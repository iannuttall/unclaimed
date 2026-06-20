#!/usr/bin/env node
/**
 * domains — a local CLI for finding/tracking premium brandable domains.
 *
 *   pnpm domains check prompt.io
 *   pnpm domains check prompt --tlds=io,ai,dev
 *   pnpm domains sweep                 # check the curated list × priority TLDs
 *   pnpm domains available             # what's free
 *   pnpm domains candidates            # registered but no real site (cold outreach)
 *   pnpm domains dropping              # registered, soonest estimated drop first
 *   pnpm domains stats
 *
 * No deploy, no Cloudflare. WHOIS runs over node:net, RDAP/liveness over fetch,
 * results persist in a local SQLite db (node:sqlite) at ./data/domains.db.
 */
import { readFileSync, existsSync } from "node:fs";
import { checkDomain, setWhoisTransport } from "./resolvers";
import { whoisQuery } from "./whois-node";
import { checkLiveness } from "./liveness";
import {
  porkbunTldPrices,
  namecheapCredsFromEnv,
  detectClientIp,
  namecheapSupportedTlds,
  namecheapBulkCheck,
} from "./pricing";
import { Store, type DomainRow, type ResultUpdate } from "./store";
import words from "./words.json";

// WHOIS over node:net in the CLI runtime.
setWhoisTransport(whoisQuery);

// Minimal .env loader (no dep): PORKBUN_API_KEY / PORKBUN_SECRET_KEY etc.
function loadEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Highest-opportunity TLDs for premium single words: newer/brandable gTLDs with
// real unregistered inventory, plus the iconic-but-saturated ones (still useful
// as drop / cold-outreach leads). Override with --tlds=.
const PRIORITY_TLDS = [
  "io", "ai", "dev", "app", "sh", "so", "xyz",
  "run", "now", "build", "studio", "store", "link", "space", "live", "to",
];

const DEFAULT_DB = "./data/domains.db";

// ---- tiny arg parser ------------------------------------------------------
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }
  return { positional, flags };
}

