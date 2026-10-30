use super::*;
use crate::{native_memory_owner::NativeMemoryOwner,projects::ProjectStore};
use veyra_memory::{ExecutionStamp,CompletedMessage,SourceRef,Role,content_hash,fingerprint};
impl LiveRuntime {
 fn memory_verify_owner(engine:&OwnedEngine,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<(),RuntimeError>{
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  if let Some(binding)=owner.private_binding(){
   // The closure borrows the actual locked ProjectStore and sealed owner.
   // It is not caller-supplied metadata or a decoder permission grant.
   local_workspaces::require_local_engine(engine,binding,&||owner.verify_chat(store,chat))?;
  }
  engine.ensure_directory(owner.directory())?;
  if matches!(&engine.environment,Environment::Wsl{user:None,..})||
     fingerprint(&engine.environment).map_err(|_|RuntimeError::Binding)?!=owner.scope().execution_id{return Err(RuntimeError::Binding)}
  Ok(())
 }
 fn memory_stamp_locked(&self,engine:&OwnedEngine,store:&ProjectStore,owner:&NativeMemoryOwner,session:&EngineSession)->Result<ExecutionStamp,RuntimeError>{
  Self::memory_verify_owner(engine,store,owner,&session.id)?;
  if session.location.directory!=owner.directory(){return Err(RuntimeError::Binding)}
  Ok(ExecutionStamp{scope:owner.scope().clone(),binding_revision:owner.revision(),service_instance_id:owner.instance().into(),
   engine_instance_id:task_permissions::current_engine_instance_id(engine)?,engine_revision:self.credentials_revision(),
   engine_project_id:session.project_id.clone(),directory:owner.directory().into()})
 }
 pub fn memory_current_stamp(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<ExecutionStamp,RuntimeError>{
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  if session.id!=chat{return Err(RuntimeError::Binding)}
  let stamp=self.memory_stamp_locked(&engine,store,owner,&session)?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;Ok(stamp)
 }
 /// Read one bounded latest page; never follow cursor or use context/history().
 pub fn memory_recent(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<(ExecutionStamp,Vec<CompletedMessage>),RuntimeError>{
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  if session.id!=chat{return Err(RuntimeError::Binding)}
  let stamp=self.memory_stamp_locked(&engine,store,owner,&session)?;
  // Projects 8b18318e owns this ONE canonical decoder. No cursor traversal.
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  let page=engine.client()?.local_recent_messages(chat,None,32)?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  if page.data.len()>32||serde_json::to_vec(&page).map_err(|_|RuntimeError::Storage)?.len()>4*1024*1024{
   return Err(RuntimeError::Binding)
  }
  // Shared first page is newest-first. Pair projection consumes chronological
  // order, so reverse exactly once and discard the unused opaque cursor.
  let mut messages=page.data;messages.reverse();
  let selected=self.memory_pairs(owner,&stamp,chat,&messages)?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  if self.memory_stamp_locked(&engine,store,owner,&session)?!=stamp{return Err(RuntimeError::Binding)}
  Ok((stamp,selected))
 }
 /// Re-read EXACT selected canonical message IDs; unrelated later turns are allowed.
 pub fn memory_refresh(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str,ids:&[String])->Result<(ExecutionStamp,Vec<CompletedMessage>),RuntimeError>{
  if ids.is_empty()||ids.len()>32{return Err(RuntimeError::Binding)}
  owner.verify_chat(store,chat).map_err(|_|RuntimeError::Binding)?;
  let engine=self.lock_engine_for_directory(owner.directory())?;
  Self::memory_verify_owner(&engine,store,owner,chat)?;
  let session=engine.client()?.session_in_project(chat,&SessionQuery{directory:owner.directory().into(),..SessionQuery::default()})?;
  if session.id!=chat{return Err(RuntimeError::Binding)}
  let stamp=self.memory_stamp_locked(&engine,store,owner,&session)?;
  let mut messages=Vec::with_capacity(ids.len());let mut bytes=0usize;
  for id in ids{
   Self::memory_verify_owner(&engine,store,owner,chat)?;
   let message=engine.client()?.message(chat,id)?;
   Self::memory_verify_owner(&engine,store,owner,chat)?;
   bytes=bytes.checked_add(serde_json::to_vec(&message).map_err(|_|RuntimeError::Storage)?.len()).ok_or(RuntimeError::Binding)?;
   if bytes>4*1024*1024{return Err(RuntimeError::Binding)}
   messages.push(message);
  }
  let selected=self.memory_pairs(owner,&stamp,chat,&messages)?;
  if selected.len()!=ids.len(){return Err(RuntimeError::Binding)}
  Self::memory_verify_owner(&engine,store,owner,chat)?;
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
