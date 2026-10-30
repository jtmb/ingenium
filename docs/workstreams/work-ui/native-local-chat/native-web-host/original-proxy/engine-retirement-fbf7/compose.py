"""Source-only exact follow-on; no process/Native writes/builds/downloads."""
import difflib,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[6]
BASE='fbf7b19218337d4b2a08a233ca752d4326db6e8b'
PREFIX='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/windows-join-492f'
for path in subprocess.check_output(['git','-C',str(REPO),'ls-tree','-r','--name-only',BASE,'--',PREFIX]).decode().splitlines():
 assert (REPO/path).read_bytes()==subprocess.check_output(['git','-C',str(REPO),'show',BASE+':'+path]),('frozen fbf7 input drift',path)
PRIOR=ROOT.parent/'windows-join-492f'/'compose.py';env={'__file__':str(PRIOR),'__name__':'frozen_composition'}
exec(compile(PRIOR.read_text().rsplit('\npatch=[];manifest=[]\n',1)[0],str(PRIOR),'exec'),env)
before=env['after'].copy();after=before.copy();replace=env['replace'];sha=env['sha']
RT,WEB,READ,COMP,CARRIER,INPUT=[env[k] for k in ('RT','WEB','READ','COMP','CARRIER','INPUT')]
NEW='crates/adapters/src/opencode/desktop_runtime/web_engine_retirement.rs'
PINNED={
 'crates/adapters/src/opencode/desktop_runtime/isolated_windows.rs':'04868864680f293b4f11420a67725f0e7201be01',
 'crates/adapters/src/opencode/desktop_runtime/isolated_wsl.rs':'d9829b42136900dcac1c14ea54505aa200281b66',
}
native_git=env['env']['blob']
for path,oid in PINNED.items():before[path]=native_git(oid).decode();after[path]=before[path]
after[NEW]=(ROOT/'sources'/NEW).read_text()
data=after[RT]
data=replace(data,'mod local_workspaces;','mod local_workspaces;\nmod web_engine_retirement;\npub(crate) use web_engine_retirement::NativeWebEngineOriginal;\npub(crate) use local_workspaces::web_completion::NativeWebEngineReadRetired;')
data=replace(data,'struct OwnedEngine {\n','struct OwnedEngine {\n    native_web_original:Arc<web_engine_retirement::NativeWebEngineOriginal>,\n    native_web_workers:web_engine_retirement::WorkerOriginals,\n')
data=replace(data,'        let engine = OwnedEngine {\n','        let engine = OwnedEngine {\n            native_web_original:Arc::new(web_engine_retirement::NativeWebEngineOriginal::new()),\n            native_web_workers:web_engine_retirement::WorkerOriginals::new(bootstrap_writer.as_ref()),\n')
data=replace(data,'        self.credential_revision.fetch_add(1, Ordering::AcqRel);\n        engine.monitor_stop.store(true, Ordering::SeqCst);','        engine.native_web_original.close_admission();\n        self.credential_revision.fetch_add(1, Ordering::AcqRel);\n        engine.monitor_stop.store(true, Ordering::SeqCst);')
# Both actual stop branches already proved native job empty and joined workers.
old='''                engine.finish_isolation_original(deadline)?;
                *slot = None;'''
assert data.count(old)==2
data=data.replace(old,'''                engine.finish_isolation_original(deadline)?;
                self.native_web_completions.retire_stopped_windows_engine(engine,deadline)?;
                *slot = None;''');after[RT]=data
for path in PINNED:
 data=after[path];data=replace(data,'            *slot = Some(OwnedEngine {\n','            *slot = Some(OwnedEngine {\n                native_web_original:Arc::new(web_engine_retirement::NativeWebEngineOriginal::new()),\n                native_web_workers:web_engine_retirement::WorkerOriginals::new(None),\n');after[path]=data
