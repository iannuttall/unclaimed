// Turn a pasted corpus CSV (rank,word,count,is_brand) into a clean, deduped
// list of singular+plural forms worth checking for domains.
//   node scripts/build-corpus.mjs            (reads data/corpus.csv)
// Output: data/corpus-words.json
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data"); // repo-root data/ (same place as the db)

const MIN_COUNT_NICHE = 5; // keep non-dictionary words only if reasonably frequent
const MIN_LEN = 3;
const MAX_LEN = 15;

// real-word dictionary from WordNet (all POS) so niche-but-real words survive
function wn(file) {
  const path = join(require("wordnet-db").path, file);
  const set = new Set();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const lemma = line.split(" ", 1)[0];
    if (/^[a-z]+$/.test(lemma)) set.add(lemma);
  }
  return set;
}
// Domains want NOUNS (singular/plural). Verbs/adjs/adverbs make garbage plurals.
const NOUNS = wn("index.noun");
const VERBS = wn("index.verb");
const isGerund = (w) =>
  w.endsWith("ing") && w.length > 5 &&
  (VERBS.has(w.slice(0, -3)) || VERBS.has(w.slice(0, -3) + "e"));
const isPast = (w) =>
  w.endsWith("ed") && w.length > 4 &&
  (VERBS.has(w.slice(0, -2)) || VERBS.has(w.slice(0, -2) + "e"));

const FRAGMENTS = new Set(
  ("don won isn doesn didn wasn weren hasn haven couldn wouldn shouldn aren " +
   "https http www com org net etc vs ok https tel xxx xxxx yyyy ing").split(/\s+/),
);

function singularize(w) {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(?:ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}
function pluralize(w) {
  if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

const csv = readFileSync(join(DATA, "corpus.csv"), "utf8").split("\n");
const out = new Set();
let kept = 0;
let droppedBrand = 0;
let droppedJunk = 0;

for (const line of csv) {
  const parts = line.split(",");
  if (parts.length < 2) continue;
  const word = (parts[1] || "").trim().toLowerCase();
  const count = Number(parts[2] || 0);
  const isBrand = (parts[3] || "").trim().toLowerCase() === "yes";
  if (!word || word === "word") continue;
  if (isBrand) { droppedBrand++; continue; }
  if (!/^[a-z]+$/.test(word) || word.length < MIN_LEN || word.length > MAX_LEN) { droppedJunk++; continue; }
  if (FRAGMENTS.has(word)) { droppedJunk++; continue; }
  const sg = singularize(word);
  // nouns only; skip gerunds/past-tense even if a noun form exists
  const isNoun = NOUNS.has(word) || NOUNS.has(sg);
  if (!isNoun) { droppedJunk++; continue; }
  if (isGerund(word) || isGerund(sg) || isPast(word) || isPast(sg)) { droppedJunk++; continue; }
  if (count < 2) { droppedJunk++; continue; } // skip single-occurrence noise
  kept++;
  out.add(sg);
  out.add(pluralize(sg));
}

const list = [...out].filter((w) => /^[a-z]+$/.test(w) && w.length >= MIN_LEN && w.length <= MAX_LEN).sort();
writeFileSync(join(DATA, "corpus-words.json"), JSON.stringify(list));
console.log(`corpus rows kept: ${kept}  (dropped ${droppedBrand} brands, ${droppedJunk} junk)`);
console.log(`singular+plural forms: ${list.length} -> data/corpus-words.json`);
console.log("sample:", list.slice(0, 30).join(", "));
