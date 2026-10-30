"""Compose actual abdb retained Windows read with frozen492f completion slots.
Source-only, no compiler, no Native writes. Existing task-owned root only.
"""
import difflib,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[6]
PRIOR=ROOT.parent/'followon-094c'/'compose.py'
FROZEN_COMPLETION='492f77695e812be14889978eb80dce821d0ef815'
frozen_paths=subprocess.check_output(['git','-C',str(REPO),'ls-tree','-r','--name-only',FROZEN_COMPLETION,'--','docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/followon-094c']).decode().splitlines()
for relative in frozen_paths:
 pinned=subprocess.check_output(['git','-C',str(REPO),'show',FROZEN_COMPLETION+':'+relative])
 assert (REPO/relative).read_bytes()==pinned,('immutable predecessor drift',relative)
env={'__file__':str(PRIOR),'__name__':'frozen_composition'}
# Execute transformations only; never rewrite the immutable predecessor files.
exec(compile(PRIOR.read_text().split('patch=[];manifest=[]')[0],str(PRIOR),'exec'),env)
before=env['after'].copy();after=before.copy();replace=env['replace'];sha=env['sha']
PROJECTS_BASE='abdbd8f1956e3e3f2b8964086d2ad32dc67b6149'
PROJECTS_PREFIX='docs/workstreams/projects/native-web-files/retained-windows/sources/'
def source(path):return subprocess.check_output(['git','-C',str(REPO),'show',PROJECTS_BASE+':'+PROJECTS_PREFIX+path]).decode()
READ='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original/windows_read.rs'
CARRIER='crates/adapters/src/local_execution/windows_web_read.rs'
NATIVE='crates/adapters/src/local_execution/windows_web_read/native.rs'
HELPER=READ[:-3]+'/completion.rs'
INPUT='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_file_input.rs'
WEB,STORE,RT,LR,SVC,FACADE,COMP=[env[key] for key in ('WEB','STORE','RUNTIME','LR','SVC','FACADE','COMPLETION')]
MAT='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs'
for path in (READ,CARRIER,NATIVE):before[path]=source(path);after[path]=before[path]
# Canonical73fc structural imports, adapted to the094c expanded reexport. Root
# must compose these exact preimages (not duplicate the old integration hunk).
before[WEB]=replace(before[WEB],'use super::*;\nuse reqwest','use super::*;\nmod windows_read;\npub use windows_read::NativeWindowsWebRead;\nuse reqwest')
before[RT]=replace(before[RT],'LocalWebOriginalSubmission};','LocalWebOriginalSubmission,NativeWindowsWebRead};')
after[WEB]=before[WEB];after[RT]=before[RT]
for path in (HELPER,INPUT):after[path]=(ROOT/'sources'/path).read_text()
after[READ]=replace(after[READ],'use super::*;','use super::*;\nmod completion;')
data=after[LR];data=replace(data,'pub(super) mod web_completion;','pub(super) mod web_completion;\npub(super) mod web_file_input;');after[LR]=data
data=after[RT]
data=replace(data,'pub use local_workspaces::web_completion::NativeWebCompletions;','pub use local_workspaces::web_file_input::NativeWebFileInput;\npub(crate) use local_workspaces::web_completion::NativeWebReadJoined;\npub use local_workspaces::web_completion::NativeWebCompletions;');after[RT]=data
data=after[MAT]
data+='''
/// Identity wire body only for the genuine retained Windows original owner.
/// WSL must use the explicit verified URI transformation instead.
pub(crate) fn identity_windows_web_body(original:&super::web_original::NativeWebOriginal,read:&super::web_original::NativeWindowsWebRead)->Result<EffectiveWebBody,String>{
 if !read.matches_original(original){return Err(invalid());}
 Ok(EffectiveWebBody{bytes:original.body().to_vec(),original_body_sha256:hash(original.body()),effective_body_sha256:hash(original.body()),transformations:Vec::new()})
}
''';after[MAT]=data
data=after[WEB]
data=replace(data,'    pub(super) scope:String,','    pub(super) scope:String,\n    pub(super) joined:Option<super::web_completion::NativeWebReadJoined>,')
data=data.replace('crate::opencode::attachments::NativeWebFilesOriginal)->Result<crate::projects::NativeWebReservation,String>','super::web_file_input::NativeWebFileInput)->Result<crate::projects::NativeWebReservation,String>')
old='''        let files=crate::opencode::attachments::resolve_local_web_files(&lease.binding,&session,
            original.operation_id(),original.input_sha256(),&view,current).map_err(|_|local_error())?;
        let effective=super::web_materialization::materialize_resolved_web_files(original.body(),&files).map_err(|_|local_error())?;
        if files.contains_image()&&!engine.model.vision{return Err(local_error());}'''
