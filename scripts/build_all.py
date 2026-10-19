"""Build 100 deterministic numbered buckets, retaining registered null slots."""

from pathlib import Path
import sys

if __package__:
    from . import quote_removals as corpus
else:
    import quote_removals as corpus


def build_all(root=corpus.ROOT):
    master, _ = corpus.load_master(root, allow_restored=True)
    buckets = corpus.make_buckets(master)
    outputs = {f"quotes/all/{number}.json": corpus.array_json(bucket)
               for number, bucket in enumerate(buckets, 1)}
    outputs[corpus.MASTER] = corpus.pretty_json(master)
    directory = Path(root) / "quotes/all"
    delete = [f"quotes/all/{path.name}" for path in directory.iterdir()
              if path.is_file() and f"quotes/all/{path.name}" not in outputs] if directory.exists() else []
    corpus.write_changed(root, outputs, delete)
    print("quotes:", len(master), "buckets:", corpus.N_BUCKETS)


def main(root=corpus.ROOT):
    try:
        build_all(root)
    except (corpus.ValidationError, OSError, UnicodeError) as exc:
        print(f"Build rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
