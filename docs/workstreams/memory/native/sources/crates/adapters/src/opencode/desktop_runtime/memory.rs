use super::*;
use crate::{native_memory_owner::NativeMemoryOwner,projects::ProjectStore};
use veyra_memory::{ExecutionStamp,CompletedMessage,SourceRef,Role,content_hash,fingerprint};
impl LiveRuntime {
 fn memory_stamp_locked(&self,engine:&OwnedEngine,owner:&NativeMemoryOwner,session:&EngineSession)->Result<ExecutionStamp,RuntimeError>{
  engine.ensure_directory(owner.directory())?;
  if matches!(&engine.environment,Environment::Wsl{user:None,..})||
     fingerprint(&engine.environment).map_err(|_|RuntimeError::Binding)?!=owner.scope().execution_id{return Err(RuntimeError::Binding)}
  if session.location.directory!=owner.directory(){return Err(RuntimeError::Binding)}
  Ok(ExecutionStamp{scope:owner.scope().clone(),binding_revision:owner.revision(),service_instance_id:owner.instance().into(),
   engine_instance_id:task_permissions::current_engine_instance_id(engine)?,engine_revision:self.credentials_revision(),
   engine_project_id:session.project_id.clone(),directory:owner.directory().into()})
 }
 pub fn memory_current_stamp(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<ExecutionStamp,RuntimeError>{
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  let stamp=self.memory_stamp_locked(&engine,owner,&session)?;
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;Ok(stamp)
 }
 /// Read one bounded latest page; never follow cursor or use context/history().
 pub fn memory_recent(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<(ExecutionStamp,Vec<CompletedMessage>),RuntimeError>{
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  let stamp=self.memory_stamp_locked(&engine,owner,&session)?;
  // ROOT RECONCILIATION GATE: this provisional call names the superseded
  // memory-specific client proposal. Replace with Projects' actual frozen ONE
  // scoped bounded-recent export before Native apply/build. Preserve <=32,
  // latest-desc first page only, canonical conversion and chronological output.
  // No duplicate OpenCodeClient implementation is supplied by memory.
  let messages=engine.client()?.memory_recent(chat)?;
  let selected=self.memory_pairs(owner,&stamp,chat,&messages)?;
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;
  if self.memory_stamp_locked(&engine,owner,&session)?!=stamp{return Err(RuntimeError::Binding)}
  Ok((stamp,selected))
 }
 /// Re-read EXACT selected canonical message IDs; unrelated later turns are allowed.
 pub fn memory_refresh(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str,ids:&[String])->Result<(ExecutionStamp,Vec<CompletedMessage>),RuntimeError>{
  if ids.is_empty()||ids.len()>32{return Err(RuntimeError::Binding)}
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  let stamp=self.memory_stamp_locked(&engine,owner,&session)?;
  let messages=ids.iter().map(|id|engine.client()?.message(chat,id)).collect::<Result<Vec<_>,_>>()?;
  let selected=self.memory_pairs(owner,&stamp,chat,&messages)?;
  if selected.len()!=ids.len(){return Err(RuntimeError::Binding)}
  owner.verify(store).map_err(|_|RuntimeError::Binding)?;
  Ok((stamp,selected))
 }
 fn memory_pairs(&self,owner:&NativeMemoryOwner,stamp:&ExecutionStamp,chat:&str,messages:&[super::super::EngineMessage])->Result<Vec<CompletedMessage>,RuntimeError>{
  let mut records=self.prompts.lock().map_err(|_|RuntimeError::Storage)?;
  if records.is_none(){*records=Some(load_prompt_records(&self.storage.join("prompt-admissions.json"))?)}
  let records=records.as_ref().ok_or(RuntimeError::Storage)?;
  let mut selected=vec![];
  for pair in messages.chunks(2){
   if pair.len()!=2{return Err(RuntimeError::Binding)}
   let (u,a)=(&pair[0],&pair[1]);
   if u.kind!="user"||a.kind!="assistant"||a.parent_id.as_deref()!=Some(u.id.as_str())||a.error.is_some()||
      a.finish.as_deref()!=Some("stop")||u.session_id!=chat||a.session_id!=chat{return Err(RuntimeError::Binding)}
   let completed=a.time.as_ref().and_then(|v|v.get("completed")).and_then(Value::as_u64).ok_or(RuntimeError::Binding)?;
   let record=records.values().find(|r|r.message_id==u.id&&r.session_id==chat&&r.state==PromptState::Admitted).ok_or(RuntimeError::Binding)?;
   let original=record.original.as_ref().ok_or(RuntimeError::Binding)?;
   if original.library_id!=stamp.scope.library_id||original.engine_project_id!=stamp.engine_project_id||original.project.primary_root!=owner.directory()||
      !matches!(&stamp.scope.namespace,veyra_memory::NativeNamespace::Project{project_id} if *project_id==original.project.id)||
      fingerprint(&original.project.environment).map_err(|_|RuntimeError::Binding)?!=stamp.scope.execution_id{return Err(RuntimeError::Binding)}
   // Completed tool-bearing turns and original injected files/skills/memory/hooks
   // are conservatively external. No proof is inferred from today's settings.
   let external=!original.files.as_array().is_some_and(Vec::is_empty)||!original.skill_ids.is_empty()||
    !original.memory.is_null()||!original.hooks.as_object().is_some_and(|h|h.is_empty())||
    pair.iter().any(|m|m.content.iter().any(|p|matches!(p,super::super::TimelineContent::Tool{..})));
   for (m,role) in [(u,Role::User),(a,Role::Assistant)]{
    let text=m.text.clone().ok_or(RuntimeError::Binding)?;
    let revision=fingerprint(&(m,original)).map_err(|_|RuntimeError::Binding)?;
    selected.push(CompletedMessage{source:SourceRef{chat_id:chat.into(),message_id:m.id.clone(),role,content_hash:content_hash(&text),revision,turn_id:u.id.clone(),terminal_id:a.id.clone()},
     text,completed_ms:completed,terminal:true,external_context:Some(external)});
   }
  }
  Ok(selected)
 }
}
