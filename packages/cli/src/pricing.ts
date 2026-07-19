/**
 * Registrar pricing/availability via the Porkbun API.
 *
 * RDAP/WHOIS can't tell us (a) that a name is registry-reserved and NOT actually
 * registerable (e.g. domain.now on a no-WHOIS Amazon TLD), or (b) that an
 * available name is premium-priced (e.g. source.build at a steep price). The
 * registrar knows both. We use Porkbun's checkDomain as the authority over our
 * "available" guesses.
 *
 * Keys: create an API key + secret in your Porkbun account and ENABLE API
 * access, then put them in .env:
 *   PORKBUN_API_KEY=pk1_...
 *   PORKBUN_SECRET_KEY=sk1_...
 */

export interface PorkbunKeys {
  apikey: string;
  secretapikey: string;
}

export interface PricingResult {
  available: boolean | null; // registrar can register it right now
  premium: boolean | null;
  price: number | null; // first-year registration price
  renewalPrice: number | null;
  currency: string; // Porkbun quotes USD
}

const BASE = "https://api.porkbun.com/api/json/v3";

// Flat-rate TLDs which are not carried by Porkbun. Keep these alongside the
// public base-price feed so the CLI and interactive UI share one fallback.
export const FLAT_TLD_PRICES: Readonly<Record<string, number>> = { so: 70, md: 57 };

export function porkbunKeysFromEnv(): PorkbunKeys | null {
  const apikey = process.env.PORKBUN_API_KEY;
  const secretapikey = process.env.PORKBUN_SECRET_KEY;
  if (!apikey || !secretapikey) return null;
  return { apikey, secretapikey };
}

/**
 * TLDs Porkbun actually sells (free, unauthenticated, unlimited). Pricing a TLD
 * Porkbun doesn't carry just wastes a rate-limited call and can mis-report a
 * genuinely-available name as unavailable — so skip those.
 */
export async function porkbunSupportedTlds(): Promise<Set<string>> {
  const res = await fetch(`${BASE}/pricing/get`, { signal: AbortSignal.timeout(15000) });
  const j = (await res.json()) as { status?: string; pricing?: Record<string, unknown> };
  return new Set(Object.keys(j.pricing ?? {}));
}

