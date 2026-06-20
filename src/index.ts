import {
  checkDomain,
  setWhoisTransport,
  type CheckResult,
  type ForceSource,
} from "./resolvers";
import { whoisQuery } from "./whois";
import {
  seedIfEmpty,
  runCheckBatch,
  listAvailable,
  listColdOutreach,
  listDropping,
  stats,
  NoDbError,
  type TrackerEnv,
} from "./tracking";

export interface Env extends TrackerEnv {
  // Optional KV: caches results + the IANA bootstrap. Worker runs fine without.
  DOMAIN_CACHE?: KVNamespace;
  // Optional D1: enables the tracking endpoints + cron (binding name: DB).
  DB?: D1Database;
  // Optional: if set, /seed and /run require ?token=<this>.
  ADMIN_TOKEN?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// WHOIS over Cloudflare sockets in the Worker runtime.
setWhoisTransport(whoisQuery);

const CACHE_TTL = 60 * 60 * 6; // 6h; available names can get registered

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function checkCached(
  domain: string,
  env: Env,
  source: ForceSource,
): Promise<CheckResult> {
  const kv = env.DOMAIN_CACHE;
  if (source !== "auto") return checkDomain(domain, { kv, source });

  if (kv) {
    const hit = await kv.get(`status:${domain}`, "json");
    if (hit) return { ...(hit as CheckResult), source: "cache" };
  }
  const result = await checkDomain(domain, { kv });
  if (kv && result.status !== "unknown") {
    await kv.put(`status:${domain}`, JSON.stringify(result), {
      expirationTtl: CACHE_TTL,
    });
  }
  return result;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

function authed(url: URL, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return true; // no token configured -> open (dev)
  return url.searchParams.get("token") === env.ADMIN_TOKEN;
}

async function handleCheck(url: URL, env: Env): Promise<Response> {
  const sourceParam = url.searchParams.get("source");
  const source: ForceSource =
    sourceParam === "rdap" || sourceParam === "whois" ? sourceParam : "auto";

  let domains: string[] = [];
  const single = url.searchParams.get("domain");
  if (single) {
    domains = [single.trim().toLowerCase()];
  } else {
    const name = url.searchParams.get("name")?.trim().toLowerCase();
    const tlds = url.searchParams.get("tlds");
    if (name && tlds) {
      domains = tlds
        .split(",")
        .map((t) => t.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean)
        .map((t) => `${name}.${t}`);
    }
  }

  if (domains.length === 0) {
    return json(
      {
        error: "pass ?domain=name.tld OR ?name=word&tlds=md,io,so,agent,dev",
        endpoints: {
          "/?domain=prompt.md": "check one domain",
          "/?name=prompt&tlds=md,io,dev": "one word across TLDs",
          "/?domain=prompt.md&source=whois": "pin a source (rdap|whois)",
          "/available": "tracked names currently available",
          "/candidates": "tracked names registered but parked / no site",
          "/dropping": "tracked names sorted by soonest estimated drop",
          "/stats": "tracking coverage + counts",
        },
      },
      400,
    );
  }
  if (domains.length > 50) return json({ error: "max 50 domains per request" }, 400);

  const results = await mapLimit(domains, 8, (d) => checkCached(d, env, source));
  return json(domains.length === 1 ? results[0] : results);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);

    try {
      switch (path) {
        case "/":
        case "/check":
          return await handleCheck(url, env);

        case "/available":
          return json(await listAvailable(env, limit));
        case "/candidates":
          return json(await listColdOutreach(env, limit));
        case "/dropping":
          return json(await listDropping(env, limit));
        case "/stats":
          return json(await stats(env));

        case "/seed": {
          if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
          const inserted = await seedIfEmpty(env);
          return json({ seeded: inserted });
        }
        case "/run": {
          if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
          const res = await runCheckBatch(env, {
            limit: Math.min(Number(url.searchParams.get("n")) || 40, 200),
          });
          return json(res);
        }

        default:
          return json({ error: "not found" }, 404);
      }
    } catch (e) {
      if (e instanceof NoDbError) return json({ error: e.message }, 501);
      return json({ error: String(e) }, 500);
    }
  },

  // Cron: re-check the stalest slice of the list. Seeding 100k+ rows is too much
  // for one cron tick — run /seed once after deploy (see README); seedIfEmpty
  // here is only a no-op safety net once the table is populated.
  //
  // CYCLE TIME: rows = words × TRACKED_TLDS. At BATCH rows every 5 min the full
  // re-check cycle ≈ rows / BATCH × 5 min. Raise BATCH (subrequest limits permit
  // — registered names also do a liveness fetch) or trim TLDs to go faster.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (!env.DB) return; // tracking not configured
    await seedIfEmpty(env);
    await runCheckBatch(env, { limit: 60, concurrency: 6 });
  },
};
