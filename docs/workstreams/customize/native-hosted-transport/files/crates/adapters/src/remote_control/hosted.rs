//! Explicit NodeHosted capability domain in the existing saved-connection owner.
//! Native paired requests never enter this domain; neither credentials nor URLs come from the renderer.
use super::*;
use crate::account_vault::{AccountVault,node_hosted::{AccountReview,Target}};
use crate::access_profiles::AccessProfiles;
pub mod contracts;
pub mod attestation;
mod wire;
pub use wire::{payload_hash,RemotePending};
use contracts::*;

#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
 pub protocol:String,pub enrollment_request_id:String,pub native_owner:NativeOwner,pub identity:Identity,pub account_review:AccountReview,
 pub dashboard_origin:String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustFile {pub endpoint:String,pub certificate_pem:String,pub certificate_sha256:String,pub dashboard_origin:String}
pub struct TrustedEnrollment {pub(crate) trust:TrustFile,pub sha256:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Retained {pub original:Original,pub private_owner:Enrollment,pub connection:ConnectionView}
pub struct SessionConnection {saved:StoredConnection,client:reqwest::blocking::Client}
fn account_error(_:crate::account_vault::Error)->Error{Error::Forbidden}
impl Store {
 pub fn hosted_connections(&self)->Result<Vec<Value>,Error>{
  self.access(|db|db.connections.values().filter_map(|c|c.node_hosted.as_ref().map(|e|json!({"id":c.view.id,"name":c.view.name,"protocol":e.protocol,
    "actor_id":e.identity.binding.actor_id,"installation_id":e.identity.binding.installation_id,"hosted_project_id":e.identity.binding.hosted_project_id,
    "native_owner":e.native_owner,"account_id":e.account_review.account.id}))).map(Ok).collect(),false)
 }
 pub fn hosted(&self,id:&str)->Result<SessionConnection,Error>{
  let saved=self.access(|db|db.connections.get(id).cloned().ok_or(Error::NotFound),false)?;
  let enrollment=saved.node_hosted.as_ref().ok_or(Error::Forbidden)?;
  if enrollment.protocol!="node_hosted_governance_v1"{return Err(Error::Forbidden);}
  let client=super::client::pinned_client(&saved.certificate_pem,&saved.view.certificate_sha256)?;
  Ok(SessionConnection{saved,client})
 }
 pub fn save_hosted(&self,id:String,name:String,trust:TrustedEnrollment,enrollment:Enrollment)->Result<ConnectionView,Error>{
  if !crate::utility_operations::canonical(&id)||enrollment.identity.binding.connection_id!=id||enrollment.protocol!="node_hosted_governance_v1"||
    enrollment.identity.binding.actor_id!=enrollment.identity.session_actor_id {return Err(Error::Invalid);}
  let grant=policy_grant(&enrollment.identity);
  validate_scope(&grant.scope)?;
  let view=ConnectionView{id,name,endpoint:trust.trust.endpoint,certificate_sha256:trust.trust.certificate_sha256,
   authority_id:enrollment.identity.binding.authority_id.clone(),service_instance:enrollment.identity.binding.hosted_service_instance_id.clone(),
   scope:grant.scope};
  let saved=StoredConnection{view:view.clone(),certificate_pem:trust.trust.certificate_pem,protected_token:None,token:None,grant_id:Some(enrollment.identity.binding.grant_id.clone()),node_hosted:Some(enrollment)};
  self.access(|db|{if db.connections.contains_key(&view.id)||db.connections.len()>=64{return Err(Error::Conflict);}db.connections.insert(view.id.clone(),saved);Ok(view)},true)
 }
 pub fn require_hosted(&self,connection:&SessionConnection)->Result<(),Error>{
  self.access(|db|{
   let current=db.connections.get(&connection.saved.view.id).ok_or(Error::NotFound)?;
   if json!(current.view)!=json!(connection.saved.view)||json!(current.node_hosted)!=json!(connection.saved.node_hosted){return Err(Error::Conflict);}Ok(())
  },false)
 }
}
impl SessionConnection {
 pub fn enrollment(&self)->&Enrollment{self.saved.node_hosted.as_ref().expect("validated typed connection")}
 pub fn view(&self)->&ConnectionView{&self.saved.view}
 fn target(&self)->Target<'_>{Target{client:&self.client,endpoint:&self.saved.view.endpoint,dashboard_origin:&self.enrollment().dashboard_origin,connection_id:&self.saved.view.id}}
 /// Current identity is supplied by the Node principal/project authority, never from ConnectionView metadata.
 pub fn identity(&self,vault:&AccountVault,owner:&NativeOwner)->Result<Identity,Error>{
  let e=self.enrollment();let target=self.target();
  if owner.library_id!=e.native_owner.library_id||owner.project.as_ref().map(|p|&p.id)!=e.native_owner.project.as_ref().map(|p|&p.id){return Err(Error::Conflict);}
  vault.with_node_hosted_session(&target,&e.account_review,|session|{
   let actual=wire::identity(&target,&session,&e.identity.binding.grant_id).map_err(|_|crate::account_vault::Error::Conflict)?;
   if actual.binding.connection_id!=self.saved.view.id||
    actual.binding.authority_id!=e.identity.binding.authority_id||actual.binding.installation_id!=e.identity.binding.installation_id||
    actual.binding.actor_id!=session.actor_id||actual.session_actor_id!=session.actor_id||
    actual.binding.hosted_project_id!=e.identity.binding.hosted_project_id||
    actual.binding.native_library_id!=owner.library_id||actual.binding.native_service_instance_id!=owner.service_instance_id||
    actual.binding.native_project_id.as_deref()!=owner.project.as_ref().map(|p|p.id.as_str())||
    actual.binding.native_project_revision!=owner.project.as_ref().map(|p|p.revision)||

    actual.capabilities.iter().any(|c|!e.identity.capabilities.contains(c)){return Err(crate::account_vault::Error::Conflict);}
   Ok(actual)
  }).map_err(account_error)
 }
 fn authorized(&self,profiles:&AccessProfiles,identity:&Identity,write:bool)->Result<(),Error>{
  if !profiles.inventory().map_err(|_|Error::Forbidden)?.iter().any(|p|p.grant_id==identity.binding.grant_id){return Err(Error::Forbidden);}
  let grant=profiles.effective_grant(&policy_grant(identity),now()).map_err(|_|Error::Forbidden)?;
  let required=if write{"hosted_governance_write"}else{"hosted_governance_read"};
  if !grant.scope.permissions.iter().any(|p|p==required){return Err(Error::Forbidden);}Ok(())
 }
 pub fn read(&self,vault:&AccountVault,profiles:&AccessProfiles,current:&Identity,command:&Read)->Result<Value,Error>{
  self.authorized(profiles,current,false)?;
  if !current.capabilities.contains(&command.capability()){return Err(Error::Forbidden);}
  vault.with_node_hosted_session(&self.target(),&self.enrollment().account_review,|s|wire::read(&self.target(),&s,&current.binding,command).map_err(|_|crate::account_vault::Error::Conflict)).map_err(account_error)
 }
 pub fn available(&self,profiles:&AccessProfiles,current:&Identity)->Result<Vec<Capability>,Error>{
  self.authorized(profiles,current,false)?;
  let writable=self.authorized(profiles,current,true).is_ok();
  Ok(current.capabilities.iter().copied().filter(|c|match c{
   Capability::SynthesisRun|Capability::SynthesisModels=>false,
   Capability::Create|Capability::Save|Capability::Archive|Capability::Restore|Capability::Enable|Capability::Disable|Capability::Submit|Capability::Approve|Capability::Reject|Capability::Rollback=>writable,
   _=>true
  }).collect())
 }
 pub fn pending(&self,vault:&AccountVault,profiles:&AccessProfiles,current:&Identity)->Result<Vec<RemotePending>,Error>{
  self.authorized(profiles,current,false)?;
  vault.with_node_hosted_session(&self.target(),&self.enrollment().account_review,|s|wire::pending(&self.target(),&s,&current.binding).map_err(|_|crate::account_vault::Error::Unavailable)).map_err(account_error)
 }
 pub fn send(&self,vault:&AccountVault,profiles:&AccessProfiles,current:&Identity,original:&Original)->Result<Receipt,Error>{
  if current.binding!=original.binding||!original.command.validate()||!current.capabilities.contains(&original.command.capability()){return Err(Error::Conflict);}
  self.authorized(profiles,current,true)?;
  let intent=hash(&serde_json::to_vec(original).map_err(|_|Error::Invalid)?);
  profiles.admit(&policy_grant(current),&original.id,&intent,"hosted_governance_write",now()).map_err(|_|Error::Forbidden)?;
  vault.with_node_hosted_session(&self.target(),&self.enrollment().account_review,|s|wire::effect(&self.target(),&s,original,&s.locks).map_err(|_|crate::account_vault::Error::Unavailable)).map_err(account_error)
 }
 pub fn inspect(&self,vault:&AccountVault,profiles:&AccessProfiles,current:&Identity,original:&Original)->Result<Receipt,Error>{
  self.authorized(profiles,current,false)?;
  if recovery_key(&current.binding)!=recovery_key(&original.binding){return Err(Error::Forbidden);}
  vault.with_node_hosted_session(&self.target(),&self.enrollment().account_review,|s|wire::inspect(&self.target(),&s,&current.binding,original).map_err(|_|crate::account_vault::Error::Unavailable)).map_err(account_error)
 }
}
pub fn recovery_key(b:&Binding)->String{
 hash(&serde_json::to_vec(&json!([b.native_library_id,b.native_service_instance_id,b.hosted_service_instance_id,b.authority_id,b.connection_id,b.actor_id,b.installation_id,b.native_project_id,b.hosted_project_id,b.visibility])).expect("scalar owner"))
}
pub fn unknown(original:&Original)->Receipt{Receipt{original:original.clone(),outcome:Outcome::Unknown,value:None,error:Some(PublicError{status:None,code:"hosted_original_unconfirmed".into(),message:"Original outcome remains unconfirmed; inspect this original without replay.".into()})}}

// This only adapts an ALREADY authenticated Node grant to the existing local access-policy API.
// It creates no Native credential/grant, is never used by Store::authenticate or the generic proxy,
// and every use requires an explicitly configured managed local policy (no legacy default).
fn policy_grant(identity:&Identity)->GrantView{
 let read=identity.capabilities.iter().any(|c|matches!(c,Capability::Catalog|Capability::Skill));
 let write=identity.capabilities.iter().any(|c|matches!(c,Capability::Create|Capability::Save|Capability::Archive|Capability::Restore|Capability::Enable|Capability::Disable|Capability::Submit|Capability::Approve|Capability::Reject|Capability::Rollback));
 GrantView{id:identity.binding.grant_id.clone(),revision:identity.binding.grant_revision,revoked:false,created_at:0,
  scope:Scope{name:"NodeHosted governance policy".into(),project_ids:vec![identity.binding.hosted_project_id.clone()],
    permissions:[(read,"hosted_governance_read"),(write,"hosted_governance_write")].into_iter().filter(|(present,_)|*present).map(|(_,p)|p.into()).collect()}}
}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountCommand {
 pub operation_id:String,pub enrollment_request_id:String,pub native_owner:NativeOwner,pub account_review:AccountReview,
 pub trust_file:PathBuf,pub trust_sha256:String,pub second_factor:bool,#[serde(default,skip_serializing_if="Option::is_none")]pub mfa_file:Option<PathBuf>,
}
pub fn trusted_file(path:&Path,expected:&str)->Result<TrustedEnrollment,Error>{
 if !path.is_absolute()||expected.len()!=64{return Err(Error::Invalid);}
 for ancestor in path.ancestors(){let metadata=fs::symlink_metadata(ancestor).map_err(|_|Error::Invalid)?;if redirected(&metadata){return Err(Error::Invalid);}}
 let mut options=fs::OpenOptions::new();options.read(true);
 #[cfg(windows)]{use std::os::windows::fs::OpenOptionsExt;options.share_mode(1).custom_flags(0x00200000);}
 let file=options.open(path).map_err(|_|Error::Invalid)?;let metadata=file.metadata().map_err(|_|Error::Invalid)?;
 if redirected(&metadata)||!metadata.is_file()||metadata.len()>256*1024{return Err(Error::Invalid);}
 let mut bytes=Vec::new();file.take(256*1024+1).read_to_end(&mut bytes).map_err(|_|Error::Unavailable)?;
 if bytes.len()>256*1024||hash(&bytes)!=expected{return Err(Error::Conflict);}
 let trust:TrustFile=serde_json::from_slice(&bytes).map_err(|_|Error::Invalid)?;
 // Use exactly the existing pin verifier and strict HTTPS origin parser.
 super::client::pinned_client(&trust.certificate_pem,&trust.certificate_sha256)?;
 for (text,origin_only) in [(&trust.endpoint,true),(&trust.dashboard_origin,true)]{
  let url=reqwest::Url::parse(text).map_err(|_|Error::Invalid)?;
  if url.scheme()!="https"||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||origin_only&&url.path()!="/"{return Err(Error::Invalid);}
 }
 if trust.dashboard_origin.ends_with('/'){return Err(Error::Invalid);}
 Ok(TrustedEnrollment{trust,sha256:expected.into()})
}
/// The caller validates the complete saved Native owner and retains AccountCommand first.
pub fn sign_in(state:&Path,input:&AccountCommand)->Result<crate::account_vault::node_hosted::SessionStatus,Error>{
 if !crate::utility_operations::canonical(&input.operation_id)||!crate::utility_operations::canonical(&input.enrollment_request_id){return Err(Error::Invalid);}
 let trust=trusted_file(&input.trust_file,&input.trust_sha256)?;
 let client=super::client::pinned_client(&trust.trust.certificate_pem,&trust.trust.certificate_sha256)?;
 let target=Target{client:&client,endpoint:&trust.trust.endpoint,dashboard_origin:&trust.trust.dashboard_origin,connection_id:&input.enrollment_request_id};
 let vault=AccountVault::new(state);
 let review=if input.second_factor{input.mfa_file.as_ref().map(|file|vault.node_hosted_mfa_file(&input.account_review,file)).transpose().map_err(account_error)?.unwrap_or_else(||input.account_review.clone())}else{if input.mfa_file.is_some(){return Err(Error::Invalid);}input.account_review.clone()};
 vault.node_hosted_sign_in(&target,&review,&input.operation_id,input.second_factor).map_err(account_error)
}
/// Not serializable: the existing one-use pairing code remains private to the Root Node client custody ceremony.
pub struct PreparedPairing {pub(crate) code:String,pub expires_at:u64,pub custodian:attestation::Custodian}
impl Store {
 pub fn prepare_hosted_pairing(&self,state:&Path,input:&AccountCommand,policy:crate::access_profiles::Policy)->Result<PreparedPairing,Error>{
  let trust=trusted_file(&input.trust_file,&input.trust_sha256)?;
  let client=super::client::pinned_client(&trust.trust.certificate_pem,&trust.trust.certificate_sha256)?;
  let target=Target{client:&client,endpoint:&trust.trust.endpoint,dashboard_origin:&trust.trust.dashboard_origin,connection_id:&input.enrollment_request_id};
  let actual=AccountVault::new(state).with_node_hosted_session(&target,&input.account_review,|s|wire::site_identity(&target,&s).map_err(|_|crate::account_vault::Error::Conflict)).map_err(account_error)?;
  let custodian=attestation::Custodian{enrollment_request_id:input.enrollment_request_id.clone(),actor_id:actual.actor_id,installation_id:actual.installation_id,hosted_authority_id:actual.authority_id,native_owner:input.native_owner.clone()};
  let(code,expires_at)=self.pair_node_custodian(custodian.clone(),policy,&AccessProfiles::new(state))?;
  Ok(PreparedPairing{code,expires_at,custodian})
 }
 /// Called only AFTER Root's actual Node private owner redeems the above pairing and can authenticate its Native context callback.
 /// If that callback is absent, the frozen server returns503; no self-asserted identity or fallback is accepted.
 pub fn enroll_hosted(&self,state:&Path,input:&AccountCommand,hosted_project:&str,visibility:Visibility,policy:crate::access_profiles::Policy,name:String)->Result<ConnectionView,Error>{
  let trust=trusted_file(&input.trust_file,&input.trust_sha256)?;
  let client=super::client::pinned_client(&trust.trust.certificate_pem,&trust.trust.certificate_sha256)?;
  let target=Target{client:&client,endpoint:&trust.trust.endpoint,dashboard_origin:&trust.trust.dashboard_origin,connection_id:&input.enrollment_request_id};
  let vault=AccountVault::new(state);
  let identity=vault.with_node_hosted_session(&target,&input.account_review,|s|wire::enroll(&target,&s,&input.enrollment_request_id,hosted_project,&visibility).map_err(|_|crate::account_vault::Error::Conflict)).map_err(account_error)?;
  if identity.binding.native_library_id!=input.native_owner.library_id||identity.binding.native_service_instance_id!=input.native_owner.service_instance_id||
   identity.binding.native_project_id.as_deref()!=input.native_owner.project.as_ref().map(|p|p.id.as_str())||identity.binding.native_project_revision!=input.native_owner.project.as_ref().map(|p|p.revision){return Err(Error::Conflict);}
  let review=vault.node_hosted_bind_enrollment(&input.account_review,&input.enrollment_request_id,&identity.binding).map_err(account_error)?;
  let grant=policy_grant(&identity);let id=identity.binding.connection_id.clone();
  let profiles=AccessProfiles::new(state);
  profiles.configure_exact(&grant,0,None,policy,now(),||crate::utility_operations::Store::open(state).and_then(|s|s.hosted_pending(&recovery_key(&identity.binding))).map(|rows|rows.is_empty()).map_err(|_|crate::access_profiles::Error::Unavailable)).map_err(|_|Error::Forbidden)?;
  let enrollment=Enrollment{protocol:"node_hosted_governance_v1".into(),enrollment_request_id:input.enrollment_request_id.clone(),native_owner:input.native_owner.clone(),identity,account_review:review,dashboard_origin:trust.trust.dashboard_origin.clone()};
  self.save_hosted(id,name,trust,enrollment)
 }
}