# Every actual monitor/event install records Pending before spawn. No worker
# can be re-created after Joined/Failed under the same original engine.
import re
for path in [RT,*PINNED]:
 data=after[path]
 for field,role in [('event_thread','Event'),('monitor_thread','Monitor')]:
  pattern=r'(?m)^( +)engine\.'+field+r' = Some\('
  data=re.sub(pattern,lambda m:m[1]+'engine.native_web_workers.begin(web_engine_retirement::WorkerRole::'+role+')?;\n'+m[0],data)
 after[path]=data
data=after[RT]
start=data.index('    fn settle_workers(')
end=data.index('    fn stop_linux(',start)
data=data[:start]+'''    fn settle_workers(&mut self,deadline:Instant)->Result<(),RuntimeError>{
        let mut failed=false;
        if let Some(transport)=self.credential_transport.as_mut(){if transport.stop_until(deadline).is_err(){failed=true;}}
        self.monitor_stop.store(true,Ordering::SeqCst); // revocation only
        while self.monitor_thread.as_ref().is_some_and(|w|!w.is_finished())
            ||self.event_thread.as_ref().is_some_and(|w|!w.is_finished())
            ||self.bootstrap_writer.as_ref().is_some_and(|w|!w.is_finished()){
            if Instant::now()>=deadline{break;}
            thread::sleep(Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now())));
        }
        if self.monitor_thread.as_ref().is_some_and(|w|!w.is_finished()){failed=true;}
        else if self.native_web_workers.join_monitor(self.monitor_thread.take()).is_err(){self.prevent_isolation_close();failed=true;}
        if self.event_thread.as_ref().is_some_and(|w|!w.is_finished()){failed=true;}
        else if self.native_web_workers.join_event(self.event_thread.take()).is_err(){self.prevent_isolation_close();failed=true;}
        if self.bootstrap_writer.as_ref().is_some_and(|w|!w.is_finished()){failed=true;}
        else if self.native_web_workers.join_bootstrap(self.bootstrap_writer.take()).is_err(){self.prevent_isolation_close();failed=true;}
        // All three independent finished handles were reconciled even if one
        // failed. Persistent per-original seals apply to Direct/Native too.
        if failed{return Err(RuntimeError::Storage);}
        self.native_web_workers.require_all()
    }
'''+data[end:];after[RT]=data
data=after[WEB]
data=replace(data,'pub struct LocalWebLease {\n','pub struct LocalWebLease {\n    native_engine_original:Arc<super::super::web_engine_retirement::NativeWebEngineOriginal>,\n')
data=replace(data,'Ok(LocalWebLease { binding, original, binding_id,','Ok(LocalWebLease { native_engine_original:engine.native_web_original.clone(),binding, original, binding_id,')
data=replace(data,'pub struct NativeWebOriginal {\n','pub struct NativeWebOriginal {\n    native_engine_original:Arc<super::super::web_engine_retirement::NativeWebEngineOriginal>,\n')
data=replace(data,'        Ok(Self { operation_id, binding_id: lease.binding_id.clone(),','        Ok(Self { native_engine_original:lease.native_engine_original.clone(),operation_id, binding_id: lease.binding_id.clone(),')
data=replace(data,'    pub fn operation_id(&self) -> &str { &self.operation_id }','    pub(crate) fn native_engine_original(&self)->&Arc<super::super::web_engine_retirement::NativeWebEngineOriginal>{&self.native_engine_original}\n    pub fn operation_id(&self) -> &str { &self.operation_id }')
data=replace(data,'        if original.binding_id != lease.binding_id || original.invalidation_epoch != lease.invalidation_epoch','        if original.native_engine_original.admission_closed()||!Arc::ptr_eq(&original.native_engine_original,&lease.native_engine_original)||!Arc::ptr_eq(&lease.native_engine_original,&engine.native_web_original)\n            ||original.binding_id != lease.binding_id || original.invalidation_epoch != lease.invalidation_epoch')
data=replace(data,'            if observed != lease.original || lease.revoked()\n','            if !Arc::ptr_eq(&lease.native_engine_original,&engine.native_web_original)||observed != lease.original || lease.revoked()\n')
data=replace(data,'        if observed!=lease.original||lease.revoked(){return Err(local_error());}','        if !Arc::ptr_eq(&lease.native_engine_original,&engine.native_web_original)||observed!=lease.original||lease.revoked(){return Err(local_error());}');after[WEB]=data
data=after[READ]
data=replace(data,'pub struct NativeWindowsWebRead{\n','pub struct NativeWindowsWebRead{\n native_engine_original:Arc<super::super::super::web_engine_retirement::NativeWebEngineOriginal>,\n')
data=replace(data,'Ok(NativeWindowsWebRead{held,original:observed,','Ok(NativeWindowsWebRead{native_engine_original:engine.native_web_original.clone(),held,original:observed,')
data+='''
impl NativeWindowsWebRead{
 pub(crate) fn retire_after_tree(&self,retired:&super::super::web_completion::NativeWebEngineReadRetired,deadline:Instant)->Result<(),String>{self.held.retire_after_tree(retired,deadline)}
}
''';after[READ]=data
HELPER=env['HELPER'];data=after[HELPER]
data=replace(data,'  self.original==original.engine&&self.operation==original.operation_id()','  Arc::ptr_eq(&self.native_engine_original,original.native_engine_original())&&self.original==original.engine&&self.operation==original.operation_id()');after[HELPER]=data
data=after[COMP]
data=replace(data,'#[derive(Default)]\npub struct NativeWebCompletions{slots:Mutex<BTreeMap<String,Arc<NativeWebSendSlot>>>}','''pub(crate) struct NativeWebRegistryOriginal{_nonce:uuid::Uuid}
impl Default for NativeWebRegistryOriginal{fn default()->Self{Self{_nonce:uuid::Uuid::new_v4()}}}
#[derive(Default)]
pub struct NativeWebCompletions{slots:Mutex<BTreeMap<String,Arc<NativeWebSendSlot>>>,generation:Arc<NativeWebRegistryOriginal>}''')
data=replace(data,'  let operation=dispatch.parts().0.operation_id().to_owned();','  if dispatch.parts().0.native_engine_original().admission_closed(){return Err(RuntimeError::AdmissionPending);}\n  let operation=dispatch.parts().0.operation_id().to_owned();')
data=replace(data,'struct CompletionState{','''/// Private actual engine-tree proof bound to ONE actual held read. Registry
/// mints it only after matching original engine Arc and querying the real job.
pub(crate) struct NativeWebEngineReadRetired{
 _tree:Arc<super::super::web_engine_retirement::NativeWebTreeRetired>,held:Arc<RetainedWindowsWebRead>,
}
impl NativeWebEngineReadRetired{
 pub(crate) fn matches_carrier(&self,actual:&RetainedWindowsWebRead)->bool{std::ptr::eq(self.held.as_ref(),actual)}
}
struct CompletionState{''')
data=replace(data,' published:Option<NativeWebPublished>,',' published:Option<NativeWebPublished>,tree_retired:Option<NativeWebEngineReadRetired>,read_close_started:bool,read_closed:bool,sender_finished:bool,')
data=replace(data,'state:Mutex::new(CompletionState{request:None,outcome:None,published:None})','state:Mutex::new(CompletionState{request:None,outcome:None,published:None,tree_retired:None,read_close_started:false,read_closed:false,sender_finished:false})')
data=replace(data,'  state.request.as_mut().expect("request retained before send").execute_retained();','  state.request.as_mut().expect("request retained before send").execute_retained();\n  state.sender_finished=true; // actual blocking sender returned; NOT client/transport closure')
# Genuine read closure is distinct from reqwest client/runtime closure. Keep
# those exact resources, response and raw bytes until a real closure owner is
# supplied. No unit Drop or guard-close success becomes a global-retired claim.
data=replace(data,'  let publication=state.published.as_ref().expect("actual publication retained");','  if slot.dispatch.parts().2.windows_read().is_some()&&outcome.joined.is_none(){return Err("Actual materialization join remains unknown; no close attempted".into());}\n  if state.read_close_started&&!state.read_closed{return Err("Previous actual read close remains protected".into());}\n  state.read_close_started=true;\n  let publication=state.published.as_ref().expect("actual publication retained");')
data=replace(data,'  if retired{drop(state);slots.remove(&operation);Ok(())}\n  else{Err("Actual original Web request ownership remains unknown".into())}', '''  if retired{
   state.read_closed=true;
   // Actual Client/Response remain owned: no checked transport-close API is
   // provided by this delta. check_empty stays false; no new Web admission.
   Ok(())
  }else{Err("Actual original Web request ownership remains unknown".into())}''')
