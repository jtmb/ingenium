"""Pure stdlib source composition; no Native writes, compiler or dependencies.
Regenerate inside this same root: python3 -B compose.py.
Frozen 094c artifact bytes are never edited. Native object database read only.
"""
import difflib,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[6]
BASE='094c34e39b7ba62e7e3d3e45cd1e77d4432d48ed'
PREFIX='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/'
NATIVE='//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source'
GIT='/mnt/c/Program Files/Git/cmd/git.exe'
def sha(b):return hashlib.sha256(b).hexdigest()
def frozen(path):return subprocess.check_output(['git','-C',str(REPO),'show',BASE+':'+PREFIX+path])
def blob(oid):return subprocess.check_output([GIT,'-c','safe.directory='+NATIVE,'-C',NATIVE,'cat-file','blob',oid])
def replace(data,a,b):
 assert data.count(a)==1,('ambiguous exact source replacement',a[:120]);return data.replace(a,b,1)
def reconstruct():
 pins=json.loads(frozen('native15-inputs.json'))['records'];files={p['path']:blob(p['blob']).decode() for p in pins}
 lines=frozen('native15-originals.patch').decode().splitlines(True);index=0
 while index<len(lines):
  assert lines[index].startswith('--- ');old=lines[index][4:].strip();new=lines[index+1][4:].strip();path=new[2:];index+=2
  source=files.get(path,'').splitlines(True);out=[];cursor=0
  while index<len(lines) and not lines[index].startswith('--- '):
   import re
   match=re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',lines[index]);assert match,lines[index]
   start=int(match[1]);count=int(match[2] or 1);index+=1;at=start-1 if start else 0
   out.extend(source[cursor:at]);cursor=at;consumed=0
   while index<len(lines) and not lines[index].startswith(('@@ ','--- ')):
    line=lines[index];index+=1
    if line.startswith('\\'):continue
    if line in ('\n','\r\n'):line=' '+line
    if line[0] in ' -':assert source[cursor]==line[1:],(path,cursor);cursor+=1;consumed+=1
    if line[0] in ' +':out.append(line[1:])
   assert consumed==count,(path,consumed,count)
  out.extend(source[cursor:]);files[path]=''.join(out)
 manifest=json.loads(frozen('native15-manifest.json'))
 for item in manifest['files']:assert sha(files[item['path']].encode())==item['postimage_sha256'],item['path']
 return files
