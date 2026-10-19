"""Regenerate tag arrays/index from live master occurrences, honoring removals."""

import sys

if __package__:
    from . import quote_removals as corpus
else:
    import quote_removals as corpus


def invert(root=corpus.ROOT):
    master, _ = corpus.load_master(root, allow_restored=True)
    outputs = corpus.tag_outputs(master)
    delete = corpus.obsolete_tag_files(root, outputs)
    outputs[corpus.MASTER] = corpus.pretty_json(master)
    corpus.write_changed(root, outputs, delete)
    print("tags written:", len(outputs) - 2, "-> also wrote", corpus.TAG_INDEX)


def main(root=corpus.ROOT):
    try:
        invert(root)
    except (corpus.ValidationError, OSError, UnicodeError) as exc:
        print(f"Tag build rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