# Publication keeps the registry census read-only; its slot/client stays owned.
start=data.index(' pub fn retain_publication(');end=data.index(' pub fn check_empty(',start)
segment=data[start:end].replace('let mut slots=self.slots.lock()','let slots=self.slots.lock()')
data=data[:start]+segment+data[end:]
data=replace(data,'   let state=match slot.state.try_lock(){Ok(state)=>state,Err(_)=>{failed=true;continue;}};','   let mut state=match slot.state.try_lock(){Ok(state)=>state,Err(_)=>{failed=true;continue;}};')
data=replace(data,'   match slot.dispatch.parts().2.retire_never_sent(deadline){Ok(())=>removed.push(operation.clone()),Err(_)=>failed=true}', '''   if state.read_close_started&&!state.read_closed{failed=true;continue;}
   if !state.read_closed{
    state.read_close_started=true;
    match slot.dispatch.parts().2.retire_never_sent(deadline){Ok(())=>state.read_closed=true,Err(_)=>{failed=true;continue;}}
   }
   // A prepared actual Client remains retained even though HTTP never began.
   // Only a slot with NO transport owner can be removed on this path.
   if state.request.is_none(){removed.push(operation.clone());}''')
mark=' pub fn check_empty(&self)->Result<(),String>{'
addition=''' /// Called only at the genuine existing OwnedEngine stop boundary. This
 /// function queries the real kernel job itself; it accepts no supplied proof
 /// metadata/URL/PID/status/current-owner predicate. No workload is stopped here.
 pub(super) fn retire_stopped_windows_engine(&self,engine:&mut OwnedEngine,deadline:Instant)->Result<(),RuntimeError>{
  let slots=self.slots.lock().map_err(|_|RuntimeError::Storage)?;
  let has_windows_read=slots.values().any(|slot|Arc::ptr_eq(slot.dispatch.parts().0.native_engine_original(),&engine.native_web_original)&&slot.dispatch.parts().2.windows_read().is_some());
  if !has_windows_read{return Ok(());}
  let tree=Arc::new(super::super::web_engine_retirement::capture(engine,&self.generation)?);
  if !Arc::ptr_eq(tree.registry(),&self.generation){return Err(RuntimeError::Binding);}
  let mut failed=false;
  for(_operation,slot)in slots.iter(){
   let original=slot.dispatch.parts().0;
   if !Arc::ptr_eq(original.native_engine_original(),tree.original()){continue;}
   let Some(read)=slot.dispatch.parts().2.windows_read()else{continue};
   if Arc::strong_count(slot)!=1||!read.matches_original(original){failed=true;continue;}
   let mut state=match slot.state.try_lock(){Ok(state)=>state,Err(_)=>{failed=true;continue;}};
   if state.request.as_ref().is_some_and(|r|r.observation.phase!=WebTransportPhase::Prepared)&&!state.sender_finished{failed=true;continue;}
   if !state.read_closed{
    // Any previous close attempt is protected. Never retry it through the
    // engine-retirement path after a publication/checked-close failure.
    if state.tree_retired.is_some()||state.read_close_started{failed=true;continue;}
    state.tree_retired=Some(NativeWebEngineReadRetired{_tree:tree.clone(),held:read.held_original()});
    state.read_close_started=true;
    match read.retire_after_tree(state.tree_retired.as_ref().expect("actual tree proof retained"),deadline){
     Ok(())=>state.read_closed=true,Err(_)=>{failed=true;continue;}
    }
   }
   // FILESYSTEM-READ retirement only. The separate actual Client/Response,
   // sender observation and exact raw prefix are explicitly retained. Even a
   // complete private ACK is not a checked reqwest runtime/client close.
  }
  if failed{Err(RuntimeError::Storage)}else{Ok(())}
 }
'''
data=replace(data,mark,addition+mark)
# Parent Runtime must call the private custody method; parent modules cannot
# call a pub(super) item restricted to local_workspaces, so grant crate scope.
data=data.replace(' pub(super) fn retire_stopped_windows_engine',' pub(crate) fn retire_stopped_windows_engine')
after[COMP]=data
data=after[CARRIER]
mark=' pub(crate) fn is_closed(&self)->bool'
addition=''' /// The actual registry's opaque proof already queried the same retained
 /// engine job empty. No current auth or guessed leader-exit evidence enters.
 pub(crate) fn retire_after_tree(&self,retired:&crate::opencode::desktop_runtime::NativeWebEngineReadRetired,deadline:Instant)->Result<(),String>{
  if !retired.matches_carrier(self){return Err("different actual retired read owner".into());}
  let mut state=self.state.try_lock().map_err(|_|"original read busy")?;
  if !matches!(state.phase,Phase::Sending|Phase::Held|Phase::Refused|Phase::Reserved){return Err("original checked close already spent or uncertain".into());}
  state.phase=Phase::Closing;
  #[cfg(windows)]state.native.close_once(deadline)?;
  #[cfg(not(windows))]{let _=deadline;return Err("Windows original unavailable".into());}
  #[cfg(windows)]{state.phase=Phase::Closed;Ok(())}
 }
'''
data=replace(data,mark,addition+mark);after[CARRIER]=data
# Grounded reqwest0.12.28 closure: actual Response then final native Client
# owner, on a retained original worker with a real checked JoinHandle.
TRANSPORT='crates/adapters/src/opencode/local_web_transport.rs'
CLOSER='crates/adapters/src/opencode/local_web_transport/closure.rs'
after[CLOSER]=(ROOT/'sources'/CLOSER).read_text()
data=after[TRANSPORT]
data=replace(data,'use std::sync::Arc;','use std::sync::Arc;\nmod closure;\npub(crate) use closure::{RetainedWebTransportClose,NativeWebTransportEnded};')
data=replace(data,' http:Client,request:Option<reqwest::blocking::Request>,',' http:Arc<Client>,request:Option<reqwest::blocking::Request>,')
data=replace(data,'  let mut request=http.request(Method::POST,target);','  let http=Arc::new(http);\n  let mut request=http.request(Method::POST,target);')
after[TRANSPORT]=data
data=after[COMP]
data=replace(data,'{OriginalWebPromptRequest,WebPromptObservation,WebTransportPhase};','{OriginalWebPromptRequest,WebPromptObservation,WebTransportPhase,RetainedWebTransportClose,NativeWebTransportEnded};')
data=replace(data,'read_closed:bool,sender_finished:bool,','read_closed:bool,sender_finished:bool,transport_close:Option<RetainedWebTransportClose>,transport_ended:Option<NativeWebTransportEnded>,')
data=replace(data,'read_closed:false,sender_finished:false})','read_closed:false,sender_finished:false,transport_close:None,transport_ended:None})')
data=replace(data,'   let never_sent=state.outcome.is_none()&&state.request.as_ref().is_none_or(|r|r.observation.phase==WebTransportPhase::Prepared);','''   let prepared=state.request.as_ref().map(|r|&r.observation)
    .or_else(||state.transport_close.as_ref().map(|c|c.observation()));
   let never_sent=state.outcome.is_none()&&prepared.is_none_or(|o|o.phase==WebTransportPhase::Prepared&&o.status.is_none()&&o.body.is_empty());''')
