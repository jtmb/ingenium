//! Closed local conversation reads/controls through the actual selected engine.
use super::*;
use veyra_contracts::local_workspaces::LocalOperation;
fn session_locked(engine:&OwnedEngine,binding:&LocalWorkspaceBinding,id:&str,current:&dyn Fn()->Result<(),String>)->Result<EngineSession,RuntimeError>{
 require_local_engine(engine,binding,current)?;
 let session=engine.client()?.session_in_project(id,&SessionQuery{directory:binding.directory().into(),..SessionQuery::default()})?;
 require_local_engine(engine,binding,current)?;
 if session.id!=id||session.location.directory!=binding.directory(){return Err(local_error());}Ok(session)
}
impl LiveRuntime{
 pub fn local_runtime_context(&self,binding:&LocalWorkspaceBinding,current:&dyn Fn()->Result<(),String>)->Result<Value,RuntimeError>{
  current().map_err(|_|local_error())?;
  let mut slot=self.engine.lock().map_err(|_|RuntimeError::Storage)?;
  let Some(engine)=slot.as_mut() else{current().map_err(|_|local_error())?;return Ok(json!({"ready":false,"reason":"engine_stopped"}));};
  require_local_engine(engine,binding,current)?;
  if engine.child.try_wait().map_err(|_|RuntimeError::Storage)?.is_some(){current().map_err(|_|local_error())?;return Ok(json!({"ready":false,"reason":"owned_engine_exited"}));}
  let identity=engine.client()?.info()?;
  require_local_engine(engine,binding,current)?;
  if identity.version!=PINNED_VERSION{return Err(RuntimeError::Unavailable("pinned engine version differs"));}
  let agents=engine.client()?.agents(binding.directory())?.into_iter().filter(|agent|agent.mode=="primary"&&!agent.hidden&&task_permissions::managed_profile(&agent.id).is_none()).collect::<Vec<_>>();
  require_local_engine(engine,binding,current)?;
  let models=engine.client()?.models_in_project(binding.directory())?;
  require_local_engine(engine,binding,current)?;
  Ok(json!({"ready":true,"version":identity.version,"environment":engine.environment,"engine_model_selection":engine.model,
   "engine_instance_id":engine.registration_instance_id,"agents":agents,"models":models,
   "model_selection_scope":"current_engine_model_only","readiness_scope":"engine_protocol_only","isolation":engine.isolation_mode()}))
 }
 pub fn local_messages(&self,binding:&LocalWorkspaceBinding,id:&str,cursor:Option<&str>,limit:u32,current:&dyn Fn()->Result<(),String>)->Result<Value,RuntimeError>{
  let engine=self.lock_engine_for_directory(binding.directory())?;session_locked(&engine,binding,id,current)?;
  let page=engine.client()?.local_recent_messages(id,cursor,limit)?;
  require_local_engine(&engine,binding,current)?;
  let bytes=serde_json::to_vec(&page).map_err(|_|RuntimeError::Storage)?;
  if bytes.len()>4*1024*1024{return Err(RuntimeError::Unavailable("conversation page exceeds supported bytes"));}
  Ok(json!({"session_id":id,"data":page.data,"cursor":page.cursor,"order":if cursor.is_none(){"desc"}else{"cursor"}}))
 }
 pub fn local_conversation_status(&self,binding:&LocalWorkspaceBinding,id:&str,current:&dyn Fn()->Result<(),String>)->Result<Value,RuntimeError>{
  let engine=self.lock_engine_for_directory(binding.directory())?;let session=session_locked(&engine,binding,id,current)?;
  let running=engine.client()?.local_session_running(id)?;
  require_local_engine(&engine,binding,current)?;
  let identity=engine.client()?.info()?;require_local_engine(&engine,binding,current)?;
  if identity.version!=PINNED_VERSION{return Err(RuntimeError::Unavailable("pinned engine version differs"));}
  Ok(json!({"session_id":id,"running":running,"engine_ready":true,"version":identity.version,
   "agent":session.agent,"model":session.model,"engine_model_selection":engine.model,"time":session.time,
   "outcome":session.outcome,"terminal_observed":false}))
 }
 pub fn local_conversation_control(&self,binding:&LocalWorkspaceBinding,operation:&LocalOperation,current:&dyn Fn()->Result<(),String>)->Result<Value,RuntimeError>{
  let id=match operation{LocalOperation::SessionInterrupt{session_id}|LocalOperation::SessionSelectModel{session_id,..}|LocalOperation::SessionSelectAgent{session_id,..}=>session_id,_=>return Err(local_error())};
  let engine=self.lock_engine_for_directory(binding.directory())?;session_locked(&engine,binding,id,current)?;
  match operation{
   LocalOperation::SessionInterrupt{..}=>{
    require_local_engine(&engine,binding,current)?;
    // Generic current-conversation stop. Upstream has no per-original abort
    // guarantee. The service's durable operation fence prevents repeated sends.
    let interrupted=engine.client()?.interrupt(id)?;
    require_local_engine(&engine,binding,current)?;
    Ok(json!({"session_id":id,"interrupted":interrupted,"scope":"current_conversation","terminal_observed":false,"exact_turn_guarantee":false}))
   },
   LocalOperation::SessionSelectModel{model_id,..}=>{
    if model_id!=&engine.model.id{return Err(RuntimeError::Unavailable("select the actual engine model; loading remains its original owner"));}
    let catalog=engine.client()?.models_in_project(binding.directory())?;
    if !catalog.data.iter().any(|model|model.id==*model_id&&model.provider_id==provider_config::PROVIDER_ID&&model.enabled){return Err(local_error());}
    let selected=ModelRef{id:model_id.clone(),provider_id:provider_config::PROVIDER_ID.into(),variant:Some(engine.model.variant.clone())};
    require_local_engine(&engine,binding,current)?;engine.client()?.select_model_ack(id,&selected)?;
    let observed=session_locked(&engine,binding,id,current)?;
    if observed.model.as_ref()!=Some(&selected){return Err(local_error());}
    Ok(json!({"session_id":id,"model":observed.model}))
   },
   LocalOperation::SessionSelectAgent{agent,..}=>{
    if agent.is_empty()||agent.len()>128||task_permissions::managed_profile(agent).is_some(){return Err(RuntimeError::AgentUnavailable);}
    if !engine.client()?.agents(binding.directory())?.iter().any(|entry|entry.id==*agent&&entry.mode=="primary"&&!entry.hidden){return Err(RuntimeError::AgentUnavailable);}
    require_local_engine(&engine,binding,current)?;engine.client()?.select_local_agent_ack(id,agent)?;
    let observed=session_locked(&engine,binding,id,current)?;
    if observed.agent.as_deref()!=Some(agent.as_str()){return Err(local_error());}
    Ok(json!({"session_id":id,"agent":observed.agent}))
   },_=>Err(local_error()),
  }
 }
}
