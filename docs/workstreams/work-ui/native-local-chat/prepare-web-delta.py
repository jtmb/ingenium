"""Render exact new Web modules + sole optional Panel wiring from immutable1fd.
Root applies only after actual backend authority/manifest/capability qualification.
"""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parent
app=root.parents[3]
base="1fd9f0b4ac84312ac03315a0f5b7f29d04558c87"
frontend=["LocalChatPanel.tsx","LocalWebPresentation.tsx","LocalWebPresentation.test.tsx","local-web-controller.mjs","local-web-controller.d.mts"]
paths=[(root/"sources"/"apps/web/src/features/work-ui/local"/name,"apps/web/src/features/work-ui/local/"+name) for name in frontend]
paths.append((root/"native-web-host/sources/apps/desktop/src-tauri/src/local_web_child.rs","apps/desktop/src-tauri/src/local_web_child.rs"))
parts=[];records=[]
for source,target in paths:
    git_path=source.relative_to(app).as_posix()
    found=subprocess.run(["git","-C",str(app),"show",base+":"+git_path],capture_output=True)
    before=found.stdout.decode().replace("\r\n","\n") if found.returncode==0 else ""
    after=source.read_text(encoding="utf-8").replace("\r\n","\n")
    parts.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile="a/"+target if found.returncode==0 else "/dev/null",tofile="b/"+target,n=0))
    records.append({"path":target,"preimage_lf_sha256":hashlib.sha256(before.encode()).hexdigest() if found.returncode==0 else None,"requires_absent":found.returncode!=0,"source":source.relative_to(root).as_posix(),"after_lf_sha256":hashlib.sha256(after.encode()).hexdigest()})
wire="".join(parts)
(root/"native-web-host/child-from-1fd.patch").write_text(wire,encoding="utf-8",newline="\n")
(root/"native-web-host/child-delta-inputs.json").write_text(json.dumps({"base":base,"files":records,"bytes":len(wire.encode()),"sha256":hashlib.sha256(wire.encode()).hexdigest(),"application":"exact existing preimages/new paths absent; --unidiff-zero; Root reconciles actual current tree. Does not edit Cargo/lock/ACL/commands or implement the missing authority factory."},indent=2)+"\n",encoding="utf-8")
print(json.dumps({"files":len(records),"bytes":len(wire.encode()),"sha256":hashlib.sha256(wire.encode()).hexdigest()}))
