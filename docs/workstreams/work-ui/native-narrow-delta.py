"""CSS-only refinement from the coordinator's exact immutable staged tree."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys

native, git = Path(sys.argv[1]).resolve(), sys.argv[2]
here = Path(__file__).resolve().parent
tree = "268acab8c5dcf14ab188ecd8fdcbb21c9316179b"
windows = "//wsl.localhost/Ubuntu" + str(native)
command = [git, "-c", "safe.directory=" + windows, "-C", windows]


def original(path):
    return subprocess.run(command + ["show", tree + ":" + path], check=True,
                          stdout=subprocess.PIPE).stdout.decode().replace("\r\n", "\n")


def blob(text):
    data = text.encode()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


unchanged = []
for path in ("apps/web/src/features/workbench/Workbench.tsx",
             "apps/web/src/features/work-ui/NativeWorkPresentation.tsx",
             "apps/web/src/features/work-ui/NativeWorkPresentation.test.tsx"):
    text = (native / path).read_bytes().decode().replace("\r\n", "\n")
    assert original(path) == text, ("Frozen owner changed", path)
    unchanged.append({"path": path, "gitBlob": blob(text)})
frozen = subprocess.run(command + ["diff", "--cached", "--binary", "HEAD"],
                        check=True, stdout=subprocess.PIPE).stdout
frozen_hash = hashlib.sha256(frozen).hexdigest()
assert frozen_hash == "1294cbf1b5cf778cae5b08cc306583d8071f93e35d39451510af630af9c60672"

paths = [("apps/web/src/features/work-ui/native-work.css", False),
         ("apps/web/src/features/work-ui/native-work-reflow.browser.mjs", True)]
patch, files = [], []
for path, new in paths:
    before = "" if new else original(path)
    after = (native / path).read_bytes().decode().replace("\r\n", "\n")
    patch += [f"diff --git a/{path} b/{path}\n"]
    if new:
        patch += ["new file mode 100644\n"]
    patch += list(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                     fromfile="/dev/null" if new else "a/" + path,
                                     tofile="b/" + path))
    files.append({"path": path, "beforeGitBlob": None if new else blob(before),
                  "afterGitBlob": blob(after),
                  "beforeSha256": None if new else hashlib.sha256(before.encode()).hexdigest(),
                  "afterSha256": hashlib.sha256(after.encode()).hexdigest()})
output = "".join(patch).encode()
(here / "native-work-narrow.patch").write_bytes(output)
receipt = {
    "baseTree": tree, "baseCommit": "268962e20bef8c246fce332241c08c00c1fc2317",
    "patchSha256": hashlib.sha256(output).hexdigest(), "bytes": len(output),
    "frozenWorkerIndexPatchSha256": frozen_hash,
    "unchangedOwners": unchanged, "files": files,
    "workerChecks": "Browser-helper syntax and exact reverse patch only; no browser/build",
    "actualGoalStatus": "blocked",
}
(here / "native-work-narrow.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({key: receipt[key] for key in ("patchSha256", "bytes")}))
