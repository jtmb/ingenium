"""Generate only a native proposal against the coordinator's exact staged TREE.

No native writes/index mutation, compilation, process/device or dependency work.
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
BASE = "268acab8c5dcf14ab188ecd8fdcbb21c9316179b"


def git(*args):
    return subprocess.run(["git", "--no-optional-locks", "-c", f"safe.directory={native.as_posix()}",
        "-C", str(native), *args], env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def sha(data):
    return hashlib.sha256(data).hexdigest()


if git("cat-file", "-t", BASE).strip() != b"tree":
    raise SystemExit("Expected the exact coordinator staged tree, never an inferred HEAD")
changes = {}
name = "crates/adapters/src/speech.rs"
before = git("show", BASE + ":" + name)
if before.count(b"mod http_worker;") != 1:
    raise SystemExit("Native speech module preimage drift")
changes[name] = (before, before.replace(b"mod http_worker;", b"mod http_worker;\npub mod cpu_reconnect;", 1))
name = "crates/adapters/src/speech/http_worker.rs"
before = git("show", BASE + ":" + name)
anchor = b"    pub(super) fn execute(\n"
if before.count(anchor) != 1:
    raise SystemExit("Native CPU adapter preimage drift")
after = before.replace(anchor, (HERE / "http_additions.rs").read_bytes() + anchor, 1)
after += b"\n" + (HERE / "http_transport.rs").read_bytes()
changes[name] = (before, after)
changes["crates/adapters/src/speech/cpu_reconnect.rs"] = (b"", (HERE / "cpu_reconnect.rs").read_bytes())
patch = ""
for name, (before, after) in changes.items():
    patch += "".join(difflib.unified_diff(before.decode("utf-8").splitlines(True), after.decode("utf-8").splitlines(True),
        fromfile="a/" + name if before else "/dev/null", tofile="b/" + name))
(HERE / "native-cpu-reconnect.patch").write_bytes(patch.encode("utf-8"))
receipt = {"nativeBaseTree": BASE, "baseType": "tree", "nativeWritten": False,
    "preimages": {name: sha(before) if before else None for name, (before, _) in changes.items()},
    "postimages": {name: sha(after) for name, (_, after) in changes.items()}, "patchSha256": sha(patch.encode()),
    "composition": "Explicit v2 entry points require existing supervisor port; v1 remains unchanged. No default owner or runtime activation.",
    "requiredRootWork": "Real process/job custody + original durable binding/transition IPC; original-result validation; scoped uncertain-receipt reconciliation/retirement under existing Speech owner; positive prior-process retirement for replacement generation.",
    "nativeCompilation": False, "runtimeQualification": False}
(HERE / "provenance.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"patchSha256": receipt["patchSha256"], "nativeBaseTree": BASE, "nativeWritten": False}))
