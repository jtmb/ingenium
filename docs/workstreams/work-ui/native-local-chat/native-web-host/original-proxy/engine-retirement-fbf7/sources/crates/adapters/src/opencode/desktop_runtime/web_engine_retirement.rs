//! Opaque original-engine allocation and genuine Windows job-empty witness.
//! No process is stopped here. Existing explicit lifecycle owns termination.
use super::*;
pub(crate) struct NativeWebEngineOriginal{_nonce:uuid::Uuid,admission_closed:AtomicBool}
impl NativeWebEngineOriginal{
 pub(super) fn new()->Self{Self{_nonce:uuid::Uuid::new_v4(),admission_closed:AtomicBool::new(false)}}
 pub(super) fn close_admission(&self){self.admission_closed.store(true,Ordering::Release);}
 pub(super) fn admission_closed(&self)->bool{self.admission_closed.load(Ordering::Acquire)}
}
/// Constructed only after querying the exact retained job and joining workers.
/// No public constructor, Deserialize, metadata/PID/boolean retirement API.
pub(crate) struct NativeWebTreeRetired{
 original:Arc<NativeWebEngineOriginal>,registry:Arc<local_workspaces::web_completion::NativeWebRegistryOriginal>,
}
impl NativeWebTreeRetired{
 pub(super) fn original(&self)->&Arc<NativeWebEngineOriginal>{&self.original}
 pub(super) fn registry(&self)->&Arc<local_workspaces::web_completion::NativeWebRegistryOriginal>{&self.registry}
}
pub(super) fn capture(engine:&mut OwnedEngine,registry:&Arc<local_workspaces::web_completion::NativeWebRegistryOriginal>)->Result<NativeWebTreeRetired,RuntimeError>{
 #[cfg(windows)]{
  // require_local_engine permits this private Windows source only on the
  // Direct non-project owner. Other backends need their actual tree witness.
  if engine.environment!=Environment::Windows||!matches!(&engine.child,isolated_wsl::EngineProcess::Direct(_))
   ||engine.account_scope.is_some()||engine.linux_owner.is_some()||engine.linux_launch.is_some()
   ||engine.monitor_thread.is_some()||engine.event_thread.is_some()||engine.bootstrap_writer.is_some()
   ||engine.credential_transport.is_some(){return Err(RuntimeError::Binding);}
  engine.native_web_workers.require_all()?;
  // A leader exit is necessary but insufficient. This SAME job was assigned
  // to this exact suspended child before resume; all descendants remain owned.
  if engine.child.try_wait().map_err(|_|RuntimeError::Storage)?.is_none(){return Err(RuntimeError::Storage);}
  let job=engine.process_job.as_ref().ok_or(RuntimeError::Storage)?;
  if !job.is_empty().map_err(|_|RuntimeError::Storage)?{return Err(RuntimeError::Storage);}
  if let Some(relay)=engine.model_relay.as_ref(){relay.check_stopped().map_err(|_|RuntimeError::Storage)?;}
  Ok(NativeWebTreeRetired{original:engine.native_web_original.clone(),registry:registry.clone()})
 }
 #[cfg(not(windows))]{let _=(engine,registry);Err(RuntimeError::Binding)}
}

