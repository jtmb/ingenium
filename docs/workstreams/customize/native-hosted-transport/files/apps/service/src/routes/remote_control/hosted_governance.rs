//! Typed local Native owner for NodeHosted governance. Not installed into the generic remote proxy.
use super::*;
use serde::Serialize;
use veyra_adapters::{account_vault::AccountVault,access_profiles::AccessProfiles,utility_operations,remote_control::hosted::{self,contracts::*}};
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct Context {library_id:String,service_instance_id:String,project:Option<veyra_contracts::Project>}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct ReadRequest {binding:Binding,command:Read}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct ReserveRequest {binding:Binding,command:Write}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct OriginalRequest {binding:Binding,original:Original}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct OwnerRequest {binding:Binding}
pub(super) fn router()->Router<Arc<ServiceState>>{
 Router::new().route("/context",post(context)).route("/read",post(read)).route("/reserve",post(reserve))
  .route("/send",post(send)).route("/inspect",post(inspect)).route("/pending",post(pending))
  .layer(axum::extract::DefaultBodyLimit::max(2_100_000))
  .layer(axum::middleware::map_response(|mut r:Response|async move{r.headers_mut().insert(axum::http::header::CACHE_CONTROL,axum::http::HeaderValue::from_static("no-store"));r}))
}
fn value<T:Serialize>(v:T)->Result<Value,Error>{serde_json::to_value(v).map_err(|_|Error::Unavailable)}
fn library(state:&ServiceState)->Result<String,Error>{utility_operations::Store::open(&state.state_directory).and_then(|s|s.library_id()).map_err(|_|Error::Unavailable)}
fn native_owner(state:&ServiceState,library_id:&str,service_instance:&str,project_id:Option<&str>,revision:Option<u32>)->Result<NativeOwner,Error>{
 if library(state)?!=library_id||state.instance_id!=service_instance{return Err(Error::Conflict);}
 let projects=state.projects.lock().map_err(|_|Error::Unavailable)?;
 let project=project_id.map(|id|projects.as_ref().ok_or(Error::Unavailable)?.get(id).map_err(|_|Error::Conflict)).transpose()?;
 if project.as_ref().is_some_and(|p|p.archived||Some(p.revision)!=revision)||project.is_none()&&revision.is_some(){return Err(Error::Conflict);}
 Ok(NativeOwner{library_id:library_id.into(),service_instance_id:service_instance.into(),project})
}
fn current(state:&ServiceState,id:&str,b:&Binding)->Result<(hosted::SessionConnection,Identity),Error>{
 if b.connection_id!=id{return Err(Error::Forbidden);}
 let connection=state.remote_control.store.hosted(id)?;
 let owner=native_owner(state,&b.native_library_id,&b.native_service_instance_id,b.native_project_id.as_deref(),b.native_project_revision)?;
 if json!(owner.project)!=json!(connection.enrollment().native_owner.project){return Err(Error::Conflict);}
 let actual=connection.identity(&AccountVault::new(&state.state_directory),&owner)?;
 if actual.binding!=*b{return Err(Error::Conflict);}
 state.remote_control.store.require_hosted(&connection)?;
 Ok((connection,actual))
}
/// Reuse the existing tracked RemoteControl worker custody before any journal/network work.
/// The command mutex covers forget/revoke/admin races; blocking work outlives its HTTP waiter.
async fn retained(state:Arc<ServiceState>,work:impl FnOnce(Arc<ServiceState>)->Result<Value,Error>+Send+'static)->Response{
 let control=state.remote_control.clone();let worker=state.clone();let(tx,rx)=tokio::sync::oneshot::channel();
 if let Err(e)=control.retain(format!("hosted:{}",uuid::Uuid::new_v4()),async move{
  // Existing /v1/remote-control has no agent_admission layer. Acquire the shared serial FIRST,
  // matching account/access-profile admission order; do not wrap this router in agent_admission.
  let project_guard=worker.serial.clone().lock_owned().await;
  let guard=worker.remote_control.commands.clone().lock_owned().await;
  let result=blocking(move||{let _guard=guard;let _project_guard=project_guard;if worker.draining.load(Ordering::SeqCst){return Err(Error::Unavailable);}work(worker)}).await;
  let _=tx.send(result);
 }){return problem(e);}
 match rx.await{Ok(Ok(v))=>Json(v).into_response(),Ok(Err(e))=>problem(e),Err(_)=>problem(Error::Unavailable)}
}
async fn context(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<Context>)->Response{
 retained(state,move|state|{
  let owner=native_owner(&state,&input.library_id,&input.service_instance_id,input.project.as_ref().map(|p|p.id.as_str()),input.project.as_ref().map(|p|p.revision))?;
  if json!(input.project)!=json!(owner.project){return Err(Error::Conflict);}
  let connection=state.remote_control.store.hosted(&id)?;
  if json!(owner.project)!=json!(connection.enrollment().native_owner.project){return Err(Error::Conflict);}
  let identity=connection.identity(&AccountVault::new(&state.state_directory),&owner)?;
  let capabilities=connection.available(&AccessProfiles::new(&state.state_directory),&identity)?;
  state.remote_control.store.require_hosted(&connection)?;
  Ok(json!({"protocol":"node_hosted_governance_v1","binding":identity.binding,"capabilities":capabilities}))
 }).await
}
async fn read(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<ReadRequest>)->Response{
 retained(state,move|state|{
  let(connection,identity)=current(&state,&id,&input.binding)?;
  let actual=connection.read(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),&identity,&input.command)?;
  state.remote_control.store.require_hosted(&connection)?;
  Ok(json!({"binding":identity.binding,"value":actual}))
 }).await
}
fn index(state:&ServiceState,connection:&hosted::SessionConnection,identity:&Identity,journal:&utility_operations::Store)->Result<Vec<hosted::Retained>,Error>{
 let key=hosted::recovery_key(&identity.binding);
 let rows=journal.hosted_pending(&key).map_err(|_|Error::Unavailable)?.into_iter().map(|v|serde_json::from_value(v).map_err(|_|Error::Unavailable)).collect::<Result<Vec<hosted::Retained>,Error>>()?;
 let remote=connection.pending(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),identity)?;
 for receipt in remote{
  if !rows.iter().any(|r|r.original.id==receipt.operation_id&&hosted::payload_hash(&r.original).ok().as_deref()==Some(receipt.payload_hash.as_str())){return Err(Error::Conflict);}
 }
 Ok(rows)
}
async fn reserve(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<ReserveRequest>)->Response{
 retained(state,move|state|{
  let(connection,identity)=current(&state,&id,&input.binding)?;
  if !input.command.validate()||!connection.available(&AccessProfiles::new(&state.state_directory),&identity)?.contains(&input.command.capability()){return Err(Error::Forbidden);}
  let mut journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  if !index(&state,&connection,&identity,&journal)?.is_empty(){return Err(Error::Conflict);}
  let original=Original{id:uuid::Uuid::new_v4().to_string(),binding:identity.binding,command:input.command};
  let record=hosted::Retained{original:original.clone(),private_owner:connection.enrollment().clone(),connection:connection.view().clone()};
  // Validate canonical original size before creating a durable barrier.
  hosted::payload_hash(&original)?;
  journal.hosted_reserve(&original.id,&hosted::recovery_key(&original.binding),&value(record)?).map_err(|_|Error::Conflict)
 }).await
}
fn retained_original(state:&ServiceState,input:&OriginalRequest)->Result<(utility_operations::Store,Value,hosted::Retained,Option<Receipt>),Error>{
 if hosted::recovery_key(&input.binding)!=hosted::recovery_key(&input.original.binding){return Err(Error::Forbidden);}
 let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
 let row=journal.hosted_record(&input.original.id,&hosted::recovery_key(&input.binding)).map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
 let record:hosted::Retained=serde_json::from_value(row["record"].clone()).map_err(|_|Error::Unavailable)?;
 if record.original!=input.original{return Err(Error::Conflict);}
 let receipt=if row["result"].is_null(){None}else{Some(serde_json::from_value(row["result"].clone()).map_err(|_|Error::Unavailable)?)};
 Ok((journal,row,record,receipt))
}
fn inspect_exact(state:&ServiceState,connection:&hosted::SessionConnection,identity:&Identity,input:&OriginalRequest)->Result<Value,Error>{
 let(mut journal,row,record,terminal)=retained_original(state,input)?;
 let key=hosted::recovery_key(&input.binding);
 if let Some(receipt)=terminal{
  // Recheck original access at its actual Node owner, including current source permission.
  let actual=connection.inspect(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),identity,&input.original)?;
  if actual.outcome==Outcome::Unknown{return value(receipt);}
  if actual.outcome!=receipt.outcome{return Err(Error::Conflict);}return value(receipt);
 }
 if row["started"]==false{
  let refused=Receipt{original:input.original.clone(),outcome:Outcome::Refused,value:None,error:Some(PublicError{status:None,code:"native_original_never_dispatched".into(),message:"The Native original owner atomically closed this unsent original; no hosted request was replayed.".into()})};
  if journal.hosted_refuse_unstarted(&input.original.id,&key,&value(&record)?,&value(&refused)?).map_err(|_|Error::Unavailable)?{return value(refused);}
 }
 let receipt=connection.inspect(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),identity,&input.original).unwrap_or_else(|_|hosted::unknown(&input.original));
 if receipt.outcome!=Outcome::Unknown{journal.finish(&input.original.id,&value(&receipt)?).map_err(|_|Error::Unavailable)?;}
 value(receipt)
}
async fn send(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<OriginalRequest>)->Response{
 retained(state,move|state|{
  let(connection,identity)=current(&state,&id,&input.binding)?;
  let(mut journal,_row,record,terminal)=retained_original(&state,&input)?;
  if terminal.is_some(){return inspect_exact(&state,&connection,&identity,&input);}
  if input.original.binding!=identity.binding{return Err(Error::Conflict);}
  if !journal.hosted_claim(&input.original.id,&hosted::recovery_key(&input.binding),&value(&record)?).map_err(|_|Error::Unavailable)?{return inspect_exact(&state,&connection,&identity,&input);}
  let receipt=connection.send(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),&identity,&input.original).unwrap_or_else(|_|hosted::unknown(&input.original));
  // Network/decoder/checkpoint ambiguity stays NULL/pending; it is never a refusal or new dispatch.
  if receipt.outcome!=Outcome::Unknown{journal.finish(&input.original.id,&value(&receipt)?).map_err(|_|Error::Unavailable)?;}
  value(receipt)
 }).await
}
async fn inspect(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<OriginalRequest>)->Response{
 retained(state,move|state|{let(connection,identity)=current(&state,&id,&input.binding)?;inspect_exact(&state,&connection,&identity,&input)}).await
}
async fn pending(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,Json(input):Json<OwnerRequest>)->Response{
 retained(state,move|state|{
  let(connection,identity)=current(&state,&id,&input.binding)?;
  let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  value(index(&state,&connection,&identity,&journal)?.into_iter().map(|r|r.original).collect::<Vec<_>>())
 }).await
}

