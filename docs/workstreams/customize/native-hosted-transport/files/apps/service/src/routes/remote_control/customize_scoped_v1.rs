//! Fixed local RPC and paired TLS proof endpoints for the distinct scoped consent owner.
use super::hosted_governance::{current, native_owner, retained};
use super::*;
use veyra_adapters::remote_control::hosted::contracts::Binding;
use veyra_adapters::{
    access_profiles::AccessProfiles,
    account_vault::AccountVault,
    remote_control::hosted::{
        self,
        customize_scoped_v1::{self as scoped, contracts::*},
    },
    utility_operations,
};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Owner {
    consent_id: String,
    base_binding: Binding,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reserve {
    consent_id: String,
    base_binding: Binding,
    command: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OriginalInput {
    original: Original,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Context {
    library_id: String,
    service_instance_id: String,
    project: Option<veyra_contracts::Project>,
}
pub(super) fn router() -> Router<Arc<ServiceState>> {
    Router::new()
        .route("/context", post(context))
        .route("/binding", post(binding))
        .route("/consents", post(consent))
        .route("/consent-reconciliation", post(consent_reconciliation))
        .route("/consent-revocation", post(consent_revocation))
        .route("/read", post(read))
        .route("/reserve", post(reserve))
        .route("/send", post(send))
        .route("/inspect", post(inspect))
        .route("/pending", post(pending))
        .layer(axum::extract::DefaultBodyLimit::max(2_100_000))
        .layer(axum::middleware::map_response(
            |mut r: Response| async move {
                r.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("no-store"),
                );
                r
            },
        ))
}
fn json_value(value: impl serde::Serialize) -> Result<Value, Error> {
    serde_json::to_value(value).map_err(|_| Error::Unavailable)
}
fn exact(
    state: &ServiceState,
    id: &str,
    consent_id: &str,
    b: &Binding,
) -> Result<
    (
        hosted::SessionConnection,
        hosted::contracts::Identity,
        Consent,
    ),
    Error,
> {
    let (connection, identity) = current(state, id, b)?;
    let consent = state.remote_control.store.scoped_consent(consent_id, id)?;
    if consent.state != ConsentState::Active || consent.original.base_binding != *b {
        return Err(Error::Forbidden);
    }
    Ok((connection, identity, consent))
}
async fn context(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<Context>,
) -> Response {
    retained(state,move|state|{
  let owner=native_owner(&state,&input.library_id,&input.service_instance_id,input.project.as_ref().map(|p|p.id.as_str()),input.project.as_ref().map(|p|p.revision))?;
  if json!(owner.project)!=json!(input.project){return Err(Error::Conflict);}
  let connection=state.remote_control.store.hosted(&id)?;
  let review=connection.scoped_review(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),&owner)?;
  state.remote_control.store.require_hosted(&connection)?;
  Ok(json!({"protocol":PROTOCOL,"reviewSha256":scoped::request_hash(&review)?,"review":review,"consents":state.remote_control.store.scoped_inventory(&id)?}))
 }).await
}
async fn binding(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<Owner>,
) -> Response {
    retained(state, move |state| {
        let (connection, identity, consent) =
            exact(&state, &id, &input.consent_id, &input.base_binding)?;
        let profiles = AccessProfiles::new(&state.state_directory);
        let (verbs, local, parent) =
            scoped::policy::proof_profiles(&profiles, &consent, &identity)?;
        let actual =
            connection.scoped_context(&AccountVault::new(&state.state_directory), &consent)?;
        let node_verbs: Vec<Verb> = serde_json::from_value(actual["capabilities"].clone())
            .map_err(|_| Error::Unavailable)?;
        if node_verbs.iter().any(|v| !verbs.contains(v))
            || actual["localProfileRevision"] != local
            || actual["parentProfileRevision"] != parent
        {
            return Err(Error::Conflict);
        }
        state.remote_control.store.require_hosted(&connection)?;
        Ok(actual)
    })
    .await
}
async fn consent(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<scoped::ConsentCommand>,
) -> Response {
    retained(state,move|state|{
  let n=&input.review.native_owner;
  let owner=native_owner(&state,&n.library_id,&n.service_instance_id,n.project.as_ref().map(|p|p.id.as_str()),n.project.as_ref().map(|p|p.revision))?;
  if json!(owner)!=json!(input.review.native_owner){return Err(Error::Conflict);}
  let connection=state.remote_control.store.hosted(&id)?;
  if connection.view().id!=input.review.base_binding.connection_id{return Err(Error::Conflict);}
  let mut journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let original=json!({"protocol":"customize_scoped_consent_command_v1","command":input,"private_owner":connection.enrollment()});
  if let Some(old)=journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?{return if old["original"]==original{Ok(old)}else{Err(Error::Conflict)};}
  if journal.hosted_resource_has_custody(&connection.enrollment().enrollment_request_id).map_err(|_|Error::Unavailable)?{return Err(Error::Conflict);}
  journal.begin(&input.operation_id,"remote_admin",&original).map_err(|_|Error::Conflict)?;
  let result=match connection.scoped_consent_command(&state.state_directory,&state.remote_control.store,&input,&owner){Ok(value)=>json!({"state":"completed","value":value}),Err(_)=>json!({"state":"unconfirmed","code":"scoped_consent_unconfirmed","message":"The original remains consumed. Read its metadata; do not replay consent or authentication."})};
  journal.finish(&input.operation_id,&result).map_err(|_|Error::Unavailable)?;
  journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::Unavailable)
 }).await
}
async fn read(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<ReadRequest>,
) -> Response {
    retained(state,move|state|{
  let consent=state.remote_control.store.scoped_consent(&input.consent_id,&id)?;
  let(connection,identity,consent)=exact(&state,&id,&consent.original.id,&consent.original.base_binding)?;
  let value=connection.scoped_read(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),&consent,&identity,&input)?;
  state.remote_control.store.require_hosted(&connection)?;Ok(json!({"protocol":PROTOCOL,"consentId":consent.original.id,"consentRevision":consent.revision,"value":value}))
 }).await
}
async fn reserve(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(mut input): Json<Reserve>,
) -> Response {
    retained(state, move |state| {
        let (connection, identity, consent) =
            exact(&state, &id, &input.consent_id, &input.base_binding)?;
        let verb: Verb =
            serde_json::from_value(input.command["op"].clone()).map_err(|_| Error::Invalid)?;
        scoped::policy::current(
            &AccessProfiles::new(&state.state_directory),
            &consent,
            &identity,
            verb,
        )?;
        let live =
            connection.scoped_context(&AccountVault::new(&state.state_directory), &consent)?;
        let live_verbs: Vec<Verb> =
            serde_json::from_value(live["capabilities"].clone()).map_err(|_| Error::Unavailable)?;
        if !live_verbs.contains(&verb) {
            return Err(Error::Forbidden);
        }
        if !verb.mutating() || input.command.get("operationId").is_some() {
            return Err(Error::Invalid);
        }
        let operation = uuid::Uuid::new_v4().to_string();
        input
            .command
            .as_object_mut()
            .ok_or(Error::Invalid)?
            .insert("operationId".into(), json!(operation));
        if !Command::validate(&input.command) {
            return Err(Error::Invalid);
        }
        let original = Original {
            protocol: PROTOCOL.into(),
            id: operation,
            consent_id: consent.original.id.clone(),
            consent_revision: consent.revision,
            consent_request_sha256: consent.request_sha256.clone(),
            base_binding: identity.binding,
            command: input.command,
        };
        scoped::request_hash(&original)?;
        let mut journal = utility_operations::Store::open(&state.state_directory)
            .map_err(|_| Error::Unavailable)?;
        if journal
            .hosted_resource_has_custody(&connection.enrollment().enrollment_request_id)
            .map_err(|_| Error::Unavailable)?
        {
            return Err(Error::Conflict);
        }
        let record = scoped::Retained {
            original: original.clone(),
            private_owner: connection.enrollment().clone(),
            connection: connection.view().clone(),
            scope_owner: consent.clone(),
        };
        journal
            .hosted_reserve(
                &original.id,
                &scoped::recovery_key(&consent),
                &json_value(record)?,
            )
            .map_err(|_| Error::Conflict)
    })
    .await
}
fn original_record(
    state: &ServiceState,
    id: &str,
    original: &Original,
) -> Result<(utility_operations::Store, Value, scoped::Retained, Consent), Error> {
    let consent = state
        .remote_control
        .store
        .scoped_consent(&original.consent_id, id)?;
    if original.base_binding != consent.original.base_binding
        || original.consent_revision != consent.revision
        || original.consent_request_sha256 != consent.request_sha256
    {
        return Err(Error::Conflict);
    }
    let journal =
        utility_operations::Store::open(&state.state_directory).map_err(|_| Error::Unavailable)?;
    let row = journal
        .hosted_record(&original.id, &scoped::recovery_key(&consent))
        .map_err(|_| Error::Unavailable)?
        .ok_or(Error::NotFound)?;
    let record: scoped::Retained =
        serde_json::from_value(row["record"].clone()).map_err(|_| Error::Unavailable)?;
    if json!(record.original) != json!(original)
        || record.scope_owner.request_sha256 != consent.request_sha256
        || record.private_owner.enrollment_request_id
            != state
                .remote_control
                .store
                .hosted(id)?
                .enrollment()
                .enrollment_request_id
    {
        return Err(Error::Forbidden);
    }
    Ok((journal, row, record, consent))
}
fn unknown(original: &Original) -> Result<Value, Error> {
    Ok(
        json!({"original":original,"outcome":"unknown","receipt":{"protocol":PROTOCOL,"operationId":original.id,"nativeRequestSha256":scoped::request_hash(original)?,"consentId":original.consent_id,"outcome":"unknown","value":null,"error":{"code":"scoped_original_unconfirmed"}}}),
    )
}
fn inspect_original(state: &ServiceState, id: &str, original: &Original) -> Result<Value, Error> {
    let (mut journal, row, record, consent) = original_record(state, id, original)?;
    if !row["result"].is_null() {
        return Ok(row["result"].clone());
    }
    let key = scoped::recovery_key(&consent);
    if row["started"] == false {
        let refusal = json!({"original":original,"outcome":"refused","receipt":{"protocol":PROTOCOL,"operationId":original.id,"nativeRequestSha256":scoped::request_hash(original)?,"consentId":original.consent_id,"outcome":"refused","value":null,"error":{"code":"native_original_never_dispatched"}}});
        if journal
            .hosted_refuse_unstarted(&original.id, &key, &row["record"], &refusal)
            .map_err(|_| Error::Unavailable)?
        {
            return Ok(refusal);
        }
    }
    let connection = state.remote_control.store.hosted(id)?;
    match connection.scoped_receipt(
        &AccountVault::new(&state.state_directory),
        &consent,
        original,
    ) {
        Ok(metadata) if metadata["outcome"] != "unknown" => {
            let result = json!({"original":record.original,"outcome":metadata["outcome"],"receipt":{"protocol":PROTOCOL,"operationId":original.id,"nativeRequestSha256":scoped::request_hash(original)?,"consentId":original.consent_id,"outcome":metadata["outcome"],"value":null,"error":if metadata["code"].is_null(){Value::Null}else{json!({"code":metadata["code"]})}},"recovery":{"liveBinding":false,"domainReadback":"not_requested"}});
            journal
                .finish(&original.id, &result)
                .map_err(|_| Error::Unavailable)?;
            Ok(result)
        }
        _ => unknown(original),
    }
}
async fn send(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<OriginalInput>,
) -> Response {
    retained(state, move |state| {
        let (connection, identity, consent) = exact(
            &state,
            &id,
            &input.original.consent_id,
            &input.original.base_binding,
        )?;
        let (mut journal, row, record, _) = original_record(&state, &id, &input.original)?;
        if !row["result"].is_null() {
            return Ok(row["result"].clone());
        }
        if row["started"] == true {
            return inspect_original(&state, &id, &input.original);
        }
        let verb: Verb = serde_json::from_value(input.original.command["op"].clone())
            .map_err(|_| Error::Invalid)?;
        let live = connection.scoped_context(&AccountVault::new(&state.state_directory), &consent);
        let live_allowed = live
            .ok()
            .and_then(|v| serde_json::from_value::<Vec<Verb>>(v["capabilities"].clone()).ok())
            .is_some_and(|v| v.contains(&verb));
        if !live_allowed {
            return inspect_original(&state, &id, &input.original);
        }
        if scoped::policy::admit(
            &AccessProfiles::new(&state.state_directory),
            &consent,
            &identity,
            &input.original,
            verb,
        )
        .is_err()
        {
            return inspect_original(&state, &id, &input.original);
        }
        if !journal
            .hosted_claim(
                &input.original.id,
                &scoped::recovery_key(&consent),
                &json_value(record)?,
            )
            .map_err(|_| Error::Unavailable)?
        {
            return inspect_original(&state, &id, &input.original);
        }
        let receipt = match connection.scoped_send(
            &AccountVault::new(&state.state_directory),
            &AccessProfiles::new(&state.state_directory),
            &consent,
            &identity,
            &input.original,
        ) {
            Ok(v) => v,
            Err(_) => return unknown(&input.original),
        };
        let result = json!({"original":input.original,"outcome":receipt.outcome,"receipt":receipt});
        if receipt.outcome != Outcome::Unknown {
            journal
                .finish(&input.original.id, &result)
                .map_err(|_| Error::Unavailable)?;
        }
        Ok(result)
    })
    .await
}
async fn inspect(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<OriginalInput>,
) -> Response {
    retained(state, move |state| {
        inspect_original(&state, &id, &input.original)
    })
    .await
}
async fn pending(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<Owner>,
) -> Response {
    retained(state,move|state|{
  let consent=state.remote_control.store.scoped_consent(&input.consent_id,&id)?;if input.base_binding!=consent.original.base_binding{return Err(Error::Forbidden);}
  let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let values=journal.hosted_pending(&scoped::recovery_key(&consent)).map_err(|_|Error::Unavailable)?;
  Ok(json!({"protocol":PROTOCOL,"consentId":consent.original.id,"originals":values.into_iter().map(|v|v["original"].clone()).collect::<Vec<_>>(),"liveBinding":false}))
 }).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofQuery {
    actor_id: String,
    installation_id: String,
    purpose: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OriginalQuery {
    actor_id: String,
    installation_id: String,
    payload_hash: String,
}
pub(super) fn paired_router() -> Router<Arc<ServiceState>> {
    Router::new().route("/remote/v1/node-hosted/enrollments/{id}/customize-scoped-v1/consents/{consent}",get(paired_consent))
 .route("/remote/v1/node-hosted/enrollments/{id}/customize-scoped-v1/consents/{consent}/originals/{operation}",get(paired_original))
 .layer(axum::middleware::map_response(|mut r:Response|async move{r.headers_mut().insert(axum::http::header::CACHE_CONTROL,axum::http::HeaderValue::from_static("no-store"));r}))
}
fn proof(
    state: &ServiceState,
    grant: &veyra_adapters::remote_control::GrantView,
    enrollment: &str,
    consent_id: &str,
    actor: &str,
    installation: &str,
    purpose: &str,
) -> Result<Proof, Error> {
    let store = &state.remote_control.store;
    let custodian = store.node_custodian(grant, enrollment, actor, installation)?;
    let owner = native_owner(
        state,
        &custodian.native_owner.library_id,
        &custodian.native_owner.service_instance_id,
        custodian
            .native_owner
            .project
            .as_ref()
            .map(|p| p.id.as_str()),
        custodian.native_owner.project.as_ref().map(|p| p.revision),
    )?;
    let context = json_value(store.context_proof(grant, &custodian, &owner)?)?;
    let consent = store.scoped_for_enrollment(consent_id, enrollment, actor, installation)?;
    if json!(owner) != json!(consent.original.native_owner) {
        return Err(Error::Conflict);
    }
    store.scoped_local_proof(
        consent_id,
        &consent.original.base_binding.connection_id,
        context,
        &AccessProfiles::new(&state.state_directory),
        purpose,
    )
}
async fn paired_consent(
    State(state): State<Arc<ServiceState>>,
    Path((enrollment, consent)): Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<ProofQuery>,
    headers: HeaderMap,
) -> Response {
    let (grant, _) = match proxy::authentication(&state, &headers, false).await {
        Ok(v) => v,
        Err(e) => return problem(e),
    };
    match blocking(move || {
        json_value(proof(
            &state,
            &grant,
            &enrollment,
            &consent,
            &q.actor_id,
            &q.installation_id,
            &q.purpose,
        )?)
    })
    .await
    {
        Ok(value) => Json(value).into_response(),
        Err(e) => problem(e),
    }
}
async fn paired_original(
    State(state): State<Arc<ServiceState>>,
    Path((enrollment, consent, operation)): Path<(String, String, String)>,
    axum::extract::Query(q): axum::extract::Query<OriginalQuery>,
    headers: HeaderMap,
) -> Response {
    let (grant, _) = match proxy::authentication(&state, &headers, false).await {
        Ok(v) => v,
        Err(e) => return problem(e),
    };
    match blocking(move||{
  let mut proof=proof(&state,&grant,&enrollment,&consent,&q.actor_id,&q.installation_id,"domain")?;
  let c=state.remote_control.store.scoped_for_enrollment(&consent,&enrollment,&q.actor_id,&q.installation_id)?;
  let journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let row=journal.hosted_record(&operation,&scoped::recovery_key(&c)).map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
  let record:scoped::Retained=serde_json::from_value(row["record"].clone()).map_err(|_|Error::Unavailable)?;
  if row["started"]!=true||record.original.consent_id!=consent||record.private_owner.enrollment_request_id!=enrollment||scoped::request_hash(&record.original)?!=q.payload_hash{return Err(Error::Forbidden);}
  let connection=state.remote_control.store.hosted(&c.original.base_binding.connection_id)?;
  let admitted=scoped::policy::verify_admitted(&AccessProfiles::new(&state.state_directory),&c,&connection.enrollment().identity,&record.original)?;
  if !proof.effective_verbs.contains(&admitted){proof.effective_verbs.push(admitted);}
  Ok(json!({"protocol":"customize-scoped-v1-original","proof":proof,"operationId":operation,"nativeRequestSha256":q.payload_hash,"dispatchClaimed":true}))
 }).await{Ok(value)=>Json(value).into_response(),Err(e)=>problem(e)}
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsentReconciliation {
    operation_id: String,
    consent_id: String,
    source_operation_id: String,
    request_sha256: String,
}
async fn consent_reconciliation(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<ConsentReconciliation>,
) -> Response {
    retained(state,move|state|{
  if input.consent_id!=input.source_operation_id||!utility_operations::canonical(&input.operation_id)||input.operation_id==input.source_operation_id{return Err(Error::Invalid);}
  let consent=state.remote_control.store.scoped_consent(&input.consent_id,&id)?;
  if consent.request_sha256!=input.request_sha256{return Err(Error::Conflict);}
  let n=&consent.original.native_owner;
  let owner=native_owner(&state,&n.library_id,&n.service_instance_id,n.project.as_ref().map(|p|p.id.as_str()),n.project.as_ref().map(|p|p.revision))?;
  if json!(owner)!=json!(n){return Err(Error::Conflict);}
  let connection=state.remote_control.store.hosted(&id)?;
  let mut journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  let source=journal.original(&input.source_operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
  if source["original"]["protocol"]!="customize_scoped_consent_command_v1"||source["original"]["command"]["operationId"]!=input.consent_id||source["original"]["private_owner"]["enrollment_request_id"]!=connection.enrollment().enrollment_request_id{return Err(Error::Forbidden);}
  let source_input:scoped::ConsentCommand=serde_json::from_value(source["original"]["command"].clone()).map_err(|_|Error::Unavailable)?;
  if source_input.review_sha256!=consent.original.review_sha256||source_input.review_sha256!=scoped::request_hash(&source_input.review)?||source_input.review.base_binding!=consent.original.base_binding||source_input.review.account_id!=consent.original.account_id||json!(source_input.review.native_owner)!=json!(consent.original.native_owner)||json!(source_input.selection)!=json!(consent.original.selection)||json!(source_input.local_policy)!=json!(consent.original.local_policy)||source["original"]["private_owner"]["account_review"]["account"]["id"]!=consent.original.account_id||source["original"]["private_owner"]["native_owner"]!=json!(consent.original.native_owner){return Err(Error::Forbidden);}
  let original=json!({"protocol":"customize_scoped_consent_reconciliation_v1","command":input,"source_operation_id":input.source_operation_id,"source_original":source["original"],"private_owner":connection.enrollment()});
  if let Some(old)=journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?{return if old["original"]==original{Ok(old)}else{Err(Error::Conflict)};}
  journal.begin(&input.operation_id,"remote_admin",&original).map_err(|_|Error::Conflict)?;
  let result=match connection.scoped_reconcile_registration(&AccountVault::new(&state.state_directory),&AccessProfiles::new(&state.state_directory),&state.remote_control.store,&consent,&owner){
   Ok(actual)=>json!({"state":"completed","value":{"registration_confirmed":true,"consent":actual,"proof":"actual_Node_registration_fresh_parent_and_managed_profiles","physical_erasure":false}}),
   Err(_)=>json!({"state":"unconfirmed","code":"scoped_consent_reconciliation_unconfirmed","message":"Current authority or the original registration could not be proved; no consent was replayed."})
  };journal.finish(&input.operation_id,&result).map_err(|_|Error::Unavailable)?;
  journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::Unavailable)
 }).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsentRevocation {
    operation_id: String,
    consent_id: String,
    request_sha256: String,
}
async fn consent_revocation(
    State(state): State<Arc<ServiceState>>,
    Path(id): Path<String>,
    Json(input): Json<ConsentRevocation>,
) -> Response {
    retained(state,move|state|{
  if !utility_operations::canonical(&input.operation_id){return Err(Error::Invalid);}
  let consent=state.remote_control.store.scoped_consent(&input.consent_id,&id)?;
  if consent.request_sha256!=input.request_sha256{return Err(Error::Conflict);}
  let connection=state.remote_control.store.hosted(&id)?;
  let mut journal=utility_operations::Store::open(&state.state_directory).map_err(|_|Error::Unavailable)?;
  if journal.library_id().map_err(|_|Error::Unavailable)?!=consent.original.native_owner.library_id{return Err(Error::Forbidden);}
  let original=json!({"protocol":"customize_scoped_consent_revocation_v1","command":input,"private_owner":connection.enrollment()});
  if let Some(old)=journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?{return if old["original"]==original{Ok(old)}else{Err(Error::Conflict)};}
  journal.begin(&input.operation_id,"remote_admin",&original).map_err(|_|Error::Conflict)?;
  let result=match connection.scoped_revoke(&state.state_directory,&state.remote_control.store,&consent){
   Ok(value)=>json!({"state":"completed","value":value}),
   Err(_)=>json!({"state":"unconfirmed","code":"scoped_consent_revocation_unconfirmed","message":"Local access may already be denied; inspect the retained original. No physical erasure or remote outcome is inferred."})
  };journal.finish(&input.operation_id,&result).map_err(|_|Error::Unavailable)?;
  journal.original(&input.operation_id,"remote_admin").map_err(|_|Error::Unavailable)?.ok_or(Error::Unavailable)
 }).await
}
