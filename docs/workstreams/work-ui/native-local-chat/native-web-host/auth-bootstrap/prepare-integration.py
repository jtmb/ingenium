"""Exact two-hook host delta from imported2c, plus new auth module; no Native write."""
import difflib,hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
proposal=root.parents[1]
app=proposal.parents[3]
base="2c74413ef0bfe2fc1b4d826493d1276326ee936e"
host="docs/workstreams/work-ui/native-local-chat/native-web-host/sources/apps/desktop/src-tauri/src/local_web_child.rs"
before=subprocess.check_output(["git","-C",str(app),"show",base+":"+host]).decode().replace("\r\n","\n")
needle='    fn authorize_child(&self, child: &Webview) -> Result<(), String>; // exact-origin native bootstrap; no eval/script/token URL or port-ambient cookie\n'
if before.count(needle)!=1:raise RuntimeError("exact imported host authority hook preimage differs")
after=before.replace(needle,needle+'    fn detach_child_auth(&self, child: &Webview) -> Result<(), String>; // exact callback removal acknowledged before close/release\n',1)
needle='        entry.cleanup_required = true;\n        if !entry.closed {\n'
if after.count(needle)!=1:raise RuntimeError("exact imported host release preimage differs")
after=after.replace(needle,'        entry.cleanup_required = true;\n        entry.authority.detach_child_auth(&entry.child)?;\n        if !entry.closed {\n',1)
target="apps/desktop/src-tauri/src/local_web_child.rs"
patch="".join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile="a/"+target,tofile="b/"+target,n=0))
source=root/"sources/apps/desktop/src-tauri/src/local_web_auth.rs"
new=source.read_text(encoding="utf-8").replace("\r\n","\n")
patch+="".join(difflib.unified_diff([],new.splitlines(True),fromfile="/dev/null",tofile="b/apps/desktop/src-tauri/src/local_web_auth.rs",n=0))
(root/"auth-from-2c.patch").write_text(patch,encoding="utf-8",newline="\n")
manifest={"base":base,"existing_host_lf_sha256":hashlib.sha256(before.encode()).hexdigest(),"existing_host_output_lf_sha256":hashlib.sha256(after.encode()).hexdigest(),"new_auth_source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),"bytes":len(patch.encode()),"sha256":hashlib.sha256(patch.encode()).hexdigest(),"application":"Root reconciles current imported host; exact preimage and --unidiff-zero. No full host copy, service factory, Cargo, lock or command change."}
(root/"integration-inputs.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"bytes":manifest["bytes"],"sha256":manifest["sha256"]}))