new='''        let files=if lease.owner().environment==veyra_contracts::local_workspaces::LocalEnvironment::Windows{
            // SAME already-held OwnedEngine. Public wrappers would recurse.
            super::web_file_input::NativeWebFileInput::windows(self.hold_local_windows_web_read_locked(&engine,lease,&original,current)?)
        }else{
            super::web_file_input::NativeWebFileInput::snapshot(crate::opencode::attachments::resolve_local_web_files(&lease.binding,&session,
                original.operation_id(),original.input_sha256(),&view,current).map_err(|_|local_error())?)
        };
        let effective=files.effective(&original).map_err(|_|local_error())?;
        if files.contains_image().map_err(|_|local_error())?&&!engine.model.vision{return Err(local_error());}'''
data=replace(data,old,new)
data=replace(data,'        let mut total=0usize;\n        for file in files.into_iter().flatten(){','        let mut total=0usize;\n        if files_original.windows_read().is_none(){\n        for file in files.into_iter().flatten(){')
data=replace(data,'        let session=engine.client()?.session_in_project(lease.session_id(),&SessionQuery{\n            directory:lease.binding.directory().into(),..SessionQuery::default()})?;\n        let baseline=', '        } // Windows forwards original URIs under the actual retained chain.\n        let session=engine.client()?.session_in_project(lease.session_id(),&SessionQuery{\n            directory:lease.binding.directory().into(),..SessionQuery::default()})?;\n        let baseline=')
data=replace(data,'        let prepared=engine.client()?.prepare_original_web_prompt(','''        if let Some(read)=files_original.windows_read(){self.check_local_windows_web_read_locked(engine,lease,original,read,current)?;}
        let prepared=engine.client()?.prepare_original_web_prompt(''')
after[WEB]=data
data=after[STORE]
data=replace(data,'use crate::opencode::attachments::NativeWebFilesOriginal;','use crate::opencode::desktop_runtime::NativeWebFileInput;')
data=data.replace('files:NativeWebFilesOriginal','files:NativeWebFileInput').replace('&NativeWebFilesOriginal','&NativeWebFileInput')
data=replace(data,'let verified=crate::opencode::desktop_runtime::materialize_resolved_web_files(original.body(),&files).map_err(|_|StoreError::Conflict)?;','let verified=files.effective(&original).map_err(|_|StoreError::Conflict)?;')
data=replace(data,'let mut provenance=files.journal_original();','let mut provenance=files.journal_original(&original).map_err(|_|StoreError::Conflict)?;')
data=replace(data,' fn from_actual(outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome)->Self{',''' pub(crate) fn matches_join(&self,identity:&std::sync::Arc<crate::opencode::desktop_runtime::NativeWebCompletionIdentity>,operation:&str,input:&str,body:&str)->bool{
  std::sync::Arc::ptr_eq(&self.identity,identity)&&self.operation==operation&&self.input_sha256==input&&self.body_sha256==body
 }
 fn from_actual(outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome)->Self{''');after[STORE]=data
