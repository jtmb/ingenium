//! Local library metadata and actual engine conversation reads. No snapshot alias.
use super::*;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MessageQuery{cursor:Option<String>,limit:Option<u32>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ListQuery{after:Option<String>,limit:Option<u32>}
pub(super) async fn context(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>)->Response{
 let result=tokio::task::spawn_blocking(move||{
  actor.check(&state)?;
  with_store(&state,|store|{
   let custody=store.local_custody().map_err(|_|"original local custody unavailable")?;
   let value=json!({"library_id":store.local_installation_id().map_err(|_|"original library unavailable")?,
    "service_instance_id":state.instance_id,"custodian":{"scheme":custody.scheme(),"subject":custody.subject(),"key":custody.key()},
    "supported_environment_kinds":["windows","wsl"],"engine_readiness":"query_the_selected_private_workspace_runtime"});
   custody.verify()?;Ok(value)
  })
 }).await;
 reply(result.unwrap_or_else(|_|Err("local library context unavailable".into())))
}
fn read(state:&ServiceState,workspace:&str,session:Option<&str>,kind:&str,cursor:Option<&str>,limit:u32)->Result<Value,String>{
 if !(1..=100).contains(&limit)||cursor.is_some_and(|value|value.is_empty()||value.len()>4096||value.chars().any(char::is_control)){return Err("invalid bounded page".into());}
 let binding=with_store(state,|store|{
  let record=store.local_workspace(workspace).map_err(|_|"private workspace unavailable")?;
  let owner=current_owner(state,&record,store)?;
  if let Some(id)=session{store.require_local_session(workspace,id).map_err(|_|"conversation is not owned by this private workspace")?;}
  LocalWorkspaceBinding::acquire(store,&owner,&state.instance_id)
 })?;
 let current=||check_current(state,&binding);
 current()?;
 let mut value=state.live_agent.local_conversation_read(&binding,session,kind,cursor,limit,&current)?;
 current()?;value.as_object_mut().ok_or("invalid private read projection")?.insert("owner".into(),json!(binding.owner()));Ok(value)
}
pub(super) async fn runtime(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path(workspace):Path<String>)->Response{
 let result=tokio::task::spawn_blocking(move||{actor.check(&state)?;read(&state,&workspace,None,"runtime",None,50)}).await;
 reply(result.unwrap_or_else(|_|Err("private runtime observation unavailable".into())))
}
pub(super) async fn messages(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path((workspace,session)):Path<(String,String)>,Query(query):Query<MessageQuery>)->Response{
 let result=tokio::task::spawn_blocking(move||{actor.check(&state)?;read(&state,&workspace,Some(&session),"messages",query.cursor.as_deref(),query.limit.unwrap_or(50))}).await;
 reply(result.unwrap_or_else(|_|Err("private messages unavailable".into())))
}
pub(super) async fn status(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path((workspace,session)):Path<(String,String)>)->Response{
 let result=tokio::task::spawn_blocking(move||{actor.check(&state)?;read(&state,&workspace,Some(&session),"status",None,50)}).await;
 reply(result.unwrap_or_else(|_|Err("private conversation status unavailable".into())))
}
pub(super) async fn sessions(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Path(workspace):Path<String>,Query(query):Query<ListQuery>)->Response{
 let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
  actor.check(&state)?;let limit=query.limit.unwrap_or(50);
  let (binding,ids)=with_store(&state,|store|{
   let record=store.local_workspace(&workspace).map_err(|_|"private workspace unavailable")?;
   let owner=current_owner(&state,&record,store)?;
   let binding=LocalWorkspaceBinding::acquire(store,&owner,&state.instance_id)?;
   let ids=store.local_session_ids(&workspace,query.after.as_deref(),limit).map_err(|_|"bounded private conversation references unavailable")?;
   Ok((binding,ids))
  })?;
  let current=||check_current(&state,&binding);let mut data=Vec::new();
  for id in &ids{current()?;data.push(state.live_agent.local_session(&binding,id,&current)?);}
  current()?;Ok(json!({"owner":binding.owner(),"data":data,"after":ids.last(),"limit":limit}))
 }).await;
 reply(result.unwrap_or_else(|_|Err("private conversation list unavailable".into())))
}