function parseTlds(flags: Record<string, string | boolean>): string[] | undefined {
  const t = flags.tlds;
  if (typeof t === "string" && t.trim())
    return t.split(",").map((x) => x.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
  return undefined;
}

/** For sweep/check: fall back to the priority set when no --tlds given. */
function tldList(flags: Record<string, string | boolean>): string[] {
  return parseTlds(flags) ?? PRIORITY_TLDS;
}

// Singular vs plural is derived from the curated list itself: a word is plural
// when its singular form is ALSO in the list (keys -> key, lights -> light).
function singularize(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(?:ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}
const WORD_SET = new Set(words as string[]);
const PLURAL_WORDS = (words as string[]).filter((w) => {
  const sg = singularize(w);
  return sg !== w && WORD_SET.has(sg);
});
const PLURAL_SET = new Set(PLURAL_WORDS);
const SINGULAR_WORDS = (words as string[]).filter((w) => !PLURAL_SET.has(w));

function parseForm(flags: Record<string, string | boolean>): "singular" | "plural" | undefined {
  if (flags.plural === true || flags.form === "plural") return "plural";
  if (flags.singular === true || flags.form === "singular") return "singular";
  return undefined;
}
function formWords(form: "singular" | "plural" | undefined): string[] | undefined {
  if (form === "plural") return PLURAL_WORDS;
  if (form === "singular") return SINGULAR_WORDS;
  return undefined;
}

// Word (SLD) length filter: --len=4-5 or --len=5, or --min-len / --max-len.
function parseLen(flags: Record<string, string | boolean>): { min?: number; max?: number } {
  let min: number | undefined;
  let max: number | undefined;
  if (typeof flags.len === "string") {
    const m = flags.len.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      min = Number(m[1]);
      max = m[2] ? Number(m[2]) : Number(m[1]);
    }
  }
  if (flags["min-len"]) min = Number(flags["min-len"]);
  if (flags["max-len"]) max = Number(flags["max-len"]);
  return { min, max };
}

// The word-IN filter implied by --singular/--plural + --len (undefined = no filter).
function wordFilterFromFlags(flags: Record<string, string | boolean>): string[] | undefined {
  const form = parseForm(flags);
  const { min, max } = parseLen(flags);
  if (!form && min === undefined && max === undefined) return undefined;
  const base = formWords(form) ?? (words as string[]);
  const pool = base.filter(
    (w) => (min === undefined || w.length >= min) && (max === undefined || w.length <= max),
  );
  return pool.length ? pool : [" "]; // sentinel matches nothing
}

// ---- quality scoring ------------------------------------------------------
// A domain's quality ≈ how premium the WORD is (its rank in the curated list,
// which is ordered most-common-first) × how desirable the TLD is.
const WORD_RANK = new Map((words as string[]).map((w, i) => [w, i]));
const TOTAL_WORDS = (words as string[]).length;

// TLD desirability, 0–100. Tuned by hand; unlisted TLDs default to 45.
const TLD_TIER: Record<string, number> = {
  com: 100, ai: 96, io: 92,
  co: 82, dev: 82, app: 80,
  sh: 70, run: 70, studio: 68, now: 66, store: 66, build: 64, link: 64,
  live: 64, pro: 64, space: 62, so: 62, xyz: 60, design: 60, art: 58, tech: 60,
  cloud: 60, life: 60, shop: 58, page: 56, music: 56, health: 56, fit: 56,
  food: 56, love: 56, ventures: 56, money: 56, fund: 54, capital: 54,
  finance: 54, blog: 54, media: 54, games: 54, world: 52, online: 52, site: 52,
  news: 52, video: 52, exchange: 52, club: 52, team: 52, works: 50, codes: 50,
  software: 50, network: 50, tools: 50, digital: 50, email: 50, wiki: 50,
  audio: 50, film: 50, show: 50, plus: 50, market: 50, agency: 50, fun: 50,
  systems: 48, trade: 48, group: 48, zone: 48, ink: 48, photos: 46, deals: 46,
  sale: 46, gifts: 46, expert: 46, guru: 44, md: 42,
};
const tldTier = (tld: string): number => TLD_TIER[tld] ?? 45;

function qualityScore(row: DomainRow): number {
  const idx = WORD_RANK.get(row.word) ?? TOTAL_WORDS;
  const wordScore = 100 * (1 - idx / TOTAL_WORDS); // 100 = most common word
  return Math.round(wordScore * 0.55 + tldTier(row.tld) * 0.45);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- concurrency-limited runner with live progress ------------------------
// delayMs paces each worker (a pause between its requests) — needed for
// rate-limited single-registry WHOIS TLDs like .md that block bulk lookups.
async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<void>,
  delayMs = 0,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
      if (delayMs) await sleep(delayMs);
    }
  });
  await Promise.all(workers);
}

// ---- check one domain (availability + liveness for registered) ------------
async function resolveOne(domain: string, liveness: boolean): Promise<ResultUpdate> {
  const res = await checkDomain(domain);
  let siteStatus: string | null = null;
  let hasSite: boolean | null = null;
  let coldOutreach = false;
  let httpStatus: number | null = null;

  if (res.status === "registered" && liveness) {
    const live = await checkLiveness(domain);
    siteStatus = live.siteStatus;
    hasSite = live.hasSite;
    coldOutreach = live.coldOutreach;
    httpStatus = live.httpStatus;
  }
  return {
    status: res.status,
    source: res.source,
    expiry: res.expiry,
    estimatedAvailable: res.estimatedAvailable,
    siteStatus,
    hasSite,
    coldOutreach,
    httpStatus,
    checkedAt: res.checkedAt,
  };
}

// ---- printing -------------------------------------------------------------
const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const statusColor = (s: string) =>
  s === "available" ? C.green(s) : s === "registered" ? C.dim(s) : C.yellow(s);

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

