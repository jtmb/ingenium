use serde::{Serialize,Deserialize};
use crate::*;
pub const RECENT_LIMIT:usize=32;
pub const SNAPSHOT_BYTES:usize=262_144;
/// Canonical EngineMessage + original prompt custody; absent provenance is unknown.
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedMessage {
 pub source:SourceRef,pub text:String,pub completed_ms:u64,
 pub terminal:bool,pub external_context:Option<bool>,
}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedSnapshot {
 pub stamp:ExecutionStamp,pub chat_id:String,pub messages:Vec<CompletedMessage>,
 pub captured_ms:u64,pub policy_revision:u64,pub chat_revision:u64,pub watermark:String,
}
impl CompletedSnapshot {
 pub fn capture(stamp:ExecutionStamp,chat_id:String,messages:Vec<CompletedMessage>,now:u64,policy:&Policy,chat:&ChatPolicy)->Result<Self,MemoryError>{
  stamp.validate()?;
  if !policy.enabled||!policy.generate||!chat.contribute{return Err(MemoryError::Excluded)}
  if !(1..=48).contains(&policy.min_idle_hours)||!id(&chat_id)||messages.is_empty()||messages.len()>RECENT_LIMIT||messages.len()%2!=0{return Err(MemoryError::Invalid)}
  let mut bytes=0usize;let mut seen=std::collections::BTreeSet::new();let mut latest=0;
  for pair in messages.chunks_exact(2){
   let (u,a)=(&pair[0],&pair[1]);
   if u.source.role!=Role::User||a.source.role!=Role::Assistant||!a.terminal||!u.terminal||
      u.source.turn_id!=a.source.turn_id||u.source.terminal_id!=a.source.message_id||a.source.terminal_id!=a.source.message_id||
      u.source.message_id!=u.source.turn_id{return Err(MemoryError::Unavailable)}
   for m in pair{
    if m.source.chat_id!=chat_id||!id(&m.source.message_id)||!id(&m.source.revision)||m.source.content_hash!=content_hash(&m.text)||m.text.is_empty()||
       !seen.insert(m.source.message_id.clone())||m.completed_ms>now{return Err(MemoryError::Invalid)}
    match m.external_context{None=>return Err(MemoryError::Unavailable),Some(true) if !policy.external_context=>return Err(MemoryError::Excluded),_=>{}}
    bytes=bytes.checked_add(m.text.len()).ok_or(MemoryError::Capacity)?;latest=latest.max(m.completed_ms);
   }
  }
  if bytes>SNAPSHOT_BYTES{return Err(MemoryError::Capacity)}
  if now.saturating_sub(latest)<u64::from(policy.min_idle_hours)*3_600_000{return Err(MemoryError::Excluded)}
  let watermark=fingerprint(&(&stamp,&chat_id,&messages,policy.revision,chat.revision))?;
  Ok(Self{stamp,chat_id,messages,captured_ms:now,policy_revision:policy.revision,chat_revision:chat.revision,watermark})
 }
 /// Refresh selected members only; later messages outside the snapshot are allowed.
 pub fn verify(&self,stamp:&ExecutionStamp,current:&[CompletedMessage],policy:&Policy,chat:&ChatPolicy)->Result<(),MemoryError>{
  if &self.stamp!=stamp{return Err(MemoryError::Scope)}
  if !policy.enabled||!policy.generate||!chat.contribute||policy.revision!=self.policy_revision||chat.revision!=self.chat_revision{return Err(MemoryError::Excluded)}
  if current!=self.messages{return Err(MemoryError::SourceChanged)}
  let rebuilt=Self::capture(stamp.clone(),self.chat_id.clone(),current.to_vec(),self.captured_ms,policy,chat)?;
  if rebuilt.watermark!=self.watermark{return Err(MemoryError::SourceChanged)}Ok(())
 }
 pub fn sources(&self)->Vec<SourceRef>{self.messages.iter().map(|m|m.source.clone()).collect()}
 pub fn input_hash(&self)->Result<String,MemoryError>{fingerprint(&(&self.stamp.scope,&self.watermark))}
}