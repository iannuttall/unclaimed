// Merge the per-batch judge outputs (scripts/data/keep/batch-NNN.json) into the
// final curated list, ordered most-common-first using the heuristic detail file.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "data");
// Which keep dir to merge: "keep" (pass 1) or "p2-keep" (final pass 2).
const KEEP_DIR = join(DATA, process.argv[2] || "p2-keep");

const kept = new Set();
let files = 0;
for (const f of existsSync(KEEP_DIR) ? readdirSync(KEEP_DIR) : []) {
  if (!f.endsWith(".json")) continue;
  files++;
  const arr = JSON.parse(readFileSync(join(KEEP_DIR, f), "utf8"));
  for (const w of arr) if (typeof w === "string") kept.add(w.toLowerCase().trim());
}

// order by lemma frequency rank from the heuristic detail file
const detail = JSON.parse(
  readFileSync(join(DATA, "heuristic-words.detail.json"), "utf8"),
);
const rankOf = new Map(detail.map((d) => [d.word, d.lemmaRank]));
const ordered = [...kept]
  .filter((w) => rankOf.has(w)) // guard against judge hallucinations
  .sort((a, b) => rankOf.get(a) - rankOf.get(b) || a.localeCompare(b));

writeFileSync(
  join(DATA, "..", "..", "packages", "core", "src", "data", "words.json"),
  JSON.stringify(ordered),
);
writeFileSync(join(DATA, "curated-words.json"), JSON.stringify(ordered, null, 0));

console.log(`merged ${files} batch files`);
console.log(`curated list: ${ordered.length} words`);
console.log(`written: packages/core/src/data/words.json and scripts/data/curated-words.json`);
console.log("\nsample (most common 40):\n  " + ordered.slice(0, 40).join(", "));
console.log("\nsample (last 40):\n  " + ordered.slice(-40).join(", "));
