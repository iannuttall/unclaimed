import { rdapLookup, rdapEnabledTlds, type RdapResult, type KvLike } from "./rdap";

export type Status = "available" | "registered" | "unknown";
export type Source = "rdap" | "whois" | "cache";
export type ForceSource = "auto" | "rdap" | "whois";

/**
 * WHOIS transport is injected so the core has no Worker- or Node-specific import:
 *   - Worker entry  -> setWhoisTransport(whoisQuery from "./whois")       (sockets)
 *   - CLI entry     -> setWhoisTransport(whoisQuery from "./whois-node")  (node:net)
 */
export type WhoisFn = (
  server: string,
  domain: string,
  timeoutMs?: number,
) => Promise<string>;

let whoisImpl: WhoisFn | null = null;
export function setWhoisTransport(fn: WhoisFn): void {
  whoisImpl = fn;
}

export interface CheckResult {
  domain: string;
  tld: string;
  status: Status;
  source: Source;
  /** Registry expiry date (ISO) when registered and the registry exposes it. */
  expiry: string | null;
  /**
   * Best-effort estimate (ISO) of the earliest date a registered domain could
   * become available again if the registrant lets it lapse. null unless we have
   * an expiry to work from. See DROP_OFFSET_DAYS for the model.
   */
  estimatedAvailable: string | null;
  /** When this answer was produced (ISO). */
  checkedAt: string;
}

/**
 * gTLD post-expiry lifecycle, in days, from the registry expiry date to the
 * moment the name is released back to the pool:
 *   Auto-Renew Grace (≤45) → Redemption (30) → Pending Delete (5).
 * A lapsed name therefore drops ~75–80 days after expiry. We use the upper
 * bound as a single "could be available by" estimate; ccTLDs vary, so treat
 * this as guidance, not a guarantee. Many names are simply renewed and never
 * drop at all — `estimatedAvailable` is "if abandoned", not "will be free".
 */
const DROP_OFFSET_DAYS = 80;

/**
 * ccTLDs (and brand-new gTLDs) that have a working RDAP endpoint but are NOT in
 * the IANA gTLD bootstrap, so rdap.org can't route them. Hit the registry direct.
 */
const RDAP_OVERRIDES: Record<string, (domain: string) => string> = {
  io: (d) => `https://rdap.identitydigital.services/rdap/domain/${d}`,
  so: (d) => `https://rdap.nic.so/domain/${d}`,
  // add more as you discover them, e.g. .co once you find its registry RDAP host
};

/**
 * WHOIS server overrides for TLDs where `whois.nic.<tld>` is NOT the right host.
 * The vast majority of new gTLDs and many ccTLDs DO follow whois.nic.<tld>,
 * so this map stays small.
 */
const WHOIS_OVERRIDES: Record<string, string> = {
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  co: "whois.nic.co",
  me: "whois.nic.me",
  ai: "whois.nic.ai",
  // md uses whois.nic.md (the default pattern), listed here for clarity:
  md: "whois.nic.md",
};

/**
 * "This domain is not registered" phrases, by TLD. `default` covers most
 * registries; add a TLD-specific entry only when a registry phrases it oddly.
 * Matching is case-insensitive.
 */
const AVAILABLE_PATTERNS: Record<string, RegExp[]> = {
  default: [
    /no match/i,
    /not found/i,
    /no entries found/i,
    /no data found/i,
    /no object found/i,
    /status:\s*free/i,
    /available for registration/i,
    /domain .* is free/i,
    /not registered/i,
    // NB: deliberately NOT /is available for/ — it matches parked-domain text
    // like "this domain is available for sale", which is a REGISTERED name.
  ],
  md: [/no match/i, /not found/i],
};

/**
 * Markers that the name exists / is taken but isn't a normal registration:
 * registry-reserved, blocked, or premium-not-yet-sold. RDAP often 404s these
 * (so they'd look "available"), but they're not registerable. Treat as taken.
 * Patterns are specific to avoid matching boilerplate like "All rights reserved".
 */
const RESERVED_PATTERNS: RegExp[] = [
  /is reserved/i,
  /reserved by/i,
  /name is reserved/i,
  /reserved name/i,
  /not available for registration/i,
  /blocked for registration/i,
];

/** Markers that positively indicate a registered domain. */
const REGISTERED_PATTERNS: RegExp[] = [
  /creation date/i,
  /created on/i,
  /created:/i,
  /registered on/i, // NIC.md and others
  /registrar:/i,
  /registry expiry/i,
  /expiry date/i,
  /expiration date/i,
  /expires on/i,
  /registrant/i,
  /domain status:\s*(?!free)/i,
  /domain state:\s*(?!free|available|no\b)/i, // NIC.md "Domain state: OK"
  /nserver/i,
  /name\s?servers?:/i, // "name server", "Name Server:", "NameServer:"
];

/**
 * Expiry-date labels seen across registry WHOIS output. First capture group is
 * the date string, parsed with Date.parse and normalised to ISO.
 */
const WHOIS_EXPIRY_PATTERNS: RegExp[] = [
  /registry expiry date:\s*(.+)/i,
  /registrar registration expiration date:\s*(.+)/i,
  /expiration date:\s*(.+)/i,
  /expiration time:\s*(.+)/i,
  /expiry date:\s*(.+)/i,
  /expires on:\s*(.+)/i,
  /expire date:\s*(.+)/i,
  /^\s*expires:\s*(.+)/im,
  /^\s*expire:\s*(.+)/im,
  /paid-till:\s*(.+)/i,
  /renewal date:\s*(.+)/i,
  /valid until:\s*(.+)/i,
];

