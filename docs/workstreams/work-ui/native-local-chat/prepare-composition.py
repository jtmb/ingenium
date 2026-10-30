"""Generate only two narrow deltas from immutable Native blobs, never edit Native.
Root owns reconciliation/application to its current integration tree.
"""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
native = "//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source"
git = "/mnt/c/Program Files/Git/cmd/git.exe"
base = "c295428576246dfa2b97f3a30f2045fc5ff1950f"
def original(path):
    return subprocess.check_output([git, "-c", "safe.directory=" + native, "-C", native, "show", base + ":" + path]).decode("utf-8").replace("\r\n", "\n")
def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError("exact immutable composition preimage differs")
    return source.replace(before, after, 1)

path = "apps/web/src/app/App.tsx"
before = original(path)
after = replace_once(before, 'import { NativeWorkNoProjectActions } from "../features/work-ui/NativeWorkNoProjectActions";',
    'import { NativeWorkNoProjectActions } from "../features/work-ui/NativeWorkNoProjectActions";\nimport { LocalChatEntry } from "../features/work-ui/local/LocalChatEntry";')
after = replace_once(after, '  const [newSessionVersion, setNewSessionVersion] = useState(0);',
    '  const [newSessionVersion, setNewSessionVersion] = useState(0);\n  const [newLocalChatVersion, setNewLocalChatVersion] = useState(0);')
after = replace_once(after, '              {workDefault && !catalog.selected ? <NativeWorkNoProjectActions\n',
    '''              {workDefault && !catalog.selected ? <NativeWorkNoProjectActions
                localAvailable={connected && typeof gateway.workbench === "function" && !collaborationHeld}
                onStartLocalChat={() => {
                  if (collaborationHeldRef.current || restoring.current || operationBusy.current) return;
                  setArea("workspace"); setWorkspaceView("projects"); setCodingWorkspace(true);
                  setNewLocalChatVersion(value => value + 1);
                }}
''')
start = '          ) : workDefault && view === "projects" && codingWorkspace && !catalog.selected ? (\n'
end = '          ) : view === "projects" && savedProjectPresentation && connected && readerScope === savedProjectPresentation.readerScope &&\n'
if after.count(start) != 1 or after.count(end) != 1:
    raise RuntimeError("exact no-project branch boundary differs")
left, rest = after.split(start)
_, right = rest.split(end)
after = left + start + '''            <LocalChatEntry gateway={gateway}
              available={connected && typeof gateway.workbench === "function" && !collaborationHeld}
              connectionEpoch={instance} startVersion={newLocalChatVersion} />
''' + end + right
changes = [(path, before, after)]

path = "apps/web/src/features/work-ui/NativeWorkNoProjectActions.tsx"
before = original(path)
after = replace_once(before, 'export function NativeWorkNoProjectActions({ scratchAvailable, creating, resumable, onCreateScratch, onChooseProject, variant = "sidebar" }: {',
    'export function NativeWorkNoProjectActions({ scratchAvailable, creating, resumable, onCreateScratch, onChooseProject, localAvailable = false, onStartLocalChat, variant = "sidebar" }: {')
after = replace_once(after, '  onCreateScratch: () => void; onChooseProject?: () => void;',
    '  onCreateScratch: () => void; onChooseProject?: () => void;\n  localAvailable?: boolean; onStartLocalChat?: () => void;')
after = replace_once(after, '    {variant === "sidebar" && <button type="button" className="button new-task" disabled aria-describedby={reason}>New chat</button>}',
    '    {variant === "sidebar" && <button type="button" className="button new-task" disabled={!localAvailable || !onStartLocalChat} onClick={onStartLocalChat} aria-describedby={reason}>New chat</button>}')
after = replace_once(after, '      <p id={reason}>Chats without a project are currently unavailable. Choose a project or create a scratch project.</p>',
    '      <p id={reason}>{localAvailable && onStartLocalChat ? "Start a local chat without creating a project, or choose a project." : "Chats without a project are currently unavailable. Choose a project or create a scratch project."}</p>')
changes.append((path, before, after))

patch = "".join("".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile="a/" + path, tofile="b/" + path, n=0)) for path, before, after in changes)
target = root / "app-composition.patch"
target.write_text(patch, encoding="utf-8", newline="\n")
(root / "composition-inputs.json").write_text(json.dumps({"base_tree": base, "preimages": [
    {"path": path, "lf_sha256": hashlib.sha256(before.encode()).hexdigest()} for path, before, after in changes],
    "patch_sha256": hashlib.sha256(patch.encode()).hexdigest(),
    "scope": "Zero-context delta: requires --unidiff-zero only on exact preimages; Root reconciles actual current tree. App no-project branch + explicit sidebar callback only; Snapshot instance invalidates reads only, never supplies local ownership"}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"patch_bytes": len(patch.encode()), "patch_sha256": hashlib.sha256(patch.encode()).hexdigest()}))
