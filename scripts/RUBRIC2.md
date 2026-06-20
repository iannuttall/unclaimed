# Brandable-word audit — PASS 2 (premium tier only)

These words already passed a first brandability filter. This pass is stricter:
keep ONLY the premium tier — words a startup or buyer would genuinely pay up for
as a brand on word.com / word.io. Expect to CUT roughly a third. When torn, CUT.

KEEP only if the word is BOTH:
- clearly common (instantly understood by anyone), AND
- genuinely brandable: clean, evocative, product-like, the kind of single word
  startups actually build brands around.

Strong KEEP feel: prompt, console, studio, vault, beacon, signal, canvas, engine,
orbit, compass, ledger, forge, pixel, ember, falcon, atlas, harbor, summit,
nomad, anchor, dashboard, ecosystem, signal, rocket, prism, cipher.

CUT (too plain, functional, institutional, or weak even though common):
- merely-functional / household / mundane: aunt, couch, closet, soy, gram, debit,
  bucket, napkin, drawer, hallway.
- institutional / bureaucratic / academic: infantry, scripture, conscription,
  ministry, committee, doctrine, curriculum.
- body / medical / clinical: abdomen, thyroid, ointment, dentist, molar.
- still-slightly-technical or dull abstract -ion/-ity/-ment/-ance/-ness.
- anything that feels like a dictionary word, not a brand.

Also CUT anything that slipped through pass 1 wrongly: proper nouns, places,
nationalities, adjectives, verbs-only, past tense, -ing forms, plurals that
sound off, abbreviations, vulgar terms.

Keep BOTH singular and plural of a word only when both genuinely work as brands
(prompt/prompts, signal/signals). If the plural sounds clumsy, keep just the
singular.

## Output rules

For each assigned batch file: read it (a JSON array), apply this pass-2 bar, and
write the kept words as a JSON array to the matching output path. Only output
words that appear EXACTLY in that batch's input (lowercase, same spelling). No
new words. Valid JSON only.
