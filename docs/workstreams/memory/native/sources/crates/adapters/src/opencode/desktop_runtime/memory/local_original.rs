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
impl LiveRuntime{
 /// Original-journal read only. Never consult a later engine, dispatch, replay,
 /// mutate a PromptRecord or infer admission from transcript/status/idle.
 pub fn local_prompt_original_receipt(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str,request:&str)->Result<Option<Value>,RuntimeError>{
  if !uuid::Uuid::parse_str(request).is_ok_and(|id|!id.is_nil()&&id.to_string()==request){return Err(RuntimeError::Binding)}
  let binding=owner.private_binding().ok_or(RuntimeError::Binding)?;
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  let mut records=self.prompts.lock().map_err(|_|RuntimeError::Storage)?;
  if records.is_none(){*records=Some(load_prompt_records(&self.storage.join("prompt-admissions.json"))?)}
  let Some(record)=records.as_ref().and_then(|all|all.get(request)) else{return Ok(None)};
  let original=record.local_original.as_ref().ok_or(RuntimeError::Binding)?;
  if record.original.is_some()||record.session_id!=chat||original.request.request_id!=request||
     original.request.owner.installation_id!=binding.owner().installation_id||
     original.request.owner.custodian_key!=binding.owner().custodian_key||
     original.request.owner.workspace_id!=binding.owner().workspace_id||
     original.request.owner.environment!=binding.owner().environment||
     !matches!(&original.request.operation,LocalOperation::AgentTurn{session_id,..} if session_id==chat)||
     fingerprint(&original.request).map_err(|_|RuntimeError::Binding)?!=original.operation_request_sha256{return Err(RuntimeError::Binding)}
  // Current custody authorizes this read of the old original; it never adopts
  // the old service/engine epoch or gives the old request new execution rights.
  let admission=match record.state{PromptState::Admitted=>"admitted",PromptState::Rejected=>"rejected",_=>"uncertain"};
  let value=json!({"request_id":request,"session_id":chat,"message_id":record.message_id,
   "request_sha256":original.operation_request_sha256,"original":original,
   "admission":admission,"state":if admission=="uncertain"{"unknown"}else{admission}});
  if serde_json::to_vec(&value).map_err(|_|RuntimeError::Storage)?.len()>4*1024*1024{return Err(RuntimeError::Binding)}
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  Ok(Some(value))
 }
}
