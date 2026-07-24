"""Build the random-access quotes/all/ buckets from the tagged master.

100 balanced, shuffled buckets (fixed seed) — pick a random bucket, then a
random index within it. Reads the canonical master and is deterministic.
Run from the repo root:  python3 scripts/build_all.py
"""
import json, os, random, shutil

MASTER = "quotes/quotes.tagged.json"
OUT_DIR = "quotes/all"
N_BUCKETS = 100
SEED = 42

with open(MASTER) as f:
    quotes = json.load(f)

random.seed(SEED)
random.shuffle(quotes)

buckets = [[] for _ in range(N_BUCKETS)]
for i, q in enumerate(quotes):
    buckets[i % N_BUCKETS].append(q)

shutil.rmtree(OUT_DIR, ignore_errors=True)
os.makedirs(OUT_DIR)
sizes = []
for i, b in enumerate(buckets, 1):
    body = "[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in b) + "\n]\n"
    path = f"{OUT_DIR}/{i}.json"
    with open(path, "w") as f:
        f.write(body)
    sizes.append(os.path.getsize(path))

print("quotes:", len(quotes), "buckets:", N_BUCKETS)
print("per-bucket count:", min(len(b) for b in buckets), "-", max(len(b) for b in buckets))
print(f"file size KB: min={min(sizes)/1024:.1f} max={max(sizes)/1024:.1f} total={sum(sizes)/1024/1024:.2f} MB")