before=reconstruct();after=before.copy()
WEB='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs'
STORE='crates/adapters/src/projects/local_web_originals.rs'
PROJECTS='crates/adapters/src/projects.rs'
LOCAL='crates/adapters/src/projects/local_workspaces.rs'
RUNTIME='crates/adapters/src/opencode/desktop_runtime.rs'
LR='crates/adapters/src/opencode/desktop_runtime/local_workspaces.rs'
SVC='apps/service/src/routes/local_workspaces/web_original.rs'
FACADE='apps/service/src/routes/live_agent.rs'
TRANSPORT='crates/adapters/src/opencode/local_web_transport.rs'
COMPLETION='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_completion.rs'
for path in (TRANSPORT,COMPLETION):after[path]=(ROOT/'sources'/path).read_text()
data=after[LR];data=replace(data,'pub(super) mod web_original;','pub(super) mod web_original;\npub(super) mod web_completion;');after[LR]=data
data=after[RUNTIME]
data=replace(data,'    active_turns: Arc<Mutex<BTreeMap<String, ActiveTurn>>>,\n    credential_revision:','    active_turns: Arc<Mutex<BTreeMap<String, ActiveTurn>>>,\n    native_web_completions:Arc<local_workspaces::web_completion::NativeWebCompletions>,\n    credential_revision:')
data=replace(data,'            active_turns: Arc::new(Mutex::new(BTreeMap::new())),','            active_turns: Arc::new(Mutex::new(BTreeMap::new())),\n            native_web_completions:Arc::new(local_workspaces::web_completion::NativeWebCompletions::default()),')
data=replace(data,'pub use local_workspaces::web_event_policy::','pub use local_workspaces::web_completion::NativeWebCompletions;\npub(crate) use local_workspaces::web_completion::NativeWebCompletionIdentity;\npub use local_workspaces::web_event_policy::');after[RUNTIME]=data
data=after[PROJECTS]
data=replace(data,'pub struct ProjectStore {\n    connection: Connection,','pub struct ProjectStore {\n    connection: Connection,\n    native_web_writer:std::sync::Arc<local_web_originals::NativeWebWriterOriginal>,')
data=data.replace('connection, local_custody: None, local_installation_id: None','connection, native_web_writer:std::sync::Arc::new(local_web_originals::NativeWebWriterOriginal::new()), local_custody: None, local_installation_id: None')
data=replace(data,'NativeWebAcknowledgement,SavedNativeWebPty','NativeWebAcknowledgement,NativeWebPublished,SavedNativeWebPty');after[PROJECTS]=data
data=after[LOCAL];data=replace(data,'Self{connection,local_custody:None,local_installation_id:None}','Self{connection,native_web_writer:std::sync::Arc::new(super::local_web_originals::NativeWebWriterOriginal::new()),local_custody:None,local_installation_id:None}');after[LOCAL]=data
data=after[STORE]
data=replace(data,'pub struct NativeWebDispatch { original: NativeWebOriginal, effective:EffectiveWebBody,files:NativeWebFilesOriginal }','''pub(super) struct NativeWebWriterOriginal{_nonce:uuid::Uuid}
impl NativeWebWriterOriginal{pub(super) fn new()->Self{Self{_nonce:uuid::Uuid::new_v4()}}}
pub struct NativeWebDispatch { original:NativeWebOriginal,effective:EffectiveWebBody,files:NativeWebFilesOriginal,
 writer:std::sync::Arc<NativeWebWriterOriginal>,scope:String }
/// Same-row publication only. This is NOT materialization/read-join authority.
pub struct NativeWebPublished{
 identity:std::sync::Arc<crate::opencode::desktop_runtime::NativeWebCompletionIdentity>,
 operation:String,input_sha256:String,body_sha256:String,
}
impl NativeWebPublished{
 pub fn operation_id(&self)->&str{&self.operation}
 pub(crate) fn matches_outcome(&self,outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome)->bool{
  use sha2::{Digest,Sha256};
  std::sync::Arc::ptr_eq(&self.identity,outcome.publication_identity())&&self.operation==outcome.operation_id()
   &&self.input_sha256==outcome.input_sha256()&&self.body_sha256==format!("{:x}",Sha256::digest(outcome.body()))
 }
 fn from_actual(outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome)->Self{
  use sha2::{Digest,Sha256};
  Self{identity:outcome.publication_identity().clone(),operation:outcome.operation_id().into(),input_sha256:outcome.input_sha256().into(),body_sha256:format!("{:x}",Sha256::digest(outcome.body()))}
 }
}''')
data=replace(data,'    pub(crate) fn into_parts(self) -> (NativeWebOriginal,EffectiveWebBody,NativeWebFilesOriginal) { (self.original,self.effective,self.files) }','''    pub(crate) fn parts(&self)->(&NativeWebOriginal,&EffectiveWebBody,&NativeWebFilesOriginal){(&self.original,&self.effective,&self.files)}
    pub(crate) fn writer_identity(&self)->&std::sync::Arc<NativeWebWriterOriginal>{&self.writer}
    pub(crate) fn original_scope(&self)->&str{&self.scope}''')
data=replace(data,'pub fn acknowledge_native_web_prompt(&mut self,outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome,instance:&str)->Result<(),StoreError>{','pub fn acknowledge_native_web_prompt(&mut self,outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome,_instance:&str)->Result<NativeWebPublished,StoreError>{')
data=replace(data,'''        self.check_local_owner(outcome.owner(),instance)?;
        self.require_local_session(&outcome.owner().workspace_id,outcome.session_id())?;''','''        // Retention ONLY: the exact original ProjectStore allocation minted
        // this pre-send owner. Revocation cannot erase its actual completion.
        // Another connection/reopened DB/DTO/row lookup cannot mint this Arc.
        if !std::sync::Arc::ptr_eq(&self.native_web_writer,outcome.writer_identity())||!outcome.complete_response(){return Err(StoreError::Conflict);}
        let scope:Option<String>=self.connection.query_row("SELECT scope_engine_json FROM local_web_original_payloads WHERE operation_id=?",[outcome.operation_id()],|r|r.get(0)).optional()?;
        let forgotten:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id=?)",[outcome.operation_id()],|r|r.get(0))?;
        if forgotten||scope.as_deref()!=Some(outcome.original_scope()){return Err(StoreError::Conflict);}''')
