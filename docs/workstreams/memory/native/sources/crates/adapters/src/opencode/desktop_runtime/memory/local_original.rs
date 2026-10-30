use super::*;
use crate::local_execution::LocalWorkspaceBinding;
use crate::opencode::attachments::PromptFile;
use veyra_contracts::{LocalPromptOriginal,local_workspaces::{LocalOperation,LocalOperationRequest}};
/// The original prompt-admissions writer persists this together with message ID
/// and Intent before the sole upstream effect. No new ledger or transcript.
pub(in crate::opencode::desktop_runtime) fn capture(
 runtime:&LiveRuntime,engine:&OwnedEngine,binding:&LocalWorkspaceBinding,current:&dyn Fn()->Result<(),String>,
 before:&EngineSession,request_id:&str,text:&str,files:&[PromptFile],skills:&[String],require_idle:bool,
)->Result<LocalPromptOriginal,RuntimeError>{
 local_workspaces::require_local_engine(engine,binding,current)?;
 if before.location.directory!=binding.directory(){return Err(RuntimeError::Binding)}
 let request=LocalOperationRequest{request_id:request_id.into(),owner:binding.owner().clone(),
  operation:LocalOperation::AgentTurn{session_id:before.id.clone(),text:text.into()}};
 let original=LocalPromptOriginal{
  operation_request_sha256:fingerprint(&request).map_err(|_|RuntimeError::Binding)?,
  request,engine_revision:runtime.credentials_revision(),
  engine_instance_id:task_permissions::current_engine_instance_id(engine)?,
  engine_project_id:before.project_id.clone(),session:json!(before),model:json!(engine.model),
  effective_text_sha256:content_hash(text),files:json!(files),skill_ids:skills.to_vec(),
  // Frozen AgentTurn supplies no memory field. This original records that
  // actual absence; later recall requires a separately reviewed original input.
  memory:Value::Null,require_idle,
 };
 local_workspaces::require_local_engine(engine,binding,current)?;Ok(original)
}
