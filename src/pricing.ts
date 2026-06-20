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

export function porkbunKeysFromEnv(): PorkbunKeys | null {
  const apikey = process.env.PORKBUN_API_KEY;
  const secretapikey = process.env.PORKBUN_SECRET_KEY;
  if (!apikey || !secretapikey) return null;
  return { apikey, secretapikey };
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
