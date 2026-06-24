// One-off name hunt for two projects. Namecheap bulk for gTLDs (avail+price),
// resolver for .md. Run: pnpm exec tsx scripts/hunt.ts
import { checkDomain, setWhoisTransport } from "../src/resolvers";
import { whoisQuery } from "../src/whois-node";
import {
  namecheapCredsFromEnv,
  detectClientIp,
  namecheapBulkCheck,
  porkbunTldPrices,
} from "../src/pricing";
import { readFileSync, existsSync } from "node:fs";
setWhoisTransport(whoisQuery);
for (const line of existsSync(".env") ? readFileSync(".env", "utf8").split("\n") : []) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Project 1: AI app-building newsletter (dev + non-tech, practical). singular.
// direct + craft/build metaphors + recurring-dispatch metaphors.
const P1 = {
  tlds: ["md", "sh", "dev", "io", "ai", "build", "so", "app", "run", "studio"],
  words: ["build","ship","craft","forge","loom","anvil","ember","kiln","foundry","atelier","smith","recipe","cookbook","blueprint","schematic","playbook","primer","manual","handbook","codex","almanac","gazette","dispatch","digest","bulletin","memo","brief","gist","snippet","kit","toolkit","bench","garage","harbor","dock","studio","workshop","lab","stack","scaffold","canvas","palette","prism","mosaic","lattice","relay","spark","kindle","beacon","compass","atlas","ledger","draft","sketch","scout","loop","signal","wire"],
};
// Project 2: agent-first SEO audit SaaS (api/cli/mcp, background, growth).
// direct + "watcher/scanner that surfaces growth" metaphors.
const P2 = {
  tlds: ["ai", "io", "sh", "dev", "run", "so", "app"],
  words: ["audit","auditor","scan","scanner","crawl","crawler","rank","ranker","index","indexer","scout","radar","sonar","sentry","sentinel","beacon","lighthouse","oracle","almanac","ledger","periscope","lookout","watchtower","probe","gauge","litmus","tally","augur","herald","compass","vane","prism","lens","telescope","pulse","dial","meter","summit","ascent","apex","crest","peak","tide","surge","climb","bloom","sprout","harvest","yield","sweep","patrol","tracker","monitor","watch","sentinel"],
};

const TIER: Record<string, number> = { ai:96, io:92, dev:82, app:80, sh:70, run:70, build:64, so:62, studio:68, md:42 };
// fallback base prices (USD) for TLDs porkbun /pricing/get may miss
const FALLBACK: Record<string, number> = { md:57, sh:31.2, dev:10.81, io:28.12, ai:75, app:13, build:26.26, so:35, run:4.12, studio:11.84 };

async function hunt(name: string, p: { tlds: string[]; words: string[] }) {
  const nc0 = namecheapCredsFromEnv();
  const nc = nc0 ? { ...nc0, clientIp: await detectClientIp() } : null;
  const base = await porkbunTldPrices().catch(() => new Map<string, number>());
  for (const [t, v] of Object.entries(FALLBACK)) if (!base.has(t)) base.set(t, v); // fill gaps
  const words = [...new Set(p.words)];

  type Hit = { domain: string; word: string; tld: string; premium: boolean; price: number | null };
  const hits: Hit[] = [];

  for (const tld of p.tlds) {
    const domains = words.map((w) => `${w}.${tld}`);
    if (tld === "md" || !nc) {
      for (const d of domains) {
        const r = await checkDomain(d);
        if (r.status === "available") hits.push({ domain: d, word: d.split(".")[0], tld, premium: false, price: tld === "md" ? 57 : null });
      }
    } else {
      for (let i = 0; i < domains.length; i += 50) {
        const res = await namecheapBulkCheck(domains.slice(i, i + 50), nc).catch(() => null);
        if (!res) continue;
        for (const d of domains.slice(i, i + 50)) {
          const c = res.get(d);
          if (c?.available) hits.push({ domain: d, word: d.split(".")[0], tld, premium: !!c.premium, price: c.premium ? c.premiumPrice : (base.get(tld) ?? null) });
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // sort: standard-priced first, then by TLD tier, then short words
  hits.sort((a, b) =>
    Number(a.premium) - Number(b.premium) ||
    (TIER[b.tld] ?? 40) - (TIER[a.tld] ?? 40) ||
    a.word.length - b.word.length);

  console.log(`\n========== ${name} ==========`);
  for (const h of hits) {
    const tag = h.premium ? " \x1b[31m*PREMIUM\x1b[0m" : "";
    const price = h.price != null ? `$${h.price}` : "?";
    console.log(`  ${h.domain.padEnd(20)} ${price}${tag}`);
  }
  console.log(`  (${hits.length} available)`);
}

await hunt("PROJECT 1 — AI app-building newsletter", P1);
await hunt("PROJECT 2 — SEO audit agent SaaS", P2);
