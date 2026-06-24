// Deterministic candidate pool: union of two frequency corpora (web + spoken)
// so both tech words and modern action words make it in. WordNet noun/verb/adj,
// minus gerunds/past/-ly. Output: data/candidates.json
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const NORVIG_CUT = 15000, SUBS_CUT = 30000;
function wn(f){const s=new Set();for(const l of readFileSync(join(require("wordnet-db").path,f),"utf8").split("\n")){if(!l||l.startsWith(" "))continue;const w=l.split(" ",1)[0];if(/^[a-z]+$/.test(w))s.add(w);}return s;}
const NOUN=wn("index.noun"),VERB=wn("index.verb"),ADJ=wn("index.adj");
function ranks(file,sep){const r=new Map();let i=0;for(const l of readFileSync(file,"utf8").split("\n")){const w=l.split(sep,1)[0].toLowerCase();if(/^[a-z]+$/.test(w)&&!r.has(w))r.set(w,i++);}return r;}
const norvig=ranks(join(__dirname,"cache","count_1w.txt"),"\t");
const subs=ranks(join(__dirname,"cache","en_50k.txt")," ");
const isGerund=w=>w.endsWith("ing")&&w.length>5&&(VERB.has(w.slice(0,-3))||VERB.has(w.slice(0,-3)+"e"));
const isPast=w=>w.endsWith("ed")&&w.length>4&&(VERB.has(w.slice(0,-2))||VERB.has(w.slice(0,-2)+"e"));
const pool=new Set();
const add=(w)=>{if(!/^[a-z]+$/.test(w)||w.length<3||w.length>12)return;if(w.endsWith("ly"))return;if(isGerund(w)||isPast(w))return;if(!(NOUN.has(w)||VERB.has(w)||ADJ.has(w)))return;pool.add(w);};
for(const [w,r] of norvig) if(r<NORVIG_CUT) add(w);
for(const [w,r] of subs) if(r<SUBS_CUT) add(w);
const list=[...pool].sort();
writeFileSync(join(__dirname,"..","data","candidates.json"),JSON.stringify(list));
console.log(`candidates: ${list.length} -> data/candidates.json`);