// Closed paired TLS reads for Root's ACTUAL private Node Native-client owner.
// No local service credential or broad proxy crosses this boundary.
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct CustodianQuery{actor_id:String,installation_id:String}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct OriginalProofQuery{actor_id:String,installation_id:String,payload_hash:String}
pub(super) fn paired_router()->Router<Arc<ServiceState>>{
 Router::new().route("/remote/v1/node-hosted/enrollments/{id}/context",get(paired_context))
  .route("/remote/v1/node-hosted/enrollments/{id}/originals/{operation}",get(paired_original))
  .layer(axum::middleware::map_response(|mut r:Response|async move{r.headers_mut().insert(axum::http::header::CACHE_CONTROL,axum::http::HeaderValue::from_static("no-store"));r}))
}
async fn paired_context(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,axum::extract::Query(q):axum::extract::Query<CustodianQuery>,headers:HeaderMap)->Response{
 let(grant,_)=match proxy::authentication(&state,&headers,false).await{Ok(v)=>v,Err(e)=>return problem(e)};
 match blocking(move||{
  let store=&state.remote_control.store;
  let c=store.node_custodian(&grant,&id,&q.actor_id,&q.installation_id)?;
  let owner=native_owner(&state,&c.native_owner.library_id,&c.native_owner.service_instance_id,c.native_owner.project.as_ref().map(|p|p.id.as_str()),c.native_owner.project.as_ref().map(|p|p.revision))?;
  value(store.context_proof(&grant,&c,&owner)?)
 }).await{Ok(v)=>Json(v).into_response(),Err(e)=>problem(e)}
}
async fn paired_original(State(state):State<Arc<ServiceState>>,Path((id,operation)):Path<(String,String)>,axum::extract::Query(q):axum::extract::Query<OriginalProofQuery>,headers:HeaderMap)->Response{
 let(grant,_)=match proxy::authentication(&state,&headers,false).await{Ok(v)=>v,Err(e)=>return problem(e)};
 match blocking(move||{
  let store=&state.remote_control.store;let c=store.node_custodian(&grant,&id,&q.actor_id,&q.installation_id)?;
  let owner=native_owner(&state,&c.native_owner.library_id,&c.native_owner.service_instance_id,c.native_owner.project.as_ref().map(|p|p.id.as_str()),c.native_owner.project.as_ref().map(|p|p.revision))?;
  let proof=store.context_proof(&grant,&c,&owner)?;
  let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let stored=journal.original(&operation,"hosted_governance").map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
  let record:hosted::Retained=serde_json::from_value(stored["original"].clone()).map_err(|_|Error::Unavailable)?;
  if record.original.binding.actor_id!=c.actor_id||record.original.binding.installation_id!=c.installation_id||
    record.private_owner.enrollment_request_id!=id||hosted::payload_hash(&record.original)?!=q.payload_hash{return Err(Error::Forbidden);}
  let claim=journal.hosted_record(&operation,&hosted::recovery_key(&record.original.binding)).map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
  if claim["started"]!=true{return Err(Error::Forbidden);}
  Ok(json!({"protocol":"node_hosted_native_original_v1","context":proof,"operation_id":operation,"payload_hash":q.payload_hash,"dispatch_claimed":true}))
 }).await{Ok(v)=>Json(v).into_response(),Err(e)=>problem(e)}
}

