use crate::*;
use std::collections::BTreeSet;
const MAX_RECEIPTS:usize=4096;
const MAX_ENTRIES:usize=256;
fn chat_key(scope:&NativeScope,chat:&str)->Result<String,MemoryError>{if !id(chat){return Err(MemoryError::Invalid)}fingerprint(&(scope,chat))}
fn suppression(scope:&NativeScope,kind:&str,value:&str)->Result<String,MemoryError>{fingerprint(&(scope,kind,value))}
impl LearnedState {
 /// State-only prerequisite, not canonical source or model-dispatch authority.
 /// Called by the actual owner after capture and every exact refresh, before
 /// any model attempt so forgotten/processed inputs do not generate again.
 pub fn can_generate(&self,snapshot:&CompletedSnapshot)->Result<(),MemoryError>{
  let scope=&snapshot.stamp.scope;
  snapshot.verify(&snapshot.stamp,&snapshot.messages,&self.policy(scope)?,&self.chat(scope,&snapshot.chat_id)?)?;
  if self.processed_inputs.contains(&snapshot.input_hash()?){return Err(MemoryError::AlreadyProcessed)}
  if self.processed_inputs.len()>=4096{return Err(MemoryError::Capacity)}
  for source in snapshot.sources(){
   if self.suppressions.contains(&suppression(scope,"source",&fingerprint(&(&source.chat_id,&source.message_id))?)?){return Err(MemoryError::Forgotten)}
  }Ok(())
 }
 pub fn policy(&self,scope:&NativeScope)->Result<Policy,MemoryError>{Ok(self.policies.get(&scope.key()?).map(|v|v.policy.clone()).unwrap_or_default())}
 pub fn chat(&self,scope:&NativeScope,chat:&str)->Result<ChatPolicy,MemoryError>{Ok(self.chats.get(&chat_key(scope,chat)?).map(|v|v.policy.clone()).unwrap_or_default())}
 pub fn receipt(&self,scope:&NativeScope,operation:&str,request_hash:&str)->Result<Option<Receipt>,MemoryError>{
  if !id(operation)||!id(request_hash){return Err(MemoryError::Invalid)}
  match self.receipts.get(operation){
   Some(r) if r.scope_hash==scope.key()?&&r.request_hash==request_hash=>Ok(Some(r.clone())),
   Some(_)=>Err(MemoryError::Conflict),None=>Ok(None)
  }
 }
 fn record(&mut self,scope:&NativeScope,operation:&str,request_hash:&str,kind:&str,revision:u64,memory_id:Option<String>)->Result<Receipt,MemoryError>{
  if self.receipts.len()>=MAX_RECEIPTS{return Err(MemoryError::Capacity)}
  let receipt=Receipt{operation_id:operation.into(),request_hash:request_hash.into(),scope_hash:scope.key()?,kind:kind.into(),revision,memory_id};
  self.receipts.insert(operation.into(),receipt.clone());Ok(receipt)
 }
 /// Caller clones under GoalStore's original mutex and persists before publishing.
 pub fn set_policy(&mut self,scope:&NativeScope,operation:&str,expected:u64,mut next:Policy)->Result<Receipt,MemoryError>{
  let hash=fingerprint(&("policy",scope,expected,&next))?;
  if let Some(r)=self.receipt(scope,operation,&hash)?{return Ok(r)}
  if self.policy(scope)?.revision!=expected{return Err(MemoryError::Conflict)}
  if !(1..=48).contains(&next.min_idle_hours)||next.revision!=expected{return Err(MemoryError::Invalid)}
  next.revision=expected.checked_add(1).ok_or(MemoryError::Capacity)?;
  let receipt=self.record(scope,operation,&hash,"policy",next.revision,None)?;
  self.policies.insert(scope.key()?,PolicyRecord{scope:scope.clone(),policy:next});Ok(receipt)
 }
 pub fn set_chat(&mut self,scope:&NativeScope,chat_id:&str,operation:&str,expected:u64,mut next:ChatPolicy)->Result<Receipt,MemoryError>{
  let hash=fingerprint(&("chat",scope,chat_id,expected,&next))?;
  if let Some(r)=self.receipt(scope,operation,&hash)?{return Ok(r)}
  let key=chat_key(scope,chat_id)?;
  if self.chat(scope,chat_id)?.revision!=expected||next.revision!=expected{return Err(MemoryError::Conflict)}
  next.revision=expected.checked_add(1).ok_or(MemoryError::Capacity)?;
  let receipt=self.record(scope,operation,&hash,"chat",next.revision,None)?;
  self.chats.insert(key,ChatRecord{scope:scope.clone(),chat_id:chat_id.into(),policy:next});Ok(receipt)
 }
 pub fn suppressed(&self,scope:&NativeScope,entry:&LearnedEntry)->Result<bool,MemoryError>{
  if self.suppressions.contains(&suppression(scope,"entry",&entry.id)?)||self.suppressions.contains(&suppression(scope,"content",&entry.content_hash)?){return Ok(true)}
  for source in &entry.sources{if self.suppressions.contains(&suppression(scope,"source",&fingerprint(&(&source.chat_id,&source.message_id))?)?){return Ok(true)}}Ok(false)
 }
 pub fn accept(&mut self,snapshot:&CompletedSnapshot,stamp:&ExecutionStamp,refreshed:&[CompletedMessage],operation:&str,entry:LearnedEntry)->Result<Receipt,MemoryError>{
  let scope=&snapshot.stamp.scope;
  let hash=fingerprint(&("learn",snapshot,operation,&entry))?;
  if let Some(r)=self.receipt(scope,operation,&hash)?{return Ok(r)}
  snapshot.verify(stamp,refreshed,&self.policy(scope)?,&self.chat(scope,&snapshot.chat_id)?)?;
  let input=snapshot.input_hash()?;
  if entry.scope!=*scope||!id(&entry.id)||entry.revision!=1||entry.content.is_empty()||entry.content.len()>4096||entry.content.contains('\0')||
     entry.content_hash!=content_hash(&entry.content)||entry.sources!=snapshot.sources()||entry.source_watermark!=snapshot.watermark||
     !id(&entry.model)||entry.input_hash!=input||entry.created_ms<snapshot.captured_ms{return Err(MemoryError::Invalid)}
  if self.entries.len()>=MAX_ENTRIES||self.entries.contains_key(&entry.id){return Err(MemoryError::Capacity)}
  if self.processed_inputs.contains(&input){return Err(MemoryError::AlreadyProcessed)}
  if self.suppressed(scope,&entry)?{return Err(MemoryError::Forgotten)}
  let receipt=self.record(scope,operation,&hash,"learn",1,Some(entry.id.clone()))?;
  self.processed_inputs.insert(input);self.entries.insert(entry.id.clone(),entry);Ok(receipt)
 }
 pub fn forget(&mut self,scope:&NativeScope,memory_id:&str,operation:&str,expected:u64)->Result<Receipt,MemoryError>{
  let hash=fingerprint(&("forget",scope,memory_id,expected))?;
  if let Some(r)=self.receipt(scope,operation,&hash)?{return Ok(r)}
  let entry=self.entries.get(memory_id).ok_or(MemoryError::Forgotten)?.clone();
  if entry.scope!=*scope||entry.revision!=expected{return Err(MemoryError::Conflict)}
  let mut tombstones=BTreeSet::new();
  tombstones.insert(suppression(scope,"entry",memory_id)?);tombstones.insert(suppression(scope,"content",&entry.content_hash)?);
  for source in &entry.sources{tombstones.insert(suppression(scope,"source",&fingerprint(&(&source.chat_id,&source.message_id))?)?);}
  if self.suppressions.len()+tombstones.len()>16384{return Err(MemoryError::Capacity)}
  let receipt=self.record(scope,operation,&hash,"forget",expected,Some(memory_id.into()))?;
  self.suppressions.extend(tombstones);
  let mut remove=vec![];
  for (key,e) in &self.entries{if e.scope==*scope&&self.suppressed(scope,e)?{remove.push(key.clone())}}
  for key in remove{self.entries.remove(&key);}Ok(receipt)
 }
 pub fn recall(&self,scope:&NativeScope,chat_id:&str)->Result<Vec<LearnedEntry>,MemoryError>{
  let policy=self.policy(scope)?;let chat=self.chat(scope,chat_id)?;
  if !policy.enabled||!policy.use_memories||!chat.use_memories{return Ok(vec![])}
  let mut entries=Vec::new();
  for e in self.entries.values(){if e.scope==*scope&&!self.suppressed(scope,e)?&&
     e.sources.iter().all(|s|self.chat(scope,&s.chat_id).map(|p|p.contribute).unwrap_or(false)){entries.push(e.clone())}}
  entries.sort_by(|a,b|b.created_ms.cmp(&a.created_ms).then(a.id.cmp(&b.id)));entries.truncate(8);Ok(entries)
 }
 /// Same verified custody only. Current tombstones/receipts/opt-outs dominate.
 pub fn restore(&mut self,backup:LearnedState)->Result<(),MemoryError>{
  if backup.version!=1{return Err(MemoryError::Invalid)}
  let mut next=backup;
  next.suppressions.extend(self.suppressions.iter().cloned());
  next.processed_inputs.extend(self.processed_inputs.iter().cloned());
  for (key,r) in &self.receipts{
   if next.receipts.get(key).is_some_and(|other|other!=r){return Err(MemoryError::Conflict)}
   next.receipts.insert(key.clone(),r.clone());
  }
  next.policies.extend(self.policies.clone());next.chats.extend(self.chats.clone());
  let mut remove=vec![];
  for (key,e) in &next.entries{if next.suppressed(&e.scope,e)?{remove.push(key.clone())}}
  for key in remove{next.entries.remove(&key);}
  next.validate()?;*self=next;Ok(())
 }
 pub fn validate(&self)->Result<(),MemoryError>{
  if self.version!=1||self.entries.len()>MAX_ENTRIES||self.receipts.len()>MAX_RECEIPTS||self.suppressions.len()>16384||self.processed_inputs.len()>4096||
     self.policies.len()>256||self.chats.len()>4096{return Err(MemoryError::Capacity)}
  for (key,v) in &self.policies{if *key!=v.scope.key()?||!(1..=48).contains(&v.policy.min_idle_hours){return Err(MemoryError::Invalid)}}
  for (key,v) in &self.chats{if *key!=chat_key(&v.scope,&v.chat_id)?{return Err(MemoryError::Invalid)}}
  for (key,e) in &self.entries{e.scope.validate()?;
   if *key!=e.id||!id(key)||e.revision==0||e.content.is_empty()||e.content.len()>4096||e.content_hash!=content_hash(&e.content)||
      e.sources.is_empty()||e.sources.len()>RECENT_LIMIT{return Err(MemoryError::Invalid)}
  }Ok(())
 }
}
