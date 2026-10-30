"""Package assigned native frontend source without modifying its index or checkout.

Run with Windows Python/Git because this checkout's Git metadata uses Windows paths.
No test/build/runtime invocation, temporary files or dependency copies are made.
"""
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
native = Path(sys.argv[1]).resolve()
preflight = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
BASE = "61c99f8e649da85b600fccec93236b5d6b07f78b"
EXISTING = ["apps/web/src/features/workbench/VoiceWorkspace.tsx",
    "apps/web/src/features/workbench/VoiceChat.tsx", "apps/web/src/features/workbench/SpeechControls.tsx"]
environment = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}


def git(*arguments):
    return subprocess.run(["git", "--no-optional-locks", "-c", f"safe.directory={native.as_posix()}",
        "-C", str(native), *arguments], env=environment, check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def preservation():
    if digest(Path(preflight["indexPath"]).read_bytes()) != preflight["indexSha256"]:
        raise SystemExit("Protected native index changed; stop and reconcile, never reset")
    for entry in preflight["protectedFiles"]:
        if digest((native / entry["path"]).read_bytes()) != entry["sha256"]:
            raise SystemExit("Protected packaging source changed; preserve and reconcile")


preservation()
if git("rev-parse", "HEAD").decode().strip() != BASE:
    raise SystemExit("Native base differs; do not silently rebase the source recipe")
if git("branch", "--show-current").decode().strip() != preflight["branch"]:
    raise SystemExit("Native branch differs from writer transfer")
old_hashes, new_hashes, patch = {}, {}, ""
paths = list(EXISTING)
paths += sorted(file.relative_to(native).as_posix()
    for file in (native / "apps/web/src/features/voice-ui").rglob("*") if file.is_file())
for name in paths:
    path = native / name
    if path.is_symlink() or path.suffix not in (".ts", ".tsx"):
        raise SystemExit("Unexpected generated/helper input; preserve and reconcile")
    before = git("show", BASE + ":" + name) if name in EXISTING else b""
    after = path.read_bytes()
    old_hashes[name] = digest(before) if name in EXISTING else None
    new_hashes[name] = digest(after)
    patch += "".join(difflib.unified_diff(before.decode("utf-8").splitlines(True),
        after.decode("utf-8").splitlines(True), fromfile="a/" + name if name in EXISTING else "/dev/null",
        tofile="b/" + name))
for entry in preflight["preimages"]:
    if old_hashes[entry["path"]] != entry["sha256"]:
        raise SystemExit("Native writer preimage differs from baseline; no approximate patch")
preservation()
(HERE / "native-voice-ui.patch").write_bytes(patch.encode("utf-8"))
manifest = {"nativeBase": BASE, "nativeBranch": preflight["branch"],
    "sequence": "Apply after reviewed native speech HTTP proposal; exact frontend preimages remain mandatory",
    "preimages": old_hashes, "postimages": new_hashes, "patchSha256": digest(patch.encode()),
    "protectedIndexSha256": preflight["indexSha256"], "protectedPackagingFiles": preflight["protectedFiles"],
    "nativeIndexMutated": False, "nativeStagedOrCommitted": False,
    "tests": "Helper/React test source only; coordinator schedules execution",
    "dependency": "Additive native SessionView.voice from original Record.voice; null/missing is never inferred for retained CPU read-replies",
    "sharedComposition": "Coordinator opts shared Workbench into optional compact=true; default=false retains legacy presentation",
    "activation": "No builds/dependencies/services/devices/audio/CU/downloads; native/runtime/browser/release acceptance open"}
(HERE / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"patchSha256": manifest["patchSha256"], "sourceFiles": len(paths),
    "protectedIndexSha256": preflight["indexSha256"], "testsRun": False}, indent=2))
