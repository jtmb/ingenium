"""Pinned brain packaging checks; no model, provider or host configuration changes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("prepare_computer_use", Path(__file__).parents[1] / "scripts/prepare-computer-use.py")
brain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brain)


class BrainPackageTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.output = self.root / "installed"
        self.lock_path = self.root / "lock.json"
        names = [f"skill-{index:02d}" for index in range(23)]
        self.lock = {"revision": "a" * 40, "repository": "test://pinned", "skills": names, "files": []}
        for name in names:
            self.add_file(f".opencode/skills/{name}/SKILL.md", f"---\nname: {name}\n---\nRead references/detail.md\n".encode())
            self.add_file(f".opencode/skills/{name}/references/detail.md", b"Full reference\n")
        self.add_file("scripts/probe.sh", b"#!/bin/sh\nexit 0\n", executable=True)
        (self.source / "global").mkdir()
        (self.source / "global/opencode.jsonc").write_text('{"model":"do-not-copy"}')
        self.save_lock()

    def add_file(self, name, data, executable=False):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.lock["files"].append({"path": name, "bytes": len(data), "gitBlob": brain.blob_hash(data), "executable": executable})

    def save_lock(self):
        self.lock_path.write_text(json.dumps(self.lock))

    def test_full_references_and_launcher_without_global_config(self):
        receipt = brain.prepare(self.lock_path, self.output, self.source)
        self.assertEqual(receipt["files"], 47)
        self.assertEqual(len(receipt["skills"]), 23)
        self.assertFalse(receipt["runtimeSkillLoadingVerified"])
        self.assertFalse((self.output / "global").exists())
        self.assertEqual((self.output / ".opencode/skills/skill-00/references/detail.md").read_bytes(), b"Full reference\n")

    def test_changed_reference_refuses_before_output(self):
        (self.source / ".opencode/skills/skill-00/references/detail.md").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Pinned dependency mismatch"):
            brain.prepare(self.lock_path, self.output, self.source)
        self.assertFalse(self.output.exists())

    def test_incomplete_catalog_refuses_before_output(self):
        self.lock["skills"].pop()
        self.save_lock()
        with self.assertRaisesRegex(ValueError, "Incomplete pinned skill catalog"):
            brain.prepare(self.lock_path, self.output, self.source)
        self.assertFalse(self.output.exists())

    def test_escape_and_existing_output_refuse(self):
        self.lock["files"][0]["path"] = "../escape"
        self.save_lock()
        with self.assertRaisesRegex(ValueError, "Unsafe dependency path"):
            brain.prepare(self.lock_path, self.output, self.source)
        self.output.mkdir()
        sentinel = self.output / "user.txt"
        sentinel.write_text("preserve")
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            brain.prepare(self.lock_path, self.output, self.source)
        self.assertEqual(sentinel.read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
