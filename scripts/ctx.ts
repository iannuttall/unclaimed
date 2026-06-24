import { checkDomain, setWhoisTransport } from "../src/resolvers";
import { whoisQuery } from "../src/whois-node";
import { namecheapCredsFromEnv, detectClientIp, namecheapBulkCheck, porkbunTldPrices } from "../src/pricing";
import { readFileSync, existsSync } from "node:fs";
setWhoisTransport(whoisQuery);
for (const l of existsSync(".env") ? readFileSync(".env","utf8").split("\n") : []) { const m=l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/); if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^["']|["']$/g,""); }
const TLDS = ["md","sh","tools","run","so","page","io","dev"];
const WORDS = ["mentions","impressions","signals","citations","rankings","positions","backlinks","snippets","clusters","slugs","pillars","anchors","sources","redirects","entities","spiders","probes","traces","beacons","authorities","discoveries","budgets","throttles","depths","voices","serps","canonicals","dwells","cadences","tallies","intents","audits","scans","crawls","ranks","queries","keywords","metrics","insights","leads","gaps","surfaces","silos","renders","fetches","pulses","signals","scouts","trackers","monitors","fixes","failures","themes","experiments","learnings","observations"];
const FB: Record<string,number> = { md:57, sh:31.2, dev:10.81, io:28.12, so:35, run:4.12, tools:9.78, page:10.81 };
const nc0 = namecheapCredsFromEnv();
const nc = nc0 ? { ...nc0, clientIp: await detectClientIp() } : null;
const base = await porkbunTldPrices().catch(()=>new Map<string,number>());
for (const [t,v] of Object.entries(FB)) if(!base.has(t)) base.set(t,v);
const words=[...new Set(WORDS)];
const byWord: Record<string,string[]> = {};
for (const tld of TLDS) {
  const domains=words.map(w=>`${w}.${tld}`);
  if (tld==="md"||!nc){ for(const d of domains){ const r=await checkDomain(d); if(r.status==="available"){const w=d.split(".")[0];(byWord[w]??=[]).push(`.${tld}($57)`);} } }
  else { for(let i=0;i<domains.length;i+=50){ const res=await namecheapBulkCheck(domains.slice(i,i+50),nc).catch(()=>null); if(!res)continue; for(const d of domains.slice(i,i+50)){ const c=res.get(d); if(c?.available){const w=d.split(".")[0];const p=c.premium?`($${c.premiumPrice} PREM)`:`($${base.get(tld)??'?'})`;(byWord[w]??=[]).push(`.${tld}${p}`);} } await new Promise(r=>setTimeout(r,900)); } }
}
console.log("\n===== SEO plurals available =====");
for (const w of words) if(byWord[w]) console.log("  "+w.padEnd(13)+byWord[w].join(" "));
