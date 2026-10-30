"""Source-only exact-blob assembly. Never edits Native, invokes Cargo, or runs a service."""
import argparse, difflib, hashlib, json, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NATIVE = '//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source'
GIT = '/mnt/c/Program Files/Git/cmd/git.exe'
PREIMAGES = ROOT / 'preimages.json'
def git(*args):
    return subprocess.run([GIT,'-c','safe.directory='+NATIVE,'-C',NATIVE,*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
def sha(data): return hashlib.sha256(data).hexdigest()
def replace_once(data, before, after):
    assert data.count(before)==1, ('nonunique exact insertion', before[:80])
    return data.replace(before,after,1)

facade = '''    pub(super) fn mint_local_web_lease(&self,binding:std::sync::Arc<veyra_adapters::local_execution::LocalWorkspaceBinding>,session:&str,current:&dyn Fn()->Result<(),String>)->Result<veyra_adapters::opencode::desktop_runtime::LocalWebLease,String>{
        self.runtime.mint_local_web_lease(binding,session,current).map_err(|_|"original private Web lease unavailable".into())
    }
    pub(super) fn check_local_web_lease(&self,lease:&veyra_adapters::opencode::desktop_runtime::LocalWebLease,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
        self.runtime.check_local_web_lease(lease,current).map_err(|_|"original private Web lease changed".into())
    }
    pub(super) fn capture_local_web_request(&self,lease:&veyra_adapters::opencode::desktop_runtime::LocalWebLease,method:&str,target:&str,headers:&[(String,String)],body:Vec<u8>,current:&dyn Fn()->Result<(),String>)->Result<veyra_adapters::opencode::desktop_runtime::NativeWebOriginal,String>{
        self.runtime.capture_local_web_request(lease,method,target,headers,body,current).map_err(|_|"original private Web request capture refused".into())
    }
    pub(super) fn inspect_local_web_prompt(&self,lease:&veyra_adapters::opencode::desktop_runtime::LocalWebLease,original:&veyra_adapters::opencode::desktop_runtime::NativeWebOriginal,current:&dyn Fn()->Result<(),String>)->Result<veyra_adapters::opencode::desktop_runtime::LocalWebPromptInspection,String>{
        self.runtime.inspect_local_web_prompt(lease,original,current).map_err(|_|"original private Web prompt inspection refused".into())
    }
'''
EDITS = {
 'crates/adapters/src/opencode/desktop_runtime.rs': (b'mod local_workspaces;\n',b'mod local_workspaces;\npub use local_workspaces::web_original::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection};\n'),
 'crates/adapters/src/opencode/desktop_runtime/local_workspaces.rs': (b'mod conversations;\n',b'mod conversations;\npub(super) mod web_original;\n'),
 'apps/service/src/routes/local_workspaces.rs': (b'mod conversations;\n',b'mod conversations;\nmod web_original;\n'),
 'apps/service/src/routes/live_agent.rs': (b'    pub(super) fn local_conversation_read',facade.encode()+b'    pub(super) fn local_conversation_read'),
}
OBSERVE = [
 'crates/adapters/src/opencode/mod.rs',
 'crates/adapters/src/opencode/desktop_runtime/task_permissions.rs',
 'crates/adapters/src/local_execution.rs',
 'apps/service/src/routes.rs',
 'apps/service/Cargo.toml',
 'apps/desktop/src-tauri/src/local_web_child.rs',
 'apps/desktop/src-tauri/src/local_web_auth.rs',
 'apps/desktop/src-tauri/src/main.rs',
]
parser=argparse.ArgumentParser();parser.add_argument('--freeze',action='store_true');args=parser.parse_args()
if args.freeze:
    assert not PREIMAGES.exists(), 'preimages already frozen; do not replace an original'
    records=[]
    for path in [*EDITS,*OBSERVE]:
        blob=git('rev-parse',':'+path).decode().strip(); data=git('cat-file','blob',blob)
        records.append({'path':path,'blob':blob,'sha256':sha(data),'bytes':len(data),'role':'edit' if path in EDITS else 'observed_boundary'})
    PREIMAGES.write_text(json.dumps({'schema':1,'native':NATIVE,'records':records},indent=2)+'\n')
pins=json.loads(PREIMAGES.read_text()); patches=[]; manifest=[]
for pin in pins['records']:
    data=git('cat-file','blob',pin['blob']); assert sha(data)==pin['sha256']
    path=pin['path']
    if path not in EDITS: continue
    before,after=EDITS[path]; post=replace_once(data,before,after)
    patches.extend(difflib.unified_diff(data.decode().splitlines(True),post.decode().splitlines(True),fromfile='a/'+path,tofile='b/'+path))
    manifest.append({'path':path,'preimage_blob':pin['blob'],'preimage_sha256':sha(data),'postimage_sha256':sha(post),'postimage_bytes':len(post)})
for source in sorted((ROOT/'sources').rglob('*')):
    if not source.is_file(): continue
    path=source.relative_to(ROOT/'sources').as_posix();data=source.read_bytes()
    patches.extend(difflib.unified_diff([],data.decode().splitlines(True),fromfile='/dev/null',tofile='b/'+path))
    manifest.append({'path':path,'preimage_blob':None,'postimage_sha256':sha(data),'postimage_bytes':len(data)})
patch=''.join(patches).encode(); (ROOT/'original-proxy.patch').write_bytes(patch)
(ROOT/'assembly-manifest.json').write_text(json.dumps({'schema':1,'scope':'source_proposal_only','compiled':False,'runtime_qualified':False,'patch_sha256':sha(patch),'patch_bytes':len(patch),'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(patch),'patch_sha256':sha(patch),'compiled':False}))
