//! Real retained-engine acquisition for original Windows URI reads.
//! No raw forwarding, write callback, copied ACK proof or generic IPC endpoint.
use super::*;
use crate::local_execution::windows_web_read::RetainedWindowsWebRead;
use crate::opencode::attachments::web_files::windows_inputs::inspect_windows_inputs;
use sha2::{Digest,Sha256};
use std::time::{Duration,Instant};
pub struct NativeWindowsWebRead{
 held:Arc<RetainedWindowsWebRead>,original:OriginalEngine,engine_key:String,
 binding_id:String,invalidation_epoch:String,operation:String,input_sha256:String,
}
fn key(original:&OriginalEngine,session:&EngineSession,engine:&OwnedEngine)->Result<String,RuntimeError>{
 let bytes=serde_json::to_vec(&(original,&session.model,&session.agent,&engine.model.id,&engine.model.quant,engine.model.context,&engine.model.variant,engine.model.vision)).map_err(|_|RuntimeError::Storage)?;
 Ok(format!("{:x}",Sha256::digest(bytes)))
}
fn actual_session(engine:&OwnedEngine,lease:&LocalWebLease,current:&dyn Fn()->Result<(),String>)->Result<EngineSession,RuntimeError>{
 require_local_engine(engine,&lease.binding,current)?;
 let session=engine.client()?.session_in_project(lease.session_id(),&SessionQuery{directory:lease.binding.directory().into(),..SessionQuery::default()})?;
 let model=session.model.as_ref().ok_or_else(local_error)?;let agent=session.agent.as_deref().ok_or_else(local_error)?;
 if session.id!=lease.session_id()||session.location.directory!=lease.binding.directory()||session.project_id!=lease.original.project_id
  ||model.id!=engine.model.id||model.provider_id!=provider_config::PROVIDER_ID||model.variant.as_deref()!=Some(engine.model.variant.as_str())
  ||task_permissions::managed_profile(agent).is_some()||!engine.client()?.agents(lease.binding.directory())?.iter().any(|a|a.id==agent&&a.mode=="primary"&&!a.hidden){return Err(local_error());}
 require_local_engine(engine,&lease.binding,current)?;Ok(session)
}
impl LiveRuntime{
 /// Current Native8MiB/32-file bounds remain in force. This returns a genuine
 /// held-chain original but NOT a dispatch permit. Root/Work1 must supply the
 /// actual journal token + same-engine joined-request adapter before mounting.
 pub fn hold_local_windows_web_read(&self,lease:&LocalWebLease,original:&NativeWebOriginal,current:&dyn Fn()->Result<(),String>)->Result<NativeWindowsWebRead,RuntimeError>{
  let inspection=self.inspect_local_web_prompt(lease,original,current)?;
  if lease.owner().environment!=veyra_contracts::local_workspaces::LocalEnvironment::Windows{return Err(local_error());}
  let engine=self.lock_engine_for_directory(lease.binding.directory())?;
  let observed=observe(&engine,&lease.binding,lease.session_id(),self.credentials_revision(),current)?;
  if observed!=lease.original||original.engine!=observed||original.binding_id!=lease.binding_id||original.invalidation_epoch!=lease.invalidation_epoch||lease.revoked(){return Err(local_error());}
  let session=actual_session(&engine,lease,current)?;self.enforce_custom_assistant_session(&engine,&session)?;
  let prompt:Value=serde_json::from_slice(original.body()).map_err(|_|local_error())?;
  let inputs=inspect_windows_inputs(&prompt,lease.binding.directory()).map_err(|_|local_error())?;
  let agent=session.agent.as_deref().ok_or_else(local_error)?;
  if self.presentation_record(lease.session_id())?.archived||prompt.get("metadata").and_then(|v|v.get("agent")).is_some_and(|v|v.as_str()!=Some(agent)){return Err(local_error());}
  if let Some(selected)=prompt.get("metadata").and_then(|v|v.get("model")){
   if selected.get("modelID").and_then(Value::as_str)!=Some(engine.model.id.as_str())||selected.get("providerID").and_then(Value::as_str)!=Some(provider_config::PROVIDER_ID)
    ||selected.get("variant").is_some_and(|v|v.as_str()!=Some(engine.model.variant.as_str())){return Err(local_error());}
  }
  references::validate_skills(engine.client()?,lease.binding.directory(),&inspection.skill_ids)?;
  let engine_key=key(&observed,&session,&engine)?;
  let held=RetainedWindowsWebRead::reserve(&lease.binding,lease.session_id(),original.operation_id(),original.input_sha256(),&engine_key,Instant::now()+Duration::from_secs(30)).map_err(|_|local_error())?;
  let acquired=(||{
   held.capture(&lease.binding,&inputs.absolute_files,inputs.inline_bytes,current).map_err(|_|local_error())?;
   if !engine.model.vision&&(inputs.inline_image||held.contains_image().map_err(|_|local_error())?){return Err(RuntimeError::Unavailable("The loaded model does not support image input"));}
   held.check(&lease.binding,lease.session_id(),original.operation_id(),original.input_sha256(),&engine_key,current).map_err(|_|local_error())?;
   if self.credentials_revision()!=lease.original.revision||lease.revoked()||key(&observed,&actual_session(&engine,lease,current)?,&engine)?!=engine_key{return Err(local_error());}
   Ok(())
  })();
  if let Err(error)=acquired{
   // This constructor never sent HTTP. Cleanup is allowed only in its actual
   // never-sent phase; a failed checked close remains in original inventory.
   let _=held.retire_never_sent(Instant::now()+Duration::from_secs(3));return Err(error);
  }
  Ok(NativeWindowsWebRead{held,original:observed,engine_key,binding_id:lease.binding_id.clone(),invalidation_epoch:lease.invalidation_epoch.clone(),operation:original.operation_id().into(),input_sha256:original.input_sha256().into()})
 }
 pub fn check_local_windows_web_read(&self,lease:&LocalWebLease,original:&NativeWebOriginal,read:&NativeWindowsWebRead,current:&dyn Fn()->Result<(),String>)->Result<(),RuntimeError>{
  self.inspect_local_web_prompt(lease,original,current)?;
  let engine=self.lock_engine_for_directory(lease.binding.directory())?;
  let observed=observe(&engine,&lease.binding,lease.session_id(),self.credentials_revision(),current)?;
  let session=actual_session(&engine,lease,current)?;
  if read.original!=observed||observed!=lease.original||read.binding_id!=lease.binding_id||read.invalidation_epoch!=lease.invalidation_epoch
   ||read.operation!=original.operation_id()||read.input_sha256!=original.input_sha256()||key(&observed,&session,&engine)?!=read.engine_key
   ||self.credentials_revision()!=lease.original.revision||lease.revoked(){return Err(local_error());}
  read.held.check(&lease.binding,lease.session_id(),&read.operation,&read.input_sha256,&read.engine_key,current).map_err(|_|local_error())
 }
 /// Read-only evidence visitor for the EXISTING private allocation7 writer.
 /// The sink result grants no dispatch/join/release permission. Caller uses
 /// nonblocking original-store lock order and rolls back on any final refusal.
 pub fn visit_local_windows_read_sources(&self,lease:&LocalWebLease,original:&NativeWebOriginal,read:&NativeWindowsWebRead,current:&dyn Fn()->Result<(),String>,visit:&mut dyn FnMut(usize,&str,&[u8],&str)->Result<(),String>)->Result<(),RuntimeError>{
  self.check_local_windows_web_read(lease,original,read,current)?;
  read.held.visit_sources(visit).map_err(|_|local_error())?;
  self.check_local_windows_web_read(lease,original,read,current)
 }

}
