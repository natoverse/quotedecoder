# Quote Decoder

A web app that serves a daily encrypted quote puzzle. Each quote is scrambled with a Caesar cipher, and you crack it by working out the letter substitutions.

## How to solve

Every letter in the quote has been swapped for a different letter, consistently throughout the puzzle. Your job is to figure out which cipher letter maps to which real letter. Start with short words, common letters, and repeated patterns, fill in guesses across the whole quote, and refine until the plaintext reads clearly.

## Data

Quotes live in `quotes/`, served straight from GitHub (no backend/query layer):

- `all/` — 100 shuffled buckets. Pick a random bucket, then a random quote in it.
- `tagged/` — one file per tag (e.g. `kids.json`) for filtering by theme.
- `tags.json` — the list of all available tags.
- `quotes.tagged.json` — the full tagged master set.

Each quote is `{ "quote", "author", "tags": [...] }`.

## Scripts

`scripts/` regenerates the data from the tagged master:

- `build_all.py` → `quotes/all/`
- `phase2_invert.py` → `quotes/tagged/` and `quotes/tags.json`