data=after[FACADE];data=data.replace('veyra_adapters::opencode::attachments::NativeWebFilesOriginal)->Result<veyra_adapters::projects::NativeWebReservation,String>','veyra_adapters::opencode::desktop_runtime::NativeWebFileInput)->Result<veyra_adapters::projects::NativeWebReservation,String>');after[FACADE]=data
data=after[COMP]
data=replace(data,'use crate::projects::{NativeWebDispatch,NativeWebPublished};','''use crate::projects::{NativeWebDispatch,NativeWebPublished};
use crate::local_execution::windows_web_read::RetainedWindowsWebRead;
/// Only actual retained sender completion can mint this. A parsed DTO, status,
/// cancellation flag, primary-PID exit or copied JSON has no constructor.
pub(crate) struct NativeWebReadJoined{
 identity:Arc<NativeWebCompletionIdentity>,held:Arc<RetainedWindowsWebRead>,operation:String,input:String,body:String,
}
impl NativeWebReadJoined{
 pub(crate) fn matches_carrier(&self,actual:&RetainedWindowsWebRead)->bool{std::ptr::eq(self.held.as_ref(),actual)}
 pub(crate) fn matches_publication(&self,published:&NativeWebPublished)->bool{published.matches_join(&self.identity,&self.operation,&self.input,&self.body)}
}''')
start=data.index(' pub fn retain_publication(');end=data.index(' pub fn check_empty(',start)
data=data[:start]+''' pub fn retain_publication(&self,published:NativeWebPublished)->Result<(),String>{
  let mut slots=self.slots.lock().map_err(|_|"Original Web completion registry poisoned")?;
  let operation=published.operation_id().to_owned();
  let slot=slots.get(&operation).ok_or("Original request slot missing")?.clone();
  let mut state=slot.state.lock().map_err(|_|"Original request slot poisoned")?;
  let outcome=state.outcome.as_ref().ok_or("Original completion unavailable")?.clone();
  if !published.matches_outcome(&outcome){return Err("Publication belongs to a different actual request slot".into());}
  if state.published.is_some(){return Err("Original publication already spent; do not repeat close".into());}
  state.published=Some(published); // retain BEFORE any fallible checked close
  let publication=state.published.as_ref().expect("actual publication retained");
  let retired=if let Some(read)=slot.dispatch.parts().2.windows_read(){
   let Some(joined)=outcome.joined.as_ref()else{return Err("Actual Windows materialization join remains unknown".into())};
   read.retire_published(joined,publication,Instant::now()+Duration::from_secs(3))?;true
  }else{outcome.complete_response()&&matches!(outcome.admission(),"admitted"|"rejected")};
  if retired{drop(state);slots.remove(&operation);Ok(())}
  else{Err("Actual original Web request ownership remains unknown".into())}
 }
'''+data[end:]
data=replace(data,'&crate::opencode::attachments::NativeWebFilesOriginal','&super::web_file_input::NativeWebFileInput')
data=replace(data,'  state.request=Some(request);','  state.request=Some(request);\n  self.dispatch.parts().2.begin_actual_send().map_err(|_|RuntimeError::Storage)?;')
data=replace(data,'  let outcome=Arc::new(super::web_original::LocalWebPromptOutcome{','''  let joined=if admission=="admitted"{
   if let Some(read)=self.dispatch.parts().2.windows_read(){
    let value:Option<Value>=serde_json::from_slice(&observed.body).ok();
    match value.as_ref().and_then(|v|v.get("data")){
     Some(user)=>match read.verify_materialized_user(original,user){
      Ok(())=>Some(NativeWebReadJoined{identity:self.identity.clone(),held:read.held_original(),operation:original.operation_id().into(),input:original.input_sha256().into(),body:format!("{:x}",Sha256::digest(&observed.body))}),
      Err(_)=>None,
     },None=>None,
    }
   }else{None}
  }else{None};
  let outcome=Arc::new(super::web_original::LocalWebPromptOutcome{''')
