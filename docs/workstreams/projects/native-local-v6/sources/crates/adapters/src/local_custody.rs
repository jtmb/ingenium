//! Local custody over the actual original service guard and retained NT roots.
//! No serializable principal, guessed organization, Project conversion or ACL repair.
use std::{fs::{self,File},path::{Path,PathBuf},sync::{Arc,Mutex},time::{Instant,Duration}};
use sha2::{Digest,Sha256};
#[cfg(windows)] mod windows;
#[cfg(target_os="linux")] mod linux;
type Result<T> = std::result::Result<T,String>;
#[cfg(windows)]
pub trait OriginalStateGuardSource:Send+Sync {
 fn with_original(&self,read:&mut dyn FnMut(&crate::service_registration::ServiceGuardDirectory<'_>)->Result<()>)->Result<()>;
 fn originals(&self)->Arc<LocalCustodyOriginals>;
}
/// Created only from the original sealed ServiceGuardDirectory inside adapters.
#[cfg(windows)]
pub struct LocalStateObservation{pub(crate) subject:String,pub(crate) physical:String}
#[derive(Default)]
pub struct LocalCustodyOriginals{
 #[cfg(windows)] separations:Mutex<Vec<Arc<crate::task_workspaces::NativeRootSeparation>>>,
 #[cfg(windows)] roots:Mutex<Vec<Arc<crate::task_workspaces::PrivateRootCustody>>>,
}
impl LocalCustodyOriginals{
 #[cfg(windows)]
 fn capture(&self,path:&Path)->Result<(Arc<crate::task_workspaces::PrivateRootCustody>,String,String)>{
  let path=path.to_str().ok_or("invalid private path")?;
  let mut roots=self.roots.try_lock().map_err(|_|"original private custody inventory is busy")?;
  if let Some(root)=roots.iter().find(|r|r.root()==path){
   let (subject,physical)=root.verify_pinned().map_err(|_|"retained root unavailable")?;
   return Ok((root.clone(),subject,physical));
  }
  if roots.len()>=256{return Err("private custody inventory capacity".into());}
  let root=crate::task_workspaces::PrivateRootCustody::prepare(path,Instant::now()+Duration::from_secs(5)).map_err(|_|"private preparation")?;
  roots.push(root.clone()); // retained BEFORE the first NT open/query
  root.capture_once().map_err(|_|"private acquisition remains retained")?;
  let (subject,physical)=root.observe(Instant::now()+Duration::from_secs(3)).map_err(|_|"private observation remains retained")?;
  Ok((root,subject,physical))
 }
 #[cfg(windows)]
 pub fn separate(&self,protected:&str,other:&[String])->Result<()>{
  let original=crate::task_workspaces::NativeRootSeparation::prepare(protected,other,Instant::now()+Duration::from_secs(3)).map_err(|_|"namespace separation preparation")?;
  {
   let mut retained=self.separations.try_lock().map_err(|_|"separation originals busy")?;
   if retained.len()>=256{return Err("unresolved separation capacity".into());}
   retained.push(original.clone());
  }
  let result=original.check_once();
  let closed=original.retire_once(Instant::now()+Duration::from_secs(3));
  if closed.is_ok(){
   self.separations.try_lock().map_err(|_|"closed separation metadata busy")?.retain(|v|!Arc::ptr_eq(v,&original));
  }
  if result.is_err()||closed.is_err(){return Err("protected namespace overlaps or physical custody remains unresolved".into());}
  Ok(())
 }
 pub fn finish_until(&self,deadline:Instant)->Result<()>{
  #[cfg(windows)] {
   let mut separations=self.separations.try_lock().map_err(|_|"separation originals busy")?;
   if separations.iter().any(|r|Arc::strong_count(r)!=1){return Err("active namespace borrower".into());}
   for original in separations.iter(){original.retire_once(deadline).map_err(|_|"separation checked-close original unresolved")?;}
   separations.clear();
   let mut roots=self.roots.try_lock().map_err(|_|"private custody inventory busy")?;
   if roots.iter().any(|r|Arc::strong_count(r)!=1){return Err("active private borrower still owns original custody".into());}
   for root in roots.iter(){root.retire_once(deadline).map_err(|_|"private checked-close original remains unresolved")?;}
   roots.clear();
  }
  #[cfg(not(windows))] let _=deadline;
  Ok(())
 }
}
pub struct LocalCustody {
 root:PathBuf,scheme:String,subject:String,physical:String,key:String,
 originals:Arc<LocalCustodyOriginals>,
 #[cfg(windows)] guard:Option<Arc<dyn OriginalStateGuardSource>>,
 #[cfg(windows)] held:Option<Arc<crate::task_workspaces::PrivateRootCustody>>,
 #[cfg(target_os="linux")] held:linux::Held,
}
impl LocalCustody {
 #[cfg(windows)]
 pub fn from_original_state(root:&Path,source:Arc<dyn OriginalStateGuardSource>)->Result<Arc<Self>>{
  let mut observed=None;
  source.with_original(&mut |guard|{observed=Some(guard.local_custody_observation(root)?);Ok(())})?;
  let observed=observed.ok_or("original native custody missing")?;
  let scheme="windows_sid".to_owned();let subject=observed.subject;let physical=observed.physical;
  let key=format!("{:x}",Sha256::digest(serde_json::to_vec(&(&scheme,&subject,&physical)).map_err(|_|"custody encoding")?));
  let originals=source.originals();
  Ok(Arc::new(Self{root:root.into(),scheme,subject,physical,key,originals,guard:Some(source),held:None}))
 }
 /// Portable Linux custody metadata; hosted/container execution remains its
 /// original API owner, not a new native Linux desktop runtime.
 #[cfg(target_os="linux")]
 pub fn capture(root:&Path)->Result<Arc<Self>>{
  let (held,subject,physical)=linux::capture(root)?;
  let scheme="linux_euid".to_owned();
  let key=format!("{:x}",Sha256::digest(serde_json::to_vec(&(&scheme,&subject,&physical)).map_err(|_|"custody encoding")?));
  Ok(Arc::new(Self{root:root.into(),scheme,subject,physical,key,held,originals:Arc::new(LocalCustodyOriginals::default())}))
 }
 pub fn originals(&self)->Arc<LocalCustodyOriginals>{self.originals.clone()}
 #[cfg(windows)]
 fn related(self:&Arc<Self>,path:&Path)->Result<Arc<Self>>{
  self.verify()?;
  if path.parent()!=Some(self.root.as_path()){return Err("private child outside original root".into());}
  let (held,subject,physical)=self.originals.capture(path)?;
  if subject!=self.subject{return Err("private child OS custodian changed".into());}
  let scheme="windows_sid".to_owned();
  let key=format!("{:x}",Sha256::digest(serde_json::to_vec(&(&scheme,&subject,&physical)).map_err(|_|"custody encoding")?));
  Ok(Arc::new(Self{root:path.into(),scheme,subject,physical,key,originals:self.originals.clone(),guard:None,held:Some(held)}))
 }
 pub fn capture_related(self:&Arc<Self>,path:&Path)->Result<Arc<Self>>{
  #[cfg(windows)] return self.related(path);
  #[cfg(target_os="linux")] {self.verify()?;return Self::capture(path);}
  #[cfg(not(any(windows,target_os="linux")))] Err("unsupported OS custody".into())
 }
 pub fn verify_account(&self)->Result<()>{
  #[cfg(windows)] let current=crate::windows_acl::owner_sid()?;
  #[cfg(target_os="linux")] let current=linux::current_subject()?;
  #[cfg(not(any(windows,target_os="linux")))] return Err("unsupported OS account".into());
  #[cfg(any(windows,target_os="linux"))] if current!=self.subject{return Err("OS process account changed".into());}
  Ok(())
 }
 pub fn verify(&self)->Result<()>{
  self.verify_account()?;
  #[cfg(windows)] {
   let (subject,physical)=if let Some(source)=&self.guard{
    let mut observed=None;
    source.with_original(&mut |guard|{observed=Some(guard.local_custody_observation(&self.root)?);Ok(())})?;
    let observed=observed.ok_or("original state guard unavailable")?;(observed.subject,observed.physical)
   }else{
    self.held.as_ref().ok_or("private original missing")?.verify_pinned().map_err(|_|"private original observation refused")?
   };
   if subject!=self.subject||physical!=self.physical{return Err("actual root custody changed".into());}
   return Ok(());
  }
  #[cfg(target_os="linux")] return linux::verify(&self.held,&self.root,&self.subject,&self.physical);
  #[cfg(not(any(windows,target_os="linux")))] Err("unsupported OS custody".into())
 }
 pub fn root(&self)->&Path{&self.root}
 pub fn scheme(&self)->&str{&self.scheme}
 pub fn subject(&self)->&str{&self.subject}
 pub fn physical(&self)->&str{&self.physical}
 pub fn key(&self)->&str{&self.key}
 pub fn verify_private_file(&self,path:&Path)->Result<()>{
  self.verify()?;
  if path.parent()!=Some(self.root.as_path()){return Err("file outside original state".into());}
  #[cfg(windows)] windows::verify_file(path)?;
  #[cfg(target_os="linux")] linux::verify_file(path)?;
  self.verify()
 }
 pub fn prepare_database(&self,path:&Path)->Result<()>{
  self.verify()?;
  if path.parent()!=Some(self.root.as_path()){return Err("database outside original state".into());}
  if path.exists(){return self.verify_private_file(path);}
  #[cfg(windows)] let file=crate::windows_acl::create_owner_only_file(path).map_err(|_|"private database creation refused")?;
  #[cfg(target_os="linux")] let file={use std::os::unix::fs::OpenOptionsExt;fs::OpenOptions::new().create_new(true).write(true).mode(0o600).open(path).map_err(|_|"private database creation refused")?};
  #[cfg(any(windows,target_os="linux"))] file.sync_all().map_err(|_|"private database sync")?;
  self.verify()
 }
 pub fn create_child(self:&Arc<Self>,name:&str)->Result<Arc<Self>>{
  self.verify()?;
  if !uuid::Uuid::parse_str(name).is_ok_and(|v|!v.is_nil()&&v.to_string()==name){return Err("invalid private child".into());}
  let path=self.root.join(name);
  #[cfg(windows)] windows::create(&path)?;
  #[cfg(target_os="linux")] linux::create(&path)?;
  self.capture_related(&path)
 }
 pub fn existing_child(self:&Arc<Self>,name:&str,physical:&str)->Result<Arc<Self>>{
  self.verify()?;
  if !uuid::Uuid::parse_str(name).is_ok_and(|v|!v.is_nil()&&v.to_string()==name){return Err("invalid private child".into());}
  let child=self.capture_related(&self.root.join(name))?;
  if child.physical()!=physical||child.subject()!=self.subject{return Err("private original root replaced".into());}
  self.verify()?;Ok(child)
 }
}
