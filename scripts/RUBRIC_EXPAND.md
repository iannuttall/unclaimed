# Brandable-word audit — EXPANSION pass (slightly broader, still no junk)

These words already passed a first brandability filter but were cut by an
over-strict pass. We're broadening the list from ~1.4k toward ~2.2k WITHOUT
letting in junk. Keep the clean, common, usable ones; still cut the genuinely
weak.

KEEP if the word is:
- commonly known (an average adult knows it, no dictionary needed), AND
- a real singular/plural noun that reads fine as a brand, product, or domain —
  it does NOT have to be flashy/iconic, just clean and usable.

This bar is more generous than "premium only" — solid everyday nouns are fine
now (e.g. harbor, cabin, ladder, garden, rocket, signal, canvas, meadow, anchor,
voyage, lantern, comet, prairie, harvest, beacon, summit, orchard).

STILL CUT (the real junk):
- obscure / archaic / technical / academic (abatement, baccalaureate, codon).
- medical / clinical / anatomy (abdomen, thyroid, ointment).
- bureaucratic / institutional abstract -ion/-ity/-ment/-ance/-ness jargon.
- proper nouns, places, nationalities, languages, names.
- adjectives, verbs-only, past tense, -ing forms.
- awkward/ugly plurals nobody would brand on, abbreviations, vulgar terms.
- words that just feel ugly or unpronounceable as a brand.

When genuinely torn on a clean common word, LEAN KEEP (we're broadening). When
it's obscure/ugly/jargon, CUT.

## Output rules

For each assigned batch file: read it (a JSON array), apply this bar, and write
the kept words as a JSON array to the matching output path. Only output words
that appear EXACTLY in that batch's input (lowercase, same spelling). No new
words. Valid JSON only.
