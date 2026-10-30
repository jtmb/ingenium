//! Original Windows handles retained beyond capture, never a JSON/path lease.
//! Only the same-engine raw sender may move Held -> Sending -> Joined.
use super::*;
use std::{sync::Mutex,time::Instant};
#[cfg(windows)]mod native;
#[derive(Clone,Copy,PartialEq,Eq)]enum Phase{Reserved,Acquiring,Held,Sending,Joined,Closing,Closed,Refused}
#[derive(Clone,PartialEq,Eq)]struct Scope{owner:LocalWorkspaceOwner,directory:String,session:String,operation:String,input_sha256:String,engine_epoch:String}
struct State{phase:Phase,#[cfg(windows)]native:native::Held}
pub(crate) struct RetainedWindowsWebRead{scope:Scope,deadline:Instant,state:Mutex<State>}
impl RetainedWindowsWebRead{
 /// Internal owner-only constructor. The original service inventory owns the
 /// Arc BEFORE first OS open; no raw path, claimed PID or snapshot creates it.
 pub(crate) fn reserve(binding:&LocalWorkspaceBinding,session:&str,operation:&str,input_sha256:&str,engine_epoch:&str,deadline:Instant)->Result<Arc<Self>,String>{
  if binding.owner.environment!=LocalEnvironment::Windows||session.is_empty()||[engine_epoch,input_sha256].iter().any(|v|v.len()!=64||!v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))
   ||!uuid::Uuid::parse_str(operation).is_ok_and(|v|!v.is_nil()&&v.to_string()==operation){return Err("original Windows read scope unavailable".into());}
  if Instant::now()>=deadline{return Err("original read deadline elapsed".into());}
  binding.verify()?;
  let value=Arc::new(Self{scope:Scope{owner:binding.owner.clone(),directory:binding.directory.clone(),session:session.into(),operation:operation.into(),input_sha256:input_sha256.into(),engine_epoch:engine_epoch.into()},deadline,state:Mutex::new(State{phase:Phase::Reserved,#[cfg(windows)]native:native::Held::default()})});
  #[cfg(windows)]{
   let originals=binding.installation.originals();let mut inventory=originals.web_reads.try_lock().map_err(|_|"original file inventory busy")?;
   if inventory.len()>=128||inventory.iter().any(|v|v.scope.operation==operation||!v.is_closed()){return Err("original read already retained or inventory full".into());}
   inventory.push(value.clone());return Ok(value);
  }
  #[cfg(not(windows))]{let _=value;Err("original URI read sharing requires Windows backend".into())}
 }
 pub(crate) fn capture(&self,binding:&LocalWorkspaceBinding,absolute_files:&[String],inline_bytes:usize,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  current()?;binding.verify()?;self.matches(binding)?;
  if absolute_files.len()>32||inline_bytes>crate::attachments::MAX_BATCH_BYTES{return Err("original file count bound".into());}
  let mut state=self.state.try_lock().map_err(|_|"original read busy")?;
  if state.phase!=Phase::Reserved{return Err("original read cannot be reacquired".into());}state.phase=Phase::Acquiring;
  #[cfg(windows)]let result=state.native.capture(binding,absolute_files,crate::attachments::MAX_BATCH_BYTES-inline_bytes,&||{if Instant::now()>=self.deadline{return Err("original acquisition deadline".into());}current()});
  #[cfg(not(windows))]let result={let _=(absolute_files,inline_bytes);Err("Windows original unavailable".into())};
  state.phase=if result.is_ok(){Phase::Held}else{Phase::Refused};result?;
  drop(state);current()?;binding.verify()
 }
 fn matches(&self,binding:&LocalWorkspaceBinding)->Result<(),String>{
  if self.scope.owner!=binding.owner||self.scope.directory!=binding.directory{return Err("original read owner changed".into());}Ok(())
 }
 pub(crate) fn check(&self,binding:&LocalWorkspaceBinding,session:&str,operation:&str,input_sha256:&str,engine_epoch:&str,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  current()?;binding.verify()?;self.matches(binding)?;
  if self.scope.session!=session||self.scope.operation!=operation||self.scope.input_sha256!=input_sha256||self.scope.engine_epoch!=engine_epoch{return Err("original read dispatch changed".into());}
  let state=self.state.try_lock().map_err(|_|"original read busy")?;
  if Instant::now()>=self.deadline{return Err("original dispatch deadline; retain sent uncertainty".into());}
  if !matches!(state.phase,Phase::Held|Phase::Sending){return Err("original read not held".into());}
  #[cfg(windows)]state.native.check()?;
  current()
 }
 /// Internal single-send transition; Root's actual sender MUST call it only
 /// after the same-writer original fence and final retained-engine check.
 pub(crate) fn begin_send(&self)->Result<(),String>{
  let mut state=self.state.try_lock().map_err(|_|"original read busy")?;
  if state.phase!=Phase::Held||Instant::now()>=self.deadline{return Err("original send already spent or expired".into());}
  state.phase=Phase::Sending;Ok(())
 }
 /// Deliberately NO public or crate-wide mark-joined API, callback, boolean or
 /// DTO proof. Root's actual request-owner adapter must compose the typed join.
 /// Until that exact private adapter lands, Sending stays retained and blocks
 /// retirement. This carrier alone grants no dispatch/ACK acceptance.
 pub(crate) fn retire_never_sent(&self,deadline:Instant)->Result<(),String>{
  let mut state=self.state.try_lock().map_err(|_|"original read busy")?;
  if !matches!(state.phase,Phase::Reserved|Phase::Held|Phase::Refused){return Err("sent/uncertain original needs actual join".into());}
  state.phase=Phase::Closing;
  #[cfg(windows)]state.native.close_once(deadline)?;
  #[cfg(not(windows))]let _=deadline;
  state.phase=Phase::Closed;Ok(())
 }
 pub(crate) fn visit_sources(&self,visit:&mut dyn FnMut(usize,&str,&[u8],&str)->Result<(),String>)->Result<(),String>{
  let state=self.state.try_lock().map_err(|_|"original source inventory busy")?;
  if state.phase!=Phase::Held{return Err("source evidence must be journaled before send".into());}
  #[cfg(windows)]for (index,source) in state.native.sources.iter().enumerate(){visit(index,&source.absolute,&source.bytes,&source.mime)?;}
  #[cfg(not(windows))]{let _=visit;return Err("Windows source inventory unavailable".into());}
  #[cfg(windows)]Ok(())
 }
 pub(crate) fn contains_image(&self)->Result<bool,String>{
  let state=self.state.try_lock().map_err(|_|"original read busy")?;
  if state.phase!=Phase::Held{return Err("original read not captured".into());}
  #[cfg(windows)]return Ok(state.native.sources.iter().any(|source|source.mime.starts_with("image/")));
  #[cfg(not(windows))]Err("Windows original unavailable".into())
 }
 pub(crate) fn is_closed(&self)->bool{self.state.try_lock().is_ok_and(|s|s.phase==Phase::Closed)}
}

#[cfg(test)]mod tests{
 use super::*;use std::time::Duration;
 // Internal empty-handle state fixtures test ownership protocol only. They do
 // not construct an OS binding, perform a read, or prove Windows containment.
 fn fixture(phase:Phase,expired:bool)->RetainedWindowsWebRead{
  RetainedWindowsWebRead{scope:Scope{owner:LocalWorkspaceOwner{installation_id:"11111111-1111-4111-8111-111111111111".into(),custodian_key:"fixture-no-os-authority".into(),workspace_id:"22222222-2222-4222-8222-222222222222".into(),revision:0,service_instance_id:"fixture".into(),environment:LocalEnvironment::Windows},directory:"fixture-no-path".into(),session:"ses_fixture".into(),operation:"33333333-3333-4333-8333-333333333333".into(),input_sha256:"a".repeat(64),engine_epoch:"b".repeat(64)},deadline:if expired{Instant::now()-Duration::from_secs(1)}else{Instant::now()+Duration::from_secs(30)},state:Mutex::new(State{phase,#[cfg(windows)]native:native::Held::default()})}
 }
 #[test]fn unknown_send_keeps_original_even_when_operation_deadline_elapsed(){
  for expired in [false,true]{let value=fixture(Phase::Sending,expired);assert!(value.retire_never_sent(Instant::now()+Duration::from_secs(1)).is_err());assert!(!value.is_closed());assert!(matches!(value.state.lock().unwrap().phase,Phase::Sending));assert!(value.begin_send().is_err());}
 }
 #[test]fn expired_unsent_original_cannot_send_but_can_retire_its_own_empty_inventory(){
  let value=fixture(Phase::Held,true);assert!(value.begin_send().is_err());value.retire_never_sent(Instant::now()+Duration::from_secs(1)).unwrap();assert!(value.is_closed());assert!(value.begin_send().is_err());
 }
 #[test]fn duplicate_begin_does_not_create_second_dispatch_or_unsent_cleanup(){
  let value=fixture(Phase::Held,false);value.begin_send().unwrap();assert!(value.begin_send().is_err());assert!(value.retire_never_sent(Instant::now()+Duration::from_secs(1)).is_err());assert!(!value.is_closed());
 }
 #[test]fn closing_uncertainty_never_retries_or_turns_into_closed_metadata(){
  let value=fixture(Phase::Closing,false);assert!(value.retire_never_sent(Instant::now()+Duration::from_secs(1)).is_err());assert!(!value.is_closed());assert!(value.begin_send().is_err());
 }
}