data=replace(data,'return Err(StoreError::Conflict);}return Ok(());','return Err(StoreError::Conflict);}return Ok(NativeWebPublished::from_actual(outcome));')
data=replace(data,'        tx.commit()?;Ok(())\n    }\n\n    /// Caller retains','        tx.commit()?;Ok(NativeWebPublished::from_actual(outcome))\n    }\n\n    /// Caller retains')
data=replace(data,'Ok(NativeWebReservation::Fresh(NativeWebDispatch{original,effective,files}))','Ok(NativeWebReservation::Fresh(NativeWebDispatch{original,effective,files,writer:self.native_web_writer.clone(),scope}))');after[STORE]=data
data=after[WEB]
data=replace(data,"    admission:&'static str,status:u16,content_type:Option<String>,body:Vec<u8>,",'''    pub(super) admission:&'static str,
    pub(super) observed:Arc<crate::opencode::local_web_transport::WebPromptObservation>,
    pub(super) identity:Arc<super::web_completion::NativeWebCompletionIdentity>,
    pub(super) writer:Arc<crate::projects::local_web_originals::NativeWebWriterOriginal>,
    pub(super) scope:String,''')
# Sibling completion producer is the only additional mint, never public DTO.
data=replace(data,'    operation_id:String,input_sha256:String,owner:LocalWorkspaceOwner,session_id:String,upstream_id:Option<String>,','    pub(super) operation_id:String,pub(super) input_sha256:String,pub(super) owner:LocalWorkspaceOwner,pub(super) session_id:String,pub(super) upstream_id:Option<String>,')
data=replace(data,'    Sent(LocalWebPromptOutcome),','    Sent(Arc<LocalWebPromptOutcome>),')
data=replace(data,'    pub fn status(&self)->u16{self.status}\n    pub fn content_type(&self)->Option<&str>{self.content_type.as_deref()}\n    pub fn body(&self)->&[u8]{&self.body}', '''    pub fn status(&self)->u16{self.observed.status.unwrap_or(0)}
    pub fn content_type(&self)->Option<&str>{self.observed.content_type.as_deref()}
    pub fn body(&self)->&[u8]{&self.observed.body}
    pub(crate) fn complete_response(&self)->bool{self.observed.phase==crate::opencode::local_web_transport::WebTransportPhase::Complete}
    pub(crate) fn publication_identity(&self)->&Arc<super::web_completion::NativeWebCompletionIdentity>{&self.identity}
    pub(crate) fn writer_identity(&self)->&Arc<crate::projects::local_web_originals::NativeWebWriterOriginal>{&self.writer}
    pub(crate) fn original_scope(&self)->&str{&self.scope}''')
data=replace(data,'impl LiveRuntime {\n    /// The reservation callback', '''impl LiveRuntime {
    pub fn original_web_completions(&self)->Arc<super::web_completion::NativeWebCompletions>{self.native_web_completions.clone()}
    /// The reservation callback''')
assert data.count(')->Result<LocalWebPromptOutcome,RuntimeError>{')==2
data=data.replace(')->Result<LocalWebPromptOutcome,RuntimeError>{',')->Result<Arc<LocalWebPromptOutcome>,RuntimeError>{')
data=replace(data,'        let (original,effective,files_original)=dispatch.into_parts();','''        let slot=self.native_web_completions.enroll(dispatch)?;
        let (original,effective,files_original)=slot.parts();''')
