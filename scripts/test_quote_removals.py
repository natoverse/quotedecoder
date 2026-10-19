"""Standard-library regression tests; all writes stay in isolated temporary fixtures."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

if __package__:
    from . import build_all, phase1_tag, phase2_invert, pipeline, quote_removals as corpus
    from . import remove_quote, validate_removals
else:
    import build_all
    import phase1_tag
    import phase2_invert
    import pipeline
    import quote_removals as corpus
    import remove_quote
    import validate_removals


class CorpusFixture(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix=".removal-tests-")
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name)
        self.raw = [{"quote": f"Entry {index}", "author": f"Writer {index}", "category": "general"}
                    for index in range(205)]
        self.raw[0]["category"] = "exclusive"
        self.raw[1] = {"quote": "Shared words", "author": "Same Writer", "category": "general"}
        self.raw[2] = dict(self.raw[1])
        self.raw[3] = {"quote": "null", "author": "None", "category": "general"}
        self.raw[4] = {"quote": 'Exact “é” "quoted"\ntext', "author": "Å", "category": "general"}
        self.master = [{"quote": quote["quote"], "author": quote["author"],
                        "tags": pipeline.compute_tags(quote["category"], quote["quote"])}
                       for quote in self.raw]
        self.write_json("quotes.json", self.raw)
        self.write_json(corpus.MASTER, self.master)
        self.write_json(corpus.REGISTRY, corpus.empty_registry(len(self.master)))
        self.rebuild()

    def write_json(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(corpus.pretty_json(value), encoding="utf-8")

    def read(self, relative):
        return corpus.read_json(self.root / relative)

    def snapshot(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*")
                if path.is_file() and ".git" not in path.relative_to(self.root).parts}

    def rebuild(self):
        with contextlib.redirect_stdout(io.StringIO()):
            build_all.build_all(self.root)
            phase2_invert.invert(self.root)

    def request(self, slot=0):
        number = corpus.shuffled_indices(len(self.master)).index(slot) + 1
        quote = self.master[slot]
        return {"number": number, "quote": quote["quote"], "author": quote["author"]}

    def remove(self, slot=0):
        return remove_quote.remove_quote(self.request(slot), self.root)

    def assert_rejected_unchanged(self, action):
        before = self.snapshot()
        with self.assertRaises((corpus.ValidationError, ValueError)):
            action()
        self.assertEqual(before, self.snapshot())


class RemovalTests(CorpusFixture):
    def test_exact_identity_mismatches_make_no_writes(self):
        for field, value in (("quote", "wrong"), ("author", "wrong"),
                             ("quote", self.request()["quote"] + " ")):
            with self.subTest(field=field, value=value):
                request = self.request()
                request[field] = value
                self.assert_rejected_unchanged(lambda: remove_quote.remove_quote(request, self.root))

    def test_invalid_request_shapes_and_types(self):
        cases = [None, [], {}, {**self.request(), "extra": 1}]
        for number in (True, False, 0, -1, 1.0, "1", None, 206):
            cases.append({**self.request(), "number": number})
        for field in ("quote", "author"):
            for value in (None, True, 1, [], {}):
                cases.append({**self.request(), field: value})
        for request in cases:
            with self.subTest(request=request):
                self.assert_rejected_unchanged(lambda: remove_quote.remove_quote(request, self.root))

    def test_only_one_number_and_master_slot_change(self):
        before = corpus.make_buckets(self.master)
        self.assertTrue(self.remove())
        master, registry, after = corpus.validate_state(self.root)
        expected = list(self.master)
        expected[0] = None
        self.assertEqual(master, expected)
        changes = [(bucket, slot) for bucket in range(100) for slot in range(len(before[bucket]))
                   if before[bucket][slot] != after[bucket][slot]]
        number = self.request()["number"]
        self.assertEqual(changes, [((number - 1) % 100, (number - 1) // 100)])
        self.assertEqual(registry["corpus_size"], len(self.master))
        self.assertEqual(len(master), len(self.master))

    def test_first_and_last_numbers_keep_their_slots(self):
        indices = corpus.shuffled_indices(len(self.master))
        for number in (1, len(self.master)):
            self.remove(indices[number - 1])
        master, registry, buckets = corpus.validate_state(self.root)
        self.assertEqual([entry["number"] for entry in registry["entries"]], [1, len(self.master)])
        self.assertIsNone(buckets[0][0])
        self.assertIsNone(buckets[(len(master) - 1) % 100][(len(master) - 1) // 100])

    def test_duplicate_numbered_occurrence_is_preserved(self):
        before = self.read("quotes/tagged/general.json")
        self.remove(1)
        master, _, buckets = corpus.validate_state(self.root)
        self.assertIsNone(master[1])
        self.assertEqual(master[2], self.master[2])
        number = self.request(2)["number"]
        self.assertEqual(buckets[(number - 1) % 100][(number - 1) // 100], self.master[2])
        after = self.read("quotes/tagged/general.json")
        self.assertEqual(before.count(self.master[1]), 2)
        self.assertEqual(after.count(self.master[1]), 1)

    def test_duplicate_occurrences_can_be_removed_independently(self):
        self.remove(1)
        self.remove(2)
        master, registry, _ = corpus.validate_state(self.root)
        self.assertIsNone(master[1])
        self.assertIsNone(master[2])
        self.assertEqual(len(registry["entries"]), 2)
        self.assertEqual(registry["entries"][0]["identity_sha256"],
                         registry["entries"][1]["identity_sha256"])

    def test_idempotent_rerun_is_byte_identical(self):
        self.remove()
        before = self.snapshot()
        self.assertFalse(self.remove())
        self.assertEqual(before, self.snapshot())

    def test_repeat_with_wrong_identity_is_rejected(self):
        self.remove()
        for field in ("quote", "author"):
            request = self.request()
            request[field] += "wrong"
            self.assert_rejected_unchanged(lambda: remove_quote.remove_quote(request, self.root))

    def test_registry_persists_without_plaintext(self):
        self.remove(4)
        registry = self.read(corpus.REGISTRY)
        self.assertEqual(registry["entries"], [{
            "number": self.request(4)["number"], "master_index": 4,
            "identity_sha256": corpus.identity_sha256(self.master[4]["quote"], self.master[4]["author"]),
        }])
        self.assertNotIn(self.master[4]["quote"], (self.root / corpus.REGISTRY).read_text())
        self.assertNotIn('"author"', (self.root / corpus.REGISTRY).read_text())
        self.assertFalse(self.remove(4))

    def test_hash_encoding_is_unambiguous_and_exact(self):
        import hashlib
        expected = hashlib.sha256('["é","Å"]'.encode("utf-8")).hexdigest()
        self.assertEqual(corpus.identity_sha256("é", "Å"), expected)
        escaped = '["Exact “é” \\"quoted\\"\\ntext","Å"]'
        expected = hashlib.sha256(escaped.encode("utf-8")).hexdigest()
        self.assertEqual(corpus.identity_sha256(self.master[4]["quote"], self.master[4]["author"]), expected)
        self.assertNotEqual(corpus.identity_sha256('Exact “é” "quoted"\\ntext', "Å"), expected)
        self.assertNotEqual(corpus.identity_sha256("a,b", "c"), corpus.identity_sha256("a", "b,c"))
        self.assertNotEqual(corpus.identity_sha256("é", "Å"), corpus.identity_sha256("e\u0301", "Å"))

    def test_last_tag_copy_removes_tag_file_and_index_entry(self):
        self.assertTrue((self.root / "quotes/tagged/exclusive.json").exists())
        self.remove()
        self.assertFalse((self.root / "quotes/tagged/exclusive.json").exists())
        self.assertNotIn("exclusive", self.read(corpus.TAG_INDEX))
        corpus.validate_state(self.root)

    def test_null_like_content_is_not_a_tombstone(self):
        self.remove(0)
        self.assertEqual(self.read(corpus.MASTER)[3]["quote"], "null")
        corpus.validate_state(self.root)

    def test_shuffle_and_serialization_have_no_churn(self):
        shuffled = copy.deepcopy(self.master)
        random.Random(42).shuffle(shuffled)
        expected = [shuffled[bucket::100] for bucket in range(100)]
        self.assertEqual(corpus.make_buckets(self.master), expected)
        before = self.snapshot()
        self.rebuild()
        with contextlib.redirect_stdout(io.StringIO()):
            phase1_tag.tag_master(self.root)
        self.assertEqual(before, self.snapshot())

    def test_build_all_sanitizes_restored_master_without_renumbering(self):
        self.remove(1)
        expected = self.snapshot()
        self.write_json(corpus.MASTER, self.master)
        with contextlib.redirect_stdout(io.StringIO()):
            build_all.build_all(self.root)
        self.assertEqual(expected, self.snapshot())
        corpus.validate_state(self.root)

    def test_tag_build_sanitizes_restored_master(self):
        self.remove(1)
        expected = self.snapshot()
        self.write_json(corpus.MASTER, self.master)
        with contextlib.redirect_stdout(io.StringIO()):
            phase2_invert.invert(self.root)
        self.assertEqual(expected, self.snapshot())
        corpus.validate_state(self.root)

    def test_phase1_never_restores_removed_occurrence(self):
        self.remove(1)
        expected = self.snapshot()
        with contextlib.redirect_stdout(io.StringIO()):
            quotes = phase1_tag.tag_master(self.root)
        self.assertIsNone(quotes[1])
        self.assertEqual(quotes[2], self.master[2])
        self.assertEqual(expected, self.snapshot())
        corpus.validate_state(self.root)

    def test_changed_source_identity_and_length_fail_before_writes(self):
        self.remove()
        for raw in (self.raw[1:], [self.raw[1], self.raw[0]] + self.raw[2:]):
            self.write_json("quotes.json", raw)
            self.assert_rejected_unchanged(lambda: phase1_tag.tag_master(self.root))

    def test_moved_restored_master_fails_before_build_writes(self):
        self.remove()
        moved = list(self.master)
        moved[0], moved[1] = moved[1], moved[0]
        self.write_json(corpus.MASTER, moved)
        for build in (build_all.build_all, phase2_invert.invert):
            self.assert_rejected_unchanged(lambda: build(self.root))

    def test_invalid_registry_fails_all_writers_before_any_writes(self):
        self.remove()
        registry = self.read(corpus.REGISTRY)
        entry = registry["entries"][0]
        cases = [
            {**registry, "version": True}, {**registry, "version": 2},
            {**registry, "corpus_size": True}, {**registry, "corpus_size": 0},
            {**registry, "corpus_size": len(self.master) + 1},
            {**registry, "corpus_size": 10 ** 100},
            {**registry, "entries": {}}, {**registry, "extra": 1},
            {**registry, "entries": [entry, entry]},
        ]
        for key, value in (("number", True), ("number", 0), ("number", 206),
                           ("master_index", -1), ("master_index", True), ("master_index", 1),
                           ("identity_sha256", "a" * 63), ("identity_sha256", "A" * 64),
                           ("identity_sha256", None), ("quote", "plaintext")):
            cases.append({**registry, "entries": [{**entry, key: value}]})
        for invalid in cases:
            with self.subTest(registry=invalid):
                self.write_json(corpus.REGISTRY, invalid)
                for action in (lambda: self.remove(1),
                               lambda: build_all.build_all(self.root),
                               lambda: phase2_invert.invert(self.root),
                               lambda: phase1_tag.tag_master(self.root)):
                    self.assert_rejected_unchanged(action)

    def test_untracked_null_is_rejected_even_when_derived_files_match(self):
        master = list(self.master)
        master[0] = None
        self.write_json(corpus.MASTER, master)
        outputs = corpus.tag_outputs(master)
        for number, bucket in enumerate(corpus.make_buckets(master), 1):
            outputs[f"quotes/all/{number}.json"] = corpus.array_json(bucket)
        corpus.write_changed(self.root, outputs, corpus.obsolete_tag_files(self.root, outputs))
        self.assert_rejected_unchanged(lambda: self.remove())
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))

    def test_validator_rejects_bucket_corruption_and_missing_files(self):
        relative = "quotes/all/1.json"
        original = (self.root / relative).read_bytes()
        bucket = self.read(relative)
        bucket[0], bucket[1] = bucket[1], bucket[0]
        self.write_json(relative, bucket)
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))
        self.assert_rejected_unchanged(lambda: self.remove())
        (self.root / relative).unlink()
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))
        (self.root / relative).write_bytes(original)
        (self.root / "quotes/all/101.json").write_text("[]")
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))

    def test_validator_rejects_tag_corruption_missing_files_and_index(self):
        for relative, invalid in (("quotes/tagged/general.json", []), (corpus.TAG_INDEX, [])):
            path = self.root / relative
            original = path.read_bytes()
            self.write_json(relative, invalid)
            self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))
            self.assert_rejected_unchanged(lambda: self.remove())
            path.unlink()
            self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))
            path.write_bytes(original)

    def test_validator_rejects_registered_live_master(self):
        self.remove()
        self.write_json(corpus.MASTER, self.master)
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root))
        self.assert_rejected_unchanged(lambda: self.remove())

    def test_unsafe_or_duplicate_tags_fail_before_writes(self):
        for tags in (["../../outside"], [r"..\outside"], ["/absolute"], ["x/y"], [r"x\y"],
                     ["general", "general"], [True], []):
            master = copy.deepcopy(self.master)
            master[0]["tags"] = tags
            self.write_json(corpus.MASTER, master)
            self.assert_rejected_unchanged(lambda: phase2_invert.invert(self.root))

    def test_strict_json_rejects_duplicate_keys_and_nonstandard_constants(self):
        for body in ('{"number":1,"number":2,"quote":"a","author":"b"}', "NaN", "Infinity"):
            with self.subTest(body=body):
                with self.assertRaises(corpus.ValidationError):
                    corpus.parse_json(body)
        path = self.root / corpus.REGISTRY
        path.write_text('{"version":1,"version":1,"corpus_size":205,"entries":[]}')
        self.assert_rejected_unchanged(lambda: self.remove())

    def test_cli_request_paths_resolve_against_root_not_cwd(self):
        self.write_json("request.json", self.request())
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        previous = Path.cwd()
        try:
            os.chdir(elsewhere)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(remove_quote.main(["--request", "request.json"], self.root), 0)
                self.assertEqual(remove_quote.main(["--request", str(self.root / "request.json")], self.root), 0)
                self.assertEqual(validate_removals.main([], self.root), 0)
        finally:
            os.chdir(previous)
        corpus.validate_state(self.root)

    def test_cli_failures_return_nonzero_without_writes(self):
        for request in ({"number": True, "quote": "a", "author": "b"},
                        {**self.request(), "quote": "wrong"}):
            self.write_json("request.json", request)
            before = self.snapshot()
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(remove_quote.main(["--request", "request.json"], self.root), 1)
            self.assertEqual(before, self.snapshot())

    def test_cli_rejects_ambiguous_request_json_without_writes(self):
        valid = json.dumps(self.request())
        duplicate = valid.replace('"number":', '"number": 1, "number":', 1)
        for body in (duplicate, valid[:-1] + ', "unexpected": true}', "{", "NaN"):
            (self.root / "request.json").write_text(body, encoding="utf-8")
            before = self.snapshot()
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(remove_quote.main(["--request", "request.json"], self.root), 1)
            self.assertEqual(before, self.snapshot())

    def test_cli_subprocess_from_outside_repository(self):
        scripts = self.root / "scripts"
        scripts.mkdir()
        for filename in ("remove_quote.py", "quote_removals.py", "validate_removals.py"):
            shutil.copyfile(corpus.ROOT / "scripts" / filename, scripts / filename)
        self.write_json("request.json", self.request(4))
        with tempfile.TemporaryDirectory(prefix=".cli-cwd-") as outside:
            for request_path in ("request.json", str(self.root / "request.json")):
                result = subprocess.run(
                    [sys.executable, str(scripts / "remove_quote.py"), "--request", request_path],
                    cwd=outside, capture_output=True, text=True,
                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                )
                self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run(
                [sys.executable, str(scripts / "validate_removals.py")],
                cwd=outside, capture_output=True, text=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(self.read(corpus.MASTER)[4])


class GitBaseTests(CorpusFixture):
    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def base(self, include_registry=True):
        self.git("init", "--quiet")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("add", "quotes")
        if not include_registry:
            self.git("rm", "--cached", corpus.REGISTRY)
        self.git("commit", "--quiet", "-m",
                 "Synthetic corpus fixture\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>")
        return self.git("rev-parse", "HEAD")

    def test_base_allows_feature_introduction_and_code_only_changes(self):
        base = self.base(include_registry=False)
        validate_removals.validate(self.root, base)
        (self.root / "unrelated.js").write_text("// safe unrelated change\n")
        validate_removals.validate(self.root, base)
        self.remove(1)
        validate_removals.validate(self.root, base)

    def test_base_allows_existing_registry_plus_verified_new_removal(self):
        self.remove(0)
        base = self.base()
        validate_removals.validate(self.root, base)
        self.remove(1)
        validate_removals.validate(self.root, base)

    def test_base_rejects_registry_rewrite_removal_and_reordering(self):
        self.remove(0)
        self.remove(1)
        base = self.base()
        original = self.read(corpus.REGISTRY)
        rewritten = copy.deepcopy(original)
        rewritten["entries"][0]["identity_sha256"] = "a" * 64
        reordered = copy.deepcopy(original)
        reordered["entries"].reverse()
        for registry in (rewritten, reordered):
            self.write_json(corpus.REGISTRY, registry)
            self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))
        self.write_json(corpus.REGISTRY, corpus.empty_registry(len(self.master)))
        self.write_json(corpus.MASTER, self.master)
        self.rebuild()
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))

    def test_base_rejects_new_tombstone_with_wrong_hash(self):
        base = self.base()
        self.remove(0)
        registry = self.read(corpus.REGISTRY)
        registry["entries"][0]["identity_sha256"] = "a" * 64
        self.write_json(corpus.REGISTRY, registry)
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))

    def test_base_rejects_renumbering_even_with_regenerated_outputs(self):
        base = self.base()
        changed = copy.deepcopy(self.master)
        changed[0], changed[4] = changed[4], changed[0]
        self.write_json(corpus.MASTER, changed)
        self.rebuild()
        validate_removals.validate(self.root)
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))

    def test_base_rejects_unrelated_content_changes(self):
        base = self.base()
        changed = copy.deepcopy(self.master)
        changed[4]["author"] += " changed"
        self.write_json(corpus.MASTER, changed)
        self.rebuild()
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))

    def test_base_rejects_initial_corpus_size_changes(self):
        base = self.base(include_registry=False)
        self.write_json(corpus.MASTER, self.master[:-1])
        self.write_json(corpus.REGISTRY, corpus.empty_registry(len(self.master) - 1))
        self.rebuild()
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, base))

    def test_invalid_base_ref_is_read_only_and_fails(self):
        self.base()
        self.assert_rejected_unchanged(lambda: validate_removals.validate(self.root, "--not-a-ref"))


if __name__ == "__main__":
    unittest.main()
