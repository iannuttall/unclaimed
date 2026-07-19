import { checkDomain, checkLiveness, words } from "@unclaimed/core";

/**
 * TLDs we track the curated word list across. Most premium single words are long
 * gone on .com/.net/.org, but new gTLDs and a few ccTLDs still have them — that's
 * where the opportunity is. Edit freely; the cron picks these up automatically.
 * The resolver handles any delegated TLD (RDAP or WHOIS), so adding more here
 * just works; undelegated ones simply resolve to "unknown" and cost nothing.
 */
export const TRACKED_TLDS = [
  // tech / startup
  "com",
  "co",
  "io",
  "ai",
  "dev",
  "app",
  "sh",
  "so",
  "xyz",
  "me",
  "tech",
  "cloud",
  "online",
  "site",
  "space",
  "world",
  "digital",
  "systems",
  "network",
  "tools",
  "codes",
  "software",
  "build",
  "run",
  "now",
  "works",
  // web / content
  "page",
  "link",
  "wiki",
  "blog",
  "email",
  "studio",
  "design",
  "art",
  "media",
  "news",
  "photos",
  "video",
  "audio",
  "film",
  "show",
  "music",
  // commerce
  "store",
  "shop",
  "market",
  "deals",
  "sale",
  "gifts",
  "money",
  "fund",
  "finance",
  "capital",
  "ventures",
  "exchange",
  "trade",
  "games",
  // community / brand
  "club",
  "team",
  "group",
  "agency",
  "life",
  "live",
  "love",
  "fun",
  "guru",
  "expert",
  "pro",
  "zone",
  // lifestyle / misc + ccTLDs
  "health",
  "fit",
  "food",
  "travel",
  "ink",
  "plus",
  "md",
  "to",
];

export interface TrackerEnv {
  DB?: D1Database;
  DOMAIN_CACHE?: KVNamespace;
}

export interface DomainRow {
  domain: string;
  word: string;
  tld: string;
  status: string;
  source: string | null;
  expiry: string | null;
  estimated_available: string | null;
  site_status: string | null;
  has_site: number | null;
  cold_outreach: number;
  http_status: number | null;
  first_seen: string;
  last_checked: string | null;
  became_available_at: string | null;
  check_count: number;
}

export class NoDbError extends Error {
  constructor() {
    super("tracking requires a D1 binding named DB. See README → Tracking setup.");
  }
}

function db(env: TrackerEnv): D1Database {
  if (!env.DB) throw new NoDbError();
  return env.DB;
}

/**
 * Seed one row per (word × tld) if the table is empty. Idempotent.
 * Pass `tlds` to seed a subset (e.g. a prioritized local sweep) instead of the
 * full TRACKED_TLDS set.
 */
export async function seedIfEmpty(env: TrackerEnv, tlds: string[] = TRACKED_TLDS): Promise<number> {
  const d = db(env);
  const existing = await d.prepare("SELECT COUNT(*) AS n FROM domains").first<{ n: number }>();
  if (existing && existing.n > 0) return 0;

  const now = new Date().toISOString();
  const list = words as string[];
  let inserted = 0;

  // D1 batches are capped; insert in chunks of statements.
  const CHUNK = 200;
  let batch: D1PreparedStatement[] = [];
  const stmt = d.prepare(
    "INSERT OR IGNORE INTO domains (domain, word, tld, first_seen) VALUES (?, ?, ?, ?)",
  );
  for (const word of list) {
    for (const tld of tlds) {
      batch.push(stmt.bind(`${word}.${tld}`, word, tld, now));
      inserted++;
      if (batch.length >= CHUNK) {
        await d.batch(batch);
        batch = [];
      }
    }
  }
  if (batch.length) await d.batch(batch);
  return inserted;
}

interface CheckBatchResult {
  checked: number;
  flipped: { domain: string; from: string; to: string }[];
}

/**
 * Re-check the `limit` stalest rows (never-checked first). For registered names
 * we also probe site presence so cold-outreach candidates surface. Concurrency
 * is deliberately low — rdap.org and registry WHOIS both rate-limit per IP.
 */
