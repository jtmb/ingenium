//! Actual directory-scoped engine methods, with a separately typed native owner.
use super::*;
mod conversations;
use crate::local_execution::LocalWorkspaceBinding;
use veyra_contracts::local_workspaces::LocalEnvironment;
fn local_error()->RuntimeError{RuntimeError::Binding}
pub(super) fn require_local_engine(engine:&OwnedEngine,binding:&LocalWorkspaceBinding,current:&dyn Fn()->Result<(),String>)->Result<(),RuntimeError>{
 binding.verify().map_err(|_|local_error())?;current().map_err(|_|local_error())?;
 let expected=match &binding.owner().environment {
  LocalEnvironment::Windows=>Environment::Windows,
  LocalEnvironment::Wsl{distro,user}=>Environment::Wsl{distro:distro.clone(),user:Some(user.clone())},
 };
 // Project-owned credential/plugin/isolation scope cannot be relabeled private.
 if engine.environment!=expected || engine.account_scope.is_some() || engine.child.is_isolated()
  || engine._plugins.as_ref().is_some_and(|launch|!launch.empty())
  || engine._assistants.as_ref().is_some_and(|launch|!launch.empty())
  {return Err(local_error());}
 engine.ensure_directory(binding.directory())
}
impl LiveRuntime {
 pub fn create_local_session(&self,binding:&LocalWorkspaceBinding,request:&str,title:&str,agent:&str,current:&dyn Fn()->Result<(),String>)->Result<EngineSession,RuntimeError>{
  let request=uuid::Uuid::parse_str(request).map_err(|_|local_error())?;
  if title.is_empty()||title.len()>256||agent.is_empty()||agent.len()>128||task_permissions::managed_profile(agent).is_some()
   {return Err(local_error());}
  let engine=self.lock_engine_for_directory(binding.directory())?;
  require_local_engine(&engine,binding,current)?;
  if !engine.client()?.agents(binding.directory())?.iter().any(|a|a.id==agent&&a.mode=="primary"&&!a.hidden){return Err(RuntimeError::AgentUnavailable);}
  let model=ModelRef{id:engine.model.id.clone(),provider_id:provider_config::PROVIDER_ID.into(),variant:Some(engine.model.variant.clone())};
  require_local_engine(&engine,binding,current)?;
  let id=format!("ses_{}",request.simple());
  let session=engine.client()?.create_bound_session_for_agent(binding.directory(),title,&id,&model,Some(agent))?;
  require_local_engine(&engine,binding,current)?;
  if session.id!=id||session.location.directory!=binding.directory(){return Err(local_error());}Ok(session)
 }
 pub fn local_session(&self,binding:&LocalWorkspaceBinding,id:&str,current:&dyn Fn()->Result<(),String>)->Result<EngineSession,RuntimeError>{
  let engine=self.lock_engine_for_directory(binding.directory())?;require_local_engine(&engine,binding,current)?;
  let session=engine.client()?.session_in_project(id,&SessionQuery{directory:binding.directory().into(),..SessionQuery::default()})?;
  require_local_engine(&engine,binding,current)?;
  if session.id!=id||session.location.directory!=binding.directory(){return Err(local_error());}Ok(session)
 }
 pub fn prompt_local(&self,binding:&LocalWorkspaceBinding,id:&str,request:&str,text:&str,current:&dyn Fn()->Result<(),String>)->Result<Value,RuntimeError>{
  current().map_err(|_|local_error())?;
  let result=self.prompt_scoped_checked_local(id,binding.directory(),request,text,&[],&[],false,None,Some((binding,current)))?;
  current().map_err(|_|local_error())?;Ok(result)
 }
}
