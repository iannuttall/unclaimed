// Heuristic word-list audit (stage 1 of 2).
//
// Goal: from the universe of English words, mechanically narrow down to COMMON,
// SINGULAR/PLURAL NOUNS that could plausibly be premium, brandable domains —
// then hand the survivors to the LLM brandability pass (stage 2).
//
// Sources (both reproducible, cached under scripts/cache/):
//   - Norvig count_1w.txt   -> frequency ranking ("common")  norvig.com/ngrams
//   - WordNet (wordnet-db)  -> part of speech ("noun, not verb/adj/adverb")
//
// Filters applied here (ruthless, but the LLM does the final brandability call):
//   - must be a WordNet NOUN (singular or plural form)
//   - must be common: within the top FREQ_RANK_LIMIT by frequency
//   - pure a-z, length MIN_LEN..MAX_LEN
//   - drop deverbal gerunds (-ing of a verb)   e.g. meeting, building, running
//   - drop past tense / participles (-ed of a verb) e.g. created, branded
//   - drop adverbs / comparatives / superlatives (handled by the noun filter)
//   - drop a stoplist of function words
//
// Output: scripts/data/heuristic-words.json  (+ a stage report to stdout)

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "cache");
const DATA = join(__dirname, "data");
mkdirSync(CACHE, { recursive: true });
mkdirSync(DATA, { recursive: true });

// ---- tunables -------------------------------------------------------------
const FREQ_RANK_LIMIT = 12000;
const MIN_LEN = 3;
const MAX_LEN = 14;
const FREQ_URL = "https://norvig.com/ngrams/count_1w.txt";

// ---- 1. WordNet POS sets --------------------------------------------------
function loadWordnetLemmas(posFile) {
  const path = join(require("wordnet-db").path, posFile);
  const text = readFileSync(path, "utf8");
  const set = new Set();
  for (const line of text.split("\n")) {
    // License header lines start with two spaces; data lines start with lemma.
    if (!line || line.startsWith(" ")) continue;
    const lemma = line.split(" ", 1)[0];
    if (/^[a-z]+$/.test(lemma)) set.add(lemma); // single words only (no _ phrases)
  }
  return set;
}

const NOUNS = loadWordnetLemmas("index.noun");
const VERBS = loadWordnetLemmas("index.verb");

// ---- 2. frequency list ----------------------------------------------------
async function loadFrequency() {
  const cached = join(CACHE, "count_1w.txt");
  if (!existsSync(cached)) {
    process.stderr.write(`downloading ${FREQ_URL} ...\n`);
    const res = await fetch(FREQ_URL);
    if (!res.ok) throw new Error(`frequency download failed: HTTP ${res.status}`);
    writeFileSync(cached, await res.text());
  }
  const rank = new Map(); // word -> rank (0 = most common)
  let i = 0;
  for (const line of readFileSync(cached, "utf8").split("\n")) {
    const word = line.split("\t", 1)[0].toLowerCase();
    if (word && !rank.has(word)) rank.set(word, i++);
  }
  return rank;
}

