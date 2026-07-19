#!/usr/bin/env node
/**
 * unclaimed - a local CLI for finding and tracking single-word domains.
 *
 *   unclaimed check prompt.io
 *   unclaimed check prompt --tlds io,ai,dev
 *   unclaimed sweep
 *   unclaimed refresh --all
 *   unclaimed available
 *
 * No deploy, no Cloudflare. WHOIS runs over node:net, RDAP/liveness over fetch,
 * results persist in a local SQLite db via node:sqlite.
 */
import { readFileSync } from "node:fs";
import { checkDomain, checkLiveness, setWhoisTransport, words } from "@unclaimed/core";
import {
  configPath,
  DEFAULT_TLDS,
  dataPath,
  loadConfig,
  loadEnv,
  normalizeTlds,
  readTldsFile,
  type UserConfig,
} from "./config";
import { openStore } from "./open-store";
import {
  detectClientIp,
  FLAT_TLD_PRICES,
  namecheapBulkCheck,
  namecheapCredsFromEnv,
  namecheapSupportedTlds,
  porkbunTldPrices,
} from "./pricing";
import { commercialScore, isPluralWord, qualityScore } from "./ranking";
import type { DomainRow, ResultUpdate, Store } from "./store";
import { VERSION } from "./version";
import { whoisQuery } from "./whois-node";

// WHOIS over node:net in the CLI runtime.
setWhoisTransport(whoisQuery);

// Highest-opportunity TLDs for premium single words: newer/brandable gTLDs with
// real unregistered inventory, plus the iconic-but-saturated ones (still useful
// as drop / cold-outreach leads). Override with --tlds=.
let userConfig: UserConfig = {};

// ---- tiny arg parser ------------------------------------------------------
export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const a = argv[index];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[index + 1] && !argv[index + 1].startsWith("-")) flags[k] = argv[++index];
      else flags[k] = true;
    } else if (a.startsWith("-") && a.length === 2) {
      const aliases: Record<string, string> = { h: "help", V: "version" };
      flags[aliases[a.slice(1)] ?? a.slice(1)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function parseTlds(flags: Record<string, string | boolean>): string[] | undefined {
  const t = flags.tlds;
  if (typeof t === "string" && t.trim()) return normalizeTlds(t.split(","));
  const file = flags["tlds-file"];
  if (typeof file === "string") return readTldsFile(file);
  return undefined;
}

/** For sweep/check: fall back to the priority set when no --tlds given. */
function tldList(flags: Record<string, string | boolean>): string[] {
  return parseTlds(flags) ?? normalizeTlds(userConfig.tlds ?? DEFAULT_TLDS);
}

function databasePath(flags: Record<string, string | boolean>): string {
  return (flags.db as string) || userConfig.database || dataPath();
}

function parseForm(flags: Record<string, string | boolean>): "singular" | "plural" | undefined {
  if (flags.plural === true || flags.form === "plural") return "plural";
  if (flags.singular === true || flags.form === "singular") return "singular";
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

// Word source for sweeps: --words-file accepts a JSON array or text separated
// by whitespace/commas, and overrides the bundled list.
function resolveWords(flags: Record<string, string | boolean>): string[] {
  const wf = flags["words-file"];
  if (typeof wf === "string") {
    const raw = readFileSync(wf, "utf8").trim();
    const parsed = raw.startsWith("[") ? (JSON.parse(raw) as string[]) : raw.split(/[\s,]+/);
    return [...new Set(parsed.map((word) => word.trim().toLowerCase()))].filter((word) =>
      /^[a-z0-9-]+$/.test(word),
    );
  }
  return words as string[];
}

// The word-IN filter implied by --singular/--plural + --len (undefined = no filter).
// Word-IN filter for --curated only (restrict to the bundled curated 2.5k).
// Form (--singular/--plural) and --len are applied PER-ROW in the query so they
// work on any word, including imported corpus words. Returns undefined = no IN.
function curatedFilter(flags: Record<string, string | boolean>): string[] | undefined {
  return flags.curated === true ? (words as string[]) : undefined;
}

// Per-row form + length predicate (works on any word).
function rowMatchesFormLen(flags: Record<string, string | boolean>, word: string): boolean {
  const form = parseForm(flags);
  if (form === "plural" && !isPluralWord(word)) return false;
  if (form === "singular" && isPluralWord(word)) return false;
  const { min, max } = parseLen(flags);
  if (min !== undefined && word.length < min) return false;
  if (max !== undefined && word.length > max) return false;
  return true;
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
  return `  ${star}${C.dim(price)}`;
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
      console.log(`  ${r.domain.padEnd(22)} ${tag}  ${C.dim(`expiry ${fmtDate(r.expiry)}`)}`);
    } else {
      console.log(`  ${C.green(r.domain)}${priceSuffix(r)}`);
    }
  }
}

// Score-ranked rows: a score badge then the domain (best first).
function printScored(rows: DomainRow[], score: (r: DomainRow) => number, extra?: "site" | "drop") {
  for (const r of rows) {
    const s = score(r);
    const badge = (s >= 75 ? C.green : s >= 55 ? C.yellow : C.dim)(String(s).padStart(3));
    let tail = "";
    if (extra === "site") tail = C.dim(`  ${r.site_status ?? ""}`);
    else if (extra === "drop") tail = C.dim(`  drop~ ${fmtDate(r.estimated_available)}`);
    console.log(`  ${badge}  ${r.domain}${priceSuffix(r)}${tail}`);
  }
}

// ---- commands -------------------------------------------------------------
async function cmdCheck(positional: string[], flags: Record<string, string | boolean>) {
  const liveness = flags["no-liveness"] !== true;
  let domains: string[];
  const arg = positional[0];
  if (!arg) return fail("usage: unclaimed check <domain|word> [--tlds=io,ai,dev]");
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(arg)) {
    return fail("check expects one word or one domain");
  }
  if (arg.includes(".")) domains = [arg.toLowerCase()];
  else domains = tldList(flags).map((t) => `${arg.toLowerCase()}.${t}`);

  await runPool(domains, 6, async (domain) => {
    const u = await resolveOne(domain, liveness);
    const extra =
      u.status === "registered"
        ? C.dim(
            `  ${u.siteStatus ?? ""}${u.expiry ? ` · expiry ${fmtDate(u.expiry)}` : ""}` +
              (u.estimatedAvailable ? ` · drop~ ${fmtDate(u.estimatedAvailable)}` : ""),
          )
        : "";
    console.log(`  ${domain.padEnd(22)} ${statusColor(u.status)} ${C.dim(u.source ?? "")}${extra}`);
  });
}

