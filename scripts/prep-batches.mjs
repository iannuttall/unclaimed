// Split the heuristic candidate list into fixed-size batches for the LLM judges.
// Each batch becomes scripts/data/batches/batch-NNN.json (a JSON array of words).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "data");
const BATCH_DIR = join(DATA, "batches");
const BATCH_SIZE = Number(process.argv[2] || 500);

rmSync(BATCH_DIR, { recursive: true, force: true });
mkdirSync(BATCH_DIR, { recursive: true });

const words = JSON.parse(readFileSync(join(DATA, "heuristic-words.json"), "utf8"));
let n = 0;
for (let i = 0; i < words.length; i += BATCH_SIZE) {
  const id = String(n).padStart(3, "0");
  writeFileSync(
    join(BATCH_DIR, `batch-${id}.json`),
    JSON.stringify(words.slice(i, i + BATCH_SIZE)),
  );
  n++;
}
console.log(`${words.length} words -> ${n} batches of ${BATCH_SIZE} in scripts/data/batches/`);