function classifyWhois(tld: string, text: string): Status {
  const body = text.trim();
  if (!body) return "unknown";

  // "Taken" signals win FIRST. A parked/registered domain can contain phrases
  // like "available for sale", so a real registration marker (creation date,
  // expiry, registrant, nameservers) or a reserved marker must take precedence
  // over the available patterns.
  if (REGISTERED_PATTERNS.some((re) => re.test(body))) return "registered";
  if (RESERVED_PATTERNS.some((re) => re.test(body))) return "registered";

  const avail = AVAILABLE_PATTERNS[tld] ?? AVAILABLE_PATTERNS.default;
  if (avail.some((re) => re.test(body))) return "available";
  return "unknown";
}

function extractWhoisExpiry(text: string): string | null {
  for (const re of WHOIS_EXPIRY_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const t = Date.parse(m[1].trim());
      if (!Number.isNaN(t)) return new Date(t).toISOString();
    }
  }
  return null;
}

/** expiry + DROP_OFFSET_DAYS, or null when expiry is unknown. */
function estimateDrop(expiry: string | null): string | null {
  if (!expiry) return null;
  const t = Date.parse(expiry);
  if (Number.isNaN(t)) return null;
  return new Date(t + DROP_OFFSET_DAYS * 86_400_000).toISOString();
}

/**
 * Per-registry WHOIS pacing. Some registries (notably NIC.md) rate-limit and
 * temporarily block you after a burst, so all queries to a throttly server are
 * spaced at least N ms apart — across concurrent workers — via a per-server slot
 * reservation. Fast registries (entry absent → 0) are never delayed.
 * Add a TLD's whois host here if you see it returning bursts of "unknown".
 */
const WHOIS_PACE_MS: Record<string, number> = {
  "whois.nic.md": 1800,
};
const whoisSlot = new Map<string, number>();
async function paceWhois(server: string): Promise<void> {
  const min = WHOIS_PACE_MS[server];
  if (!min) return;
  const now = Date.now();
  const slot = Math.max(now, (whoisSlot.get(server) ?? 0) + min);
  whoisSlot.set(server, slot);
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** One WHOIS lookup, classified. Returns "unknown" on any transport error. */
async function runWhois(
  tld: string,
  domain: string,
): Promise<{ status: Status; expiry: string | null }> {
  if (!whoisImpl) return { status: "unknown", expiry: null };
  const server = WHOIS_OVERRIDES[tld] ?? `whois.nic.${tld}`;
  try {
    await paceWhois(server);
    const text = await whoisImpl(server, domain);
    const status = classifyWhois(tld, text);
    const expiry = status === "registered" ? extractWhoisExpiry(text) : null;
    return { status, expiry };
  } catch {
    return { status: "unknown", expiry: null };
  }
}

/**
 * Resolve a single domain to a status.
 *
 * Order (when source = "auto"):
 *   1. Direct registry RDAP override (io, so, ...)
 *   2. rdap.org, but ONLY if the TLD is in the IANA bootstrap (else 404 lies)
 *   3. WHOIS over TCP (covers everything RDAP misses, including .md and new gTLDs)
 *
 * RDAP that returns "unknown" (429 / 5xx after retries) falls back to WHOIS.
 *
 * `source` can pin the lookup to a single path. This is what the stability test
 * harness uses to confirm RDAP and WHOIS agree on the same domain — and it lets
 * callers force WHOIS for expiry detail RDAP sometimes omits.
 */
export async function checkDomain(
  domain: string,
  opts: { kv?: KvLike; source?: ForceSource } = {},
): Promise<CheckResult> {
  const { kv, source = "auto" } = opts;
  const tld = domain.split(".").pop()!.toLowerCase();
  const checkedAt = new Date().toISOString();

  const finalize = (
    status: Status,
    src: Source,
    expiry: string | null,
  ): CheckResult => ({
    domain,
    tld,
    status,
    source: src,
    expiry,
    estimatedAvailable: status === "registered" ? estimateDrop(expiry) : null,
    checkedAt,
  });

  // ---- RDAP path (skipped when source is pinned to "whois") ----
  if (source !== "whois") {
    let rdap: RdapResult | null = null;
    if (RDAP_OVERRIDES[tld]) {
      rdap = await rdapLookup(RDAP_OVERRIDES[tld](domain));
    } else {
      const enabled = await rdapEnabledTlds(kv);
      if (enabled.has(tld)) {
        rdap = await rdapLookup(`https://rdap.org/domain/${domain}`);
      }
    }

    if (rdap && rdap.status === "registered") {
      return finalize("registered", "rdap", rdap.expiry);
    }

    if (rdap && rdap.status === "available") {
      // RDAP 404 is NOT proof of availability — registry-reserved / blocked /
      // premium-unsold names also 404. Confirm against WHOIS before trusting it.
      // (Pinned source=rdap skips this so the compare harness sees raw RDAP.)
      if (source === "rdap") return finalize("available", "rdap", null);
      const whois = await runWhois(tld, domain);
      if (whois.status === "registered") {
        return finalize("registered", "whois", whois.expiry); // taken/reserved
      }
      return finalize("available", "rdap", null); // confirmed, or WHOIS unsure
    }

    // RDAP unknown. If the caller pinned "rdap", report unknown rather than
    // silently answering from a different source.
    if (source === "rdap") {
      return finalize("unknown", "rdap", null);
    }
  }

  // ---- WHOIS path (RDAP unknown, or source pinned to whois) ----
  const whois = await runWhois(tld, domain);
  return finalize(whois.status, "whois", whois.expiry);
}
