//! Content-free memory purpose rows in the ORIGINAL ProviderAttemptStore.
//! No new connection, writer, credential, request slot or release authority.
use super::*;
use serde::{Deserialize,Serialize};
#[cfg(test)]
mod persistence_tests;
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryAttemptMetadata{
 pub request_id:String,pub scope_hash:String,pub input_hash:String,
 pub source_watermark:String,pub payload_sha256:String,pub engine_instance_id:String,
 pub policy_revision:u64,pub chat_revision:u64,
 pub binding:veyra_contracts::ModelBinding,pub runtime:RuntimeMetadata,
}
fn hex(v:&str)->bool{v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn checked_sql_count(value:i64)->Result<u64,ProviderAttemptStoreError>{
 u64::try_from(value).map_err(|_|ProviderAttemptStoreError::Corrupt)
}
fn encode(value:&MemoryAttemptMetadata)->Result<String,ProviderAttemptStoreError>{
 use ProviderAttemptStoreError::Invalid;
 if !validation::uuid_id(&value.request_id)||![&value.scope_hash,&value.input_hash,&value.source_watermark,&value.payload_sha256].iter().all(|v|hex(v))||
  value.engine_instance_id.is_empty()||value.engine_instance_id.len()>512||value.engine_instance_id.chars().any(char::is_control)||
  value.binding.profile_id.is_empty()||value.binding.profile_id.len()>256||value.binding.quant.is_empty()||value.binding.quant.len()>128||
  value.binding!=value.runtime.binding||!validation::uuid_id(&value.runtime.generation)||
  *value.runtime.address.ip()!=std::net::Ipv4Addr::LOCALHOST||value.runtime.address.port()==0||
  value.runtime.listener_pid==0||value.runtime.listener_creation_time==0{return Err(Invalid)}
 let record=serde_json::to_string(value).map_err(|_|Invalid)?;
 if record.len()>8192{return Err(Invalid)}Ok(record)
}
pub struct MemoryAttemptYielded{metadata:MemoryAttemptMetadata,seal:Arc<StoreSeal>}
impl ProviderAttemptStore{
 /// Read-only early refusal in the SAME journal. Final commit repeats the
 /// check transactionally; this read does not grant a slot or native effect.
 pub fn can_admit_memory_input(&self,request:&str,scope:&str,input:&str)->Result<(),ProviderAttemptStoreError>{
  if !validation::uuid_id(request)||!hex(scope)||!hex(input){return Err(ProviderAttemptStoreError::Invalid)}
  validation::validate_schema(&self.connection)?;
  let count=checked_sql_count(self.connection.query_row("SELECT count(*) FROM memory_attempts",[],|r|r.get::<_,i64>(0))?)?;
  if count>=4096{return Err(ProviderAttemptStoreError::Conflict)}
  let spent:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE request_id=?1) OR EXISTS(SELECT 1 FROM memory_attempts WHERE request_id=?1 OR (scope_hash=?2 AND input_hash=?3))",
   params![request,scope,input],|r|r.get(0))?;
  if spent{return Err(ProviderAttemptStoreError::Conflict)}Ok(())
 }
 pub fn commit_memory_once(&mut self,value:&MemoryAttemptMetadata)->Result<(),ProviderAttemptStoreError>{
  let record=encode(value)?;
  let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
  validation::validate_schema(&tx)?;
  let count=checked_sql_count(tx.query_row("SELECT count(*) FROM memory_attempts",[],|r|r.get::<_,i64>(0))?)?;
  if count>=4096{return Err(ProviderAttemptStoreError::Conflict)}
  let spent:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE request_id=?1) OR EXISTS(SELECT 1 FROM memory_attempts WHERE request_id=?1 OR (scope_hash=?2 AND input_hash=?3))",
   params![value.request_id,value.scope_hash,value.input_hash],|r|r.get(0))?;
  if spent{return Err(ProviderAttemptStoreError::Conflict)}
  tx.execute("INSERT INTO memory_attempts VALUES(?1,?2,?3,?4,'pending')",params![value.request_id,value.scope_hash,value.input_hash,record])?;
  validation::validate_schema(&tx)?;tx.commit()?;Ok(())
 }
 pub fn pending_memory(&self)->Result<bool,ProviderAttemptStoreError>{
  validation::validate_schema(&self.connection)?;
  self.connection.query_row("SELECT EXISTS(SELECT 1 FROM memory_attempts WHERE disposition='pending')",[],|r|r.get(0)).map_err(Into::into)
 }
 /// Same contract as mark_yielded: only the original service consumer with
 /// actual joined native retirement/resume may call this metadata transition.
 pub fn mark_memory_yielded(&mut self,value:&MemoryAttemptMetadata)->Result<MemoryAttemptYielded,ProviderAttemptStoreError>{
  let record=encode(value)?;
  let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
  validation::validate_schema(&tx)?;
  let changed=tx.execute("UPDATE memory_attempts SET disposition='yielded' WHERE request_id=?1 AND record=?2 AND disposition='pending'",params![value.request_id,record])?;
  if changed!=1{return Err(ProviderAttemptStoreError::Conflict)}
  tx.commit()?;Ok(MemoryAttemptYielded{metadata:value.clone(),seal:self.seal.clone()})
 }
 pub fn owns_memory_yielded(&self,receipt:&MemoryAttemptYielded,value:&MemoryAttemptMetadata)->bool{
  Arc::ptr_eq(&self.seal,&receipt.seal)&&receipt.metadata==*value
 }
}
pub(super) fn validate_rows(connection:&Connection)->Result<(),ProviderAttemptStoreError>{
 let count=checked_sql_count(connection.query_row("SELECT count(*) FROM memory_attempts",[],|r|r.get::<_,i64>(0))?)?;
 if count>4096{return Err(ProviderAttemptStoreError::Corrupt)}
 let mut q=connection.prepare("SELECT request_id,scope_hash,input_hash,record,disposition FROM memory_attempts")?;
 let mut rows=q.query([])?;
 while let Some(row)=rows.next()?{
  let record:String=row.get(3)?;
  if record.len()>8192{return Err(ProviderAttemptStoreError::Corrupt)}
  let value:MemoryAttemptMetadata=serde_json::from_str(&record).map_err(|_|ProviderAttemptStoreError::Corrupt)?;
  let disposition:String=row.get(4)?;
  if encode(&value).map_err(|_|ProviderAttemptStoreError::Corrupt)?!=record||row.get::<_,String>(0)?!=value.request_id||
     row.get::<_,String>(1)?!=value.scope_hash||row.get::<_,String>(2)?!=value.input_hash||
     !matches!(disposition.as_str(),"pending"|"yielded"){return Err(ProviderAttemptStoreError::Corrupt)}
  let collision:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE request_id=?)",[&value.request_id],|r|r.get(0))?;
  if collision{return Err(ProviderAttemptStoreError::Corrupt)}
 }Ok(())
}
pub(super) fn validate_schema_v3(connection:&Connection)->Result<(),ProviderAttemptStoreError>{
 type Shape=(String,String,String,Option<String>);
 let temp=checked_sql_count(connection.query_row("SELECT count(*) FROM sqlite_temp_schema",[],|r|r.get::<_,i64>(0))?)?;
 if temp!=0{return Err(ProviderAttemptStoreError::Corrupt)}
 let base=include_str!("0002.sql").split(';').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>();
 let migration=include_str!("0003.sql");
 let before_triggers=migration.split("CREATE TRIGGER").next().ok_or(ProviderAttemptStoreError::Corrupt)?;
 let additions=before_triggers.split(';').map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>();
 let mut triggers=vec![];
 for part in migration.split("CREATE TRIGGER").skip(1){
  let end=part.find(" END;").ok_or(ProviderAttemptStoreError::Corrupt)?;
  triggers.push(format!("CREATE TRIGGER{} END",&part[..end]));
 }
 if base.len()!=3||additions.len()!=2||triggers.len()!=2{return Err(ProviderAttemptStoreError::Corrupt)}
 let mut expected:Vec<Shape>=vec![
  ("index".into(),"attempts_one_pending_turn".into(),"attempts".into(),Some(base[1].into())),
  ("index".into(),"sqlite_autoindex_attempts_1".into(),"attempts".into(),None),
  ("table".into(),"attempts".into(),"attempts".into(),Some(base[0].into())),
  ("index".into(),"memory_attempts_one_input".into(),"memory_attempts".into(),Some(additions[1].into())),
  ("index".into(),"sqlite_autoindex_memory_attempts_1".into(),"memory_attempts".into(),None),
  ("table".into(),"memory_attempts".into(),"memory_attempts".into(),Some(additions[0].into())),
  ("trigger".into(),"attempts_no_memory_request".into(),"attempts".into(),Some(triggers[0].clone())),
  ("trigger".into(),"memory_no_task_request".into(),"memory_attempts".into(),Some(triggers[1].clone())),
 ];
 expected.sort();
 let mut q=connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")?;
 let observed=q.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?.collect::<Result<Vec<Shape>,_>>()?;
 if observed!=expected{return Err(ProviderAttemptStoreError::Corrupt)}Ok(())
}
#[cfg(test)]
mod count_tests{
 use super::*;
 #[test]
 fn sqlite_signed_counts_are_checked_without_unsigned_decoding(){
  let connection=Connection::open_in_memory().unwrap();
  for value in [i64::MIN,-1,0,4095,4096,4097,i64::MAX]{
   let decoded=connection.query_row("SELECT ?1",[value],|row|row.get::<_,i64>(0)).unwrap();
   let checked=checked_sql_count(decoded);
   if value<0{assert!(matches!(checked,Err(ProviderAttemptStoreError::Corrupt)))}
   else{assert_eq!(checked.unwrap(),u64::try_from(value).unwrap())}
  }
 }
}
