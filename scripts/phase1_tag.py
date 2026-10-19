"""Tag original quotes.json, verify recorded removals, and persist sanitized master.

This provenance step requires the original raw source (not included in the repo).
Source and output paths are relative to the repository, not the working directory.
"""

import collections
from pathlib import Path
import sys

if __package__:
    from . import quote_removals as corpus
    from .pipeline import SRC, load_tagged_quotes
else:
    import quote_removals as corpus
    from pipeline import SRC, load_tagged_quotes


def tag_master(root=corpus.ROOT, src=None):
    root = Path(root)
    registry = corpus.read_json(root / corpus.REGISTRY)
    source = Path(src) if src is not None else Path(SRC)
    if not source.is_absolute():
        source = root / source
    quotes = corpus.sanitize_master(load_tagged_quotes(source), registry, allow_restored=True)
    corpus.write_changed(root, {corpus.MASTER: corpus.pretty_json(quotes)})

    live = [quote for quote in quotes if quote is not None]
    tag_counts = collections.Counter(tag for quote in live for tag in quote["tags"])
    per_quote = collections.Counter(len(quote["tags"]) for quote in live)
    print("tagged quotes:", len(live), "numbered slots:", len(quotes))
    print("distinct tags:", len(tag_counts))
    print("tags per quote:", dict(sorted(per_quote.items())))
    return quotes


def main(root=corpus.ROOT):
    try:
        tag_master(root)
    except (ValueError, OSError, UnicodeError, KeyError, TypeError) as exc:
        print(f"Tagging rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
