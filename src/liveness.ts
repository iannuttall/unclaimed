/**
 * Site-presence ("liveness") probe for REGISTERED domains.
 *
 * A name can be taken yet have nothing real on it — no DNS, a dead server, or a
 * registrar/parking lander. Those are the cold-outreach candidates: the owner
 * isn't using the name, so they may sell or let it lapse.
 *
 *   none    -> doesn't resolve / connection refused on http+https  (best lead)
 *   parked  -> resolves but serves a parking / "for sale" lander    (good lead)
 *   live    -> resolves and serves real content                     (in use)
 *   unknown -> timed out or blocked us; can't tell
 *
 * `coldOutreach` is true for none/parked. Runs only when asked (it's a live
 * subrequest per domain), never for available/unknown names.
 */

export type SiteStatus = "live" | "parked" | "none" | "unknown";

export interface LivenessResult {
  siteStatus: SiteStatus;
  hasSite: boolean; // true only for "live"
  coldOutreach: boolean; // true for none / parked
  httpStatus: number | null;
  finalUrl: string | null;
  signal: string | null; // what tipped the classification (parking host, error, ...)
  checkedAt: string;
}

/** Substrings that, in the final URL host or the body, signal a parked name. */
const PARKING_MARKERS: string[] = [
  // parking / aftermarket hosts
  "sedoparking.com",
  "bodis.com",
  "parkingcrew.net",
  "parkingcrew.com",
  "afternic.com",
  "dan.com",
  "undeveloped.com",
  "hugedomains.com",
  "above.com",
  "voodoo.com",
  "skenzo.com",
  "domainparking",
  "parklogic",
  "fabulous.com",
  "sav.com",
  "rookmedia",
  "cashparking",
  // lander copy
  "buy this domain",
  "this domain is for sale",
  "the domain is for sale",
  "domain is for sale",
  "domain for sale",
  "is for sale",
  "buy now for",
  "parked free",
  "courtesy of godaddy",
  "future home of",
  "this web page is parked",
  "domain has expired",
  "domain name has expired",
  "renew now",
];

const MAX_BODY_BYTES = 16 * 1024; // enough to catch a lander; cheap to read

async function fetchCapped(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; finalUrl: string; body: string } | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // look like a normal browser so we get the real page, not a bot wall
        "user-agent":
          "Mozilla/5.0 (compatible; domain-check/1.0; +https://github.com/)",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });

    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      while (received < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          body += decoder.decode(value, { stream: true });
        }
      }
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
    }
    return { status: res.status, finalUrl: res.url || url, body };
  } catch {
    return null;
  }
}

function detectParking(finalUrl: string, body: string): string | null {
  const host = (() => {
    try {
      return new URL(finalUrl).host.toLowerCase();
    } catch {
      return "";
    }
  })();
  const hay = (host + "\n" + body).toLowerCase();
  for (const m of PARKING_MARKERS) {
    if (hay.includes(m)) return m;
  }
  return null;
}

export async function checkLiveness(
  domain: string,
  timeoutMs = 6000,
): Promise<LivenessResult> {
  const checkedAt = new Date().toISOString();
  const base: Omit<LivenessResult, "siteStatus" | "hasSite" | "coldOutreach"> = {
    httpStatus: null,
    finalUrl: null,
    signal: null,
    checkedAt,
  };

  // Try HTTPS first, then HTTP. A connection/DNS failure on both => "none".
  const res =
    (await fetchCapped(`https://${domain}/`, timeoutMs)) ??
    (await fetchCapped(`http://${domain}/`, timeoutMs));

  if (!res) {
    return {
      ...base,
      siteStatus: "none",
      hasSite: false,
      coldOutreach: true,
      signal: "no-response",
    };
  }

  const parking = detectParking(res.finalUrl, res.body);
  if (parking) {
    return {
      ...base,
      siteStatus: "parked",
      hasSite: false,
      coldOutreach: true,
      httpStatus: res.status,
      finalUrl: res.finalUrl,
      signal: `parking:${parking}`,
    };
  }

  // Server errors / gateway pages aren't a real site, but aren't clearly a lead
  // either — call it unknown rather than overclaiming.
  if (res.status >= 500 || res.status === 403 || res.status === 0) {
    return {
      ...base,
      siteStatus: "unknown",
      hasSite: false,
      coldOutreach: false,
      httpStatus: res.status,
      finalUrl: res.finalUrl,
      signal: `http-${res.status}`,
    };
  }

  // Resolves, no parking markers, non-error status, has some body => live.
  const looksEmpty = res.body.replace(/\s+/g, "").length < 200;
  if (looksEmpty && (res.status === 404 || res.status === 410)) {
    return {
      ...base,
      siteStatus: "none",
      hasSite: false,
      coldOutreach: true,
      httpStatus: res.status,
      finalUrl: res.finalUrl,
      signal: `empty-${res.status}`,
    };
  }

  return {
    ...base,
    siteStatus: "live",
    hasSite: true,
    coldOutreach: false,
    httpStatus: res.status,
    finalUrl: res.finalUrl,
    signal: null,
  };
}
