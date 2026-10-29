"""Regenerate the rendered-JSX-only delta without a scratch checkout or index."""
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

native = Path(sys.argv[1]).resolve()
git = sys.argv[2]
here = Path(__file__).resolve().parent
manifest = json.loads((here / "native-work-layout.json").read_text())
aggregate = (here / "native-work-layout.patch").read_bytes()
assert hashlib.sha256(aggregate).hexdigest() == manifest["followOnSha256"]
native_windows = "//wsl.localhost/Ubuntu" + str(native)
command = [git, "-c", "safe.directory=" + native_windows, "-C", native_windows]


def index_source(path):
    return subprocess.run(command + ["show", ":" + path], check=True,
                          stdout=subprocess.PIPE).stdout.decode().replace("\r\n", "\n")


def blob(data):
    raw = data.encode()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def apply_file_patch(original, path):
    sections = aggregate.decode().split("diff --git ")
    section = next((s for s in sections if s.startswith(f"a/{path} b/{path}\n")), None)
    if section is None:
        return original
    lines = original.splitlines(keepends=True)
    delta = section.splitlines(keepends=True)
    result, cursor, index = [], 0, 0
    while index < len(delta):
        match = re.match(r"@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", delta[index])
        if not match:
            index += 1
            continue
        start = int(match[1]) - 1
        assert start >= cursor
        result.extend(lines[cursor:start])
        cursor, index = start, index + 1
        while index < len(delta) and not delta[index].startswith("@@"):
            line = delta[index]
            if line.startswith("+"):
                result.append(line[1:])
            elif line.startswith((" ", "-")):
                assert lines[cursor] == line[1:], (path, cursor)
                if line.startswith(" "):
                    result.append(lines[cursor])
                cursor += 1
            elif line.startswith("\\"):
                raise AssertionError("Missing-newline input needs explicit review")
            else:
                break
            index += 1
    result.extend(lines[cursor:])
    return "".join(result)


paths = [
    "apps/web/src/app/App.tsx",
    "apps/web/src/features/workbench/Workbench.tsx",
    "apps/web/src/features/work-ui/NativeWorkPresentation.tsx",
    "apps/web/src/features/work-ui/NativeWorkPresentation.test.tsx",
    "apps/web/src/features/work-ui/native-work.css",
]
expected = {item["path"]: item["afterGitBlob"] for item in manifest["sourceFiles"]}
patch, evidence = [], []
for path in paths:
    before = apply_file_patch(index_source(path), path)
    if path in expected:
        assert blob(before) == expected[path], ("Base mismatch", path)
    after = (native / path).read_bytes().decode().replace("\r\n", "\n")
    assert before != after
    if path.endswith("/Workbench.tsx"):
        start = "  const api = (gateway as WorkbenchGateway).workbench;"
        end = "  if (!project) {"
        original_owner = before[before.index(start):before.index(end, before.index(start))]
        current_owner = after[after.index(start):after.index(end, after.index(start))]
        assert original_owner == current_owner, "Operational owner changed"
    patch += [f"diff --git a/{path} b/{path}\n",
              f"index {blob(before)}..{blob(after)} 100644\n"]
    patch += list(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                     fromfile="a/" + path, tofile="b/" + path))
    evidence.append({"path": path, "beforeGitBlob": blob(before), "afterGitBlob": blob(after),
                     "beforeSha256": hashlib.sha256(before.encode()).hexdigest(),
                     "afterSha256": hashlib.sha256(after.encode()).hexdigest()})
output = "".join(patch).encode()
(here / "native-work-composer.patch").write_bytes(output)
receipt = {
    "baseAggregateSha256": manifest["followOnSha256"],
    "separateTestFixSha256": "a25e27efe6d0cbd734880d79aa029cc1a6459c24eae83de91ad934f1e44c6f60",
    "patchSha256": hashlib.sha256(output).hexdigest(),
    "bytes": len(output), "files": evidence,
    "operationalOwnerRegionUnchanged": True,
    "expectedVoiceDependency": "VoiceWorkspace compact?: boolean, supplied by Voice owner",
    "workerFrameworkChecks": "Not run; central lease/integration required",
}
(here / "native-work-composer.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({key: receipt[key] for key in ("patchSha256", "bytes")}))
