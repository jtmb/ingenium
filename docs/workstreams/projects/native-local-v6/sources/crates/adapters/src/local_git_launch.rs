//! Separately typed private launch scope over the original failed-launch ledger.
use crate::{local_execution::LocalWorkspaceBinding,owned_process_job::OwnedProcessJob};
use std::{sync::{Arc,atomic::{AtomicBool,Ordering}},time::Instant,process::{Command,Child}};
/// Retain before spawn_once. Caller JSON cannot construct or select this scope.
pub struct LocalGitLaunch{scope:String,binding:Arc<LocalWorkspaceBinding>,attempted:AtomicBool}
impl LocalGitLaunch{
 pub fn prepare(binding:Arc<LocalWorkspaceBinding>)->Arc<Self>{
  Arc::new(Self{scope:uuid::Uuid::new_v4().to_string(),binding,attempted:AtomicBool::new(false)})
 }
 #[cfg(windows)]
 pub fn spawn_once(&self,command:&mut Command)->Result<(Child,OwnedProcessJob),String>{
  self.binding.verify()?;
  if self.attempted.swap(true,Ordering::AcqRel){return Err("original private Git launch consumed".into());}
  OwnedProcessJob::spawn_scoped(command,&self.scope)
 }
 #[cfg(windows)]
 pub fn finish_until(&self,deadline:Instant)->Result<(),String>{
  crate::owned_process_job::finish_failed_scope_until(&self.scope,deadline)
 }
}
