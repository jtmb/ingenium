//! The original NT capture/checked-close machinery, without any Project value.
use super::*;
use std::sync::{Arc,Mutex};
struct State{capture:Capture,phase:u8,checks:usize}
pub struct PrivateRootCustody{root:String,plans:Vec<Plan>,first_deadline:Instant,state:Mutex<State>}
impl PrivateRootCustody{
 pub fn prepare(root:&str,deadline:Instant)->Result<Arc<Self>,WorkspaceError>{
  live(deadline)?;
  Ok(Arc::new(Self{root:root.into(),plans:vec![Plan{project:0,names:names(root)?}],
   first_deadline:deadline,state:Mutex::new(State{capture:Capture::default(),phase:0,checks:0})}))
 }
 /// The retaining service carrier must own this Arc BEFORE invocation.
 pub fn capture_once(&self)->Result<(),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase!=0{return Err(WorkspaceError::Consumed);}state.phase=3;
  #[cfg(windows)] {state.capture.acquire_private(&self.plans,self.first_deadline)?;state.phase=1;Ok(())}
  #[cfg(not(windows))] {Err(WorkspaceError::Unsupported)}
 }
 /// Each new bounded observation retains its own immutable native query outputs.
 /// No old acquisition/query deadline or completed original is reset.
 pub fn observe(&self,deadline:Instant)->Result<(String,String),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase!=1||state.checks!=0{return Err(WorkspaceError::Capacity);}
  state.checks+=1;state.phase=3;
  #[cfg(windows)] {
   state.capture.observe_task(deadline.min(self.first_deadline))?;
   let (file,identity)=state.capture.private_root()?;
   crate::windows_acl::verify_owner_only(file,crate::windows_acl::ProtectedAclKind::Directory).map_err(|_|WorkspaceError::Unknown)?;
   let subject=crate::windows_acl::owner_sid().map_err(|_|WorkspaceError::Unknown)?;
   let physical=serde_json::to_string(&identity).map_err(|_|WorkspaceError::Unknown)?;
   state.phase=1;Ok((subject,physical))
  }
  #[cfg(not(windows))] {Err(WorkspaceError::Unsupported)}
 }
 pub fn verify_pinned(&self)->Result<(String,String),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase!=1||state.checks!=1{return Err(WorkspaceError::Unknown);}
  state.phase=3;
  #[cfg(windows)] {
   let (file,identity)=state.capture.pinned_private_root()?;
   crate::windows_acl::verify_owner_only(file,crate::windows_acl::ProtectedAclKind::Directory).map_err(|_|WorkspaceError::Unknown)?;
   let subject=crate::windows_acl::owner_sid().map_err(|_|WorkspaceError::Unknown)?;
   let physical=serde_json::to_string(&identity).map_err(|_|WorkspaceError::Unknown)?;
   state.phase=1;Ok((subject,physical))
  }
  #[cfg(not(windows))] {Err(WorkspaceError::Unsupported)}
 }
 pub fn retire_once(&self,deadline:Instant)->Result<(),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase==2{return Ok(());}if state.phase==4{return Err(WorkspaceError::Unknown);}
  state.phase=4;
  #[cfg(windows)] {
   if state.capture.never_invoked(){state.phase=2;return Ok(());}
   state.capture.retire(deadline)?;
   if !state.capture.closed(){return Err(WorkspaceError::Unknown);}
   state.phase=2;Ok(())
  }
  #[cfg(not(windows))] {Err(WorkspaceError::Unsupported)}
 }
 pub fn root(&self)->&str{&self.root}
}

/// One bounded physical namespace separation, with no invented Project.
/// All actual Project roots share group1; only protected group0 is compared.
pub struct NativeRootSeparation{plans:Vec<Plan>,deadline:Instant,state:Mutex<State>}
impl NativeRootSeparation{
 pub fn prepare(protected:&str,other:&[String],deadline:Instant)->Result<Arc<Self>,WorkspaceError>{
  live(deadline)?;
  if other.len()>128{return Err(WorkspaceError::Capacity);}
  let mut plans=vec![Plan{project:0,names:names(protected)?}];
  for root in other{plans.push(Plan{project:1,names:names(root)?});}
  if plans.iter().map(|p|p.names.len()).sum::<usize>()>4096{return Err(WorkspaceError::Capacity);}
  Ok(Arc::new(Self{plans,deadline,state:Mutex::new(State{capture:Capture::default(),phase:0,checks:0})}))
 }
 pub fn check_once(&self)->Result<(),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase!=0{return Err(WorkspaceError::Consumed);}state.phase=3;
  #[cfg(windows)] {state.capture.acquire(&self.plans,self.deadline)?;state.capture.verify(self.deadline)?;state.phase=1;Ok(())}
  #[cfg(not(windows))] {Err(WorkspaceError::Unsupported)}
 }
 pub fn retire_once(&self,deadline:Instant)->Result<(),WorkspaceError>{
  let mut state=self.state.try_lock().map_err(|_|WorkspaceError::Unknown)?;
  if state.phase==2{return Ok(());}if state.phase==4{return Err(WorkspaceError::Unknown);}state.phase=4;
  #[cfg(windows)]{
   if state.capture.never_invoked(){state.phase=2;return Ok(());}
   state.capture.retire(deadline)?;
   if !state.capture.closed(){return Err(WorkspaceError::Unknown);}state.phase=2;Ok(())
  }
  #[cfg(not(windows))]{Err(WorkspaceError::Unsupported)}
 }
}
