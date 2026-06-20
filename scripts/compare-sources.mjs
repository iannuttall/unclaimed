// Stability check: for each domain, ask the Worker via RDAP-only and WHOIS-only
// and confirm the two independent sources agree on `status`. This is the test
// behind "same response whether rdap or whois".
//
// Usage:
//   pnpm dev            # in one terminal (defaults to :8787)
//   node scripts/compare-sources.mjs [http://localhost:8787]
//
// A domain is only counted as a disagreement when BOTH sources return a
// confident, conflicting status (available vs registered). If a source returns
// "unknown" (e.g. the TLD has no RDAP, or WHOIS was rate-limited) there's
// nothing to compare, so it's reported as a skip, not a failure.

const BASE = process.argv[2] || "http://localhost:8787";

// A spread of registered + likely-available names across RDAP and non-RDAP TLDs.
const DOMAINS = [
  "google.com",
  "example.com",
  "github.io",
  "cloudflare.com",
  "this-name-should-not-exist-9f2x.com",
  "this-name-should-not-exist-9f2x.net",
  "this-name-should-not-exist-9f2x.io",
  "this-name-should-not-exist-9f2x.dev",
  "vercel.dev",
  "prompt.md",
  "openai.ai",
];

async function lookup(domain, source) {
  const url = `${BASE}/?domain=${encodeURIComponent(domain)}&source=${source}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source} ${domain}: HTTP ${res.status}`);
  return res.json();
}

const pad = (s, n) => String(s).padEnd(n);
let agree = 0;
let disagree = 0;
let skipped = 0;

console.log(
  `\n${pad("domain", 38)} ${pad("rdap", 12)} ${pad("whois", 12)} verdict`,
);
console.log("-".repeat(78));

for (const domain of DOMAINS) {
  let rdap, whois;
  try {
    [rdap, whois] = await Promise.all([
      lookup(domain, "rdap"),
      lookup(domain, "whois"),
    ]);
  } catch (e) {
    console.log(`${pad(domain, 38)} ERROR: ${e.message}`);
    disagree++;
    continue;
  }

  const r = rdap.status;
  const w = whois.status;
  let verdict;
  if (r === "unknown" || w === "unknown") {
    verdict = "skip (a source was unknown)";
    skipped++;
  } else if (r === w) {
    verdict = "✓ agree";
    agree++;
  } else {
    verdict = "✗ DISAGREE";
    disagree++;
  }
  console.log(`${pad(domain, 38)} ${pad(r, 12)} ${pad(w, 12)} ${verdict}`);
}

console.log("-".repeat(78));
console.log(
  `agree: ${agree}   disagree: ${disagree}   skipped: ${skipped}\n`,
);
process.exit(disagree > 0 ? 1 : 0);