data=replace(data,'   if state.request.is_none(){removed.push(operation.clone());}','   if state.request.is_none()&&state.transport_close.is_none(){removed.push(operation.clone());}')
mark=' pub fn check_empty(&self)->Result<(),String>{'
addition=''' /// Finish the ACTUAL original closer, retaining raw observation separately.
 /// No read-join or engine-tree authority is derived from transport ending.
 pub fn finish_transport_originals_until(&self,deadline:Instant)->Result<(),String>{
  let mut slots=self.slots.lock().map_err(|_|"Original Web registry poisoned")?;
  let mut removed=Vec::new();let mut failed=false;
  for(operation,slot)in slots.iter(){
   if Arc::strong_count(slot)!=1{continue;}
   let mut state=match slot.state.try_lock(){Ok(state)=>state,Err(_)=>{failed=true;continue;}};
   if state.transport_ended.is_none(){
    if state.transport_close.is_none(){
     let Some(request)=state.request.as_ref()else{continue};
     if !state.sender_finished&&request.observation.phase!=WebTransportPhase::Prepared{failed=true;continue;}
     let actual=state.request.take().expect("actual owner observed under same slot lock");
     // Capsule retained BEFORE spawn: errors cannot lose actual Client/Response.
     state.transport_close=Some(RetainedWebTransportClose::retain(actual));
    }
    let completion=state.transport_close.as_mut().expect("actual capsule retained").finish_until(deadline);
    match completion{Ok(Some(ended))=>state.transport_ended=Some(ended),_=>{failed=true;continue;}}
   }
   let ended=state.transport_ended.as_ref().expect("actual join witness retained");
   let capsule=state.transport_close.as_ref().ok_or("Actual transport capsule missing")?;
   if !Arc::ptr_eq(ended.observation(),capsule.observation())
    ||state.outcome.as_ref().is_some_and(|o|!Arc::ptr_eq(&o.observed,ended.observation())){failed=true;continue;}
   if !state.read_closed{continue;}
   let published=match(&state.published,&state.outcome){(Some(p),Some(o))=>p.matches_outcome(o),_=>false};
   let observed=ended.observation();
   let never_sent=state.outcome.is_none()&&observed.phase==WebTransportPhase::Prepared&&observed.status.is_none()&&observed.body.is_empty();
   if published||never_sent{removed.push(operation.clone());}
   // Partial/unknown with no private publication is NOT disposable. Keep exact
   // status/prefix even after real read/transport end for permitted persistence.
  }
  for operation in removed{slots.remove(&operation);}
  if failed{Err("Actual original transport closure remains retained".into())}else{Ok(())}
 }
'''
data=replace(data,mark,addition+mark);after[COMP]=data
SVC=env['SVC'];data=after[SVC]
data=replace(data,'  for outcome in actual.outcomes()?{','  let outcomes=match actual.outcomes(){Ok(outcomes)=>outcomes,Err(_)=>{failed=true;Vec::new()}};\n  for outcome in outcomes{')
data=replace(data,'    Ok(published)=>actual.retain_publication(published)?,Err(_)=>failed=true,','    Ok(published)=>{if actual.retain_publication(published).is_err(){failed=true;}},Err(_)=>failed=true,')
data=replace(data,'  if failed{Err("Actual original Web completions remain retained".into())}else{cleanup}','  let transports=actual.finish_transport_originals_until(deadline);\n  if failed{Err("Actual original Web completions remain retained".into())}else{cleanup.and(transports)}')
after[SVC]=data
patch=[];manifest=[]
for path,post in after.items():
 pre=before.get(path,'')
 if pre==post:continue
 patch.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path if path in before else '/dev/null',tofile='b/'+path))
 manifest.append({'path':path,'preimage_sha256':sha(pre.encode()) if path in before else None,'postimage_sha256':sha(post.encode()),'bytes':len(post.encode()),'additional_preimage_blob':PINNED.get(path)})
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'windows-engine-retirement.patch').write_bytes(raw)
(ROOT/'manifest.json').write_text(json.dumps({'base':BASE,'scope':'source-only Windows actual read-close witness; partial-prefix private persistence STILL OPEN','patch_sha256':sha(raw),'patch_bytes':len(raw),'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(raw),'sha256':sha(raw)}))
