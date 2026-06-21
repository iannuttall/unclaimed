// Expand src/words.json toward a target size without losing quality.
//   final = current curated list  ∪  vetted tech/AI words  ∪  top recovered words
// Recovered = broadening-pass survivors from the over-cut pool, added most-common
// first up to TARGET. Tech words are all kept (user's niche priority).
//
//   node scripts/expand-words.mjs [target=2400]
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "data");
const SRC = join(__dirname, "..", "src", "words.json");
const TARGET = Number(process.argv[2] || 2400);

const readAll = (dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".json")) out.push(...JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  return out;
};
const clean = (w) => String(w).toLowerCase().trim();
const ok = (w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 14;

const base = new Set(JSON.parse(readFileSync(SRC, "utf8")).map(clean));
const baseN = base.size;

// vetted tech/AI words (keep all that are valid + new)
const tech = [...new Set(readAll(join(DATA, "tech-keep")).map(clean))].filter(
  (w) => ok(w) && !base.has(w),
);

// recovered broadening-pass words, ranked by lemma frequency (most common first)
const detail = JSON.parse(readFileSync(join(DATA, "heuristic-words.detail.json"), "utf8"));
const rank = new Map(detail.map((d) => [d.word, d.lemmaRank]));
const techSet = new Set(tech);
const recovered = [...new Set(readAll(join(DATA, "exp-keep")).map(clean))]
  .filter((w) => ok(w) && !base.has(w) && !techSet.has(w))
  .sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));

// compose: keep base + all tech, then fill with recovered up to TARGET
const final = new Set([...base, ...tech]);
let filled = 0;
for (const w of recovered) {
  if (final.size >= TARGET) break;
  final.add(w);
  filled++;
}

// order output by effective frequency rank (rankless tech -> mid so it isn't
// dumped last, which would tank its quality score)
const MID = 6000;
const eff = (w) => rank.get(w) ?? MID;
const ordered = [...final].sort((a, b) => eff(a) - eff(b) || a.localeCompare(b));

writeFileSync(SRC, JSON.stringify(ordered));
writeFileSync(join(DATA, "final-words.json"), JSON.stringify(ordered, null, 0));

console.log(`base (was):     ${baseN}`);
console.log(`+ vetted tech:  ${tech.length}`);
console.log(`+ recovered:    ${filled} (of ${recovered.length} available, capped at ${TARGET})`);
console.log(`final:          ${ordered.length} -> src/words.json`);
console.log(`\nsample new tech: ${tech.slice(0, 25).join(", ")}`);
