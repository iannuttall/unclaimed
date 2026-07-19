import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { commercialScoreParts, isCuratedWord, isPluralWord, qualityScoreParts } from "./ranking";

/**
 * Local SQLite store for the CLI, via Node's built-in `node:sqlite` (no native
 * deps, no build step). Same shape as the Worker's D1 schema, so the two stay
 * conceptually identical. One row per domain (word × tld), plus an append-only
 * status-change log.
 */

export interface DomainRow {
  domain: string;
  word: string;
  tld: string;
  status: "available" | "registered" | "unknown";
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
  // registrar pricing (Porkbun) — null until priced
  registrar_available: number | null;
  premium: number | null;
  price: number | null;
  renewal_price: number | null;
  currency: string | null;
  priced_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS domains (
  domain TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  tld TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  source TEXT,
  expiry TEXT,
  estimated_available TEXT,
  site_status TEXT,
  has_site INTEGER,
  cold_outreach INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  first_seen TEXT NOT NULL,
  last_checked TEXT,
  became_available_at TEXT,
  check_count INTEGER NOT NULL DEFAULT 0,
  registrar_available INTEGER,
  premium INTEGER,
  price REAL,
  renewal_price REAL,
  currency TEXT,
  priced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_status       ON domains(status);
CREATE INDEX IF NOT EXISTS idx_last_checked ON domains(last_checked);
CREATE INDEX IF NOT EXISTS idx_estimated    ON domains(status, estimated_available);
CREATE INDEX IF NOT EXISTS idx_cold         ON domains(cold_outreach);
CREATE INDEX IF NOT EXISTS idx_tld_status   ON domains(tld, status);
CREATE INDEX IF NOT EXISTS idx_word_tld     ON domains(word, tld);
CREATE INDEX IF NOT EXISTS idx_status_word_tld ON domains(status, word, tld);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL
);
`;

export interface ResultUpdate {
  status: "available" | "registered" | "unknown";
  source: string | null;
  expiry: string | null;
  estimatedAvailable: string | null;
  siteStatus: string | null;
  hasSite: boolean | null;
  coldOutreach: boolean;
  httpStatus: number | null;
  checkedAt: string;
}

export type AvailableSort = "newest" | "name" | "quality" | "commercial" | "price" | "shortest";

export interface AvailableBrowseOptions {
  tlds?: string[];
  term?: string;
  form?: "singular" | "plural";
  minLen?: number;
  maxLen?: number;
  premium?: "no-premium" | "premium";
  maxPrice?: number;
  curated?: boolean;
  sort?: AvailableSort;
}

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.function("unclaimed_is_plural", { deterministic: true }, (word) =>
      Number(isPluralWord(typeof word === "string" ? word : "")),
    );
    this.db.function("unclaimed_is_curated", { deterministic: true }, (word) =>
      Number(isCuratedWord(typeof word === "string" ? word : "")),
    );
    this.db.function("unclaimed_quality", { deterministic: true }, (word, tld) =>
      qualityScoreParts(typeof word === "string" ? word : "", typeof tld === "string" ? tld : ""),
    );
    this.db.function(
      "unclaimed_commercial",
      { deterministic: true },
      (word, tld, premium, pricedAt) =>
        commercialScoreParts(
          typeof word === "string" ? word : "",
          typeof tld === "string" ? tld : "",
          premium === null ? null : premium === 1 || premium === 1n,
          pricedAt !== null,
        ),
    );
    // WAL = concurrent readers + one writer; busy_timeout makes a second writer
    // (e.g. a parallel sweep, or a query during a sweep) WAIT for the lock
    // instead of throwing "database is locked".
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 15000;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA temp_store = MEMORY;");
    this.db.exec("PRAGMA cache_size = -32768;");
    this.db.exec("PRAGMA mmap_size = 268435456;");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Add columns introduced after a db was first created (idempotent). */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare("PRAGMA table_info(domains)").all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    const add = (name: string, type: string) => {
      if (!cols.has(name)) this.db.exec(`ALTER TABLE domains ADD COLUMN ${name} ${type}`);
    };
    add("registrar_available", "INTEGER");
    add("premium", "INTEGER");
    add("price", "REAL");
    add("renewal_price", "REAL");
    add("currency", "TEXT");
    add("priced_at", "TEXT");
  }

  /** Insert word×tld rows that don't exist yet. Returns rows added. */
  seed(words: string[], tlds: string[]): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO domains (domain, word, tld, first_seen) VALUES (?, ?, ?, ?)",
    );
    let inserted = 0;
    this.db.exec("BEGIN");
    try {
      for (const word of words) {
        for (const tld of tlds) {
          inserted += Number(stmt.run(`${word}.${tld}`, word, tld, now).changes);
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return inserted;
  }

  /** Run several writes as one durable SQLite transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Build optional `tld IN (...)` and/or `word IN (...)` fragments + params.
   * Word lists scope to a form (the CLI passes the singular- or plural-word set).
   */
  private filters(tlds?: string[], words?: string[]): { clause: string; params: string[] } {
    const parts: string[] = [];
    const params: string[] = [];
    if (tlds?.length) {
      parts.push(`tld IN (${tlds.map(() => "?").join(",")})`);
      params.push(...tlds);
    }
    if (words?.length) {
      parts.push(`word IN (${words.map(() => "?").join(",")})`);
      params.push(...words);
    }
    return { clause: parts.join(" AND "), params };
  }

  countTotal(tlds?: string[], words?: string[]): number {
    const f = this.filters(tlds, words);
    const where = f.clause ? `WHERE ${f.clause}` : "";
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM domains ${where}`).get(...f.params) as {
        n: number;
      }
    ).n;
  }
  countChecked(tlds?: string[], words?: string[]): number {
    const f = this.filters(tlds, words);
    const where = `WHERE last_checked IS NOT NULL${f.clause ? ` AND ${f.clause}` : ""}`;
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM domains ${where}`).get(...f.params) as {
        n: number;
      }
    ).n;
  }

  /**
   * Rows still needing a check: never-checked OR still `unknown` but under the
   * per-domain attempt cap (so a registry that keeps timing out is retried a few
   * times, then left alone). Confident results are excluded. Scope with tlds.
   */
  pending(tlds: string[], maxAttempts: number, limit: number): DomainRow[] {
    const where = tlds.length ? `tld IN (${tlds.map(() => "?").join(",")}) AND ` : "";
    const sql = `SELECT * FROM domains
      WHERE ${where}(last_checked IS NULL OR status = 'unknown')
        AND check_count < ?
      ORDER BY last_checked IS NOT NULL, last_checked ASC
      LIMIT ?`;
    return this.db.prepare(sql).all(...tlds, maxAttempts, limit) as unknown as DomainRow[];
  }

  countPending(tlds: string[], maxAttempts: number): number {
    const where = tlds.length ? `tld IN (${tlds.map(() => "?").join(",")}) AND ` : "";
    const sql = `SELECT COUNT(*) AS n FROM domains
      WHERE ${where}(last_checked IS NULL OR status = 'unknown') AND check_count < ?`;
    return (this.db.prepare(sql).get(...tlds, maxAttempts) as { n: number }).n;
  }

  trackedTlds(): string[] {
    return (
      this.db.prepare("SELECT DISTINCT tld FROM domains ORDER BY tld").all() as { tld: string }[]
    ).map((row) => row.tld);
  }

  /** Stable cursor page for a full refresh, including confident old results. */
  refreshBatch(tlds: string[], afterDomain: string, limit: number): DomainRow[] {
    const filter = tlds.length ? `AND tld IN (${tlds.map(() => "?").join(",")})` : "";
    return this.db
      .prepare(
        `SELECT * FROM domains
         WHERE domain > ? ${filter}
         ORDER BY domain ASC
         LIMIT ?`,
      )
      .all(afterDomain, ...tlds, limit) as unknown as DomainRow[];
  }

  /** Substring search on the word (SLD), with the usual optional filters. */
  search(
    term: string,
    opts: {
      tlds?: string[];
      status?: string;
      noPremium?: boolean;
      maxPrice?: number;
      limit?: number;
    } = {},
  ): DomainRow[] {
    const like = `%${term.toLowerCase().replace(/[%_]/g, "")}%`;
    const parts = ["word LIKE ?"];
    const params: (string | number)[] = [like];
    if (opts.status) {
      parts.push("status=?");
      params.push(opts.status);
    }
    const f = this.filters(opts.tlds);
    if (f.clause) {
      parts.push(f.clause);
      params.push(...f.params);
    }
    if (opts.noPremium) parts.push("(premium IS NULL OR premium=0)");
    if (opts.maxPrice !== undefined) {
      parts.push("(price IS NOT NULL AND price <= ?)");
      params.push(opts.maxPrice);
    }
    return this.db
      .prepare(
        `SELECT * FROM domains WHERE ${parts.join(" AND ")}
         ORDER BY (status='available') DESC, word ASC LIMIT ?`,
      )
      .all(...params, opts.limit ?? 500) as unknown as DomainRow[];
  }

  forWord(word: string, tlds?: string[]): DomainRow[] {
    const f = this.filters(tlds);
    const where = `word=?${f.clause ? ` AND ${f.clause}` : ""}`;
    return this.db
      .prepare(`SELECT * FROM domains WHERE ${where} ORDER BY tld ASC`)
      .all(word, ...f.params) as unknown as DomainRow[];
  }

  /** Most useful known non-premium registration price for each TLD. */
  standardPrices(tlds?: string[]): Map<string, number> {
    const f = this.filters(tlds);
    const where = `premium=0 AND price IS NOT NULL${f.clause ? ` AND ${f.clause}` : ""}`;
    const rows = this.db
      .prepare(`SELECT tld, MIN(price) AS price FROM domains WHERE ${where} GROUP BY tld`)
      .all(...f.params) as Array<{ tld: string; price: number }>;
    return new Map(rows.map((row) => [row.tld, row.price]));
  }

  /** All rows with a given status (optionally scoped by tld) — for re-verify. */
  byStatus(status: string, tlds?: string[]): DomainRow[] {
    const f = this.filters(tlds);
    const where = `status=?${f.clause ? ` AND ${f.clause}` : ""}`;
    return this.db
      .prepare(`SELECT * FROM domains WHERE ${where} ORDER BY word ASC`)
      .all(status, ...f.params) as unknown as DomainRow[];
  }

  applyResult(row: DomainRow, u: ResultUpdate, preserveKnownOnUnknown = false): "flipped" | "same" {
    if (preserveKnownOnUnknown && row.status !== "unknown" && u.status === "unknown") {
      return "same";
    }

    const becameAvailable =
      u.status === "available" && row.status !== "available"
        ? u.checkedAt
        : u.status === "available"
          ? row.became_available_at
          : null;

    this.db
      .prepare(
        `UPDATE domains SET status=?, source=?, expiry=?, estimated_available=?,
           site_status=?, has_site=?, cold_outreach=?, http_status=?,
           last_checked=?, became_available_at=?, check_count=check_count+1
         WHERE domain=?`,
      )
      .run(
        u.status,
        u.source,
        u.expiry,
        u.estimatedAvailable,
        u.siteStatus,
        u.hasSite === null ? null : u.hasSite ? 1 : 0,
        u.coldOutreach ? 1 : 0,
        u.httpStatus,
        u.checkedAt,
        becameAvailable,
        row.domain,
      );

    const flipped = u.status !== "unknown" && u.status !== row.status;
    if (flipped) {
      this.db
        .prepare("INSERT INTO events (domain, at, from_status, to_status) VALUES (?,?,?,?)")
        .run(row.domain, u.checkedAt, row.status, u.status);
    }
    return flipped ? "flipped" : "same";
  }

  /** Available rows not yet priced (scoped) — feed to the registrar pricing pass. */
  unpricedAvailable(tlds?: string[], words?: string[]): DomainRow[] {
    const f = this.filters(tlds, words);
    const where = `status='available' AND priced_at IS NULL${f.clause ? ` AND ${f.clause}` : ""}`;
    return this.db
      .prepare(`SELECT * FROM domains WHERE ${where} ORDER BY word ASC`)
      .all(...f.params) as unknown as DomainRow[];
  }

  /** Store registrar pricing; correct status when the registrar says it's taken. */
  applyPricing(
    row: DomainRow,
    p: {
      available: boolean | null;
      premium: boolean | null;
      price: number | null;
      renewalPrice: number | null;
      currency: string;
    },
  ): "corrected" | "priced" {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE domains SET registrar_available=?, premium=?, price=?,
           renewal_price=?, currency=?, priced_at=? WHERE domain=?`,
      )
      .run(
        p.available === null ? null : p.available ? 1 : 0,
        p.premium === null ? null : p.premium ? 1 : 0,
        p.price,
        p.renewalPrice,
        p.currency,
        now,
        row.domain,
      );
    // Registrar can't register it -> our "available" was a reserved/taken name.
    if (p.available === false && row.status === "available") {
      this.db.prepare("UPDATE domains SET status='registered' WHERE domain=?").run(row.domain);
      this.db
        .prepare("INSERT INTO events (domain, at, from_status, to_status) VALUES (?,?,?,?)")
        .run(row.domain, now, "available", "registered");
      return "corrected";
    }
    return "priced";
  }

  available(
    limit = 500,
    tlds?: string[],
    words?: string[],
    opts: { noPremium?: boolean; maxPrice?: number } = {},
  ): DomainRow[] {
    const f = this.filters(tlds, words);
    const parts = [`status='available'`];
    const params: (string | number)[] = [...f.params];
    if (f.clause) parts.push(f.clause);
    if (opts.noPremium) parts.push(`(premium IS NULL OR premium=0)`);
    if (opts.maxPrice !== undefined) {
      parts.push(`(price IS NOT NULL AND price <= ?)`);
      params.push(opts.maxPrice);
    }
    return this.db
      .prepare(
        `SELECT * FROM domains WHERE ${parts.join(" AND ")}
         ORDER BY became_available_at DESC, word ASC LIMIT ?`,
      )
      .all(...params, limit) as unknown as DomainRow[];
  }
  availablePage(limit: number, offset: number, tlds?: string[]): DomainRow[] {
    return this.availableBrowsePage({ tlds, sort: "name" }, limit, offset);
  }
  countAvailable(tlds?: string[]): number {
    return this.countAvailableBrowse({ tlds });
  }

  private availableBrowseWhere(options: AvailableBrowseOptions): {
    where: string;
    params: Array<string | number>;
  } {
    const parts = ["status='available'"];
    const params: Array<string | number> = [];
    if (options.tlds?.length) {
      parts.push(`tld IN (${options.tlds.map(() => "?").join(",")})`);
      params.push(...options.tlds);
    }
    if (options.term?.trim()) {
      parts.push("word LIKE ?");
      params.push(`%${options.term.toLowerCase().replace(/[%_]/g, "")}%`);
    }
    if (options.form === "singular") parts.push("unclaimed_is_plural(word)=0");
    if (options.form === "plural") parts.push("unclaimed_is_plural(word)=1");
    if (options.minLen !== undefined) {
      parts.push("length(word)>=?");
      params.push(options.minLen);
    }
    if (options.maxLen !== undefined) {
      parts.push("length(word)<=?");
      params.push(options.maxLen);
    }
    if (options.premium === "no-premium") parts.push("(premium IS NULL OR premium=0)");
    if (options.premium === "premium") parts.push("premium=1");
    if (options.maxPrice !== undefined) {
      parts.push("price IS NOT NULL AND price<=?");
      params.push(options.maxPrice);
    }
    if (options.curated) parts.push("unclaimed_is_curated(word)=1");
    return { where: parts.join(" AND "), params };
  }

  availableBrowsePage(options: AvailableBrowseOptions, limit: number, offset: number): DomainRow[] {
    const query = this.availableBrowseWhere(options);
    const order =
      options.sort === "quality"
        ? "unclaimed_quality(word,tld) DESC, word ASC, tld ASC"
        : options.sort === "commercial"
          ? "unclaimed_commercial(word,tld,premium,priced_at) DESC, word ASC, tld ASC"
          : options.sort === "price"
            ? "price IS NULL ASC, price ASC, word ASC, tld ASC"
            : options.sort === "shortest"
              ? "length(word) ASC, word ASC, tld ASC"
              : options.sort === "name"
                ? "word ASC, tld ASC"
                : "became_available_at DESC, word ASC, tld ASC";
    return this.db
      .prepare(`SELECT * FROM domains WHERE ${query.where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...query.params, limit, offset) as unknown as DomainRow[];
  }

  countAvailableBrowse(options: AvailableBrowseOptions): number {
    const query = this.availableBrowseWhere(options);
    return (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM domains WHERE ${query.where}`)
        .get(...query.params) as {
        n: number;
      }
    ).n;
  }
  cold(limit = 500, tlds?: string[], words?: string[]): DomainRow[] {
    const f = this.filters(tlds, words);
    const where = `status='registered' AND cold_outreach=1${f.clause ? ` AND ${f.clause}` : ""}`;
    return this.db
      .prepare(
        `SELECT * FROM domains WHERE ${where}
         ORDER BY site_status ASC, word ASC LIMIT ?`,
      )
      .all(...f.params, limit) as unknown as DomainRow[];
  }
  dropping(limit = 500, tlds?: string[], words?: string[]): DomainRow[] {
    const f = this.filters(tlds, words);
    const where = `status='registered' AND estimated_available IS NOT NULL${
      f.clause ? ` AND ${f.clause}` : ""
    }`;
    return this.db
      .prepare(
        `SELECT * FROM domains WHERE ${where}
         ORDER BY estimated_available ASC LIMIT ?`,
      )
      .all(...f.params, limit) as unknown as DomainRow[];
  }
  statusCounts(
    tlds?: string[],
    words?: string[],
  ): { available: number; registered: number; unknown: number } {
    const f = this.filters(tlds, words);
    const where = f.clause ? `WHERE ${f.clause}` : "";
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM domains ${where} GROUP BY status`)
      .all(...f.params) as { status: string; n: number }[];
    const out = { available: 0, registered: 0, unknown: 0 };
    for (const r of rows) (out as Record<string, number>)[r.status] = r.n;
    return out;
  }
  coldCount(tlds?: string[], words?: string[]): number {
    const f = this.filters(tlds, words);
    const where = `cold_outreach=1${f.clause ? ` AND ${f.clause}` : ""}`;
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM domains WHERE ${where}`).get(...f.params) as {
        n: number;
      }
    ).n;
  }

  close(): void {
    this.db.close();
  }
}
