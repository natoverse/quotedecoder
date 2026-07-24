"""Phase 1: apply tags to every kept quote and write the canonical tagged master.

Output: quotes/quotes.tagged.json  (array of {quote, author, tags} in canonical order)
This master is the single input Phase 2 uses to invert the index by tag.

Provenance script: requires the original raw quotes.json (SRC in pipeline.py).
Run from the repo root:  python3 scripts/phase1_tag.py
"""
import json, os, collections
from pipeline import load_tagged_quotes

quotes = load_tagged_quotes()

os.makedirs("quotes", exist_ok=True)
with open("quotes/quotes.tagged.json", "w") as f:
    json.dump(quotes, f, ensure_ascii=False, indent=1)
    f.write("\n")

# Report the tag universe.
tag_counts = collections.Counter(t for q in quotes for t in q["tags"])
per_quote = collections.Counter(len(q["tags"]) for q in quotes)

print("tagged quotes:", len(quotes))
print("distinct tags:", len(tag_counts))
print("tags per quote:", dict(sorted(per_quote.items())))
print("top 30 tags:")
for tag, n in tag_counts.most_common(30):
    print(f"  {tag:14s} {n}")
print("rarest 10 tags:")
for tag, n in tag_counts.most_common()[-10:]:
    print(f"  {tag:14s} {n}")
