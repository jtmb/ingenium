//! Explicit projectless custody. This type cannot be made from a Project or JSON.
use crate::{local_custody::LocalCustody,projects::ProjectStore};
use std::sync::Arc;
use serde_json::{Value,json};
use veyra_contracts::local_workspaces::{LocalWorkspaceOwner,LocalEnvironment};
pub struct LocalWorkspaceBinding {
 owner:LocalWorkspaceOwner, installation:Arc<LocalCustody>,
 windows:Option<Arc<LocalCustody>>, directory:String, physical:String,
}
impl LocalWorkspaceBinding {
 pub fn acquire(store:&ProjectStore,owner:&LocalWorkspaceOwner,instance:&str)->Result<Arc<Self>,String>{
  let record=store.check_local_owner(owner,instance).map_err(|_|"local registry owner changed")?;
  let installation=store.local_custody().map_err(|_|"local installation unavailable")?;
  let physical=record.root_identity.ok_or("private root never observed")?;
  let directory=record.root_path.ok_or("private root unavailable")?;
  let windows=match &owner.environment {
   LocalEnvironment::Windows=>{
    let root=installation.existing_child(&owner.workspace_id,&physical)?;
    if root.root().to_str()!=Some(directory.as_str()){return Err("private root path changed".into());}
    Some(root)
   },
   LocalEnvironment::Wsl{..}=>None,
  };
  let bound=Arc::new(Self{owner:owner.clone(),installation,windows,directory,physical});
  bound.verify()?;Ok(bound)
 }
 /// Continuing permission requires the actual original registry, not only root
 /// custody. Call under its original mutex at every effect/read boundary.
 pub fn verify_current(&self,store:&ProjectStore,instance:&str)->Result<(),String>{
  let record=store.check_local_owner(&self.owner,instance).map_err(|_|"current private registry permission refused")?;
  if record.root_identity.as_deref()!=Some(self.physical.as_str())||record.root_path.as_deref()!=Some(self.directory.as_str()){
   return Err("current private registry root changed".into());
  }
  self.verify()
 }
 /// Cleanup-only account check; never read or execution permission.
 pub fn verify_account(&self)->Result<(),String>{self.installation.verify_account()}
 pub fn owner(&self)->&LocalWorkspaceOwner{&self.owner}
 pub fn directory(&self)->&str{&self.directory}
 /// Physical installation/root custody only. This does not read the registry.
 pub fn verify(&self)->Result<(),String>{
  self.installation.verify()?;
  match &self.owner.environment {
   LocalEnvironment::Windows=>self.windows.as_ref().ok_or("missing Windows custody")?.verify(),
   LocalEnvironment::Wsl{..}=>{
    let proof:Value=serde_json::from_str(&self.physical).map_err(|_|"invalid WSL custody")?;
    let observed=crate::wsl_workspace::local_private_request(&self.owner.environment,json!({
     "installation_id":self.owner.installation_id,"workspace_id":self.owner.workspace_id,
     "action":"verify","expected":proof
    }),&||self.installation.verify().is_ok()).map_err(|_|"WSL custody unavailable")?;
    if observed["root"]!=self.directory || observed["identity"]!=proof{return Err("WSL root changed".into());}Ok(())
   }
  }
 }
 pub fn wsl_request(&self,mut input:Value)->Result<Value,String>{
  self.verify()?;
  let data=input.as_object_mut().ok_or("invalid WSL effect")?;
  data.insert("installation_id".into(),json!(self.owner.installation_id));
  data.insert("workspace_id".into(),json!(self.owner.workspace_id));
  data.insert("expected".into(),serde_json::from_str(&self.physical).map_err(|_|"invalid WSL proof")?);
  crate::wsl_workspace::local_private_request(&self.owner.environment,input,&||self.installation.verify().is_ok())
   .map_err(|_|"WSL original effect unavailable; preserve receipt".into())
 }
 pub fn wsl_terminal_args(&self,shell:&str)->Result<Vec<String>,String>{
  self.verify()?;
  let LocalEnvironment::Wsl{distro,user}=&self.owner.environment else{return Err("not WSL".into());};
  if !["bash","sh","zsh","fish"].contains(&shell){return Err("invalid shell".into());}
  let data=json!({"installation_id":self.owner.installation_id,"workspace_id":self.owner.workspace_id,
   "expected":serde_json::from_str::<Value>(&self.physical).map_err(|_|"invalid WSL proof")?,"shell":shell});
  Ok(vec!["--distribution".into(),distro.clone(),"--user".into(),user.clone(),"--exec".into(),"python3".into(),
   "-c".into(),include_str!("local_custody/wsl-helper.py").into(),"--local-terminal".into(),data.to_string()])
 }
}

/// Created only by the actual selected-user helper, not Deserialize or a caller
/// callback. Persisted JSON is evidence to re-observe, never custody itself.
pub struct LocalWslCreated{
 installation:Arc<LocalCustody>,installation_id:String,workspace_id:String,
 environment:LocalEnvironment,directory:String,physical:String,
}
impl LocalWslCreated{
 pub fn create(installation:Arc<LocalCustody>,installation_id:&str,workspace_id:&str,environment:&LocalEnvironment,exclusions:&[Value])->Result<Self,String>{
  installation.verify()?;
  let proof=crate::wsl_workspace::local_private_request(environment,json!({"action":"create","installation_id":installation_id,"workspace_id":workspace_id,"exclusions":exclusions}),
   &||installation.verify().is_ok()).map_err(|_|"WSL allocation outcome unknown")?;
  let directory=proof["root"].as_str().ok_or("WSL directory missing")?.to_owned();
  let physical=serde_json::to_string(&proof["identity"]).map_err(|_|"WSL identity missing")?;
  let created=Self{installation,installation_id:installation_id.into(),workspace_id:workspace_id.into(),environment:environment.clone(),directory,physical};
  created.verify()?;Ok(created)
 }
 pub fn verify(&self)->Result<(),String>{
  self.installation.verify()?;
  let expected:Value=serde_json::from_str(&self.physical).map_err(|_|"WSL identity invalid")?;
  let proof=crate::wsl_workspace::local_private_request(&self.environment,json!({"action":"verify","installation_id":self.installation_id,"workspace_id":self.workspace_id,"expected":expected}),
   &||self.installation.verify().is_ok()).map_err(|_|"WSL custody unavailable")?;
  if proof["root"]!=self.directory||proof["identity"]!=expected{return Err("WSL custody changed".into());}Ok(())
 }
 pub fn installation_id(&self)->&str{&self.installation_id}
 pub fn workspace_id(&self)->&str{&self.workspace_id}
 pub fn environment(&self)->&LocalEnvironment{&self.environment}
 pub fn directory(&self)->&str{&self.directory}
 pub fn physical(&self)->&str{&self.physical}
}
