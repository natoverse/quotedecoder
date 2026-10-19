"""Remove one verified numbered occurrence, preserving every other quote number."""

import argparse
from pathlib import Path
import sys

if __package__:
    from . import quote_removals as corpus
else:
    import quote_removals as corpus


def validate_request(request):
    if type(request) is not dict or set(request) != {"number", "quote", "author"}:
        raise corpus.ValidationError("Request must contain exactly number, quote, author")
    if type(request["number"]) is not int or request["number"] <= 0:
        raise corpus.ValidationError("Request number must be a positive integer")
    if type(request["quote"]) is not str or type(request["author"]) is not str:
        raise corpus.ValidationError("Request quote and author must be strings")


def remove_quote(request, root=corpus.ROOT):
    """Return True if removed, False for a verified, byte-identical no-op."""
    validate_request(request)
    master, registry, buckets = corpus.validate_state(root)
    number = request["number"]
    if number > len(master):
        raise corpus.ValidationError("Request number is out of range")
    master_index = corpus.shuffled_indices(len(master))[number - 1]
    bucket_index, slot = (number - 1) % corpus.N_BUCKETS, (number - 1) // corpus.N_BUCKETS
    quote = buckets[bucket_index][slot]
    digest = corpus.identity_sha256(request["quote"], request["author"])
    if quote is None:
        entry = next(entry for entry in registry["entries"] if entry["number"] == number)
        if entry["identity_sha256"] != digest:
            raise corpus.ValidationError("Already-removed number has a different identity")
        return False
    for actual in (quote, master[master_index]):
        if actual["quote"] != request["quote"] or actual["author"] != request["author"]:
            raise corpus.ValidationError("Requested identity does not match the numbered occurrence")

    master[master_index] = None
    buckets[bucket_index][slot] = None
    registry["entries"].append({
        "number": number,
        "master_index": master_index,
        "identity_sha256": digest,
    })
    corpus.sanitize_master(master, registry)
    outputs = corpus.tag_outputs(master)
    delete = corpus.obsolete_tag_files(root, outputs)
    outputs[corpus.MASTER] = corpus.pretty_json(master)
    outputs[f"quotes/all/{bucket_index + 1}.json"] = corpus.array_json(buckets[bucket_index])
    outputs[corpus.REGISTRY] = corpus.pretty_json(registry)
    corpus.write_changed(root, outputs, delete)
    return True


def main(argv=None, root=corpus.ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path, help="JSON file with number, quote, author")
    args = parser.parse_args(argv)
    path = args.request if args.request.is_absolute() else Path(root) / args.request
    try:
        request = corpus.read_json(path)
        changed = remove_quote(request, root)
    except (corpus.ValidationError, OSError, UnicodeError) as exc:
        print(f"Removal rejected: {exc}", file=sys.stderr)
        return 1
    print(f"Quote #{request['number']}: {'removed one occurrence' if changed else 'already removed (verified)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
