// Final list = pass-2 premium keepers ∪ recovered words (recovery pass),
// ordered most-common-first. Writes packages/core/src/data/words.json.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "data");

// Base = pass-2 premium keepers (read directly from p2-keep so this stays
// idempotent no matter how many times it runs).
const final = new Set();
const p2Dir = join(DATA, "p2-keep");
for (const f of existsSync(p2Dir) ? readdirSync(p2Dir) : []) {
  if (!f.endsWith(".json")) continue;
  for (const w of JSON.parse(readFileSync(join(p2Dir, f), "utf8"))) {
    final.add(String(w).toLowerCase().trim());
  }
}
const before = final.size;

// Manual allowlist: obviously-premium common words the ruthless LLM passes drop
// as "too abstract". Edit freely. Only added if they survived the heuristic
// stage (i.e. exist in the detail file), so no junk sneaks in.
const ALWAYS = [
  "opportunity", "gateway", "legacy", "fortune", "insight", "catalyst",
  "spectrum", "venture", "horizon", "method",
];

const recDir = join(DATA, "rec-keep");
let recovered = 0;
for (const f of existsSync(recDir) ? readdirSync(recDir) : []) {
  if (!f.endsWith(".json")) continue;
  for (const w of JSON.parse(readFileSync(join(recDir, f), "utf8"))) {
    const word = String(w).toLowerCase().trim();
    if (!final.has(word)) {
      final.add(word);
      recovered++;
    }
  }
}

const detail = JSON.parse(
  readFileSync(join(DATA, "heuristic-words.detail.json"), "utf8"),
);
const rankOf = new Map(detail.map((d) => [d.word, d.lemmaRank]));

let allowed = 0;
for (const w of ALWAYS) {
  if (rankOf.has(w) && !final.has(w)) {
    final.add(w);
    allowed++;
  }
}
const ordered = [...final]
  .filter((w) => rankOf.has(w))
  .sort((a, b) => rankOf.get(a) - rankOf.get(b) || a.localeCompare(b));

writeFileSync(join(__dirname, "..", "packages", "core", "src", "data", "words.json"), JSON.stringify(ordered));
writeFileSync(join(DATA, "final-words.json"), JSON.stringify(ordered, null, 0));

console.log(`pass-2 keepers: ${before}`);
console.log(`recovered:      +${recovered}`);
console.log(`allowlist:      +${allowed}`);
console.log(`final list:     ${ordered.length} words -> packages/core/src/data/words.json`);
