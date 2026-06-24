export const meta = {
  name: 'judge-brand-words',
  description: 'Judge ~16k candidate words for software-brand quality (keep good, cut shit), then rescue wrongly-cut words',
  phases: [
    { title: 'Judge', detail: '82 agents x ~200 words, detailed brand rubric' },
    { title: 'Rescue', detail: 'second pass over rejects to recover good words wrongly cut' },
  ],
}

const DIR = '/Users/iannuttall/dev/cli/domains/scripts/data/judge-batches'
const N_BATCHES = 82

const RUBRIC = `You are judging single English words as potential names for a modern software product, app, startup, or developer tool (used as a domain like WORD.md, WORD.io, WORD.sh, WORD.ai). For EVERY word decide KEEP or REJECT. Every word must appear in exactly one of the two output arrays.

KEEP a word only if ALL of these are true:
1. A normal English speaker instantly knows it - no dictionary needed.
2. Easy to say AND easy to spell after hearing it once.
3. Clean, positive or neutral feeling - it sounds good as a brand.
4. It plausibly works as a product/app/tool name. This INCLUDES all of:
   - concrete nouns (anchor, beacon, ledger, atlas, prism, vault)
   - strong simple ACTION VERBS (swipe, tap, stash, flick, pin, save, sync, snap, sort, scroll, forge, drop, send)
   - clean evocative words (spark, pulse, signal, drift, bloom, echo)

REJECT a word if ANY of these are true:
- Morbid, dark, violent, sad, or distressing: death, grief, widow, tomb, corpse, skull, demon, plague, wound, pain, fear, doom, mourn, bury, coffin, blood.
- NSFW, sexual, vulgar, an insult, a slur, or offensive in ANY major English region (US, UK, Australia). Example: "nonce" is offensive in the UK - reject anything like this.
- Medical, clinical, anatomical, disease, or bodily-function: ankle, organ, tumor, bowel, rash, gland, spine.
- Negative connotation or makes a product sound bad: junk, dirty, broke, weak, dull, messy, fail, sloppy.
- Obscure, archaic, academic, overly technical jargon, or rarely used in everyday speech: abdication, abatement, windiest, sundry.
- Hard to spell or hard to pronounce.
- A function / grammar word or filler: all, new, any, some, just, very, most, such, more, each, only, also, even, this, that, will, can.
- A proper noun, place, nationality, person name, day, month, or existing major brand.
- Past tense, an -ing form, or an -ly adverb (these should already be gone - reject any that slipped through).
- A weak generic adjective that would not stand alone as a brand: big, small, good, nice, real, main.

Tie-breakers:
- If unsure whether something is offensive, morbid, or medical: REJECT.
- If a word is clearly common, clean, and easy but you are unsure it is "brandable enough": KEEP it. We would rather keep a decent common word than lose a good one.
- Do NOT reject a word just because it is a verb or an action. Simple action words (swipe, tap, stash, flick, pin, snap, scroll) are GOOD - keep them.`

phase('Judge')
const BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keep: { type: 'array', items: { type: 'string' } },
    reject: { type: 'array', items: { type: 'string' } },
  },
  required: ['keep', 'reject'],
}

const idx = Array.from({ length: N_BATCHES }, (_, i) => i)
const judged = await parallel(idx.map((i) => () => {
  const file = `${DIR}/b-${String(i).padStart(3, '0')}.json`
  return agent(
    `Read the file ${file} — it is a JSON array of ~200 lowercase English words.\n\n${RUBRIC}\n\nJudge every word in that file. Return a "keep" array and a "reject" array. Together they must cover every word in the file exactly once.`,
    { label: `judge:b${i}`, phase: 'Judge', schema: BATCH_SCHEMA },
  )
}))

const kept = new Set()
const rejected = []
for (const r of judged) {
  if (!r) continue
  for (const w of r.keep || []) kept.add(w)
  for (const w of r.reject || []) rejected.push(w)
}
log(`Phase 1: kept ${kept.size}, rejected ${rejected.length}`)

phase('Rescue')
const RESCUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { rescue: { type: 'array', items: { type: 'string' } } },
  required: ['rescue'],
}
const RB = 200
const rejBatches = []
for (let i = 0; i < rejected.length; i += RB) rejBatches.push(rejected.slice(i, i + RB))

const rescuedArr = await parallel(rejBatches.map((words, i) => () =>
  agent(
    `The words below were REJECTED by a first-pass filter looking for clean, common, brandable single words for software products / apps / startups / dev tools (domains like WORD.io, WORD.md, WORD.sh). Some GOOD words may have been wrongly cut.\n\nReturn ONLY the words that are genuinely good product/brand names: common, instantly known by normal people, easy to say and spell, clean and positive or neutral. This INCLUDES simple action verbs (swipe, tap, stash, flick, pin, snap, scroll).\n\nDo NOT rescue anything morbid, dark, NSFW, offensive, medical/anatomical, negative, obscure, archaic, jargon, a function/grammar word, a proper noun, or a weak generic adjective. Be selective — only rescue words that clearly should not have been cut.\n\nWords:\n${words.join(', ')}`,
    { label: `rescue:${i}`, phase: 'Rescue', schema: RESCUE_SCHEMA },
  )))

const rescued = new Set()
for (const r of rescuedArr) { if (!r) continue; for (const w of r.rescue || []) rescued.add(w) }
log(`Phase 2: rescued ${rescued.size} from rejects`)

const finalList = [...new Set([...kept, ...rescued])].filter((w) => /^[a-z]+$/.test(w)).sort()
return { keptCount: kept.size, rescuedCount: rescued.size, finalCount: finalList.length, final: finalList }