start=data.index('        let sent=engine.client()?.send_original_web_prompt_once(')
end=data.index('        let upstream_id=acknowledged.clone().or(inspected.upstream_message_id.clone());',start)
data=data[:start]+'''        let prepared=engine.client()?.prepare_original_web_prompt(lease.session_id(),original.raw_target(),original.headers(),effective.bytes())?;
        let outcome=slot.send_retained(prepared,inspected.upstream_message_id.clone())?;
        let state=match outcome.admission(){"admitted"=>PromptState::Admitted,"rejected"=>PromptState::Rejected,_=>PromptState::Uncertain};
        let acknowledged=if outcome.admission()=="admitted"{outcome.upstream_id().map(str::to_owned)}else{None};
        // Every fallible post-send step now runs AFTER actual slot retention.
        // Writer/cache failure does not discard the complete/partial transport.
        let _postprocessing=(||->Result<(),RuntimeError>{
'''+data[end:]
start=data.index('        // Keep any positive original acknowledgement durably under its old')
end=data.index('    pub fn inspect_local_web_prompt(',start)
data=data[:start]+'''        Ok(())})();
        if require_local_engine(&engine,&lease.binding,current).is_err()||self.credentials_revision()!=lease.original.revision
            ||files_original.check_current(&lease.binding,lease.session_id(),original.operation_id(),original.input_sha256(),current).is_err(){lease.revoke();}
        // Even postprocessing/revocation failure returns the same actual slot
        // outcome. The registry owns it independently of this worker/result.
        Ok(outcome)
    }
'''+data[end:];after[WEB]=data
data=after[FACADE]
needle='    pub(super) fn submit_local_web_prompt_original<F>'
data=replace(data,needle,'''    pub(super) fn original_web_completions(&self)->Arc<veyra_adapters::opencode::desktop_runtime::NativeWebCompletions>{self.runtime.original_web_completions()}
'''+needle);after[FACADE]=data
data=after[SVC]
start=data.index('#[derive(Default)]');end=data.index('/// Called only by the native-authenticated private proxy.',start)
data=data[:start]+'''/// SAME actual adapter registry, bound before the worker may dispatch.
#[derive(Default)]
pub(super) struct WebPending {registry:Mutex<Option<Arc<veyra_adapters::opencode::desktop_runtime::NativeWebCompletions>>>}
impl WebPending{
 fn bind(&self,actual:Arc<veyra_adapters::opencode::desktop_runtime::NativeWebCompletions>)->Result<(),String>{
  let mut saved=self.registry.lock().map_err(|_|"Original Web registry poisoned")?;
  if let Some(old)=saved.as_ref(){if !Arc::ptr_eq(old,&actual){return Err("Different original runtime registry refused".into());}}else{*saved=Some(actual);}Ok(())
 }
 pub(super) fn check_empty(&self)->Result<(),String>{
  let saved=self.registry.lock().map_err(|_|"Original Web registry poisoned")?;
  if let Some(actual)=saved.as_ref(){actual.check_empty()}else{Ok(())}
 }
 pub(super) fn flush(&self,service:&ServiceState,deadline:Instant)->Result<(),String>{
  let saved=self.registry.lock().map_err(|_|"Original Web registry poisoned")?;
  let Some(actual)=saved.as_ref()else{return Ok(())};
  let mut writer=service.projects.try_lock().map_err(|_|"Original Web response writer busy")?;
  let store=writer.as_mut().ok_or("Original Web response writer retired")?;
  let mut failed=false;
  for outcome in actual.outcomes()?{
   if Instant::now()>=deadline{failed=true;break;}
   match store.acknowledge_native_web_prompt(&outcome,&service.instance_id){
    Ok(published)=>actual.retain_publication(published)?,Err(_)=>failed=true,
   }
  }
  if failed{Err("Actual original Web completions remain retained".into())}else{Ok(())}
 }
}

'''+data[end:]
data=replace(data,'    tokio::task::spawn_blocking(move||{','    state.local_workspaces.web.bind(state.live_agent.original_web_completions())?;\n    tokio::task::spawn_blocking(move||{')
data=replace(data,'                state.local_workspaces.web.enroll(outcome)?;','                // Already retained before HTTP by the actual runtime slot.\n                let _same_actual_outcome=outcome;');after[SVC]=data
# Keep Rust module privacy explicit; siblings receive only crate-private types.
after[PROJECTS]=after[PROJECTS].replace('mod local_web_originals;','pub(crate) mod local_web_originals;')
after[STORE]=after[STORE].replace('pub(super) struct NativeWebWriterOriginal','pub(crate) struct NativeWebWriterOriginal')
# Parent local_workspaces module is already pub(crate) in frozen runtime.
patch=[];manifest=[]
for path,post in after.items():
 pre=before.get(path,'')
 if post==pre:continue
 patch.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path if path in before else '/dev/null',tofile='b/'+path))
 manifest.append({'path':path,'preimage_sha256':sha(pre.encode()) if path in before else None,'postimage_sha256':sha(post.encode()),'bytes':len(post.encode())})
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'completion-slots.patch').write_bytes(raw)
(ROOT/'manifest.json').write_text(json.dumps({'base':BASE,'scope':'source-only; publication is NOT read join; no activation','patch_sha256':sha(raw),'patch_bytes':len(raw),'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(raw),'sha256':sha(raw)}))