// Registrar pricing suffix once a row has been priced: a "*" marks premium,
// followed by the price, e.g. "  *$174.1" (premium) or "  $19.05" (standard).
function priceSuffix(r: DomainRow): string {
  if (!r.priced_at) return "";
  const star = r.premium ? C.red("*") : " ";
  const price =
    r.price != null ? `${r.currency === "USD" ? "$" : ""}${r.price}` : r.premium ? "" : "—";
  return "  " + star + C.dim(price);
}

function printRows(rows: DomainRow[], cols: "drop" | "site" | "plain") {
  for (const r of rows) {
    if (cols === "drop") {
      console.log(
        `  ${r.domain.padEnd(22)} expiry ${fmtDate(r.expiry)}  drop~ ${C.bold(
          fmtDate(r.estimated_available),
        )}  ${C.dim(r.site_status ?? "")}`,
      );
    } else if (cols === "site") {
      const tag = r.site_status === "none" ? C.red("no-site") : C.yellow(r.site_status ?? "?");
      console.log(`  ${r.domain.padEnd(22)} ${tag}  ${C.dim("expiry " + fmtDate(r.expiry))}`);
    } else {
      console.log(`  ${C.green(r.domain)}${priceSuffix(r)}`);
    }
  }
}

// Quality-ranked rows: a score badge then the domain (best first).
function printScored(rows: DomainRow[], extra?: "site" | "drop") {
  for (const r of rows) {
    const s = qualityScore(r);
    const badge = (s >= 75 ? C.green : s >= 55 ? C.yellow : C.dim)(String(s).padStart(3));
    let tail = "";
    if (extra === "site") tail = C.dim("  " + (r.site_status ?? ""));
    else if (extra === "drop") tail = C.dim("  drop~ " + fmtDate(r.estimated_available));
    console.log(`  ${badge}  ${r.domain}${priceSuffix(r)}${tail}`);
  }
}

// ---- commands -------------------------------------------------------------
async function cmdCheck(positional: string[], flags: Record<string, string | boolean>) {
  const liveness = flags["no-liveness"] !== true;
  let domains: string[];
  const arg = positional[0];
  if (!arg) return fail("usage: domains check <domain|word> [--tlds=io,ai,dev]");
  if (arg.includes(".")) domains = [arg.toLowerCase()];
  else domains = tldList(flags).map((t) => `${arg.toLowerCase()}.${t}`);

  await runPool(domains, 6, async (domain) => {
    const u = await resolveOne(domain, liveness);
    const extra =
      u.status === "registered"
        ? C.dim(
            `  ${u.siteStatus ?? ""}${u.expiry ? " · expiry " + fmtDate(u.expiry) : ""}` +
              (u.estimatedAvailable ? " · drop~ " + fmtDate(u.estimatedAvailable) : ""),
          )
        : "";
    console.log(`  ${domain.padEnd(22)} ${statusColor(u.status)} ${C.dim(u.source ?? "")}${extra}`);
  });
}

