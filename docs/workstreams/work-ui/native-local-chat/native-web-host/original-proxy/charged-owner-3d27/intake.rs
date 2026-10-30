// Insert as child of local_workspaces::web_original; re-export NativeWebIntake.
use super::*;
use crate::native_web_payload::{Buffer,Payload};
const INTAKE_LIMIT:usize=16*1024*1024; // preserve current limit; 20MiB gate OPEN
pub struct NativeWebIntake{
 body:Buffer,engine:Arc<super::super::super::web_engine_retirement::NativeWebEngineOriginal>,
 binding:String,epoch:String,complete:bool,failed:bool,
}
impl NativeWebIntake{
 // Authenticated host reserves BEFORE its first poll of the received HTTP Body.
 pub fn append_frame(&mut self,bytes:&[u8])->Result<(),String>{
  if self.complete||self.failed{return Err("Original intake unavailable".into())}
  // Mark failure BEFORE copying; refusal retains the actual earlier prefix.
  self.failed=true;
  if self.body.len().checked_add(bytes.len()).is_none_or(|n|n>INTAKE_LIMIT){return Err("Original intake limit".into())}
  self.body.append(bytes).map_err(|_|"Original charged destination unavailable")?;
  self.failed=false;Ok(())
 }
 pub fn received_eof(&mut self)->Result<(),String>{if self.failed||self.complete{return Err("Original intake incomplete".into())}self.complete=true;Ok(())}
 pub fn received_failure(&mut self){self.failed=true;}
 pub fn retained_prefix(&self)->&[u8]{self.body.as_ref()}
}
impl LiveRuntime{
 pub fn begin_local_web_intake(&self,lease:&LocalWebLease,current:&dyn Fn()->Result<(),String>)->Result<NativeWebIntake,RuntimeError>{
  self.check_local_web_lease(lease,current)?;
  let body=self.native_web_completions.payload_pool.allocate(INTAKE_LIMIT+1).map_err(|_|RuntimeError::AdmissionPending)?;
  self.check_local_web_lease(lease,current)?;
  Ok(NativeWebIntake{body,engine:lease.native_engine_original.clone(),binding:lease.binding_id.clone(),epoch:lease.invalidation_epoch.clone(),complete:false,failed:false})
 }
 pub(super) fn take_local_web_intake(&self,lease:&LocalWebLease,intake:NativeWebIntake)->Result<Payload,RuntimeError>{
  if intake.failed||!intake.complete||!Arc::ptr_eq(&intake.engine,&lease.native_engine_original)
   ||intake.binding!=lease.binding_id||intake.epoch!=lease.invalidation_epoch{return Err(RuntimeError::Binding)}
  let body=intake.body.freeze();
  if !body.belongs_to(&self.native_web_completions.payload_pool){return Err(RuntimeError::Binding)}
  Ok(body)
 }
}
