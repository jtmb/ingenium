use super::*;
use veyra_memory::{LearnedState,MemoryError};
#[cfg(test)]
mod tests;
pub(super) fn load(directory:&Path)->Result<LearnedState,String>{
 let path=directory.join("learned-memory-v1.json");
 let metadata=match fs::symlink_metadata(&path){
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(LearnedState::default()),
  Err(_)=>return Err("Learned memory unavailable".into()),Ok(m)=>m
 };
 if metadata.file_type().is_symlink()||!metadata.is_file()||metadata.len()>MAX_FILE{return Err("Learned memory file bound or kind invalid".into())}
 #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if metadata.file_attributes()&0x400!=0{return Err("Learned memory reparse point refused".into())}}
 crate::service_registration::restrict_file(&path)?;
 let state:LearnedState=serde_json::from_slice(&fs::read(path).map_err(|_|"Learned memory unavailable")?).map_err(|_|"Learned memory invalid")?;
 state.validate().map_err(|e|e.to_string())?;Ok(state)
}
impl GoalStore{
 pub fn learned(&self)->Result<&LearnedState,String>{
  if self.uncertain{return Err("Goal storage has an unresolved original".into())}Ok(&self.learned)
 }
 /// Runs ONLY under Goals.store, the existing single writer. No second mutex,
 /// database owner, scheduler, prompt sender or transcript authority is created.
 pub fn change_learned<T>(&mut self,action:impl FnOnce(&mut LearnedState)->Result<T,MemoryError>)->Result<T,String>{
  if self.uncertain{return Err("Goal storage has an unresolved original".into())}
  let mut next=self.learned.clone();let result=action(&mut next).map_err(|e|e.to_string())?;
  next.validate().map_err(|e|e.to_string())?;
  if next==self.learned{return Ok(result)}
  let bytes=serde_json::to_vec(&next).map_err(|_|"Learned memory encoding failed")?;
  if bytes.len() as u64>MAX_FILE{return Err("Learned memory full".into())}
  let path=self.path.with_file_name("learned-memory-v1.json");
  let temp=path.with_extension(format!("{}.pending",uuid::Uuid::new_v4().simple()));
  let written=(||->Result<(),String>{
   let mut file=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|"Learned memory staging failed")?;
   crate::service_registration::restrict_file(&temp)?;
   file.write_all(&bytes).map_err(|_|"Learned memory write unresolved")?;
   file.sync_all().map_err(|_|"Learned memory flush unresolved")?;drop(file);
   replace_file(&temp,&path)?;
   if let Ok(parent)=fs::File::open(path.parent().ok_or("Learned memory parent missing")?){
    parent.sync_all().map_err(|_|"Learned memory parent flush unresolved")?;
   }Ok(())
  })();
  if let Err(error)=written{self.uncertain=true;return Err(error)}
  self.learned=next;Ok(result)
 }
}
