# Brandable-word audit — RECOVERY pass

These words passed an initial brandability filter but were then cut by an
OVER-strict premium pass. That pass was a touch too aggressive and dropped some
clean, common, perfectly brandable words. Your job: RECOVER the good ones.

This is a slightly more lenient bar than "ultra-premium". RECOVER a word if it is:
- clearly common (any adult knows it), AND
- a clean singular/plural noun that reads fine as a brand or product name —
  even if it's not a flashy top-tier word.

RECOVER examples (these were wrongly cut): opportunity, venture, method, signal,
network, journey, momentum, balance, focus, harmony, mentor, pioneer, catalyst,
spectrum, gateway, horizon, voyage, legacy, fortune, insight.

STILL CUT (leave these out) — the genuinely weak:
- household / mundane / functional: napkin, drawer, bucket, hallway, couch, soy.
- institutional / bureaucratic / academic: infantry, conscription, committee,
  curriculum, memorandum, tenure.
- body / medical / clinical: abdomen, thyroid, ointment, molar, symptom.
- dull/junky abstract: -ness words, awkward -ity/-ment/-ance, jargon.
- anything that slipped through wrongly: proper nouns, places, nationalities,
  adjectives, verbs-only, past tense, -ing forms, abbreviations, vulgar terms,
  clumsy plurals.

Be selective — recover roughly the best 10-20%, not most. When clearly torn, CUT.

## Output rules

For each assigned batch file: read it (a JSON array), apply this recovery bar,
and write the RECOVERED words as a JSON array to the matching output path. Only
output words that appear EXACTLY in that batch's input (lowercase, same
spelling). No new words. Valid JSON only.
