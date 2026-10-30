//! Custodian binding extends the EXISTING Native one-time Pairing -> Grant chain.
//! Construction is crate-private, after actual pinned Node /identity + /auth/session validation.
use super::*;
use crate::access_profiles::{AccessProfiles,Policy};
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Custodian {
 pub enrollment_request_id:String,pub actor_id:String,pub installation_id:String,pub hosted_authority_id:String,
 pub native_owner:NativeOwner,
}
#[derive(Serialize)]
pub struct ContextProof {
 pub protocol:&'static str,pub enrollment_request_id:String,pub actor_id:String,pub installation_id:String,
 pub native_owner:NativeOwner,pub native_authority_id:String,pub grant:GrantView,
}
impl Store {
 /// The caller retains its actual remote_admin original BEFORE invoking this explicit pairing.
 /// Code stays inside the private Node connection ceremony; never in a public original/renderer.
 pub(crate) fn pair_node_custodian(&self,custodian:Custodian,policy:Policy,profiles:&AccessProfiles)->Result<(String,u64),Error>{
  if !crate::utility_operations::canonical(&custodian.enrollment_request_id)||custodian.actor_id.is_empty()||custodian.installation_id.is_empty(){return Err(Error::Invalid);}
  let projects=custodian.native_owner.project.clone().into_iter().collect::<Vec<_>>();
  let scope=Scope{name:"NodeHosted enrollment attestation".into(),project_ids:projects.iter().map(|p|p.id.clone()).collect(),permissions:vec!["hosted_enrollment".into()]};
  let(code,expires)=self.issue_pairing_owned(scope.clone(),projects)?;
  profiles.prepare_pairing(&code,&scope,policy,expires,now()).map_err(|_|Error::Forbidden)?;
  let digest=hash(code.as_bytes());
  self.access(|db|{
   let pairing=db.pairings.values_mut().find(|p|p.digest==digest&&p.expires_at>now()).ok_or(Error::Conflict)?;
   if pairing.node_custodian.is_some(){return Err(Error::Conflict);}
   pairing.node_custodian=Some(custodian);Ok(())
  },true)?;
  Ok((code,expires))
 }
 /// Real authenticated grant custody, never actor ID supplied as identity by a request.
 pub fn node_custodian(&self,grant:&GrantView,request_id:&str,actor_id:&str,installation_id:&str)->Result<Custodian,Error>{
  self.access(|db|{
   let saved=db.grants.get(&grant.id).ok_or(Error::Forbidden)?;
   if saved.view.revoked||saved.view.revision!=grant.revision||!grant.scope.permissions.iter().any(|p|p=="hosted_enrollment"){return Err(Error::Forbidden);}
   let c=saved.node_custodian.as_ref().ok_or(Error::Forbidden)?;
   if c.enrollment_request_id!=request_id||c.actor_id!=actor_id||c.installation_id!=installation_id{return Err(Error::Forbidden);}Ok(c.clone())
  },false)
 }
 pub fn context_proof(&self,grant:&GrantView,custodian:&Custodian,current:&NativeOwner)->Result<ContextProof,Error>{
  if json!(current)!=json!(custodian.native_owner){return Err(Error::Conflict);}
  Ok(ContextProof{protocol:"node_hosted_native_custodian_v1",enrollment_request_id:custodian.enrollment_request_id.clone(),
   actor_id:custodian.actor_id.clone(),installation_id:custodian.installation_id.clone(),native_owner:current.clone(),native_authority_id:self.identity()?,grant:grant.clone()})
 }
}