async function cmdSweep(flags: Record<string, string | boolean>) {
  const dbPath = (flags.db as string) || DEFAULT_DB;
  const tlds = tldList(flags);
  const concurrency = Number(flags.concurrency) || 6;
  const liveness = flags["no-liveness"] !== true;
  const maxAttempts = Number(flags.retries) || 3;
  const delay = Number(flags.delay) || 0;
  const wordLimit = flags.words ? Number(flags.words) : (words as string[]).length;
  const batch = Number(flags.batch) || 300;

  const store = new Store(dbPath);
  const wordSet = (words as string[]).slice(0, wordLimit);
  const added = store.seed(wordSet, tlds);
  const total = wordSet.length * tlds.length;

  console.log(
    C.bold(`\nSweep: ${wordSet.length} words × ${tlds.length} TLDs = ${total} domains`),
  );
  console.log(C.dim(`tlds: ${tlds.join(", ")}`));
  console.log(C.dim(`db: ${dbPath}  (+${added} new rows)  concurrency=${concurrency}\n`));

  const startPending = store.countPending(tlds, maxAttempts);
  let done = 0;
  let avail = 0;
  let cold = 0;
  const t0 = Date.now();

  while (true) {
    const rows = store.pending(tlds, maxAttempts, batch);
    if (rows.length === 0) break;
    await runPool(rows, concurrency, async (row) => {
      let u: ResultUpdate;
      try {
        u = await resolveOne(row.domain, liveness);
      } catch {
        u = {
          status: "unknown", source: null, expiry: null, estimatedAvailable: null,
          siteStatus: null, hasSite: null, coldOutreach: false, httpStatus: null,
          checkedAt: new Date().toISOString(),
        };
      }
      store.applyResult(row, u);
      done++;
      if (u.status === "available") {
        avail++;
        process.stdout.write("\r\x1b[K" + C.green(`  ✓ available: ${row.domain}`) + "\n");
      }
      if (u.coldOutreach) cold++;
      if (done % 10 === 0 || done === startPending) {
        const rate = done / Math.max(1, (Date.now() - t0) / 1000);
        process.stdout.write(
          `\r\x1b[K${C.dim(
            `  checked ${done}/${startPending}  ·  available ${avail}  ·  cold ${cold}  ·  ${rate.toFixed(1)}/s`,
          )}`,
        );
      }
    }, delay);
  }

  process.stdout.write("\r\x1b[K");
  const sc = store.statusCounts();
  console.log(C.bold(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`));
  console.log(
    `  ${C.green("available " + sc.available)}   registered ${sc.registered}   ${C.yellow(
      "unknown " + sc.unknown,
    )}   cold-outreach ${store.coldCount()}`,
  );
  console.log(C.dim(`\n  pnpm domains available | candidates | dropping\n`));

  // --price: after resolution, price the available names (registrar pricing +
  // false-positive correction). Note this is rate-limited (~1/10s) so it can run
  // far longer than the sweep itself.
  if (flags.price === true) {
    await runPricing(store, flags);
  }
  store.close();
}

// Re-check rows currently marked `--status` (default: available) with the
// current resolver — catches stored false positives after a logic fix.
async function cmdVerify(flags: Record<string, string | boolean>) {
  const dbPath = (flags.db as string) || DEFAULT_DB;
  const status = (flags.status as string) || "available";
  const tlds = parseTlds(flags);
  const concurrency = Number(flags.concurrency) || 6;
  const delay = Number(flags.delay) || 0;
  const liveness = flags["no-liveness"] !== true;
  const store = new Store(dbPath);

  const rows = store.byStatus(status, tlds);
  console.log(C.bold(`\nVerifying ${rows.length} '${status}' rows…`));
  let done = 0;
  let flipped = 0;
  await runPool(rows, concurrency, async (row) => {
    let u: ResultUpdate;
    try {
      u = await resolveOne(row.domain, liveness);
    } catch {
      done++;
      return;
    }
    const change = store.applyResult(row, u);
    done++;
    if (change === "flipped") {
      flipped++;
      process.stdout.write(
        "\r\x1b[K" + C.yellow(`  ${row.domain}: ${status} → ${u.status}`) + "\n",
      );
    }
    if (done % 10 === 0) {
      process.stdout.write(`\r\x1b[K${C.dim(`  ${done}/${rows.length}  ·  corrected ${flipped}`)}`);
    }
  }, delay);
  process.stdout.write("\r\x1b[K");
  console.log(C.bold(`\nVerified ${done} rows · corrected ${flipped} false '${status}'.\n`));
  store.close();
}

// Flat-rate TLDs with no premium tiers — every name is the same price, so we
// attribute it directly with no API call (Porkbun doesn't sell these anyway).
const FLAT_PRICING: Record<string, number> = { so: 70, md: 57 };

// Price available names: stores premium flag + price and CORRECTS status when
// the registrar says a name isn't registerable (reserved/taken). Routing:
//   .md/.so   -> flat price (no API)
//   Namecheap -> bulk check (50/call) for every TLD it sells
//   leftover  -> skipped (no supported source)
// Standard prices come from Porkbun's free /pricing/get; premium prices per-name
// from Namecheap. Resumable (priced rows skipped) and best-first.
async function runPricing(
  store: Store,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const tlds = parseTlds(flags);
  const words_ = wordFilterFromFlags(flags);
  const limit = flags.limit ? Number(flags.limit) : undefined; // undefined = all

  let rows = store.unpricedAvailable(tlds, words_);
  rows = rows.sort((a, b) => qualityScore(b) - qualityScore(a));
  if (limit !== undefined) rows = rows.slice(0, limit);
  if (!rows.length) {
    console.log(C.dim("  nothing to price (all available rows already priced)"));
    return;
  }

  // Free base (standard) prices per TLD, no auth.
  const basePrices = await porkbunTldPrices().catch(() => new Map<string, number>());

  // Namecheap creds + the set of TLDs it sells.
  const ncBase = namecheapCredsFromEnv();
  let nc: { apiUser: string; apiKey: string; userName: string; clientIp: string } | null = null;
  let ncTlds = new Set<string>();
  if (ncBase) {
    const clientIp = await detectClientIp();
    nc = { ...ncBase, clientIp };
    try {
      ncTlds = await namecheapSupportedTlds(nc);
      console.log(C.dim(`  namecheap ok (ip ${clientIp}, ${ncTlds.size} TLDs)`));
    } catch (e) {
      console.log(C.yellow("  namecheap auth failed: " + String((e as Error).message ?? e)));
      nc = null;
    }
  } else {
    console.log(C.yellow("  no Namecheap creds — only .md/.so flat pricing will run"));
  }

  const flatRows = rows.filter((r) => FLAT_PRICING[r.tld] !== undefined);
  const ncRows = nc ? rows.filter((r) => FLAT_PRICING[r.tld] === undefined && ncTlds.has(r.tld)) : [];
  const skipped = rows.length - flatRows.length - ncRows.length;

  let priced = 0;
  let premium = 0;
  let corrected = 0;
  let errors = 0;

  // 1) flat-rate ccTLDs — instant, no API
  for (const r of flatRows) {
    const price = FLAT_PRICING[r.tld];
    store.applyPricing(r, { available: true, premium: false, price, renewalPrice: price, currency: "USD" });
    priced++;
  }
  if (flatRows.length)
    console.log(C.dim(`  flat-priced ${flatRows.length} on ${Object.keys(FLAT_PRICING).map((t) => "." + t).join("/")}`));

  // 2) Namecheap bulk — 50 per call
  const BATCH = 50;
  if (ncRows.length) {
    console.log(C.bold(`\nPricing ${ncRows.length} via Namecheap (bulk, best-first)\n`));
    for (let b = 0; b < ncRows.length; b += BATCH) {
      const chunk = ncRows.slice(b, b + BATCH);
      let results;
      try {
        results = await namecheapBulkCheck(chunk.map((r) => r.domain), nc!);
      } catch (e) {
        errors += chunk.length;
        console.log(C.yellow(`  batch error: ${String((e as Error).message ?? e)}`));
        await sleep(2000);
        continue;
      }
      for (const r of chunk) {
        const c = results.get(r.domain);
        if (!c || c.available === null) {
          errors++;
          continue;
        }
        const price = c.premium ? c.premiumPrice : (basePrices.get(r.tld) ?? null);
        const res = store.applyPricing(r, {
          available: c.available,
          premium: c.premium,
          price,
          renewalPrice: price,
          currency: "USD",
        });
        priced++;
        if (res === "corrected") {
          corrected++;
          console.log(`  ${r.domain.padEnd(24)} ${C.yellow("→ registered (taken)")}`);
        } else if (c.premium) {
          premium++;
          console.log(`  ${C.red("*")} ${r.domain.padEnd(24)} ${price != null ? "$" + price : "(premium)"}`);
        }
      }
      process.stdout.write(
        `\r\x1b[K${C.dim(`  ${Math.min(b + BATCH, ncRows.length)}/${ncRows.length} · ${premium} premium · ${corrected} corrected · ${errors} err`)}`,
      );
      await sleep(1200); // be gentle on Namecheap's per-minute limit
    }
    process.stdout.write("\r\x1b[K");
  }

  if (skipped) console.log(C.dim(`  skipped ${skipped} rows on TLDs no source covers`));
  console.log(
    C.bold(`\nPriced ${priced} · ${premium} premium · ${corrected} corrected · ${errors} errors\n`),
  );
}

async function cmdPrice(flags: Record<string, string | boolean>) {
  const store = new Store((flags.db as string) || DEFAULT_DB);
  await runPricing(store, flags);
  store.close();
}

// Substring search across tracked words, showing each match's status + price.
function cmdSearch(positional: string[], flags: Record<string, string | boolean>) {
  const term = positional[0];
  if (!term) return fail("usage: domains search <term> [--tlds=..] [--status=available] [--sort=quality] [--max-price=N]");
  const store = new Store((flags.db as string) || DEFAULT_DB);
  const tlds = parseTlds(flags);
  const status = typeof flags.status === "string" ? flags.status : undefined;
  const noPremium = flags["no-premium"] === true;
  const maxPrice = flags["max-price"] ? Number(flags["max-price"]) : undefined;
  const byQuality = flags.sort === "quality" || flags.best === true;
  const limit = Number(flags.limit) || (byQuality ? 50 : 500);

  let rows = store.search(term, {
    tlds,
    status,
    noPremium,
    maxPrice,
    limit: byQuality ? 100_000 : limit,
  });
  if (byQuality) {
    rows = rows.sort((a, b) => qualityScore(b) - qualityScore(a)).slice(0, limit);
  }

  const scopeBits = [tlds?.join(", "), status, byQuality ? "by quality" : undefined].filter(Boolean);
  const scope = scopeBits.length ? C.dim(` [${scopeBits.join(" · ")}]`) : "";
  console.log(C.bold(`\n${rows.length} matching “${term}”:`) + scope);
  for (const r of rows) {
    console.log(`  ${r.domain.padEnd(24)} ${statusColor(r.status)}${priceSuffix(r)}`);
  }
  console.log();
  store.close();
}

function cmdQuery(kind: "available" | "candidates" | "dropping" | "stats", flags: Record<string, string | boolean>) {
  const dbPath = (flags.db as string) || DEFAULT_DB;
  const tlds = parseTlds(flags);
  const form = parseForm(flags);
  const { min: minLen, max: maxLen } = parseLen(flags);
  const lengthActive = minLen !== undefined || maxLen !== undefined;

  const words_ = wordFilterFromFlags(flags);
  const noPremium = flags["no-premium"] === true;
  const maxPrice = flags["max-price"] ? Number(flags["max-price"]) : undefined;
  const store = new Store(dbPath);

  // Quality sort happens in JS (needs word-rank × TLD-tier), so fetch broadly
  // then sort + trim. Default display is 50 for the "best" view, 500 otherwise.
  const byQuality = flags.sort === "quality" || flags.best === true;
  const limit = Number(flags.limit) || (byQuality ? 50 : 500);
  const fetchN = byQuality ? 100_000 : limit;

  const lenLabel = lengthActive
    ? `${minLen ?? 1}-${maxLen ?? "∞"} chars`
    : undefined;
  const scopeBits = [tlds?.join(", "), form, lenLabel, byQuality ? "by quality" : undefined].filter(Boolean);
  const scope = scopeBits.length ? C.dim(` [${scopeBits.join(" · ")}]`) : "";

  const trim = (rows: DomainRow[]): DomainRow[] =>
    byQuality
      ? [...rows].sort((a, b) => qualityScore(b) - qualityScore(a)).slice(0, limit)
      : rows;

  if (kind === "stats") {
    const sc = store.statusCounts(tlds, words_);
    console.log(C.bold("\nTracking stats") + scope);
    console.log(`  total tracked: ${store.countTotal(tlds, words_)}`);
    console.log(`  checked:       ${store.countChecked(tlds, words_)}`);
    console.log(`  available:     ${C.green(String(sc.available))}`);
    console.log(`  registered:    ${sc.registered}`);
    console.log(`  unknown:       ${C.yellow(String(sc.unknown))}`);
    console.log(`  cold-outreach: ${store.coldCount(tlds, words_)}\n`);
  } else if (kind === "available") {
    const rows = trim(store.available(fetchN, tlds, words_, { noPremium, maxPrice }));
    console.log(C.bold(`\n${rows.length} available:`) + scope);
    byQuality ? printScored(rows) : printRows(rows, "plain");
    console.log();
  } else if (kind === "candidates") {
    const rows = trim(store.cold(fetchN, tlds, words_));
    console.log(C.bold(`\n${rows.length} registered but no real site (cold-outreach leads):`) + scope);
    byQuality ? printScored(rows, "site") : printRows(rows, "site");
    console.log();
  } else {
    const rows = trim(store.dropping(fetchN, tlds, words_));
    console.log(C.bold(`\n${rows.length} registered, soonest estimated drop first:`) + scope);
    byQuality ? printScored(rows, "drop") : printRows(rows, "drop");
    console.log();
  }
  store.close();
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- main -----------------------------------------------------------------
async function main() {
  loadEnv();
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);

  switch (cmd) {
    case "check": return cmdCheck(positional, flags);
    case "sweep": return cmdSweep(flags);
    case "verify": return cmdVerify(flags);
    case "price": return cmdPrice(flags);
    case "search": return cmdSearch(positional, flags);
    case "available":
    case "candidates":
    case "dropping":
    case "stats": return cmdQuery(cmd, flags);
    default:
      console.log(
        [
          "domains — find & track premium brandable domains (local, no deploy)",
          "",
          "  pnpm domains check <domain|word> [--tlds=io,ai,dev] [--no-liveness]",
          "  pnpm domains sweep [--tlds=..] [--words=N] [--concurrency=6] [--retries=3] [--delay=ms] [--price] [--no-liveness]",
          "  pnpm domains verify [--status=available] [--tlds=..] [--concurrency=N] [--delay=ms]",
          "  pnpm domains price [--tlds=..] [--singular|--plural] [--len=4-5] [--limit=N]  # full pass if no --limit",
          "",
          "  --delay=ms paces requests — use it for rate-limited WHOIS TLDs like .md",
          "    e.g. pnpm domains verify --status=unknown --tlds=md --concurrency=1 --delay=2000",
          "  pnpm domains available [--tlds=dev,md] [--singular|--plural] [--sort=quality] [--no-premium] [--max-price=N] [--limit=N]",
          "  pnpm domains candidates [--tlds=..] [--singular|--plural] [--sort=quality] [--limit=N]",
          "  pnpm domains dropping [--tlds=..] [--singular|--plural] [--limit=N]",
          "  pnpm domains stats [--tlds=..] [--singular|--plural]",
          "  pnpm domains search <term> [--tlds=..] [--status=available] [--sort=quality] [--max-price=N]",
          "",
          "  --sort=quality ranks by word commonness × TLD desirability (best first)",
          "  --len=4-5 (or --min-len / --max-len) filters by word length",
          "  price = registrar pricing (Namecheap bulk + .md/.so flat): premium flag + price, fixes false 'available'",
          "",
          `  default TLDs: ${PRIORITY_TLDS.join(", ")}`,
          `  curated words: ${(words as string[]).length}`,
        ].join("\n"),
      );
  }
}

main().catch((e) => fail(String(e)));
