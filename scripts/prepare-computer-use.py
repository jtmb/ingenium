#!/usr/bin/env python3
"""Materialize the pinned external brain without applying its global config."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request


def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def prepare(lock_path: Path, output: Path, source: Path | None = None) -> dict:
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    revision = lock["revision"]
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Invalid pinned revision")
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists; reconcile it before preparing again")
    # Validate the entire input closure before creating output. A source checkout
    # is only a byte source: every installed file must match its pinned Git blob.
    expected = {}
    for entry in lock["files"]:
        path = PurePosixPath(entry["path"])
        if path.is_absolute() or ".." in path.parts or "\\" in str(path):
            raise ValueError("Unsafe dependency path")
        if str(path) in expected:
            raise ValueError("Duplicate dependency path")
        expected[str(path)] = entry
    contents = {}
    if source:
        base = source.resolve(strict=True)
        for name in expected:
            path = base / name
            if not path.resolve(strict=True).is_relative_to(base) or path.is_symlink():
                raise ValueError("Linked or escaping dependency input")
            contents[name] = path.read_bytes()
    else:
        request = urllib.request.Request(
            f"https://codeload.github.com/jtmb/computer-use/tar.gz/{revision}",
            headers={"User-Agent": "Veyra-pinned-brain"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            archive = response.read(8 * 1024 * 1024 + 1)
        if len(archive) > 8 * 1024 * 1024:
            raise ValueError("Dependency archive exceeds the bounded download")
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            prefix = f"computer-use-{revision}/"
            for member in tar:
                if not member.name.startswith(prefix):
                    continue
                name = member.name[len(prefix):]
                if name not in expected:
                    continue
                if not member.isfile() or member.size != expected[name]["bytes"] or name in contents:
                    raise ValueError("Invalid dependency archive member")
                stream = tar.extractfile(member)
                if stream is None:
                    raise ValueError("Missing dependency member")
                contents[name] = stream.read(member.size + 1)
    for name, entry in expected.items():
        data = contents.get(name)
        if data is None or len(data) != entry["bytes"] or blob_hash(data) != entry["gitBlob"]:
            raise ValueError(f"Pinned dependency mismatch: {name}")
    skills = sorted(name.split("/")[2] for name in expected
                    if name.startswith(".opencode/skills/") and name.count("/") == 3
                    and name.endswith("/SKILL.md"))
    if skills != sorted(lock["skills"]) or len(skills) != 23:
        raise ValueError("Incomplete pinned skill catalog")
    output.mkdir(parents=True)
    for name, entry in expected.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents[name])
        target.chmod(0o555 if entry["executable"] else 0o444)
    receipt = {"repository": lock["repository"], "revision": revision,
               "files": len(expected), "skills": skills,
               "lockSha256": hashlib.sha256(lock_path.read_bytes()).hexdigest(),
               "appliedGlobalConfiguration": False, "runtimeSkillLoadingVerified": False}
    (output / "veyra-dependency.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (output / "veyra-dependency.json").chmod(0o444)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.lock, args.output, args.source), indent=2))
