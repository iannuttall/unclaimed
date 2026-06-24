export const meta = {
  name: 'clean-brand-leaks',
  description: 'Strip proper-noun/brand/place/person-name leaks from the judged word list, keeping evocative common words',
  phases: [{ title: 'Clean', detail: '22 agents x 300 words, remove named-entity leaks' }],
}

const DIR = '/Users/iannuttall/dev/cli/domains/scripts/data/clean-batches'
const N = 22

const PROMPT = `Below is a JSON array of candidate single-word names for software products / apps / startups (used as domains like WORD.io, WORD.md). Most are good and already vetted. Your ONLY job is to REMOVE the leaks that slipped through. Keep everything else.

REMOVE a word if it is PRIMARILY:
- a company / product / brand name (e.g. amazon, android, bose, oracle, adobe, nike, tesla, pepsi)
- a place: city, region, country, continent (e.g. boston, bordeaux, dakota, asia, kenya)
- a person's first or last name (e.g. bonnie, oscar, victor, nelson) — UNLESS the word is far more commonly an ordinary English word
- a language or nationality (e.g. french, latin)
- still clearly morbid / violent (corpse, slay), NSFW / offensive / a slur, medical / anatomical (tonsil, pelvis), an obscure or archaic word, or a pure function / grammar word (which, whom, unto)

KEEP everything else. IMPORTANT — explicitly KEEP evocative words that happen to also be names but are real, common English or well-known mythological/nature words that make GREAT brands, e.g.: atlas, apollo, aurora, phoenix, orion, nova, echo, iris, jade, amber, river, ruby, opal, dawn, sky, hawk, fox, sage. When a word is a normal English word first and a name second, KEEP it.

Read the file ${'${file}'} and return the words to KEEP as a "keep" array.`

phase('Clean')
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { keep: { type: 'array', items: { type: 'string' } } },
  required: ['keep'],
}

const idx = Array.from({ length: N }, (_, i) => i)
const results = await parallel(idx.map((i) => () => {
  const file = `${DIR}/c-${String(i).padStart(3, '0')}.json`
  return agent(
    PROMPT.replace('${file}', file),
    { label: `clean:c${i}`, phase: 'Clean', schema: SCHEMA },
  )
}))

const keep = new Set()
let nullCount = 0
for (const r of results) { if (!r) { nullCount++; continue } for (const w of r.keep || []) keep.add(w) }
const finalList = [...keep].filter((w) => /^[a-z]+$/.test(w)).sort()
log(`clean: kept ${finalList.length}, failed batches ${nullCount}`)
return { finalCount: finalList.length, failedBatches: nullCount, final: finalList }
