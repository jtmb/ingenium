from pathlib import Path
import argparse,json,hashlib,difflib
parser=argparse.ArgumentParser();parser.add_argument('--native-source-root',required=True);args=parser.parse_args()
owned=Path(__file__).resolve().parent;root=Path(args.native_source_root);assert root.is_absolute() and root.resolve()==root
inputs=json.loads((owned/'inputs.json').read_text());original={}
for item in inputs['inputs']:
 raw=(root/item['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==item['sha256'],'source drift; no fallback: '+item['path']
 original[item['path']]=raw.decode()
changed=dict(original)
def replace(rel,before,after):
 assert changed[rel].count(before)==1,'exact anchor drift: '+rel
 changed[rel]=changed[rel].replace(before,after,1)
replace('crates/adapters/src/local_execution.rs','mod web_files;','mod web_files;\npub(crate) mod windows_web_read;')
replace('crates/adapters/src/local_custody.rs','pub struct LocalCustodyOriginals{','pub struct LocalCustodyOriginals{\n #[cfg(windows)] pub(crate) web_reads:Mutex<Vec<Arc<crate::local_execution::windows_web_read::RetainedWindowsWebRead>>>,')
replace('crates/adapters/src/local_custody.rs'," pub fn finish_until(&self,deadline:Instant)->Result<()>{\n  #[cfg(windows)] {", """ pub fn finish_until(&self,deadline:Instant)->Result<()>{
  #[cfg(windows)] {
   let mut reads=self.web_reads.try_lock().map_err(|_|"retained original reads busy")?;
   for read in reads.iter(){
    if !read.is_closed(){
     if Arc::strong_count(read)!=1{return Err("active original read borrower remains retained".into());}
     read.retire_never_sent(deadline)?; // sent/unknown cannot use this path
    }
   }
   if reads.iter().any(|read|!read.is_closed()){return Err("original read join/checked close unresolved".into());}
   reads.clear();
""")
replace('crates/adapters/src/opencode/attachments/web_files.rs','use super::*;\nuse crate::local_execution', 'use super::*;\npub(crate) mod windows_inputs;\nuse crate::local_execution')
replace('crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs','use super::*;\nuse reqwest', 'use super::*;\nmod windows_read;\npub use windows_read::NativeWindowsWebRead;\nuse reqwest')
replace('crates/adapters/src/opencode/desktop_runtime.rs','pub use local_workspaces::web_original::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection};','pub use local_workspaces::web_original::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection,NativeWindowsWebRead};')
patch=[];proof=[]
for rel,before in original.items():
 after=changed[rel];proof.append({'path':rel,'baseSha256':hashlib.sha256(before.encode()).hexdigest(),'proposedSha256':hashlib.sha256(after.encode()).hexdigest()})
 patch.extend(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
raw=''.join(patch);(owned/'integration.patch').write_text(raw)
new=[{'path':str(f.relative_to(owned/'sources')),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in sorted((owned/'sources').rglob('*'))if f.is_file()]
(owned/'proposal.json').write_text(json.dumps({'existingDeltas':proof,'canonicalNewSources':new,'patchSha256':hashlib.sha256(raw.encode()).hexdigest(),'sharedWritten':False,'compiled':False,'runtimeQualified':False,'dispatchActivated':False,'actualAckJoinAdapterPresent':False,'constructors':['LiveRuntime::hold_local_windows_web_read','LiveRuntime::check_local_windows_web_read'],'originalOwnership':'LocalCustodyOriginals inventory owns carrier before OS opens; one active original only','bounds':'Existing8MiB aggregate including original inline inputs /32files unchanged;30s admission deadline never releases sent uncertainty','remaining':'Root/Work1 actual single-send journal token + joined ACK/private request owner + original engine closure proof adapter required; no copied DTO/callback join API'},indent=2)+'\n')
print(json.dumps({'deltas':len(proof),'newFiles':len(new),'dispatchActivated':False}))