#[derive(Clone,Copy,PartialEq,Eq)]enum JoinState{NeverStarted,Pending,Joined,Failed}
pub(super) struct WorkerOriginal{state:JoinState}
impl WorkerOriginal{
 fn never_started()->Self{Self{state:JoinState::NeverStarted}}
 fn begin(&mut self)->Result<(),RuntimeError>{
  if self.state!=JoinState::NeverStarted{return Err(RuntimeError::Storage);}
  self.state=JoinState::Pending;Ok(())
 }
 fn no_handle(&mut self)->Result<(),RuntimeError>{
  match self.state{JoinState::NeverStarted|JoinState::Joined=>Ok(()),_=>{self.state=JoinState::Failed;Err(RuntimeError::Storage)}}
 }
 fn join_unit(&mut self,handle:JoinHandle<()>)->Result<(),RuntimeError>{
  let pending=self.state==JoinState::Pending;self.state=JoinState::Failed;
  match handle.join(){Ok(()) if pending=>{self.state=JoinState::Joined;Ok(())},_=>Err(RuntimeError::Storage)}
 }
 fn join_bootstrap(&mut self,handle:JoinHandle<std::io::Result<()>>)->Result<(),RuntimeError>{
  let pending=self.state==JoinState::Pending;self.state=JoinState::Failed;
  match handle.join(){Ok(Ok(())) if pending=>{self.state=JoinState::Joined;Ok(())},_=>Err(RuntimeError::Storage)}
 }
}
pub(super) enum WorkerRole{Monitor,Event}
pub(super) struct WorkerOriginals{monitor:WorkerOriginal,event:WorkerOriginal,bootstrap:WorkerOriginal}
impl WorkerOriginals{
 pub(super) fn new(bootstrap:Option<&JoinHandle<std::io::Result<()>>>)->Self{
  Self{monitor:WorkerOriginal::never_started(),event:WorkerOriginal::never_started(),bootstrap:WorkerOriginal{state:if bootstrap.is_some(){JoinState::Pending}else{JoinState::NeverStarted}}}
 }
 pub(super) fn begin(&mut self,role:WorkerRole)->Result<(),RuntimeError>{match role{WorkerRole::Monitor=>self.monitor.begin(),WorkerRole::Event=>self.event.begin()}}
 pub(super) fn join_monitor(&mut self,handle:Option<JoinHandle<()>>)->Result<(),RuntimeError>{match handle{Some(handle)=>self.monitor.join_unit(handle),None=>self.monitor.no_handle()}}
 pub(super) fn join_event(&mut self,handle:Option<JoinHandle<()>>)->Result<(),RuntimeError>{match handle{Some(handle)=>self.event.join_unit(handle),None=>self.event.no_handle()}}
 pub(super) fn join_bootstrap(&mut self,handle:Option<JoinHandle<std::io::Result<()>>>)->Result<(),RuntimeError>{match handle{Some(handle)=>self.bootstrap.join_bootstrap(handle),None=>self.bootstrap.no_handle()}}
 pub(super) fn require_all(&self)->Result<(),RuntimeError>{
  if [&self.monitor,&self.event,&self.bootstrap].iter().all(|w|matches!(w.state,JoinState::NeverStarted|JoinState::Joined)){Ok(())}else{Err(RuntimeError::Storage)}
 }
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn failed_real_join_then_stop_retry_stays_failed(){
  let mut original=WorkerOriginal::never_started();original.begin().unwrap();
  let handle=thread::spawn(||panic!("bounded worker join fault fixture"));
  assert!(original.join_unit(handle).is_err());assert!(original.no_handle().is_err());assert!(original.begin().is_err());
  assert!(matches!(original.state,JoinState::Failed));
 }
 #[test]fn bootstrap_io_failure_does_not_become_joined_after_handle_consumption(){
  let mut original=WorkerOriginal::never_started();original.begin().unwrap();
  let handle=thread::spawn(||Err(std::io::Error::other("bounded bootstrap fault fixture")));
  assert!(original.join_bootstrap(handle).is_err());assert!(original.no_handle().is_err());
 }
 #[test]fn pending_missing_handle_is_failed_not_never_started(){
  let mut original=WorkerOriginal::never_started();original.begin().unwrap();assert!(original.no_handle().is_err());
  assert!(original.no_handle().is_err());
 }
 #[test]fn actual_join_success_and_genuine_never_started_are_distinct_terminal_states(){
  let mut original=WorkerOriginal::never_started();original.no_handle().unwrap();assert!(matches!(original.state,JoinState::NeverStarted));
  original.begin().unwrap();original.join_unit(thread::spawn(||())).unwrap();original.no_handle().unwrap();assert!(matches!(original.state,JoinState::Joined));
  assert!(original.begin().is_err());
 }
}
