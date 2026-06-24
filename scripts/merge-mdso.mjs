// Merge the .md/.so sweep results from the separate db back into the main db.
//   node scripts/merge-mdso.mjs
import { DatabaseSync } from "node:sqlite";

const MAIN = "data/domains.db";
const SRC = "data/domains-mdso.db";

const db = new DatabaseSync(MAIN);
db.exec("PRAGMA busy_timeout=20000");
db.exec(`ATTACH DATABASE '${SRC}' AS src`);

const before = db.prepare(
  "SELECT COUNT(*) c FROM domains WHERE tld IN ('md','so') AND status='available'",
).get().c;

// Update existing main rows in place from the source sweep (only checked rows).
const cols = [
  "status", "source", "expiry", "estimated_available", "site_status", "has_site",
  "cold_outreach", "http_status", "last_checked", "became_available_at", "check_count",
  "registrar_available", "premium", "price", "renewal_price", "currency", "priced_at",
];
const setClause = cols.map((c) => `${c}=s.${c}`).join(", ");
const upd = db.prepare(
  `UPDATE domains AS d SET ${setClause}
   FROM src.domains AS s
   WHERE d.domain = s.domain AND s.last_checked IS NOT NULL`,
);
const updRes = upd.run();

// Safety net: insert any checked source rows that don't exist in main at all.
const ins = db.prepare(
  `INSERT OR IGNORE INTO domains
   (domain, word, tld, status, source, expiry, estimated_available, site_status, has_site,
    cold_outreach, http_status, first_seen, last_checked, became_available_at, check_count,
    registrar_available, premium, price, renewal_price, currency, priced_at)
   SELECT domain, word, tld, status, source, expiry, estimated_available, site_status, has_site,
    cold_outreach, http_status, first_seen, last_checked, became_available_at, check_count,
    registrar_available, premium, price, renewal_price, currency, priced_at
   FROM src.domains s
   WHERE s.last_checked IS NOT NULL AND s.domain NOT IN (SELECT domain FROM domains)`,
);
const insRes = ins.run();

const after = db.prepare(
  "SELECT COUNT(*) c FROM domains WHERE tld IN ('md','so') AND status='available'",
).get().c;
const checked = db.prepare(
  "SELECT COUNT(*) c FROM src.domains WHERE last_checked IS NOT NULL",
).get().c;

db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log(`merged: ${checked} checked rows from src`);
console.log(`updated ${updRes.changes}, inserted ${insRes.changes}`);
console.log(`.md/.so available: ${before} -> ${after}`);