// ---- 3. morphology helpers ------------------------------------------------
function singularize(w) {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("zes") ||
      w.endsWith("ches") || w.endsWith("shes")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

// The regular plural of a singular noun. Used to reject malformed corpus plurals
// like "searchs" (real plural is "searches") and "citys" (-> "cities").
function pluralize(w) {
  if (/(s|x|z|ch|sh)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

// Mass/uncountable nouns whose "plural" is not a real word people brand on.
const UNCOUNTABLE = new Set(
  ("information news software hardware music money research traffic content " +
   "knowledge advice equipment furniture luggage homework feedback gear staff " +
   "wildlife livestock progress weather harm wealth fun stuff").split(/\s+/),
);

// Is this -ing word the gerund of a verb? (meeting<-meet, building<-build)
function isDeverbalGerund(w) {
  if (!w.endsWith("ing") || w.length < 5) return false;
  const stem = w.slice(0, -3);
  return (
    VERBS.has(stem) ||           // build -> building
    VERBS.has(stem + "e") ||     // make  -> making
    (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2] &&
      VERBS.has(stem.slice(0, -1))) // run -> running
  );
}

// Is this -ed word a past tense / participle? (created<-create, branded<-brand)
function isPastTense(w) {
  if (!w.endsWith("ed") || w.length < 4) return false;
  const stem = w.slice(0, -2);
  return (
    VERBS.has(stem) ||           // brand -> branded
    VERBS.has(stem + "e") ||     // create -> created
    VERBS.has(w.slice(0, -1)) || // (rare) e.g. agreed -> agree? handled above
    (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2] &&
      VERBS.has(stem.slice(0, -1))) // stop -> stopped
  );
}

// Common function words / junk that slip through as "nouns" in WordNet.
const STOPLIST = new Set(
  ("the a an and or but if then else of to in on at by for with from as is are " +
   "was were be been being do does did has have had will would shall should can " +
   "could may might must not no yes this that these those it its they them their " +
   "you your we our he she him her his hers i me my mine us who whom whose which " +
   "what when where why how all any both each few more most other some such only " +
   "own same so than too very s t can't don't etc via per vs ok " +
   // high-frequency words WordNet lists as nouns but nobody brands on:
   "are as free out there here also well just even much many lot get got see " +
   "let put thing things way ways one two three first second next last via " +
   "able like back top over down off again still ever else around").split(/\s+/),
);

// ---- 4. run the filter ----------------------------------------------------
const rank = await loadFrequency();

const stats = {
  considered: 0,
  rejAlpha: 0,
  rejLen: 0,
  rejStop: 0,
  rejRank: 0,
  rejBadPlural: 0,
  rejNotNoun: 0,
  rejGerund: 0,
  rejPast: 0,
  kept: 0,
};

const kept = [];
const seen = new Set();
const rankOf = (w) => (rank.has(w) ? rank.get(w) : Infinity);

// Iterate the whole frequency table. We judge "common" by the LEMMA's rank, not
// the surface form's, so a plural like `prompts` counts as common because its
// singular `prompt` is — otherwise less-frequent plural forms get unfairly cut.
// SCAN_LIMIT just bounds work; plurals of common nouns sit well within it.
const SCAN_LIMIT = 120_000;
const byRank = [...rank.entries()].sort((a, b) => a[1] - b[1]);

for (const [word, r] of byRank) {
  if (r >= SCAN_LIMIT) break;

  if (!/^[a-z]+$/.test(word)) { stats.rejAlpha++; continue; }
  if (word.length < MIN_LEN || word.length > MAX_LEN) { stats.rejLen++; continue; }
  const sg = singularize(word);
  if (STOPLIST.has(word) || STOPLIST.has(sg)) { stats.rejStop++; continue; }

  const lemmaRank = Math.min(r, rankOf(sg));
  if (lemmaRank >= FREQ_RANK_LIMIT) { stats.rejRank++; continue; }
  stats.considered++;

  const isPlural = word !== sg;
  // Reject malformed corpus plurals and uncountables-as-plural.
  if (isPlural && (word !== pluralize(sg) || UNCOUNTABLE.has(sg))) {
    stats.rejBadPlural++;
    continue;
  }

  const isNoun = NOUNS.has(word) || NOUNS.has(sg);
  if (!isNoun) { stats.rejNotNoun++; continue; }

  // screen both the surface form and its singular, so plural gerunds/participles
  // (runnings <- running, leads <- ... ) are caught too.
  if (isDeverbalGerund(word) || isDeverbalGerund(sg)) { stats.rejGerund++; continue; }
  if (isPastTense(word) || isPastTense(sg)) { stats.rejPast++; continue; }

  if (seen.has(word)) continue;
  seen.add(word);
  kept.push({ word, rank: r, lemmaRank, plural: word !== sg && NOUNS.has(sg) });
  stats.kept++;
}

// most-common lemma first
kept.sort((a, b) => a.lemmaRank - b.lemmaRank || a.word.localeCompare(b.word));

writeFileSync(
  join(DATA, "heuristic-words.json"),
  JSON.stringify(kept.map((k) => k.word), null, 0) + "\n",
);
writeFileSync(
  join(DATA, "heuristic-words.detail.json"),
  JSON.stringify(kept, null, 0) + "\n",
);

// ---- 5. report ------------------------------------------------------------
console.log("\nHeuristic word-list audit (stage 1)");
console.log("===================================");
console.log(`WordNet nouns: ${NOUNS.size.toLocaleString()}   verbs: ${VERBS.size.toLocaleString()}`);
console.log(`frequency rank window: top ${FREQ_RANK_LIMIT.toLocaleString()}`);
console.log("-----------------------------------");
console.log(`considered (lemma in window): ${stats.considered.toLocaleString()}`);
console.log(`  - non-alpha:     ${stats.rejAlpha.toLocaleString()}`);
console.log(`  - bad length:    ${stats.rejLen.toLocaleString()}`);
console.log(`  - stopword:      ${stats.rejStop.toLocaleString()}`);
console.log(`  - bad plural:    ${stats.rejBadPlural.toLocaleString()}`);
console.log(`  - not a noun:    ${stats.rejNotNoun.toLocaleString()}`);
console.log(`  - gerund (-ing): ${stats.rejGerund.toLocaleString()}`);
console.log(`  - past (-ed):    ${stats.rejPast.toLocaleString()}`);
console.log("-----------------------------------");
console.log(`KEPT -> stage 2:   ${stats.kept.toLocaleString()}`);
console.log(`written: scripts/data/heuristic-words.json\n`);
console.log("sample (most common 40):");
console.log("  " + kept.slice(0, 40).map((k) => k.word).join(", "));
console.log("\nsample (middle 40):");
const mid = Math.floor(kept.length / 2);
console.log("  " + kept.slice(mid, mid + 40).map((k) => k.word).join(", "));
console.log("\nsample (last 40 — rarest kept):");
console.log("  " + kept.slice(-40).map((k) => k.word).join(", ") + "\n");
