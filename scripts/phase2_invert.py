"""Phase 2: invert the tagged master into one file per tag, and write tags.json.

Outputs:
  quotes/tagged/<tag>.json  — array of {quote, author, tags} for that tag
  quotes/tags.json          — sorted list of all tag names

Quotes with multiple tags are duplicated into each tag's file.
Run from the repo root:  python3 scripts/phase2_invert.py
"""
import json, os, shutil, collections

MASTER = "quotes/quotes.tagged.json"
TAG_DIR = "quotes/tagged"
TAGS_INDEX = "quotes/tags.json"

with open(MASTER) as f:
    quotes = json.load(f)

by_tag = collections.defaultdict(list)
for q in quotes:
    for t in q["tags"]:
        by_tag[t].append(q)

shutil.rmtree(TAG_DIR, ignore_errors=True)
os.makedirs(TAG_DIR)

rows = []
for tag, items in by_tag.items():
    path = f"{TAG_DIR}/{tag}.json"
    body = "[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in items) + "\n]\n"
    with open(path, "w") as f:
        f.write(body)
    rows.append((tag, len(items), os.path.getsize(path)))

with open(TAGS_INDEX, "w") as f:
    json.dump(sorted(by_tag.keys()), f, ensure_ascii=False, indent=1)
    f.write("\n")

rows.sort(key=lambda r: r[2], reverse=True)
print("tags written:", len(rows), "-> also wrote", TAGS_INDEX)
print(f"{'tag':18s} {'count':>6s} {'KB':>8s}")
for tag, n, size in rows[:15]:
    print(f"{tag:18s} {n:6d} {size/1024:8.1f}")
big = [r for r in rows if r[2] > 1024 * 1024]
print("files over 1 MB:", len(big), [f"{t} ({s/1024/1024:.2f}MB)" for t, n, s in big])