export async function runCheckBatch(
  env: TrackerEnv,
  opts: { limit?: number; concurrency?: number; liveness?: boolean } = {},
): Promise<CheckBatchResult> {
  const d = db(env);
  const { limit = 40, concurrency = 5, liveness = true } = opts;

  const { results } = await d
    .prepare(
      `SELECT * FROM domains
       ORDER BY last_checked IS NOT NULL, last_checked ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<DomainRow>();

  const flipped: CheckBatchResult["flipped"] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, results.length) }, async () => {
    while (i < results.length) {
      const row = results[i++];
      const res = await checkDomain(row.domain, { kv: env.DOMAIN_CACHE });

      let siteStatus: string | null = row.site_status;
      let hasSite: number | null = row.has_site;
      let cold = 0;
      let httpStatus: number | null = row.http_status;

      if (res.status === "registered" && liveness) {
        const live = await checkLiveness(row.domain);
        siteStatus = live.siteStatus;
        hasSite = live.hasSite ? 1 : 0;
        cold = live.coldOutreach ? 1 : 0;
        httpStatus = live.httpStatus;
      } else if (res.status !== "registered") {
        // not registered -> clear any stale site data
        siteStatus = null;
        hasSite = null;
        cold = 0;
        httpStatus = null;
      }

      const now = res.checkedAt;
      const becameAvailable =
        res.status === "available" && row.status !== "available"
          ? now
          : res.status === "available"
            ? row.became_available_at
            : null;

      await d
        .prepare(
          `UPDATE domains SET
               status = ?, source = ?, expiry = ?, estimated_available = ?,
               site_status = ?, has_site = ?, cold_outreach = ?, http_status = ?,
               last_checked = ?, became_available_at = ?,
               check_count = check_count + 1
             WHERE domain = ?`,
        )
        .bind(
          res.status,
          res.source,
          res.expiry,
          res.estimatedAvailable,
          siteStatus,
          hasSite,
          cold,
          httpStatus,
          now,
          becameAvailable,
          row.domain,
        )
        .run();

      if (res.status !== "unknown" && res.status !== row.status) {
        flipped.push({ domain: row.domain, from: row.status, to: res.status });
        await d
          .prepare(`INSERT INTO events (domain, at, from_status, to_status) VALUES (?, ?, ?, ?)`)
          .bind(row.domain, now, row.status, res.status)
          .run();
      }
    }
  });
  await Promise.all(workers);

  return { checked: results.length, flipped };
}

// ---- query helpers (behind the read endpoints) ----------------------------

export async function listAvailable(env: TrackerEnv, limit = 200): Promise<DomainRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT * FROM domains WHERE status = 'available'
       ORDER BY became_available_at DESC, word ASC LIMIT ?`,
    )
    .bind(limit)
    .all<DomainRow>();
  return results;
}

export async function listColdOutreach(env: TrackerEnv, limit = 200): Promise<DomainRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT * FROM domains
       WHERE status = 'registered' AND cold_outreach = 1
       ORDER BY site_status ASC, word ASC LIMIT ?`,
    )
    .bind(limit)
    .all<DomainRow>();
  return results;
}

/** Registered names sorted by soonest estimated drop (future-dated first). */
export async function listDropping(env: TrackerEnv, limit = 200): Promise<DomainRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT * FROM domains
       WHERE status = 'registered' AND estimated_available IS NOT NULL
       ORDER BY estimated_available ASC LIMIT ?`,
    )
    .bind(limit)
    .all<DomainRow>();
  return results;
}

export async function stats(env: TrackerEnv): Promise<Record<string, unknown>> {
  const d = db(env);
  const byStatus = await d
    .prepare(`SELECT status, COUNT(*) AS n FROM domains GROUP BY status`)
    .all<{ status: string; n: number }>();
  const total = await d.prepare(`SELECT COUNT(*) AS n FROM domains`).first<{ n: number }>();
  const checked = await d
    .prepare(`SELECT COUNT(*) AS n FROM domains WHERE last_checked IS NOT NULL`)
    .first<{ n: number }>();
  const cold = await d
    .prepare(`SELECT COUNT(*) AS n FROM domains WHERE cold_outreach = 1`)
    .first<{ n: number }>();
  return {
    total: total?.n ?? 0,
    checked: checked?.n ?? 0,
    coldOutreachCandidates: cold?.n ?? 0,
    byStatus: Object.fromEntries((byStatus.results ?? []).map((r) => [r.status, r.n])),
    trackedTlds: TRACKED_TLDS,
    curatedWords: (words as string[]).length,
  };
}
