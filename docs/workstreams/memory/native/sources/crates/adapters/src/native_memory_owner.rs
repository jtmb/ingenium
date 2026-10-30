//! Memory binding derived from the original Projects + OS-custody owner.
//! Constructors are not Deserialize, and metadata alone is never custody.
use std::sync::Arc;
use crate::{projects::ProjectStore,local_custody::LocalCustody,local_execution::LocalWorkspaceBinding};
use veyra_contracts::Project;
use veyra_memory::{NativeScope,NativeNamespace};
enum Owner{Project(Project),Private(Arc<LocalWorkspaceBinding>)}
pub struct NativeMemoryOwner{owner:Owner,custody:Arc<LocalCustody>,scope:NativeScope,instance:String,directory:String,revision:u64}
impl NativeMemoryOwner{
 pub fn project(store:&ProjectStore,project:&Project,instance:&str)->Result<Self,String>{
  if project.archived||store.get(&project.id).map_err(|_|"Project missing")?!=*project{return Err("Project changed".into())}
  let custody=store.local_custody().map_err(|_|"OS custody unavailable")?;custody.verify()?;
  let scope=NativeScope{library_id:store.local_installation_id().map_err(|_|"Library unavailable")?.into(),
   os_custodian_id:custody.key().into(),execution_id:veyra_memory::fingerprint(&project.environment).map_err(|e|e.to_string())?,
   namespace:NativeNamespace::Project{project_id:project.id.clone()}};
  scope.validate().map_err(|e|e.to_string())?;
  Ok(Self{owner:Owner::Project(project.clone()),custody,scope,instance:instance.into(),directory:project.primary_root.clone(),revision:u64::from(project.revision)})
 }
 pub fn private(store:&ProjectStore,binding:Arc<LocalWorkspaceBinding>,instance:&str)->Result<Self,String>{
  binding.verify_current(store,instance)?;let original=binding.owner();
  if original.service_instance_id!=instance||store.local_installation_id().map_err(|_|"Library unavailable")?!=original.installation_id{return Err("Private original owner changed".into())}
  let custody=store.local_custody().map_err(|_|"OS custody unavailable")?;custody.verify()?;
  if original.custodian_key!=custody.key(){return Err("Private custodian changed".into())}
  let scope=NativeScope{library_id:original.installation_id.clone(),os_custodian_id:custody.key().into(),
   execution_id:veyra_memory::fingerprint(&original.environment).map_err(|e|e.to_string())?,
   namespace:NativeNamespace::Projectless{namespace_id:original.workspace_id.clone()}};
  let directory=binding.directory().into();let revision=original.revision;scope.validate().map_err(|e|e.to_string())?;
  Ok(Self{owner:Owner::Private(binding),custody,scope,instance:instance.into(),directory,revision})
 }
 pub fn verify(&self,store:&ProjectStore)->Result<(),String>{
  self.custody.verify()?;
  if store.local_installation_id().map_err(|_|"Library unavailable")?!=self.scope.library_id{return Err("Library changed".into())}
  match &self.owner{
   Owner::Project(p)=>{if store.get(&p.id).map_err(|_|"Project missing")?!=*p||p.archived{return Err("Project changed".into())}},
   Owner::Private(b)=>{
    b.verify_current(store,&self.instance)?;
    // verify() retains actual root custody; the original registry must match too.
    store.check_local_owner(b.owner(),&self.instance).map_err(|_|"Private registry changed")?;
   }
  }Ok(())
 }
 pub fn scope(&self)->&NativeScope{&self.scope}
 pub fn directory(&self)->&str{&self.directory}
 pub fn instance(&self)->&str{&self.instance}
 pub fn revision(&self)->u64{self.revision}
 pub fn verify_chat(&self,store:&ProjectStore,chat:&str)->Result<(),String>{
  self.verify(store)?;
  if let Owner::Private(binding)=&self.owner{
   store.require_local_session(&binding.owner().workspace_id,chat).map_err(|_|"Chat lacks its original committed private-session reference")?;
  }Ok(())
 }
 pub(crate) fn private_binding(&self)->Option<&LocalWorkspaceBinding>{
  match &self.owner{Owner::Private(binding)=>Some(binding.as_ref()),Owner::Project(_)=>None}
 }
}