// Fast sweep via Namecheap bulk: availability + premium + price in 50-domain
// calls (~10-50x faster than per-domain RDAP/WHOIS). TLDs Namecheap doesn't sell
// (.md/.so) fall back to RDAP/WHOIS + flat pricing. Skips liveness/expiry — run a
// normal `sweep` later if you want cold-outreach / drop data on the registered ones.
async function cmdSweepFast(flags: Record<string, string | boolean>, forceRefresh = false) {
  const dbPath = databasePath(flags);
  const store = await openStore(dbPath);
  const requestedTlds = parseTlds(flags);
  const tlds =
    forceRefresh && flags.all === true && !requestedTlds ? store.trackedTlds() : tldList(flags);
  const maxAttempts = Number(flags.retries) || 3;
  const wordLimit = flags.words ? Number(flags.words) : resolveWords(flags).length;

  const ncBase = namecheapCredsFromEnv();
  if (!ncBase)
    return fail("--fast needs Namecheap creds in .env (NAMECHEAP_API_USER/API_KEY/USERNAME).");
  const clientIp = await detectClientIp();
  const nc = { ...ncBase, clientIp };
  let ncTlds: Set<string>;
  try {
    ncTlds = await namecheapSupportedTlds(nc);
  } catch (e) {
    return fail(`namecheap auth failed: ${String((e as Error).message ?? e)}`);
  }
  const basePrices = await porkbunTldPrices().catch(() => new Map<string, number>());

  const wordSet = resolveWords(flags).slice(0, wordLimit);
  const added = forceRefresh && flags.all === true ? 0 : store.seed(wordSet, tlds);
  const total = forceRefresh ? store.countTotal(tlds) : store.countPending(tlds, maxAttempts);
  console.log(
    C.bold(`\nFast ${forceRefresh ? "refresh" : "sweep"}: ${total} domains`) +
      C.dim(`  (+${added} new rows · namecheap ip ${clientIp}, ${ncTlds.size} TLDs)\n`),
  );

  const blank = {
    expiry: null,
    estimatedAvailable: null,
    siteStatus: null,
    hasSite: null,
    coldOutreach: false,
    httpStatus: null,
  };
  let done = 0;
  let avail = 0;
  let premium = 0;
  const t0 = Date.now();
  const BATCH = 50;
  let cursor = "";

  while (true) {
    const batch = forceRefresh
      ? store.refreshBatch(tlds, cursor, 1000)
      : store.pending(tlds, maxAttempts, 1000);
    if (!batch.length) break;
    if (forceRefresh) cursor = batch[batch.length - 1].domain;
    const ncRows = batch.filter((r) => ncTlds.has(r.tld));
    const otherRows = batch.filter((r) => !ncTlds.has(r.tld));

    // Namecheap-supported TLDs: bulk
    for (let i = 0; i < ncRows.length; i += BATCH) {
      const chunk = ncRows.slice(i, i + BATCH);
      let results: Awaited<ReturnType<typeof namecheapBulkCheck>>;
      try {
        results = await namecheapBulkCheck(
          chunk.map((r) => r.domain),
          nc,
        );
      } catch (error) {
        store.close();
        throw new Error(`Namecheap batch failed: ${String((error as Error).message ?? error)}`);
      }
      const now = new Date().toISOString();
      store.transaction(() => {
        for (const r of chunk) {
          const c = results.get(r.domain);
          const status =
            !c || c.available === null ? "unknown" : c.available ? "available" : "registered";
          store.applyResult(
            r,
            { status, source: "namecheap", checkedAt: now, ...blank },
            forceRefresh,
          );
          done++;
          if (status === "available" && c) {
            avail++;
            const price = c.premium ? c.premiumPrice : (basePrices.get(r.tld) ?? null);
            store.applyPricing(r, {
              available: true,
              premium: c.premium,
              price,
              renewalPrice: price,
              currency: "USD",
            });
            if (c.premium) premium++;
          }
        }
      });
      const rate = done / Math.max(1, (Date.now() - t0) / 1000);
      process.stdout.write(
        `\r\x1b[K${C.dim(`  ${done}/${total} · ${avail} available · ${premium} premium · ${rate.toFixed(0)}/s`)}`,
      );
      await sleep(1000);
    }

    // TLDs Namecheap doesn't sell (.md/.so): RDAP/WHOIS, then flat-price available
    if (otherRows.length) {
      await runPool(otherRows, 5, async (r) => {
        const u = await resolveOne(r.domain, false);
        store.applyResult(r, u, forceRefresh);
        done++;
        if (u.status === "available") {
          avail++;
          const flat = FLAT_PRICING[r.tld];
          if (flat !== undefined)
            store.applyPricing(r, {
              available: true,
              premium: false,
              price: flat,
              renewalPrice: flat,
              currency: "USD",
            });
        }
      });
    }
  }

  process.stdout.write("\r\x1b[K");
  const sc = store.statusCounts(tlds);
  console.log(
    C.bold(
      `\nFast ${forceRefresh ? "refresh" : "sweep"} done in ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
    ),
  );
  console.log(
    `  ${C.green(`available ${sc.available}`)}   registered ${sc.registered}   ${C.yellow(`unknown ${sc.unknown}`)}`,
  );
  console.log(C.dim(`\n  unclaimed available --sort=commercial\n`));
  store.close();
}

async function cmdSweep(flags: Record<string, string | boolean>) {
  if (flags.fast === true) return cmdSweepFast(flags);
  const dbPath = databasePath(flags);
  const tlds = tldList(flags);
  const concurrency = Number(flags.concurrency) || 6;
  const liveness = flags["no-liveness"] !== true;
  const maxAttempts = Number(flags.retries) || 3;
  const delay = Number(flags.delay) || 0;
  const wordLimit = flags.words ? Number(flags.words) : resolveWords(flags).length;
  const batch = Number(flags.batch) || 300;

  const store = await openStore(dbPath);
  const wordSet = resolveWords(flags).slice(0, wordLimit);
  const added = store.seed(wordSet, tlds);
  const total = wordSet.length * tlds.length;

  console.log(C.bold(`\nSweep: ${wordSet.length} words × ${tlds.length} TLDs = ${total} domains`));
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
    await runPool(
      rows,
      concurrency,
      async (row) => {
        let u: ResultUpdate;
        try {
          u = await resolveOne(row.domain, liveness);
        } catch {
          u = {
            status: "unknown",
            source: null,
            expiry: null,
            estimatedAvailable: null,
            siteStatus: null,
            hasSite: null,
            coldOutreach: false,
            httpStatus: null,
            checkedAt: new Date().toISOString(),
          };
        }
        store.applyResult(row, u);
        done++;
        if (u.status === "available") {
          avail++;
          process.stdout.write(`\r\x1b[K${C.green(`  ✓ available: ${row.domain}`)}\n`);
        }
        if (u.coldOutreach) cold++;
        if (done % 10 === 0) {
          const rate = done / Math.max(1, (Date.now() - t0) / 1000);
          process.stdout.write(
            `\r\x1b[K${C.dim(
              `  checked ${done} attempts  ·  ${startPending} initially pending  ·  available ${avail}  ·  cold ${cold}  ·  ${rate.toFixed(1)}/s`,
            )}`,
          );
        }
      },
      delay,
    );
  }

  process.stdout.write("\r\x1b[K");
  const sc = store.statusCounts();
  console.log(C.bold(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`));
  console.log(
    `  ${C.green(`available ${sc.available}`)}   registered ${sc.registered}   ${C.yellow(
      `unknown ${sc.unknown}`,
    )}   cold-outreach ${store.coldCount()}`,
  );
  console.log(C.dim(`\n  unclaimed available | candidates | dropping\n`));

  // --price: after resolution, price the available names (registrar pricing +
  // false-positive correction). Note this is rate-limited (~1/10s) so it can run
  // far longer than the sweep itself.
  if (flags.price === true) {
    await runPricing(store, flags);
  }
  store.close();
}

/** Re-check confident and unknown rows. Unlike sweep, refresh never skips old results. */
async function cmdRefresh(flags: Record<string, string | boolean>) {
  if (flags.fast === true) return cmdSweepFast(flags, true);

  const store = await openStore(databasePath(flags));
  const requestedTlds = parseTlds(flags);
  const tlds = flags.all === true && !requestedTlds ? store.trackedTlds() : tldList(flags);
  const wordSet = resolveWords(flags);
  const added = flags.all === true ? 0 : store.seed(wordSet, tlds);
  const concurrency = Math.max(1, Number(flags.concurrency) || 12);
  const delay = Math.max(0, Number(flags.delay) || 0);
  const liveness = flags.liveness === true;
  const batchSize = Math.max(concurrency, Number(flags.batch) || 500);
  const total = store.countTotal(tlds);

  console.log(C.bold(`\nRefresh: ${total} stored domains`));
  console.log(C.dim(`tlds: ${tlds.join(", ") || "all"}`));
  console.log(
    C.dim(`db: ${databasePath(flags)}  (+${added} new rows)  concurrency=${concurrency}\n`),
  );

  let cursor = "";
  let done = 0;
  let changed = 0;
  let available = 0;
  const started = Date.now();

  while (true) {
    const rows = store.refreshBatch(tlds, cursor, batchSize);
    if (!rows.length) break;
    cursor = rows[rows.length - 1].domain;

    await runPool(
      rows,
      concurrency,
      async (row) => {
        let update: ResultUpdate;
        try {
          update = await resolveOne(row.domain, liveness);
        } catch {
          update = {
            status: "unknown",
            source: null,
            expiry: null,
            estimatedAvailable: null,
            siteStatus: null,
            hasSite: null,
            coldOutreach: false,
            httpStatus: null,
            checkedAt: new Date().toISOString(),
          };
        }
        if (store.applyResult(row, update, true) === "flipped") changed++;
        if (update.status === "available") available++;
        done++;
        if (done % 25 === 0 || done === total) {
          const rate = done / Math.max(1, (Date.now() - started) / 1000);
          process.stdout.write(
            `\r\x1b[K${C.dim(`  checked ${done}/${total} · available ${available} · changed ${changed} · ${rate.toFixed(1)}/s`)}`,
          );
        }
      },
      delay,
    );
  }

  process.stdout.write("\r\x1b[K");
  console.log(
    C.bold(
      `\nRefreshed ${done} domains in ${((Date.now() - started) / 1000).toFixed(0)}s · ${changed} changed.\n`,
    ),
  );
  store.close();
}

// Re-check rows currently marked `--status` (default: available) with the
// current resolver — catches stored false positives after a logic fix.
async function cmdVerify(flags: Record<string, string | boolean>) {
  const dbPath = databasePath(flags);
  const status = (flags.status as string) || "available";
  const tlds = parseTlds(flags);
  const concurrency = Number(flags.concurrency) || 6;
  const delay = Number(flags.delay) || 0;
  const liveness = flags["no-liveness"] !== true;
  const store = await openStore(dbPath);

  const rows = store.byStatus(status, tlds);
  console.log(C.bold(`\nVerifying ${rows.length} '${status}' rows…`));
  let done = 0;
  let flipped = 0;
  await runPool(
    rows,
    concurrency,
    async (row) => {
      let u: ResultUpdate;
      try {
        u = await resolveOne(row.domain, liveness);
      } catch {
        done++;
        return;
      }
      const change = store.applyResult(row, u, true);
      done++;
      if (change === "flipped") {
        flipped++;
        process.stdout.write(`\r\x1b[K${C.yellow(`  ${row.domain}: ${status} → ${u.status}`)}\n`);
      }
      if (done % 10 === 0) {
        process.stdout.write(
          `\r\x1b[K${C.dim(`  ${done}/${rows.length}  ·  corrected ${flipped}`)}`,
        );
      }
    },
    delay,
  );
  process.stdout.write("\r\x1b[K");
  console.log(C.bold(`\nVerified ${done} rows · corrected ${flipped} false '${status}'.\n`));
  store.close();
}

// Flat-rate TLDs with no premium tiers — every name is the same price, so we
// attribute it directly with no API call (Porkbun doesn't sell these anyway).
const FLAT_PRICING = FLAT_TLD_PRICES;

// Price available names: stores premium flag + price and CORRECTS status when
// the registrar says a name isn't registerable (reserved/taken). Routing:
//   .md/.so   -> flat price (no API)
//   Namecheap -> bulk check (50/call) for every TLD it sells
//   leftover  -> skipped (no supported source)
// Standard prices come from Porkbun's free /pricing/get; premium prices per-name
// from Namecheap. Resumable (priced rows skipped) and best-first.
async function runPricing(store: Store, flags: Record<string, string | boolean>): Promise<void> {
  const tlds = parseTlds(flags);
  const words_ = curatedFilter(flags);
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
      console.log(C.yellow(`  namecheap auth failed: ${String((e as Error).message ?? e)}`));
      nc = null;
    }
  } else {
    console.log(C.yellow("  no Namecheap creds — only .md/.so flat pricing will run"));
  }

  const flatRows = rows.filter((r) => FLAT_PRICING[r.tld] !== undefined);
  const ncRows = nc
    ? rows.filter((r) => FLAT_PRICING[r.tld] === undefined && ncTlds.has(r.tld))
    : [];
  const skipped = rows.length - flatRows.length - ncRows.length;

  let priced = 0;
  let premium = 0;
  let corrected = 0;
  let errors = 0;

  // 1) flat-rate ccTLDs — instant, no API
  for (const r of flatRows) {
    const price = FLAT_PRICING[r.tld];
    store.applyPricing(r, {
      available: true,
      premium: false,
      price,
      renewalPrice: price,
      currency: "USD",
    });
    priced++;
  }
  if (flatRows.length)
    console.log(
      C.dim(
        `  flat-priced ${flatRows.length} on ${Object.keys(FLAT_PRICING)
          .map((t) => `.${t}`)
          .join("/")}`,
      ),
    );

  // 2) Namecheap bulk — 50 per call
  const BATCH = 50;
  if (ncRows.length && nc) {
    console.log(C.bold(`\nPricing ${ncRows.length} via Namecheap (bulk, best-first)\n`));
    for (let b = 0; b < ncRows.length; b += BATCH) {
      const chunk = ncRows.slice(b, b + BATCH);
      let results: Awaited<ReturnType<typeof namecheapBulkCheck>>;
      try {
        results = await namecheapBulkCheck(
          chunk.map((r) => r.domain),
          nc,
        );
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
          console.log(
            `  ${C.red("*")} ${r.domain.padEnd(24)} ${price != null ? `$${price}` : "(premium)"}`,
          );
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
  const store = await openStore(databasePath(flags));
  await runPricing(store, flags);
  store.close();
}

// Substring search across tracked words, showing each match's status + price.
async function cmdSearch(positional: string[], flags: Record<string, string | boolean>) {
  const term = positional[0];
  if (!term) return fail("usage: unclaimed search <term> [--tlds=..] [--status=available]");
  const store = await openStore(databasePath(flags));
  const tlds = parseTlds(flags);
  const status = typeof flags.status === "string" ? flags.status : undefined;
  const noPremium = flags["no-premium"] === true;
  const maxPrice = flags["max-price"] ? Number(flags["max-price"]) : undefined;
  const sortMode =
    flags.sort === "commercial"
      ? "commercial"
      : flags.sort === "quality" || flags.best === true
        ? "quality"
        : null;
  const scoreFn = sortMode === "commercial" ? commercialScore : qualityScore;
  const byScore = sortMode !== null;
  const form = parseForm(flags);
  const { min: minLen, max: maxLen } = parseLen(flags);
  const postFilter = form !== undefined || minLen !== undefined || maxLen !== undefined;
  const limit = Number(flags.limit) || (byScore ? 50 : 500);
  const page = Math.max(1, Number(flags.page) || 1);
  const offset = flags.offset !== undefined ? Number(flags.offset) : (page - 1) * limit;

  let rows = store.search(term, {
    tlds,
    status,
    noPremium,
    maxPrice,
    limit: byScore || postFilter ? 100_000 : offset + limit,
  });
  if (postFilter) rows = rows.filter((r) => rowMatchesFormLen(flags, r.word));
  if (byScore) rows = rows.sort((a, b) => scoreFn(b) - scoreFn(a));
  rows = rows.slice(offset, offset + limit);

  const formLabel = [
    form,
    postFilter && (minLen !== undefined || maxLen !== undefined) ? "len" : undefined,
  ].filter(Boolean);
  const scopeBits = [
    tlds?.join(", "),
    status,
    ...formLabel,
    sortMode ? `by ${sortMode}` : undefined,
  ].filter(Boolean);
  const scope = scopeBits.length ? C.dim(` [${scopeBits.join(" · ")}]`) : "";
  console.log(C.bold(`\n${rows.length} matching “${term}”:`) + scope);
  for (const r of rows) {
    console.log(`  ${r.domain.padEnd(24)} ${statusColor(r.status)}${priceSuffix(r)}`);
  }
  console.log();
  store.close();
}

async function cmdQuery(
  kind: "available" | "candidates" | "dropping" | "stats",
  flags: Record<string, string | boolean>,
) {
  const dbPath = databasePath(flags);
  const tlds = parseTlds(flags);
  const form = parseForm(flags);
  const { min: minLen, max: maxLen } = parseLen(flags);
  const lengthActive = minLen !== undefined || maxLen !== undefined;

  // Fresh databases only contain the bundled corpus. Use --curated to hide
  // rows imported later through --words-file.
  const words_ = flags.curated === true ? (words as string[]) : undefined;
  const noPremium = flags["no-premium"] === true;
  const maxPrice = flags["max-price"] ? Number(flags["max-price"]) : undefined;
  const store = await openStore(dbPath);

  // Score sort (quality or commercial) happens in JS, so fetch broadly then
  // sort + trim. Default display is 50 for a scored view, 500 otherwise.
  const sortMode =
    flags.sort === "commercial"
      ? "commercial"
      : flags.sort === "quality" || flags.best === true
        ? "quality"
        : null;
  const scoreFn = sortMode === "commercial" ? commercialScore : qualityScore;
  const byScore = sortMode !== null;
  const limit = Number(flags.limit) || (byScore ? 50 : 500);
  // Pagination: --page=2 (1-based) or --offset=N skips ahead.
  const page = Math.max(1, Number(flags.page) || 1);
  const offset = flags.offset !== undefined ? Number(flags.offset) : (page - 1) * limit;
  // Form/length are per-row filters now, so fetch broadly and trim in JS.
  const postFilter = form !== undefined || lengthActive;
  const fetchN = byScore || postFilter ? 100_000 : offset + limit;

  const lenLabel = lengthActive ? `${minLen ?? 1}-${maxLen ?? "∞"} chars` : undefined;
  const sortLabel = sortMode ? `by ${sortMode}` : undefined;
  const pageLabel = offset > 0 ? `page ${page}` : undefined;
  const scopeBits = [
    tlds?.join(", "),
    form,
    lenLabel,
    flags.curated === true ? "curated" : undefined,
    sortLabel,
    pageLabel,
  ].filter(Boolean);
  const scope = scopeBits.length ? C.dim(` [${scopeBits.join(" · ")}]`) : "";

  const trim = (rows: DomainRow[]): DomainRow[] => {
    let out = postFilter ? rows.filter((r) => rowMatchesFormLen(flags, r.word)) : rows;
    if (byScore) out = [...out].sort((a, b) => scoreFn(b) - scoreFn(a));
    return out.slice(offset, offset + limit);
  };

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
    byScore ? printScored(rows, scoreFn) : printRows(rows, "plain");
    console.log();
  } else if (kind === "candidates") {
    const rows = trim(store.cold(fetchN, tlds, words_));
    console.log(
      C.bold(`\n${rows.length} registered but no real site (cold-outreach leads):`) + scope,
    );
    byScore ? printScored(rows, scoreFn, "site") : printRows(rows, "site");
    console.log();
  } else {
    const rows = trim(store.dropping(fetchN, tlds, words_));
    console.log(C.bold(`\n${rows.length} registered, soonest estimated drop first:`) + scope);
    byScore ? printScored(rows, scoreFn, "drop") : printRows(rows, "drop");
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
  userConfig = loadConfig();
  const rest = process.argv.slice(2);

  if (rest.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
    const { runInteractive } = await import("./ui");
    await runInteractive(tldList({}), databasePath({}));
    return;
  }

  const cmd = rest[0] && !rest[0].startsWith("-") ? rest.shift() : undefined;
  const { positional, flags } = parseArgs(rest);

  if (flags.version === true) {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case "check":
      return cmdCheck(positional, flags);
    case "sweep":
      return cmdSweep(flags);
    case "refresh":
      return cmdRefresh(flags);
    case "verify":
      return cmdVerify(flags);
    case "price":
      return cmdPrice(flags);
    case "search":
      return cmdSearch(positional, flags);
    case "available":
    case "candidates":
    case "dropping":
    case "stats":
      return cmdQuery(cmd, flags);
    case "config":
      console.log(
        JSON.stringify(
          { path: configPath(), database: databasePath(flags), config: userConfig },
          null,
          2,
        ),
      );
      return;
    default:
      console.log(
        [
          "unclaimed - find and track single-word domains",
          "",
          "  unclaimed check <domain|word> [--tlds io,ai,dev] [--no-liveness]",
          "  unclaimed sweep [--tlds ...] [--words-file words.json] [--fast]",
          "  unclaimed refresh [--all] [--tlds ...] [--fast] [--liveness]",
          "  unclaimed verify [--status available] [--tlds ...]",
          "  unclaimed price [--tlds ...] [--limit N]",
          "",
          "  unclaimed available [--tlds dev,md] [--singular|--plural] [--sort quality]",
          "  unclaimed candidates [--tlds ...] [--limit N]",
          "  unclaimed dropping [--tlds ...] [--limit N]",
          "  unclaimed stats [--tlds ...]",
          "  unclaimed search <term> [--status available]",
          "  unclaimed config",
          "",
          "  --tlds accepts any delegated TLD. --tlds-file accepts JSON or text.",
          "  --fast uses Namecheap bulk checks when credentials are configured.",
          "  refresh re-checks old results; refresh --all covers every stored TLD.",
          "",
          `  default TLDs: ${tldList({}).join(", ")}`,
          `  curated words: ${(words as string[]).length}`,
        ].join("\n"),
      );
  }
}

main().catch((e) => fail(String(e)));
