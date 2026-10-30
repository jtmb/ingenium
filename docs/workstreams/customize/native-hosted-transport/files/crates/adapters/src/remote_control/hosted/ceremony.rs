//! Private Native -> same browser-user Node pairing ceremony; no serializable code/token.
use super::*;
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingCommand {
 pub account:AccountCommand,pub api_project:String,pub hosted_project_id:String,
 pub visibility:Visibility,pub name:String,pub pairing_policy:crate::access_profiles::Policy,
 pub governance_policy:crate::access_profiles::Policy,
}
/// Does not implement Serialize/Debug. Only generated from actual listener configuration.
pub struct Publication {configuration:Configuration,certificate_pem:String,fingerprint:String,authority_id:String}
impl Store {
 pub fn pairing_publication(&self)->Result<Publication,Error>{
  let configuration=self.configuration()?.filter(|c|c.enabled).ok_or(Error::Unavailable)?;
  let material=super::super::certificates::load(&configuration)?;
  let certificate_pem=fs::read_to_string(&configuration.certificate_path).map_err(|_|Error::Unavailable)?;
  let certificates=super::super::certificates::blocks(&certificate_pem,"CERTIFICATE")?;
  if certificates.first().map(|c|hash(c)).as_deref()!=Some(material.fingerprint.as_str()){return Err(Error::Conflict);}
  Ok(Publication{configuration,certificate_pem,fingerprint:material.fingerprint,authority_id:self.identity()?})
 }
 /// Caller retains remote_admin original before prepare; releases commands before Node redeems.
 pub fn publish_hosted_pairing(&self,state:&Path,input:&PairingCommand,prepared:PreparedPairing,publication:Publication)->Result<(),Error>{
  if prepared.expires_at<=now()||prepared.custodian.enrollment_request_id!=input.account.enrollment_request_id||
   json!(prepared.custodian.native_owner)!=json!(input.account.native_owner){return Err(Error::Conflict);}
  let current=self.configuration()?.ok_or(Error::Conflict)?;
  if json!(current)!=json!(publication.configuration)||self.identity()?!=publication.authority_id{return Err(Error::Conflict);}
  let trust=trusted_file(&input.account.trust_file,&input.account.trust_sha256)?;
  let client=super::super::client::pinned_client(&trust.trust.certificate_pem,&trust.trust.certificate_sha256)?;
  let target=Target{client:&client,endpoint:&trust.trust.endpoint,dashboard_origin:&trust.trust.dashboard_origin,connection_id:&input.account.enrollment_request_id};
  AccountVault::new(state).with_node_hosted_session(&target,&input.account.account_review,|session|{
   let actual=wire::site_identity(&target,&session).map_err(|_|crate::account_vault::Error::Conflict)?;
   if actual.actor_id!=prepared.custodian.actor_id||actual.installation_id!=prepared.custodian.installation_id||actual.authority_id!=prepared.custodian.hosted_authority_id{return Err(crate::account_vault::Error::Conflict);}
   wire::publish_pairing(&target,&session,&input.api_project,&input.hosted_project_id,&input.account.enrollment_request_id,&json!({
    "schemaVersion":1,"stage":"preparation","enrollmentRequestId":input.account.enrollment_request_id,
    "endpoint":publication.configuration.public_origin,"certificatePem":publication.certificate_pem,
    "certificateSha256":publication.fingerprint,"expectedAuthorityId":publication.authority_id,"pairingCode":prepared.code
   })).map_err(|_|crate::account_vault::Error::Unavailable)
  }).map_err(account_error)?;
  Ok(())
 }
}