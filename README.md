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

### Removing quote files

The app tolerates deleted files in `quotes/all/`: on HTTP 404 it picks a different,
untried bucket, up to **five requests total** (the first request plus four retries)
per quote load. If all five are missing and no offline quote is available, it
shows the existing "Please try again" error. Other errors are not retried.
Background offline refills use the same limit and stop silently on failure.

To remove a bucket:

1. Find its file in `quotes/all/`. For a reported quote number `n`, the bucket ID is
   `((n - 1) % 100) + 1`, and its zero-based array index is `Math.floor((n - 1) / 100)`.
2. Delete that bucket's JSON file. Keep the remaining filenames and the app's
   bucket count unchanged so existing quote numbers stay stable.
3. Deploy, confirm the deleted URL returns 404, and check that a fresh browser
   session can still load and refresh puzzles.

**A bucket contains hundreds of quotes, not just one.** Deleting it removes all
of those quotes from new app fetches; this is not a single-quote deletion strategy.
Deleting an array element instead would renumber later quotes in that bucket.
The tagged master and tag-specific files also retain their copies of the quotes.
Running `scripts/build_all.py` recreates deleted buckets from the master, so any
intentional file deletions must be reapplied after regeneration.

Already queued offline quotes can still appear until consumed; deleting a server
file does not invalidate browser storage. No quotes are cached by the service
worker itself.

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
