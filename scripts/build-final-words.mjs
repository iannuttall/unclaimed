// Assemble the final curated word list from the judged pool + recovered words,
// adding plural forms for nouns only (verbs/adjs make garbage plurals).
//   node scripts/build-final-words.mjs
// Writes src/words.json (the curated list used by the CLI by default).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
const NOUNS = wn("index.noun");

// Frequency ranks from the two corpora used to build the candidate pool, so the
// final list can be ordered most-common-first (WORD_RANK in the CLI = list index).
function ranks(file, sep) {
  const r = new Map();
  let i = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const w = line.split(sep, 1)[0].toLowerCase();
    if (/^[a-z]+$/.test(w) && !r.has(w)) r.set(w, i++);
  }
  return r;
}
const NORVIG = ranks(join(__dirname, "cache", "count_1w.txt"), "\t");
const SUBS = ranks(join(__dirname, "cache", "en_50k.txt"), " ");
const BIG = 1e9;
// Best (lowest) rank across both corpora; words in neither sink to the bottom.
const freqRank = (w) => Math.min(NORVIG.get(w) ?? BIG, SUBS.get(w) ?? BIG);

function isPlural(w) { return w.endsWith("s") && !w.endsWith("ss"); }
function pluralize(w) {
  if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

const judged = JSON.parse(readFileSync(join(ROOT, "data", "judged-words.json"), "utf8"));
const recovered = JSON.parse(readFileSync(join(__dirname, "data", "recover-keep.json"), "utf8"));

// Standard English stop/function words — grammatical filler that is never a
// brandable product name (have, can, will, might, each, down, whole, least...).
// Frequency can't tell these from home/search/signal; this list can.
const STOPWORDS = new Set(
  ("a about above after again against all am an and any are aren as at be because been before being below " +
   "between both but by can cannot could couldn did didn do does doesn doing don down during each few for from " +
   "further had hadn has hasn have haven having he her here hers herself him himself his how if in into is isn it " +
   "its itself just least let like ll me might more most mustn my myself no nor not now of off on once only or " +
   "other ought our ours ourselves out over own re same shan she should shouldn so some such than that the their " +
   "theirs them themselves then there these they this those through to too under until up very was wasn we were " +
   "weren what when where which while who whom why will with won would wouldn you your yours yourself yourselves " +
   "also another any anyone anything around because before both each either else ever every many much must " +
   "perhaps quite rather really since still then though thus upon whether whole whose mean kind thank " +
   // cardinal numbers
   "zero one two three four five six seven eight nine ten eleven twelve hundred thousand million billion " +
   // common irregular past tenses the regular -ed filter can't catch
   "saw felt given made took came went said found told gave knew said heard held kept meant sent built " +
   "lost won").split(/\s+/),
);

const base = new Set(
  [...judged, ...recovered].filter((w) => /^[a-z]+$/.test(w) && !STOPWORDS.has(w)),
);
const out = new Set();
for (const w of base) {
  if (w.length < 3 || w.length > 15) continue;
  out.add(w);
  // add a plural only for nouns that are not already plural
  if (NOUNS.has(w) && !isPlural(w)) {
    const pl = pluralize(w);
    if (pl.length <= 16) out.add(pl);
  }
}

// Order most-common-first so the CLI's WORD_RANK (= list index) reflects real
// desirability. Junk auto-plurals (ageds, bolos) are in neither corpus -> sink.
const list = [...out]
  .filter((w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 16)
  .sort((a, b) => freqRank(a) - freqRank(b) || a.localeCompare(b));

// diff vs current curated list
let prev = [];
try { prev = JSON.parse(readFileSync(join(ROOT, "src", "words.json"), "utf8")); } catch {}
const prevSet = new Set(prev);
const added = list.filter((w) => !prevSet.has(w));
const removed = prev.filter((w) => !out.has(w));

writeFileSync(join(ROOT, "src", "words.json"), JSON.stringify(list));
console.log(`base singulars: ${base.size}  (judged ${judged.length} + recovered ${recovered.length})`);
console.log(`final curated list (singular+plural): ${list.length} -> src/words.json`);
console.log(`vs previous (${prev.length}): +${added.length} added, -${removed.length} removed`);
