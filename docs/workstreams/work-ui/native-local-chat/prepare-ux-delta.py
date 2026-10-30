"""Exact new-module delta from a6b16475; never read/write Root's mutable Native."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
app = root.parents[3]
base = "a6b164751e168a393103006a31e4ab2a5fe700c4"
names = ["LocalChatEntry.tsx", "LocalChatEntry.test.tsx", "LocalChatPanel.tsx", "LocalChatPanel.test.tsx", "LocalConversation.tsx", "LocalRuntimeControls.tsx", "local-chat.css", "local-flow-index.mjs", "local-flow-index.d.mts"]
patch, inputs = [], []
for name in names:
    relative = "apps/web/src/features/work-ui/local/" + name
    path = root / "sources" / relative
    source_path = path.relative_to(app).as_posix()
    before = subprocess.check_output(["git", "-C", str(app), "show", base + ":" + source_path]).decode().replace("\r\n", "\n")
    after = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if before == after:
        continue
    patch.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile="a/" + relative, tofile="b/" + relative, n=0))
    inputs.append({"path": relative, "before_lf_sha256": hashlib.sha256(before.encode()).hexdigest(), "after_lf_sha256": hashlib.sha256(after.encode()).hexdigest()})
wire = "".join(patch)
(root / "fresh-view-a6.patch").write_text(wire, encoding="utf-8", newline="\n")
(root / "fresh-view-inputs.json").write_text(json.dumps({"base": base, "inputs": inputs, "bytes": len(wire.encode()), "sha256": hashlib.sha256(wire.encode()).hexdigest(), "application": "zero-context delta; exact preimages and --unidiff-zero required; Root reconciles Boolean(message.error) if already fixed; no App/shared gateway changes"}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": len(inputs), "bytes": len(wire.encode()), "sha256": hashlib.sha256(wire.encode()).hexdigest()}))