// Existing native account credential-file UI supplies metadata only; no email/password/code/cookie fields.
pub(super) fn account_router()->Router<Arc<ServiceState>>{
 Router::new().route("/connections",get(hosted_connections)).route("/pairing-commands",post(pairing_command)).route("/account-commands",post(account_command)).route("/account-originals/{id}",get(account_original))
  .layer(axum::extract::DefaultBodyLimit::max(128*1024))
}
async fn account_command(State(state):State<Arc<ServiceState>>,Json(input):Json<hosted::AccountCommand>)->Response{
 retained(state,move|state|{
  let actual=native_owner(&state,&input.native_owner.library_id,&input.native_owner.service_instance_id,input.native_owner.project.as_ref().map(|p|p.id.as_str()),input.native_owner.project.as_ref().map(|p|p.revision))?;
  if json!(actual)!=json!(input.native_owner){return Err(Error::Conflict);}
  let mut journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let original=json!({"protocol":"node_hosted_account_v1","command":input});
  if let Some(row)=journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?{
   return if row["original"]==original{Ok(row)}else{Err(Error::Conflict)};
  }
  journal.begin(&input.operation_id,"remote_admin",&original).map_err(|_|Error::Conflict)?;
  let result=match hosted::sign_in(&state.state_directory,&input){
   Ok(status)=>json!({"state":"completed","value":status}),
   Err(_)=>json!({"state":"unconfirmed","code":"node_hosted_account_unconfirmed","message":"The consumed original remains retained; do not replay login or MFA."})
  };
  journal.finish(&input.operation_id,&result).map_err(|_|Error::Unavailable)?;
  journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::Unavailable)
 }).await
}
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct AccountOriginalQuery{library_id:String}
async fn account_original(State(state):State<Arc<ServiceState>>,Path(id):Path<String>,axum::extract::Query(query):axum::extract::Query<AccountOriginalQuery>)->Response{
 match blocking(move||{
  if library(&state)?!=query.library_id{return Err(Error::Forbidden);}
  let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let row=journal.original(&id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
  if !["node_hosted_account_v1","node_hosted_pairing_v1"].contains(&row["original"]["protocol"].as_str().unwrap_or(""))||row["original"]["command"].get("native_owner").or_else(||row["original"]["command"]["account"].get("native_owner")).and_then(|n|n.get("library_id")).and_then(Value::as_str)!=Some(query.library_id.as_str()){return Err(Error::Forbidden);}Ok(row)
 }).await{Ok(value)=>Json(value).into_response(),Err(e)=>problem(e)}
}

async fn hosted_connections(State(state):State<Arc<ServiceState>>)->Response{
 match blocking(move||state.remote_control.store.hosted_connections()).await{Ok(rows)=>Json(json!({"connections":rows})).into_response(),Err(e)=>problem(e)}
}

enum CeremonyStart {Existing(Value),Prepared(hosted::PreparedPairing,hosted::ceremony::Publication)}
async fn pairing_command(State(state):State<Arc<ServiceState>>,Json(input):Json<hosted::ceremony::PairingCommand>)->Response{
 let input=Arc::new(input);let control=state.remote_control.clone();let worker=state.clone();
 let(tx,rx)=tokio::sync::oneshot::channel();
 if let Err(e)=control.retain(format!("hosted-pair:{}",input.account.operation_id),async move{
  let _serial=worker.serial.clone().lock_owned().await;
  let guard=worker.remote_control.commands.clone().lock_owned().await;
  let listener=worker.remote_control.listener.lock().await;
  if !listener.as_ref().is_some_and(|l|!l.task.is_finished()&&!*l.stop.borrow()){let _=tx.send(Err(Error::Unavailable));return;}
  let listener_revision=worker.remote_control.listener_revision.load(Ordering::SeqCst);drop(listener);
  let prepare_worker=worker.clone();let prepare_input=input.clone();
  let started=blocking(move||{
   let _commands=guard;
   if prepare_worker.draining.load(Ordering::SeqCst){return Err(Error::Unavailable);}
   let command=&prepare_input.account;
   let actual=native_owner(&prepare_worker,&command.native_owner.library_id,&command.native_owner.service_instance_id,command.native_owner.project.as_ref().map(|p|p.id.as_str()),command.native_owner.project.as_ref().map(|p|p.revision))?;
   if json!(actual)!=json!(command.native_owner){return Err(Error::Conflict);}
   let mut journal=utility_operations::Store::open(&prepare_worker.state_directory).map_err(|_|Error::Unavailable)?;
   let original=json!({"protocol":"node_hosted_pairing_v1","command":&*prepare_input});
   if let Some(row)=journal.original(&command.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?{
    return if row["original"]==original{Ok(CeremonyStart::Existing(row))}else{Err(Error::Conflict)};
   }
   journal.begin(&command.operation_id,"remote_admin",&original).map_err(|_|Error::Conflict)?;
   let publication=prepare_worker.remote_control.store.pairing_publication()?;
   let prepared=prepare_worker.remote_control.store.prepare_hosted_pairing(&prepare_worker.state_directory,command,prepare_input.pairing_policy.clone())?;
   Ok(CeremonyStart::Prepared(prepared,publication))
  }).await;
  let result=match started{
   Ok(CeremonyStart::Existing(row))=>Ok(row),
   Ok(CeremonyStart::Prepared(prepared,publication))=>{
    // No command guard here: Node must redeem our /remote/v1/pair, which takes it.
    // Serial and retained worker remain owned across the await and HTTP disconnect.
    let publish_worker=worker.clone();let publish_input=input.clone();
    let published=blocking(move||publish_worker.remote_control.store.publish_hosted_pairing(&publish_worker.state_directory,&publish_input,prepared,publication)).await;
    let guard=worker.remote_control.commands.clone().lock_owned().await;
    blocking(move||{
     let _commands=guard;let command=&input.account;
     let finish=(||{
      published?;
      if worker.draining.load(Ordering::SeqCst)||worker.remote_control.listener_revision.load(Ordering::SeqCst)!=listener_revision{return Err(Error::Conflict);}
      let actual=native_owner(&worker,&command.native_owner.library_id,&command.native_owner.service_instance_id,command.native_owner.project.as_ref().map(|p|p.id.as_str()),command.native_owner.project.as_ref().map(|p|p.revision))?;
      if json!(actual)!=json!(command.native_owner){return Err(Error::Conflict);}
      worker.remote_control.store.enroll_hosted(&worker.state_directory,command,&input.hosted_project_id,input.visibility.clone(),input.governance_policy.clone(),input.name.clone())
     })();
     let receipt=match finish{Ok(view)=>json!({"state":"completed","value":view}),Err(_)=>json!({"state":"unconfirmed","code":"node_hosted_pairing_unconfirmed","message":"Original retained; inspect without replaying pairing or enrollment."})};
     let mut journal=utility_operations::Store::open(&worker.state_directory).map_err(|_|Error::Unavailable)?;
     journal.finish(&command.operation_id,&receipt).map_err(|_|Error::Unavailable)?;
     journal.original(&command.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::Unavailable)
    }).await
   },
   Err(e)=>Err(e)
  };
  let _=tx.send(result);
 }){return problem(e);}
 match rx.await{Ok(Ok(v))=>Json(v).into_response(),Ok(Err(e))=>problem(e),Err(_)=>problem(Error::Unavailable)}
}