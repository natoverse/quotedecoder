"""Shared, fail-closed corpus validation and numbered-occurrence tombstones.

Numbers are one-based shuffled positions; master_index is zero-based. Identity
hashes are SHA-256 of UTF-8 JSON [quote, author], with ensure_ascii=False and
separators=(",", ":"). Text is never normalized or stored in the registry.
"""

import hashlib
import json
import os
from pathlib import Path
import random
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MASTER = "quotes/quotes.tagged.json"
REGISTRY = "quotes/removals.json"
TAG_INDEX = "quotes/tags.json"
N_BUCKETS = 100
SEED = 42


class ValidationError(ValueError):
    """The request or corpus cannot be safely processed."""


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValidationError(f"Invalid JSON constant: {value}")


def parse_json(body):
    return json.loads(body, object_pairs_hook=_object, parse_constant=_invalid_constant)


def read_json(path):
    try:
        return parse_json(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise ValidationError(f"Cannot read valid JSON from {path}: {exc}") from exc


def identity_sha256(quote, author):
    body = json.dumps([quote, author], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def shuffled_indices(size):
    indices = list(range(size))
    random.Random(SEED).shuffle(indices)
    return indices


def empty_registry(size):
    return {"version": 1, "corpus_size": size, "entries": []}


def validate_registry(registry, corpus_size=None):
    if type(registry) is not dict or set(registry) != {"version", "corpus_size", "entries"}:
        raise ValidationError("Registry must contain only version, corpus_size, entries")
    if type(registry["version"]) is not int or registry["version"] != 1:
        raise ValidationError("Unsupported registry version")
    size = registry["corpus_size"]
    if type(size) is not int or size <= 0:
        raise ValidationError("Registry corpus_size must be a positive integer")
    if corpus_size is not None and size != corpus_size:
        raise ValidationError("Master length does not match registry corpus_size")
    if type(registry["entries"]) is not list:
        raise ValidationError("Registry entries must be an array")
    indices = shuffled_indices(size)
    numbers, slots = set(), set()
    for entry in registry["entries"]:
        if type(entry) is not dict or set(entry) != {"number", "master_index", "identity_sha256"}:
            raise ValidationError("Invalid removal registry entry")
        number, slot = entry["number"], entry["master_index"]
        if type(number) is not int or not 1 <= number <= size:
            raise ValidationError("Registry number is out of range")
        if type(slot) is not int or not 0 <= slot < size:
            raise ValidationError("Registry master_index is out of range")
        if indices[number - 1] != slot:
            raise ValidationError("Registry number does not map to its master_index")
        if number in numbers or slot in slots:
            raise ValidationError("Duplicate removal registry entry")
        digest = entry["identity_sha256"]
        if type(digest) is not str or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise ValidationError("Registry identity_sha256 must be a lowercase SHA-256 digest")
        numbers.add(number)
        slots.add(slot)
    return indices


def validate_quote(quote):
    if type(quote) is not dict or set(quote) != {"quote", "author", "tags"}:
        raise ValidationError("Each live master entry must contain quote, author and tags")
    if type(quote["quote"]) is not str or type(quote["author"]) is not str:
        raise ValidationError("Quote and author must be strings")
    tags = quote["tags"]
    if type(tags) is not list or not tags:
        raise ValidationError("Each live quote must have a nonempty tags array")
    if any(type(tag) is not str or re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", tag) is None
           for tag in tags):
        raise ValidationError("Unsafe or malformed tag name")
    if len(set(tags)) != len(tags):
        raise ValidationError("Duplicate tag on a quote")


def sanitize_master(master, registry, allow_restored=False):
    """Validate first, then return a copy with only registered slots tombstoned."""
    if type(master) is not list:
        raise ValidationError("Master must be an array")
    validate_registry(registry, corpus_size=len(master))
    removals = {entry["master_index"]: entry for entry in registry["entries"]}
    result = list(master)
    for slot, quote in enumerate(master):
        entry = removals.get(slot)
        if quote is None:
            if entry is None:
                raise ValidationError(f"Untracked null master slot {slot}")
            continue
        validate_quote(quote)
        if entry is not None:
            if not allow_restored:
                raise ValidationError(f"Registered master slot {slot} is not null")
            if identity_sha256(quote["quote"], quote["author"]) != entry["identity_sha256"]:
                raise ValidationError(f"Restored identity does not match registered master slot {slot}")
            result[slot] = None
    return result


def load_master(root=ROOT, allow_restored=False):
    root = Path(root)
    registry = read_json(root / REGISTRY)
    master = read_json(root / MASTER)
    return sanitize_master(master, registry, allow_restored), registry


def make_buckets(master):
    indices = shuffled_indices(len(master))
    return [[master[index] for index in indices[bucket::N_BUCKETS]]
            for bucket in range(N_BUCKETS)]


def make_tags(master):
    by_tag = {}
    for quote in master:
        if quote is not None:
            for tag in quote["tags"]:
                by_tag.setdefault(tag, []).append(quote)
    return by_tag


def pretty_json(value):
    return json.dumps(value, ensure_ascii=False, indent=1) + "\n"


def array_json(values):
    return "[\n" + ",\n".join(json.dumps(value, ensure_ascii=False) for value in values) + "\n]\n"


def tag_outputs(master):
    by_tag = make_tags(master)
    output = {f"quotes/tagged/{tag}.json": array_json(items) for tag, items in by_tag.items()}
    output[TAG_INDEX] = pretty_json(sorted(by_tag))
    return output


def _check_directory(root, directory, expected):
    path = root / directory
    if not path.is_dir():
        raise ValidationError(f"Missing directory: {directory}")
    actual = {item.name for item in path.iterdir()}
    if actual != expected:
        raise ValidationError(f"Unexpected or missing files in {directory}")


def validate_buckets(root, master):
    root = Path(root)
    _check_directory(root, "quotes/all", {f"{number}.json" for number in range(1, N_BUCKETS + 1)})
    buckets = make_buckets(master)
    for number, expected in enumerate(buckets, 1):
        if read_json(root / f"quotes/all/{number}.json") != expected:
            raise ValidationError(f"Numbered bucket {number} differs from deterministic master mapping")
    return buckets


def validate_state(root=ROOT):
    """Validate every published corpus file; return master, registry, buckets."""
    root = Path(root)
    master, registry = load_master(root)
    buckets = validate_buckets(root, master)
    by_tag = make_tags(master)
    _check_directory(root, "quotes/tagged", {f"{tag}.json" for tag in by_tag})
    if read_json(root / TAG_INDEX) != sorted(by_tag):
        raise ValidationError("Tag index does not match the master")
    for tag, expected in by_tag.items():
        if read_json(root / f"quotes/tagged/{tag}.json") != expected:
            raise ValidationError(f"Tag output {tag} does not match the master")
    return master, registry, buckets


def obsolete_tag_files(root, outputs):
    directory = Path(root) / "quotes/tagged"
    if not directory.exists():
        return []
    return [f"quotes/tagged/{path.name}" for path in directory.iterdir()
            if path.is_file() and f"quotes/tagged/{path.name}" not in outputs]


def write_changed(root, outputs, delete=()):
    """Stage all changed content before atomic per-file replacements.

    This is not a multi-file transaction: interrupted writes are detected by the
    validator. All request/data validation must finish before this function.
    """
    root = Path(root)
    pending = []
    try:
        for relative, body in outputs.items():
            path = root / relative
            data = body.encode("utf-8")
            if path.exists() and path.read_bytes() == data:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".staged-", delete=False) as stream:
                staged = Path(stream.name)
                pending.append((staged, path))
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(staged, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        for staged, path in pending:
            os.replace(staged, path)
        for relative in delete:
            (root / relative).unlink()
        return len(pending)
    finally:
        for staged, _ in pending:
            staged.unlink(missing_ok=True)
