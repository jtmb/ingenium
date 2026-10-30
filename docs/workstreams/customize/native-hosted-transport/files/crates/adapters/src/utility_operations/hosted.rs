//! NodeHosted custody in the EXISTING utility originals database.
//! Public originals remain in originals; the companion row is only a durable CAS claim.
use super::*;
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS hosted_dispatch(
 id TEXT PRIMARY KEY REFERENCES originals(id),owner_key TEXT NOT NULL,started INTEGER NOT NULL DEFAULT 0 CHECK(started IN(0,1)));
CREATE INDEX IF NOT EXISTS hosted_dispatch_owner ON hosted_dispatch(owner_key);
"#;
const PENDING: &str = "SELECT o.id,o.original,o.result FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE o.kind='hosted_governance' AND h.owner_key=? AND o.result IS NULL ORDER BY o.created,o.id LIMIT 4097";
const INSERT: &str = "INSERT INTO originals(id,kind,original,result,created) VALUES(?,'hosted_governance',?,NULL,?)";
const CLAIM: &str = "UPDATE hosted_dispatch SET started=1 WHERE id=? AND owner_key=? AND started=0 AND EXISTS(SELECT 1 FROM originals o WHERE o.id=hosted_dispatch.id AND o.kind='hosted_governance' AND o.original=? AND o.result IS NULL)";
const UNSENT_REFUSAL: &str = "UPDATE originals SET result=? WHERE id=? AND kind='hosted_governance' AND original=? AND result IS NULL AND EXISTS(SELECT 1 FROM hosted_dispatch h WHERE h.id=originals.id AND h.owner_key=? AND h.started=0)";
fn checked(key:&str,record:&Value)->Result<String>{
 if key.len()!=64||!key.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Invalid hosted owner".into());}
 let bytes=serde_json::to_string(record).map_err(|_|"Invalid retained hosted original")?;
 if bytes.len()>2_100_000{return Err("Hosted original capacity exceeded".into());}
 Ok(bytes)
}
impl Store {
 fn hosted_schema(&self)->Result<()> {self.db.execute_batch(SCHEMA).map_err(|_|"Hosted custody unavailable".into())}
 /// Commit original and its pending-owner guard in one IMMEDIATE transaction.
 pub fn hosted_reserve(&mut self,id:&str,key:&str,record:&Value)->Result<Value>{
   if !canonical(id)||record["original"]["id"].as_str()!=Some(id){return Err("Invalid hosted original".into());}
   let bytes=checked(key,record)?;self.hosted_schema()?;
   let tx=self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|"Hosted custody busy")?;
   let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE h.owner_key=? AND o.result IS NULL)",[key],|r|r.get(0)).map_err(|_|"Cannot inspect hosted custody")?;
   if pending{return Err("A retained hosted original requires recovery".into());}
   let count:i64=tx.query_row("SELECT count(*) FROM originals",[],|r|r.get(0)).map_err(|_|"Original capacity unavailable")?;
   if count>=4096{return Err("Original capacity reached".into());}
   tx.execute(INSERT,params![id,bytes,crate::productivity::now_ms()]).map_err(|_|"Original already retained")?;
   tx.execute("INSERT INTO hosted_dispatch(id,owner_key,started) VALUES(?,?,0)",params![id,key]).map_err(|_|"Cannot retain hosted claim")?;
   tx.commit().map_err(|_|"Cannot commit hosted original")?;
   Ok(record["original"].clone())
 }
 /// Once true, even a crash before the first byte leaves this original consumed.
 pub fn hosted_claim(&mut self,id:&str,key:&str,record:&Value)->Result<bool>{
   let bytes=checked(key,record)?;self.hosted_schema()?;
   let tx=self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|"Hosted custody busy")?;
   let claimed=tx.execute(CLAIM,params![id,key,bytes]).map_err(|_|"Cannot claim hosted original")?==1;
   tx.commit().map_err(|_|"Cannot commit hosted dispatch")?;Ok(claimed)
 }
 pub fn hosted_pending(&self,key:&str)->Result<Vec<Value>>{
   checked(key,&Value::Null)?;self.hosted_schema()?;
   let mut q=self.db.prepare(PENDING).map_err(|_|"Hosted index unavailable")?;
   let rows=q.query_map([key],|r|r.get::<_,String>(1)).map_err(|_|"Hosted index unavailable")?;
   let records=rows.map(|r|serde_json::from_str::<Value>(&r.map_err(|_|"Hosted original unavailable")?).map_err(|_|"Invalid retained hosted original".into())).collect::<Result<Vec<_>>>()?;
   if records.len()>4096{return Err("Hosted index capacity exceeded".into());}Ok(records)
 }
 pub fn hosted_record(&self,id:&str,key:&str)->Result<Option<Value>>{
   if !canonical(id){return Err("Invalid hosted original ID".into());}checked(key,&Value::Null)?;self.hosted_schema()?;
   let row:Option<(String,Option<String>,i64)>=self.db.query_row(
     "SELECT o.original,o.result,h.started FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE o.id=? AND o.kind='hosted_governance' AND h.owner_key=?",
     params![id,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|"Hosted original unavailable")?;
   row.map(|(bytes,result,started)|Ok(json!({"record":serde_json::from_str::<Value>(&bytes).map_err(|_|"Invalid hosted original")?,
     "result":result.map(|s|serde_json::from_str::<Value>(&s)).transpose().map_err(|_|"Invalid hosted receipt")?,"started":started==1}))).transpose()
 }
 /// Native proof of NON-dispatch is a compare-and-finalize, never absence of a remote receipt.
 /// A racing dispatch either wins its claim or is prevented by this terminal refusal.
 pub fn hosted_refuse_unstarted(&mut self,id:&str,key:&str,record:&Value,receipt:&Value)->Result<bool>{
   let bytes=checked(key,record)?;self.hosted_schema()?;
   if receipt["outcome"]!="refused"||receipt["original"]!=record["original"]{return Err("Invalid unsent refusal".into());}
   let encoded=serde_json::to_string(receipt).map_err(|_|"Invalid hosted receipt")?;
   let tx=self.db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|"Hosted custody busy")?;
   let finalized=tx.execute(UNSENT_REFUSAL,params![encoded,id,bytes,key]).map_err(|_|"Cannot finalize unsent original")?==1;
   tx.commit().map_err(|_|"Cannot retain unsent refusal")?;Ok(finalized)
 }
}
#[cfg(test)]
mod tests {
 use super::*;
 fn store()->Store{let db=Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE originals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,original TEXT NOT NULL,result TEXT,created INTEGER NOT NULL);").unwrap();Store{db}}
 fn record(id:&str)->Value{json!({"original":{"id":id,"binding":{"actorId":"actual"},"command":{"op":"archive"}},"private_owner":{"project":{"id":"project"}}})}
 #[test] fn claim_survives_waiter_and_never_replays(){let mut s=store();let id=uuid::Uuid::new_v4().to_string();let key="a".repeat(64);let r=record(&id);s.hosted_reserve(&id,&key,&r).unwrap();assert!(s.hosted_claim(&id,&key,&r).unwrap());assert!(!s.hosted_claim(&id,&key,&r).unwrap());assert_eq!(s.hosted_pending(&key).unwrap(),vec![r]);}
 #[test] fn owner_and_exact_original_are_not_replaceable(){let mut s=store();let id=uuid::Uuid::new_v4().to_string();let key="a".repeat(64);let mut r=record(&id);s.hosted_reserve(&id,&key,&r).unwrap();r["original"]["command"]["op"]=json!("restore");assert!(!s.hosted_claim(&id,&key,&r).unwrap());assert!(s.hosted_record(&id,&"b".repeat(64)).unwrap().is_none());}
 #[test] fn inspection_proves_unsent_with_atomic_refusal(){let mut s=store();let id=uuid::Uuid::new_v4().to_string();let key="a".repeat(64);let r=record(&id);s.hosted_reserve(&id,&key,&r).unwrap();let receipt=json!({"original":r["original"],"outcome":"refused"});assert!(s.hosted_refuse_unstarted(&id,&key,&r,&receipt).unwrap());assert!(!s.hosted_claim(&id,&key,&r).unwrap());assert!(s.hosted_pending(&key).unwrap().is_empty());}
}

