//! Actual custodian retirement in the existing Native connection/grant owner.
use super::*;
fn matches(c:&attestation::Custodian,e:&Enrollment)->bool{
 c.enrollment_request_id==e.enrollment_request_id&&c.actor_id==e.identity.binding.actor_id&&c.installation_id==e.identity.binding.installation_id&&json!(c.native_owner)==json!(e.native_owner)
}
fn inventory(db:&Database,e:&Enrollment)->Value{
 json!({"enrollment_request_id":e.enrollment_request_id,"actor_id":e.identity.binding.actor_id,"installation_id":e.identity.binding.installation_id,"native_owner":e.native_owner,
 "grants":db.grants.values().filter(|g|g.node_custodian.as_ref().is_some_and(|c|matches(c,e))).map(|g|json!(g.view)).collect::<Vec<_>>(),
 "pairings":db.pairings.iter().filter(|(_,p)|p.node_custodian.as_ref().is_some_and(|c|matches(c,e))).map(|(id,p)|json!({"id":id,"expires_at":p.expires_at})).collect::<Vec<_>>()})
}
impl Store{
 pub fn hosted_retirement_inventory(&self,connection:&SessionConnection)->Result<Value,Error>{self.require_hosted(connection)?;self.access(|db|Ok(inventory(db,connection.enrollment())),false)}
 /// Caller verified actual Node quiescence/pending count and Native journal under tracked commands+serial.
 /// No receipt or missing-row inference enters this physical local revocation.
 pub fn retire_hosted_custodians(&self,connection:&SessionConnection,expected:&Value)->Result<Value,Error>{
  self.require_hosted(connection)?;
  self.access(|db|{
   let e=connection.enrollment();if inventory(db,e)!=*expected{return Err(Error::Conflict);}
   db.pairings.retain(|_,p|!p.node_custodian.as_ref().is_some_and(|c|matches(c,e)));
   for g in db.grants.values_mut().filter(|g|g.node_custodian.as_ref().is_some_and(|c|matches(c,e))){
    if !g.view.revoked{g.view.revoked=true;g.view.revision=g.view.revision.checked_add(1).ok_or(Error::Conflict)?;}
   }
   Ok(inventory(db,e))
  },true)
 }
 /// The OLD token is valid ONLY for this bounded revocation-proof read, never normal authentication.
 pub fn hosted_retirement_proof(&self,token:&str,id:&str,actor:&str,installation:&str,pending_effects:bool)->Result<Value,Error>{
  if token.len()!=64{return Err(Error::Forbidden);}let digest=hash(token.as_bytes());
  self.access(|db|{
   let grant=db.grants.values().find(|g|g.token_sha256==digest).ok_or(Error::Forbidden)?;
   let c=grant.node_custodian.as_ref().ok_or(Error::Forbidden)?;
   if c.enrollment_request_id!=id||c.actor_id!=actor||c.installation_id!=installation{return Err(Error::Forbidden);}
   let same=|other:&attestation::Custodian|other.enrollment_request_id==id&&other.actor_id==actor&&other.installation_id==installation;
   Ok(json!({"protocol":"node_hosted_retirement_v1","enrollment_request_id":id,"actor_id":actor,"installation_id":installation,
    "native_authority_id":db.authority_id,"native_owner":c.native_owner,"grant":grant.view,
    "live_pairings":db.pairings.values().filter(|p|p.expires_at>now()&&p.node_custodian.as_ref().is_some_and(&same)).count(),
    "live_grants":db.grants.values().filter(|g|!g.view.revoked&&g.node_custodian.as_ref().is_some_and(&same)).count(),
    "pending_effects":if pending_effects{1}else{0}}))
  },false)
 }
}
impl SessionConnection{
 pub fn retirement_review(&self,vault:&AccountVault,store:&Store)->Result<Value,Error>{
  store.require_hosted(self)?;
  vault.with_node_hosted_retirement_session(&self.target(),&self.enrollment().account_review,&self.enrollment().enrollment_request_id,&self.enrollment().identity.binding,|s|{
   if s.actor_id!=self.enrollment().identity.binding.actor_id{return Err(crate::account_vault::Error::Conflict);}
   let node=wire::pairing_status(&self.target(),&s,&self.enrollment().enrollment_request_id).map_err(|_|crate::account_vault::Error::Unavailable)?;
   Ok(json!({"node":node,"native":store.hosted_retirement_inventory(self).map_err(|_|crate::account_vault::Error::Conflict)?}))
  }).map_err(account_error)
 }
 pub fn retire_hosted(&self,state:&Path,vault:&AccountVault,store:&Store,expected:&Value)->Result<Value,Error>{
  store.require_hosted(self)?;
  let e=self.enrollment();
  let journal=crate::utility_operations::Store::open(state).map_err(|_|Error::Unavailable)?;
  if journal.hosted_effect_resource_has_custody(&e.enrollment_request_id).map_err(|_|Error::Unavailable)?{return Err(Error::Conflict);}
  vault.with_node_hosted_retirement_session(&self.target(),&e.account_review,&e.enrollment_request_id,&e.identity.binding,|s|{
   if s.actor_id!=e.identity.binding.actor_id{return Err(crate::account_vault::Error::Conflict);}
   let actual=wire::pairing_status(&self.target(),&s,&e.enrollment_request_id).map_err(|_|crate::account_vault::Error::Unavailable)?;
   if actual!=expected["node"]||store.hosted_retirement_inventory(self).map_err(|_|crate::account_vault::Error::Conflict)?!=expected["native"]{return Err(crate::account_vault::Error::Conflict);}
   let quiesced=wire::pairing_lifecycle(&self.target(),&s,&e.enrollment_request_id,"quiesce",actual["revision"].as_u64().ok_or(crate::account_vault::Error::Conflict)?).map_err(|_|crate::account_vault::Error::Unavailable)?;
   if !["quiescing","retired"].contains(&quiesced["state"].as_str().unwrap_or(""))||quiesced["pendingEffects"]!=0{return Err(crate::account_vault::Error::Conflict);}
   // Actual persisted Native revocation/removal precedes the Node proof read.
   let native=store.retire_hosted_custodians(self,&expected["native"]).map_err(|_|crate::account_vault::Error::Conflict)?;
   let node=wire::pairing_lifecycle(&self.target(),&s,&e.enrollment_request_id,"retire",quiesced["revision"].as_u64().ok_or(crate::account_vault::Error::Conflict)?).map_err(|_|crate::account_vault::Error::Unavailable)?;
   if node["state"]!="retired"||node["physicalErasure"]!=false{return Err(crate::account_vault::Error::Conflict);}
   let receipt=json!({"node":node,"native":native,"physical_erasure":false});
   store.access(|db|{let saved=db.connections.get_mut(&self.saved.view.id).ok_or(Error::NotFound)?;if json!(saved.node_hosted)!=json!(self.saved.node_hosted){return Err(Error::Conflict);}saved.node_hosted.as_mut().ok_or(Error::Forbidden)?.retirement=Some(receipt.clone());Ok(())},true).map_err(|_|crate::account_vault::Error::Conflict)?;
   Ok(receipt)
  }).map_err(account_error)
 }
}
// Query real persisted grants, live one-use preparations and saved connection retirement.
impl Store{
 fn hosted_live(&self,project:Option<Option<&str>>,resource:Option<&str>)->Result<bool,Error>{
  self.access(|db|{
   let owner=|n:&NativeOwner|project.is_none_or(|wanted|n.project.as_ref().map(|p|p.id.as_str())==wanted);
   let custodian=|c:&attestation::Custodian|owner(&c.native_owner)&&resource.is_none_or(|id|c.enrollment_request_id==id);
   let connection=db.connections.values().any(|c|c.node_hosted.as_ref().is_some_and(|e|e.retirement.is_none()&&owner(&e.native_owner)&&resource.is_none_or(|id|e.enrollment_request_id==id||e.account_review.account.id==id||e.identity.binding.grant_id==id||c.view.id==id)));
   let grants=db.grants.values().any(|g|!g.view.revoked&&g.node_custodian.as_ref().is_some_and(|c|owner(&c.native_owner)&&(resource==Some(g.view.id.as_str())||custodian(c))));
   let pairings=db.pairings.values().any(|p|p.expires_at>now()&&p.node_custodian.as_ref().is_some_and(&custodian));
   Ok(connection||grants||pairings)
  },false)
 }
 pub fn hosted_project_is_live(&self,project:Option<&str>)->Result<bool,Error>{self.hosted_live(Some(project),None)}
 pub fn hosted_resource_is_live(&self,id:&str)->Result<bool,Error>{self.hosted_live(None,Some(id))}
 pub fn hosted_library_is_live(&self)->Result<bool,Error>{self.hosted_live(None,None)}
}
impl Store{
 pub fn hosted_unpaired_account_is_clear(&self,enrollment:&str,account:&str,owner:&NativeOwner)->Result<bool,Error>{
  self.access(|db|{
   // Include revoked historical grants: this exact Native owner that gained a paired
   // authority must use full Node/Native retirement, never absence-based recovery.
   let grants=db.grants.values().any(|g|g.node_custodian.as_ref().is_some_and(|c|c.enrollment_request_id==enrollment&&(!g.view.revoked||json!(c.native_owner)==json!(owner))));
   let pairings=db.pairings.values().any(|p|p.expires_at>now()&&p.node_custodian.as_ref().is_some_and(|c|c.enrollment_request_id==enrollment));
   let connections=db.connections.values().any(|c|c.node_hosted.as_ref().is_some_and(|e|e.account_review.account.id==account&&e.retirement.is_none()||e.enrollment_request_id==enrollment&&(e.retirement.is_none()||json!(e.native_owner)==json!(owner))));
   Ok(!grants&&!pairings&&!connections)
  },false)
 }
}