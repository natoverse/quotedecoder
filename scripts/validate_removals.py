"""Validate published quote data and optionally allow only removals from a git base."""

import argparse
from pathlib import Path
import subprocess
import sys

if __package__:
    from . import quote_removals as corpus
else:
    import quote_removals as corpus


def _git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False)
    if result.returncode:
        raise corpus.ValidationError(f"Cannot read git base: {result.stderr.decode('utf-8', errors='replace').strip()}")
    return result.stdout.decode("utf-8")


def validate_base(root, base_ref, master, registry):
    """Require an append-only registry and exact nonremoved base occurrences."""
    root = Path(root)
    commit = _git(root, "rev-parse", "--verify", "--end-of-options", f"{base_ref}^{{commit}}").strip()
    paths = set(_git(root, "ls-tree", "-r", "--name-only", commit, "--",
                     corpus.MASTER, corpus.REGISTRY, "quotes/all").splitlines())

    def read(relative):
        if relative not in paths:
            raise corpus.ValidationError(f"Missing base file: {relative}")
        return corpus.parse_json(_git(root, "show", f"{commit}:{relative}"))

    old_master = read(corpus.MASTER)
    if type(old_master) is not list:
        raise corpus.ValidationError("Base master must be an array")
    old_registry = read(corpus.REGISTRY) if corpus.REGISTRY in paths else corpus.empty_registry(len(old_master))
    corpus.sanitize_master(old_master, old_registry)
    if registry["corpus_size"] != old_registry["corpus_size"]:
        raise corpus.ValidationError("Corpus size changed from the base")
    expected_paths = {f"quotes/all/{number}.json" for number in range(1, corpus.N_BUCKETS + 1)}
    if {path for path in paths if path.startswith("quotes/all/")} != expected_paths:
        raise corpus.ValidationError("Base must contain exactly 100 numbered buckets")
    for number, bucket in enumerate(corpus.make_buckets(old_master), 1):
        if read(f"quotes/all/{number}.json") != bucket:
            raise corpus.ValidationError(f"Base bucket {number} has an inconsistent mapping")
    old_entries = old_registry["entries"]
    if registry["entries"][:len(old_entries)] != old_entries:
        raise corpus.ValidationError("Existing removal registry entries were rewritten or removed")
    new_entries = {entry["master_index"]: entry for entry in registry["entries"][len(old_entries):]}
    for slot, (previous, current) in enumerate(zip(old_master, master)):
        entry = new_entries.get(slot)
        if entry is not None:
            if previous is None or current is not None:
                raise corpus.ValidationError("New registry entries must tombstone a live base occurrence")
            if corpus.identity_sha256(previous["quote"], previous["author"]) != entry["identity_sha256"]:
                raise corpus.ValidationError("New tombstone hash does not match the base occurrence")
        elif previous != current:
            raise corpus.ValidationError(f"Unrelated master change or renumbering at slot {slot}")


def validate(root=corpus.ROOT, base_ref=None):
    master, registry, _ = corpus.validate_state(root)
    if base_ref is not None:
        validate_base(root, base_ref, master, registry)
    return len(master), len(registry["entries"])


def main(argv=None, root=corpus.ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", help="Git commit/ref whose existing numbered occurrences must be preserved")
    args = parser.parse_args(argv)
    try:
        size, removed = validate(root, args.base_ref)
    except (ValueError, OSError, UnicodeError) as exc:
        print(f"Validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Validated {size} numbered slots, {removed} registered removals, all buckets and tags")
    return 0


if __name__ == "__main__":
    sys.exit(main())