data=replace(data,'   scope:self.dispatch.original_scope().to_owned(),','   scope:self.dispatch.original_scope().to_owned(),joined,');after[COMP]=data
data=after[COMP]
mark=' pub fn outcomes(&self)->Result<Vec<Arc<super::web_original::LocalWebPromptOutcome>>,String>{'
addition=''' /// Cleanup only an inactive actual slot whose request never entered HTTP.
 /// Original DB unknown/source records remain immutable and never replayable.
 pub fn retire_never_sent(&self,deadline:Instant)->Result<(),String>{
  let mut slots=self.slots.lock().map_err(|_|"Original Web completion registry poisoned")?;
  let mut removed=Vec::new();let mut failed=false;
  for(operation,slot)in slots.iter(){
   if Arc::strong_count(slot)!=1{continue;} // active worker retains this exact Arc
   let state=match slot.state.try_lock(){Ok(state)=>state,Err(_)=>{failed=true;continue;}};
   let never_sent=state.outcome.is_none()&&state.request.as_ref().is_none_or(|r|r.observation.phase==WebTransportPhase::Prepared);
   if !never_sent{continue;}
   match slot.dispatch.parts().2.retire_never_sent(deadline){Ok(())=>removed.push(operation.clone()),Err(_)=>failed=true}
  }
  for operation in removed{slots.remove(&operation);}
  if failed{Err("Inactive never-sent original checked close remains retained".into())}else{Ok(())}
 }
'''
data=replace(data,mark,addition+mark);after[COMP]=data
data=after[SVC]
data=replace(data,'  let mut failed=false;\n  for outcome in actual.outcomes()?{','  let cleanup=actual.retire_never_sent(deadline);\n  let mut failed=false;\n  for outcome in actual.outcomes()?{')
data=replace(data,'  if failed{Err("Actual original Web completions remain retained".into())}else{Ok(())}','  if failed{Err("Actual original Web completions remain retained".into())}else{cleanup}')
after[SVC]=data
data=after[CARRIER]
mark=' pub(crate) fn is_closed(&self)->bool'
addition=''' /// Private source evidence only. It cannot acknowledge a read or send.
 pub(crate) fn chain_projection(&self)->Result<serde_json::Value,String>{
  let state=self.state.try_lock().map_err(|_|"original chain inventory busy")?;
  if state.phase!=Phase::Held{return Err("original source proof must precede send".into());}
  #[cfg(windows)]{state.native.check()?;return state.native.projection();}
  #[cfg(not(windows))]Err("Windows source inventory unavailable".into())
 }
 pub(crate) fn visit_sent_sources(&self,visit:&mut dyn FnMut(usize,&str,&[u8],&str)->Result<(),String>)->Result<(),String>{
  let state=self.state.try_lock().map_err(|_|"original sent source inventory busy")?;
  if state.phase!=Phase::Sending{return Err("materialization verification requires actual sent original".into());}
  #[cfg(windows)]{state.native.check()?;for(index,source)in state.native.sources.iter().enumerate(){visit(index,&source.absolute,&source.bytes,&source.mime)?;}Ok(())}
  #[cfg(not(windows))]{let _=visit;Err("Windows source inventory unavailable".into())}
 }
 pub(crate) fn retire_published(&self,joined:&crate::opencode::desktop_runtime::NativeWebReadJoined,published:&crate::projects::NativeWebPublished,deadline:Instant)->Result<(),String>{
  if !joined.matches_carrier(self)||!joined.matches_publication(published){return Err("different actual materialization/publication owner".into());}
  let mut state=self.state.try_lock().map_err(|_|"original read busy")?;
  if state.phase!=Phase::Sending{return Err("original checked close already spent or no send".into());}
  #[cfg(windows)]state.native.check()?;
  state.phase=Phase::Joined;state.phase=Phase::Closing;
  #[cfg(windows)]state.native.close_once(deadline)?;
  #[cfg(not(windows))]{let _=deadline;return Err("Windows original unavailable".into());}
  #[cfg(windows)]{state.phase=Phase::Closed;Ok(())}
 }
'''
data=replace(data,mark,addition+mark);after[CARRIER]=data
data=after[READ]
data+='''
impl NativeWindowsWebRead{
 pub(crate) fn retire_published(&self,joined:&super::super::web_completion::NativeWebReadJoined,published:&crate::projects::NativeWebPublished,deadline:Instant)->Result<(),String>{self.held.retire_published(joined,published,deadline)}
}
''';after[READ]=data
data=after[NATIVE]
data=replace(data,'struct Node{file:','struct Node{path:PathBuf,file:')
data=replace(data,'self.nodes.push(Node{file:','self.nodes.push(Node{path:path.clone(),file:')
data+='''
impl Held{
 pub(super) fn projection(&self)->Result<serde_json::Value,String>{
  self.check()?;let mut nodes=Vec::new();
  for node in &self.nodes{
   let stamp=node.stamp.as_ref().ok_or("actual source stamp missing")?;
   nodes.push(serde_json::json!({"path":node.path.to_str().ok_or("actual source path invalid")?,"directory":node.directory,
    "volume":stamp.volume,"file_id_hex":stamp.id.iter().map(|b|format!("{b:02x}")).collect::<String>(),"size":stamp.size,"last_write":stamp.write}));
  }Ok(serde_json::json!(nodes))
 }
}
''';after[NATIVE]=data
patch=[];manifest=[]
for path,post in after.items():
 pre=before.get(path,'')
 if pre==post:continue
 patch.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path if path in before else '/dev/null',tofile='b/'+path))
 manifest.append({'path':path,'preimage_sha256':sha(pre.encode()) if path in before else None,'postimage_sha256':sha(post.encode()),'bytes':len(post.encode())})
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'windows-read-join.patch').write_bytes(raw)
imports=[];import_manifest=[]
for path in (WEB,RT):
 pre=env['after'][path];post=before[path]
 imports.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 import_manifest.append({'path':path,'preimage_sha256':sha(pre.encode()),'postimage_sha256':sha(post.encode())})
import_raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in imports).encode()
(ROOT/'required-web-imports.patch').write_bytes(import_raw)
(ROOT/'manifest.json').write_text(json.dumps({'base_completion':FROZEN_COMPLETION,'base_projects':PROJECTS_BASE,
 'requires':'094c then492f; canonical73fc other3structural imports +abdb4source contracts; required-web-imports.patch BEFORE windows-read-join.patch',
 'scope':'source only; no activation/runtime acceptance','patch_sha256':sha(raw),'patch_bytes':len(raw),
 'imports_patch_sha256':sha(import_raw),'imports_patch_bytes':len(import_raw),'imports':import_manifest,'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(raw),'sha256':sha(raw)}))
