import type { Status } from "./resolvers";

/**
 * Minimal KV shape the resolver needs. A real Cloudflare KVNamespace satisfies
 * this structurally, so the core stays free of Worker-only types and runs in
 * Node (the CLI) too, where no KV is passed at all.
 */
export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface RdapResult {
  status: Status;
  /** Registry expiry date as an ISO string, when the record exposes one. */
  expiry: string | null;
  /** Raw RDAP status array (e.g. "redemption period", "pending delete"), lowercased. */
  rdapStatuses: string[];
}

const UNKNOWN: RdapResult = { status: "unknown", expiry: null, rdapStatuses: [] };

/** Sent on every RDAP request; some servers 403 a missing/empty UA. */
const RDAP_USER_AGENT =
  "domain-check/1.0 (+https://github.com/; RDAP availability checker)";

/**
 * RDAP lookup. RDAP is the clean, JSON-native source — but it only exists for
 * gTLDs in the IANA bootstrap plus a handful of ccTLDs with direct endpoints.
 *
 *   404 -> domain not found in registry      -> AVAILABLE
 *   200 -> registry returned a record        -> REGISTERED (+ parse expiry)
 *   anything else (429 / 5xx / network)      -> UNKNOWN (caller may fall back to WHOIS)
 *
 * We NEVER treat a non-404 as "available". A 404 only means "available" when we
 * actually routed to a real RDAP server for that TLD — see resolvers.ts.
 *
 * Transient failures (429 / 5xx) are retried with a short backoff BEFORE we give
 * up and fall through to WHOIS. This keeps the answer (and its `source`) stable
 * for RDAP-enabled TLDs instead of flapping to WHOIS on every rate-limit blip.
 */
export async function rdapLookup(
  url: string,
  retries = 2,
): Promise<RdapResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          accept: "application/rdap+json",
          // rdap.org (and some registry RDAP servers) 403 requests without a
          // User-Agent. Identify ourselves so we get real 200/404 answers.
          "user-agent": RDAP_USER_AGENT,
        },
        // RDAP servers redirect (rdap.org -> registry); follow them.
        redirect: "follow",
      });
    } catch {
      if (attempt < retries) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return UNKNOWN;
    }

    if (res.status === 404) {
      return { status: "available", expiry: null, rdapStatuses: [] };
    }

    if (res.status === 200) {
      let expiry: string | null = null;
      let rdapStatuses: string[] = [];
      try {
        const body = (await res.json()) as RdapBody;
        expiry = extractRdapExpiry(body);
        rdapStatuses = (body.status ?? []).map((s) => s.toLowerCase());
      } catch {
        /* registered, but body wasn't parseable — status still stands */
      }
      return { status: "registered", expiry, rdapStatuses };
    }

    // 429 / 5xx / other: retry, then give up to WHOIS.
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await sleep(200 * (attempt + 1));
      continue;
    }
    return UNKNOWN;
  }
  return UNKNOWN;
}

interface RdapBody {
  events?: { eventAction?: string; eventDate?: string }[];
  status?: string[];
}

/** Pull the expiration eventDate out of an RDAP record and normalise to ISO. */
function extractRdapExpiry(body: RdapBody): string | null {
  const events = body.events ?? [];
  const exp = events.find(
    (e) => (e.eventAction ?? "").toLowerCase() === "expiration",
  );
  if (!exp?.eventDate) return null;
  const t = Date.parse(exp.eventDate);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * IANA RDAP bootstrap: the authoritative list of which TLDs have RDAP.
 * Cached in module scope (per-isolate) and optionally in KV for longer.
 */
const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
let bootstrapCache: Set<string> | null = null;

export async function rdapEnabledTlds(
  kv?: KvLike,
): Promise<Set<string>> {
  if (bootstrapCache) return bootstrapCache;

  // Try KV first (survives isolate restarts).
  if (kv) {
    const cached = await kv.get("rdap:bootstrap", "json");
    if (cached && Array.isArray(cached)) {
      bootstrapCache = new Set(cached as string[]);
      return bootstrapCache;
    }
  }

  const set = new Set<string>();
  try {
    const res = await fetch(BOOTSTRAP_URL);
    const data = (await res.json()) as { services: [string[], string[]][] };
    for (const [tlds] of data.services) {
      for (const t of tlds) set.add(t.toLowerCase());
    }
  } catch {
    // If the bootstrap is unreachable, return an empty set so everything
    // falls through to WHOIS rather than mis-routing to rdap.org.
    return new Set();
  }

  bootstrapCache = set;
  if (kv) {
    await kv.put("rdap:bootstrap", JSON.stringify([...set]), {
      expirationTtl: 60 * 60 * 24 * 7, // refresh weekly
    });
  }
  return set;
}