/** Validate keys (and connectivity). Returns the egress IP on success. */
export async function porkbunPing(keys: PorkbunKeys): Promise<string> {
  const res = await fetch(`${BASE}/ping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(keys),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json()) as { status?: string; yourIp?: string; message?: string };
  if (j.status !== "SUCCESS") throw new Error(j.message || "porkbun auth failed");
  return j.yourIp ?? "";
}

/** Registration base prices per TLD from Porkbun's free /pricing/get — used as
 *  the reference "standard" price across providers (premium prices come per-name). */
export async function porkbunTldPrices(timeoutMs = 15000): Promise<Map<string, number>> {
  const res = await fetch(`${BASE}/pricing/get`, { signal: AbortSignal.timeout(timeoutMs) });
  const j = (await res.json()) as {
    pricing?: Record<string, { registration?: string }>;
  };
  const map = new Map<string, number>();
  for (const [tld, p] of Object.entries(j.pricing ?? {})) {
    const n = Number(p?.registration);
    if (!Number.isNaN(n)) map.set(tld, n);
  }
  return map;
}

// ---- Namecheap (bulk) -----------------------------------------------------

export interface NamecheapCreds {
  apiUser: string;
  apiKey: string;
  userName: string;
  clientIp: string;
}

export function namecheapCredsFromEnv(): Omit<NamecheapCreds, "clientIp"> | null {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const userName = process.env.NAMECHEAP_USERNAME || apiUser;
  if (!apiUser || !apiKey || !userName) return null;
  return { apiUser, apiKey, userName };
}

/** Public egress IP (must be whitelisted in Namecheap). Env override wins. */
export async function detectClientIp(): Promise<string> {
  if (process.env.NAMECHEAP_CLIENT_IP) return process.env.NAMECHEAP_CLIENT_IP;
  try {
    const r = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(10000) });
    return (await r.text()).trim();
  } catch {
    return "";
  }
}

const NC_BASE = "https://api.namecheap.com/xml.response";

function ncUrl(command: string, creds: NamecheapCreds, extra: Record<string, string>): string {
  const p = new URLSearchParams({
    ApiUser: creds.apiUser,
    ApiKey: creds.apiKey,
    UserName: creds.userName,
    ClientIp: creds.clientIp,
    Command: command,
    ...extra,
  });
  return `${NC_BASE}?${p.toString()}`;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

/** The set of TLDs Namecheap offers (namecheap.domains.getTldList). */
export async function namecheapSupportedTlds(creds: NamecheapCreds): Promise<Set<string>> {
  const res = await fetch(ncUrl("namecheap.domains.getTldList", creds, {}), {
    signal: AbortSignal.timeout(20000),
  });
  const xml = await res.text();
  if (/Status="ERROR"/i.test(xml)) {
    const err = xml.match(/<Error[^>]*>([^<]*)<\/Error>/i)?.[1] ?? "namecheap error";
    throw new Error(err);
  }
  const set = new Set<string>();
  for (const m of xml.matchAll(/<Tld\s+([^>]*?)>/gi)) {
    const name = attr(m[1], "Name");
    if (name) set.add(name.toLowerCase());
  }
  return set;
}

export interface NcCheck {
  available: boolean | null;
  premium: boolean | null;
  premiumPrice: number | null;
}

/** Bulk availability+premium check (up to ~50 domains per call). */
export async function namecheapBulkCheck(
  domains: string[],
  creds: NamecheapCreds,
): Promise<Map<string, NcCheck>> {
  const out = new Map<string, NcCheck>();
  const res = await fetch(
    ncUrl("namecheap.domains.check", creds, { DomainList: domains.join(",") }),
    { signal: AbortSignal.timeout(30000) },
  );
  const xml = await res.text();
  if (/Status="ERROR"/i.test(xml)) {
    const err = xml.match(/<Error[^>]*>([^<]*)<\/Error>/i)?.[1] ?? "namecheap error";
    throw new Error(err);
  }
  for (const m of xml.matchAll(/<DomainCheckResult\s+([^>]*?)\/?>/gi)) {
    const t = m[1];
    const domain = (attr(t, "Domain") ?? "").toLowerCase();
    if (!domain) continue;
    const prem = attr(t, "IsPremiumName");
    const price = Number(attr(t, "PremiumRegistrationPrice"));
    out.set(domain, {
      available: attr(t, "Available")?.toLowerCase() === "true",
      premium: prem == null ? null : prem.toLowerCase() === "true",
      premiumPrice: !Number.isNaN(price) && price > 0 ? price : null,
    });
  }
  return out;
}

interface CheckResponse {
  status?: string;
  message?: string;
  response?: {
    avail?: string; // "yes" | "no"
    premium?: string; // "yes" | "no"
    price?: string;
    regularPrice?: string;
    additional?: { renewal?: { price?: string } };
  };
}

const num = (s: string | undefined): number | null =>
  s != null && s !== "" && !Number.isNaN(Number(s)) ? Number(s) : null;
const yn = (s: string | undefined): boolean | null =>
  s === "yes" ? true : s === "no" ? false : null;

/**
 * Check one domain. Returns null on transport/auth/rate-limit error so the
 * caller can leave it unpriced and retry later (never a wrong correction).
 */
export async function checkPorkbun(
  domain: string,
  keys: PorkbunKeys,
): Promise<PricingResult | null> {
  try {
    const res = await fetch(`${BASE}/domain/checkDomain/${encodeURIComponent(domain)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(keys),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as CheckResponse;
    if (j.status !== "SUCCESS" || !j.response) return null;
    const r = j.response;
    return {
      available: yn(r.avail),
      premium: yn(r.premium),
      price: num(r.price) ?? num(r.regularPrice),
      renewalPrice: num(r.additional?.renewal?.price) ?? num(r.regularPrice),
      currency: "USD",
    };
  } catch {
    return null;
  }
}
