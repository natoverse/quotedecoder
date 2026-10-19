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

### Removing a quote by number

Individual quotes can be removed from `quotes/all/` by replacing their array
entry with `null`. The slot remains reserved for that quote number; the bucket
file and its other quotes remain available.

To remove a reported quote number `n`:

1. Find the bucket ID using `((n - 1) % 100) + 1` and the zero-based array index
   using `Math.floor((n - 1) / 100)`.
2. In `quotes/all/<bucket ID>.json`, replace the entire quote object at that index
   with `null`. Do **not** delete the array entry, compact the array, or delete the
   bucket file: doing so would renumber later quotes or remove unrelated quotes.
3. Validate the edited JSON with `python3 -m json.tool`, run the quote-loading
   checks below, and deploy.

For example, removing quote #101 means replacing index 1 in `quotes/all/1.json`
with `null`; quote #201 stays at index 2 with its number unchanged.

When a randomly requested quote number has a `null` slot, the app treats that
number as not found **even when its bucket fetch returned HTTP 200**. It selects
another random number from an untried bucket, up to **five selections total**
(the first selection plus four retries). If all five fail and no offline quote
is available, it shows the existing "Please try again" error. Missing bucket
files also consume an attempt; other fetch/JSON errors are not retried.
Background offline refills use the same quote-number check and retry limit,
never enqueue removed slots, and stop silently on failure.

The tagged master and tag-specific files also retain their copies of the quotes.
Running `scripts/build_all.py` regenerates the buckets from the master, so
intentional `null` replacements must be reapplied after regeneration.

Already queued offline quotes can still appear until consumed; removing a number
from the server data does not invalidate browser storage. No quotes are cached
by the service worker itself.

## Web app

`index.html` (with `styles.css` and `app.js`) is a static, mobile-friendly page
that picks quotes by choosing a random bucket from `quotes/all/`, then a random
quote in it. The `.github/workflows/deploy-pages.yml` workflow publishes the
site to GitHub Pages on every push to `main`.

The app also keeps 100 unplayed random quotes in browser storage and replenishes
them silently in the background. A service worker caches the app shell, so the
site and its refresh button continue to work without a network connection after
the first online visit.

## Scripts

`scripts/` regenerates the data from the tagged master:

- `build_all.py` → `quotes/all/`
- `phase2_invert.py` → `quotes/tagged/` and `quotes/tags.json`

## Validation

Run `node --check app.js` for syntax validation and
`node --test scripts/quote-loading.test.js` for the quote-loading regression checks.
The checks use Node's built-in test runner with no additional dependencies.
