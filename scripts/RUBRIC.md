# Brandable-word audit rubric

You are auditing English words for use as PREMIUM, BRANDABLE domain names
(word.com, word.io). Be RUTHLESS — we want a small, premium set.

KEEP a word ONLY if ALL are true:

1. Common — a general English-speaking adult knows it without a dictionary.
2. It is a noun (singular OR plural common noun): a concrete object or a strong,
   familiar concept. A word that is also a verb is fine if it is ALSO a
   well-known noun (signal, anchor, spark, harbor).
3. It would make a clean, premium brand: easy to say and spell, evocative or
   genuinely useful.

REJECT if ANY are true:

- Obscure / technical / academic / archaic / rare (abatement, abdication,
  baccalaureate, evaporation, intolerance, codon, taxon, enema, easement).
- Past tense / participle (created, branded), gerund / -ing (meeting, running),
  adverb (-ly), or a pure adjective (quick, irrational, moody, prussian).
- Proper noun, place, country, nationality, language, person / brand name
  (prussia, yuma, oslo, fitzgerald).
- Medical / anatomy / chemistry unless genuinely brandable (abdomen, thyroid,
  hydrocarbons, residue).
- Awkward plurals nobody brands on (peoples, informations), letters /
  abbreviations / junk (xes, ctc, cli, crt), vulgar / offensive words.
- Bureaucratic abstract -ion / -ity / -ness / -ment / -ance words unless iconic
  and common (superiority, punctuality, conscription).

When in doubt, REJECT.

## Calibration

KEEP: prompt, prompts, console, studio, vault, beacon, signal, canvas, engine,
orbit, platform, opportunity, anchor, atlas, harbor, summit, ledger, compass,
forge, pixel, ember, falcon, nomad, quartz.

REJECT: abatement, abdomen, abdication, windiest, intolerance, evaporation,
baccalaureate, hydrocarbons, codons, taxon, prussia, yuma, peoples, xes,
slinger, easement, punctuality.

## Output rules

For each batch file you are assigned: read it (a JSON array of words), apply the
rubric, and write the KEPT words as a JSON array to the matching output path.
The output must contain only words that appear EXACTLY in that batch's input
(lowercase, same spelling). Do not invent or add words. Write valid JSON only.