// Root must invoke these from the ACTUAL Project/mapping/profile/full-restore owners.
// An unknown remote effect keeps custody even after the HTTP waiter/process exits.
const PROJECT_CUSTODY: &str = "SELECT EXISTS(SELECT 1 FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE o.kind='hosted_governance' AND o.result IS NULL AND json_extract(o.original,'$.original.binding.nativeProjectId') IS ?)";
const RESOURCE_CUSTODY: &str = "SELECT EXISTS(SELECT 1 FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE o.kind='hosted_governance' AND o.result IS NULL AND (json_extract(o.original,'$.original.binding.grantId')=? OR json_extract(o.original,'$.original.binding.connectionId')=? OR json_extract(o.original,'$.private_owner.enrollment_request_id')=?))";
impl Store {
 pub fn hosted_project_has_custody(&self,project:Option<&str>)->Result<bool>{
  self.hosted_schema()?;self.db.query_row(PROJECT_CUSTODY,[project],|r|r.get(0)).map_err(|_|"Hosted project custody unavailable".into())
 }
 pub fn hosted_resource_has_custody(&self,original_id:&str)->Result<bool>{
  self.hosted_schema()?;self.db.query_row(RESOURCE_CUSTODY,params![original_id,original_id,original_id],|r|r.get(0)).map_err(|_|"Hosted resource custody unavailable".into())
 }
 pub fn hosted_library_has_custody(&self)->Result<bool>{
  self.hosted_schema()?;self.db.query_row("SELECT EXISTS(SELECT 1 FROM originals o JOIN hosted_dispatch h ON h.id=o.id WHERE o.kind='hosted_governance' AND o.result IS NULL)",[],|r|r.get(0)).map_err(|_|"Hosted library custody unavailable".into())
 }
}
