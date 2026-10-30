//! Protected local bearer admission only. Paired remote grants never mint this
//! extension and the original remote exact route allowlist is unchanged.
use super::*;
use axum::{Extension,extract::{Path,State,Query},routing::{get,post}};
use veyra_contracts::local_workspaces::*;
use veyra_adapters::{local_execution::{LocalWorkspaceBinding,LocalWslCreated},local_custody::LocalCustody};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{sync::{Arc,Mutex},time::{Duration,Instant}};
mod git;
#[derive(Clone)]
pub(super) struct LocalRequest{instance:String}
impl LocalRequest {
 // Only the original authenticate middleware calls this after its existing check.
 pub(super) fn from_existing_admission(state:&ServiceState)->Self{Self{instance:state.instance_id.clone()}}
 fn check(&self,state:&ServiceState)->Result<(),String>{
  if self.instance!=state.instance_id{return Err("local service identity changed".into());}Ok(())
 }
}
#[derive(Default)]
pub(super) struct Runtime {
 terminals:veyra_adapters::interactive_terminal::LocalTerminals,
 git:git::GitWorkers,
 custodies:Arc<veyra_adapters::local_custody::LocalCustodyOriginals>,
}
impl Runtime {
 pub(super) fn from_store(store:&veyra_adapters::projects::ProjectStore)->Self{
  // None is the explicit unenrolled legacy constructor, not failed acquisition.
  let custodies=store.local_custody_originals().unwrap_or_else(||Arc::new(Default::default()));
  Self{custodies,..Self::default()}
 }
 pub(super) fn finish_until(&self,deadline:Instant)->Result<(),String>{
  self.terminals.finish_until(deadline).map_err(|_|"private terminal originals remain retained")?;
  self.git.finish_until(deadline)?;
  self.custodies.finish_until(deadline)
 }
}
pub(super) fn router()->Router<Arc<ServiceState>>{
 Router::new().route("/",post(create)).route("/{id}",get(workspace))
  .route("/operations/{id}",get(receipt)).route("/operations",post(operation))
  .route("/{workspace_id}/sessions/{session_id}",get(session))
  .route("/{workspace_id}/terminals/{terminal_id}",get(terminal))
}
fn canonical(id:&str)->bool{uuid::Uuid::parse_str(id).is_ok_and(|v|!v.is_nil()&&v.to_string()==id)}
fn reply(result:Result<Value,String>)->Response{match result{
 Ok(value)=>Json(value).into_response(),
 Err(_)=>(StatusCode::CONFLICT,Json(json!({"code":"local_workspace_unavailable","message":"Preserve this original and read its receipt; no fallback or repeated effect was admitted"}))).into_response()
}}
fn with_store<T>(state:&ServiceState,work:impl FnOnce(&mut veyra_adapters::projects::ProjectStore)->Result<T,String>)->Result<T,String>{
 let mut guard=state.projects.lock().map_err(|_|"local writer unavailable")?;
 work(guard.as_mut().ok_or("original workspace writer retired")?)
}
// Nonblocking original-registry admission can run while an engine/terminal/Git
// owner lock is held. Do not wait on the catalog and invert its engine lock order.
fn check_current(state:&ServiceState,binding:&LocalWorkspaceBinding)->Result<(),String>{
 let guard=state.projects.try_lock().map_err(|_|"current private registry busy")?;
 binding.verify_current(guard.as_ref().ok_or("original registry retired")?,&state.instance_id)
}
fn current_owner(state:&ServiceState,record:&veyra_adapters::projects::LocalWorkspaceRecord,store:&veyra_adapters::projects::ProjectStore)->Result<LocalWorkspaceOwner,String>{
 Ok(LocalWorkspaceOwner{installation_id:store.local_installation_id().map_err(|_|"installation unavailable")?.into(),
  custodian_key:store.local_custody().map_err(|_|"OS custody unavailable")?.key().into(),
  workspace_id:record.id.clone(),revision:record.revision,service_instance_id:state.instance_id.clone(),environment:record.environment.clone()})
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create{request_id:String,environment:LocalEnvironment}
async fn create(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Json(body):Json<Create>)->Response{
 let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
  actor.check(&state)?;
  if !canonical(&body.request_id)||state.draining.load(Ordering::Acquire){return Err("not admitted".into());}
  let original=format!("{:x}",Sha256::digest(serde_json::to_vec(&(&body.request_id,&body.environment)).map_err(|_|"invalid create")?));
  let (fresh,custody,installation,exclusions)=with_store(&state,|store|{
   let fresh=store.reserve_local_workspace(&body.request_id,&body.environment,&original).map_err(|_|"creation conflict")?;
   let exclusions=if fresh{store.require_local_allocation_separation(&body.environment).map_err(|_|"protected namespace overlaps or custody is unavailable")?}else{Vec::new()};
   Ok((fresh,store.local_custody().map_err(|_|"custody unavailable")?,store.local_installation_id().map_err(|_|"installation unavailable")?.to_owned(),exclusions))
  })?;
  if fresh {
   let allocated=match &body.environment{
    LocalEnvironment::Windows=>custody.create_child(&body.request_id).and_then(|root|with_store(&state,|store|store.activate_local_workspace(&body.request_id,&root).map_err(|_|"activation outcome unknown".into()))),
    LocalEnvironment::Wsl{..}=>LocalWslCreated::create(custody,&installation,&body.request_id,&body.environment,&exclusions)
     .and_then(|root|with_store(&state,|store|store.activate_local_wsl_workspace(&body.request_id,&root).map_err(|_|"activation outcome unknown".into()))),
   };
   if allocated.is_err(){let _=with_store(&state,|store|store.unknown_local_workspace(&body.request_id).map_err(|_|"retained unknown".into()));return Err("private root outcome unknown; do not repeat allocation".into());}
  }
  with_store(&state,|store|{
   let record=store.local_workspace(&body.request_id).map_err(|_|"private original unavailable")?;
   let owner=current_owner(&state,&record,store)?;
   Ok(json!({"workspace":record,"owner":owner,"execution_readiness":"requires_current_custody_and_engine"}))
  })
 }).await;
 reply(result.unwrap_or_else(|_|Err("creation worker remains unresolved".into())))
}
async fn workspace(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path(id):Path<String>)->Response{
 reply(actor.check(&state).and_then(|_|with_store(&state,|store|{
  let record=store.local_workspace(&id).map_err(|_|"private original unavailable")?;
  Ok(json!({"owner":current_owner(&state,&record,store)?,"workspace":record}))
 })))
}
async fn receipt(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path(id):Path<String>)->Response{
 reply(actor.check(&state).and_then(|_|with_store(&state,|store|{
  let original=store.local_receipt(&id).map_err(|_|"original unavailable")?.ok_or("original absent; absence is not settlement")?;
  if original.owner.installation_id!=store.local_installation_id().map_err(|_|"installation")?||
   original.owner.custodian_key!=store.local_custody().map_err(|_|"custody")?.key(){return Err("different custodian".into());}
  serde_json::to_value(original).map_err(|_|"original encoding".into())
 })))
}
async fn operation(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Json(body):Json<LocalOperationRequest>)->Response{
 let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
  actor.check(&state)?;
  if !canonical(&body.request_id){return Err("invalid original UUID".into());}
  // Exact process cleanup remains reachable after new workspace admission closes.
  if let LocalOperation::TerminalClose{terminal_id}=&body.operation {
   state.local_workspaces.terminals.check_close_request(&body.owner,terminal_id,&body.request_id).map_err(|_|"original terminal cleanup owner mismatch")?;
   let fresh=with_store(&state,|store|store.reserve_local_cleanup(&body,&state.instance_id).map_err(|_|"original cleanup fence unavailable".into()))?;
   if !fresh{return with_store(&state,|store|serde_json::to_value(store.local_receipt(&body.request_id).map_err(|_|"cleanup receipt unavailable")?).map_err(|_|"cleanup receipt".into()));}
   let outcome=state.local_workspaces.terminals.close(&body.owner,terminal_id,&body.request_id,Instant::now()+Duration::from_secs(3)).map_err(|_|"original close remains uncertain")?;
   return with_store(&state,|store|{
    store.settle_local_operation(&body.request_id,&outcome).map_err(|_|"cleanup settlement uncertain")?;
    serde_json::to_value(store.local_receipt(&body.request_id).map_err(|_|"cleanup receipt unavailable")?).map_err(|_|"cleanup receipt".into())
   });
  }
  if state.draining.load(Ordering::Acquire)||*state.shutdown.borrow(){return Err("service admission closed".into());}
  if matches!(body.owner.environment,LocalEnvironment::Wsl{..})&&matches!(body.operation,
   LocalOperation::GitStatus|LocalOperation::GitDiff|LocalOperation::GitBranch{..}|LocalOperation::WorktreeCreate{..}){
   return Err("WSL Git helper-tree custody has not qualified; no original effect admitted".into());
  }
  if matches!(body.operation,LocalOperation::SessionCreate{..}|LocalOperation::AgentTurn{..}) &&
   (state.model_work.check_idle_until(Instant::now()+Duration::from_secs(5)).is_err() ||
    state.model_operation_workers.has_retained()!=Ok(false)){return Err("finish original model ownership before private coding work".into());}
  let (fresh,binding)=with_store(&state,|store|{
   if !store.reserve_local_operation(&body,&state.instance_id).map_err(|_|"original conflict")?{return Ok((false,None));}
   let binding=LocalWorkspaceBinding::acquire(store,&body.owner,&state.instance_id)?;
   if let LocalOperation::AgentTurn{session_id,..}=&body.operation{store.require_local_session(&body.owner.workspace_id,session_id).map_err(|_|"session is not owned by this private original")?;}
   store.fence_local_operation(&body.request_id).map_err(|_|"durable dispatch fence unavailable")?;
   Ok((true,Some(binding)))
  })?;
  if !fresh{return with_store(&state,|store|serde_json::to_value(store.local_receipt(&body.request_id).map_err(|_|"receipt")?).map_err(|_|"receipt encoding".into()));}
  let binding=binding.ok_or("original custody missing")?;
  let current=||check_current(&state,&binding);
  current()?;
  let outcome=match &body.operation {
   LocalOperation::SessionCreate{title,agent}=>state.live_agent.create_local_session(&binding,&body.request_id,title,agent,&current),
   LocalOperation::AgentTurn{session_id,text}=>state.live_agent.prompt_local(&binding,session_id,&body.request_id,text,&current),
   LocalOperation::TerminalOpen{shell,columns,rows}=>state.local_workspaces.terminals.open(binding.clone(),&body.request_id,shell,*columns,*rows,&current).map_err(|_|"terminal outcome uncertain".into()),
   LocalOperation::TerminalInput{terminal_id,text}=>state.local_workspaces.terminals.input(&binding,terminal_id,text,&current).map_err(|_|"terminal input outcome uncertain".into()),
   LocalOperation::TerminalResize{terminal_id,columns,rows}=>state.local_workspaces.terminals.resize(&binding,terminal_id,*columns,*rows,&current).map_err(|_|"terminal resize outcome uncertain".into()),
   LocalOperation::TerminalClose{..}=>unreachable!(),
   git=>state.local_workspaces.git.run(binding.clone(),git,&current),
  }?;
  with_store(&state,|store|{
   binding.verify_current(store,&state.instance_id)?;
   store.settle_local_operation(&body.request_id,&outcome).map_err(|_|"outcome retained but receipt uncertain")?;
   serde_json::to_value(store.local_receipt(&body.request_id).map_err(|_|"receipt")?).map_err(|_|"receipt encoding".into())
  })
 }).await;
 reply(result.unwrap_or_else(|_|Err("original execution worker remains unresolved".into())))
}
async fn session(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path((workspace_id,session_id)):Path<(String,String)>)->Response{
 let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
  actor.check(&state)?;
  let binding=with_store(&state,|store|{
   let record=store.local_workspace(&workspace_id).map_err(|_|"private workspace")?;
   let owner=current_owner(&state,&record,store)?;
   store.require_local_session(&workspace_id,&session_id).map_err(|_|"private session unavailable")?;
   LocalWorkspaceBinding::acquire(store,&owner,&state.instance_id)
  })?;
  let current=||check_current(&state,&binding);
  let result=state.live_agent.local_session(&binding,&session_id,&current)?;
  current()?;Ok(result)
 }).await;
 reply(result.unwrap_or_else(|_|Err("session read unavailable".into())))
}


#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TerminalCursor{after:Option<u64>}
async fn terminal(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path((workspace_id,terminal_id)):Path<(String,String)>,Query(cursor):Query<TerminalCursor>)->Response{
 let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
  actor.check(&state)?;
  let binding=with_store(&state,|store|{
   let record=store.local_workspace(&workspace_id).map_err(|_|"private workspace")?;
   let owner=current_owner(&state,&record,store)?;
   LocalWorkspaceBinding::acquire(store,&owner,&state.instance_id)
  })?;
  let current=||check_current(&state,&binding);
  let result=state.local_workspaces.terminals.poll(&binding,&terminal_id,cursor.after.unwrap_or(0),&current).map_err(|_|"private terminal original unavailable".to_owned())?;
  current()?;Ok(result)
 }).await;
 reply(result.unwrap_or_else(|_|Err("terminal read unavailable".into())))
}
