//! Additive local custody in the existing ProjectStore single writer.
use super::*;
use crate::local_custody::LocalCustody;
use std::sync::Arc;
use sha2::{Digest,Sha256};
use veyra_contracts::local_workspaces::{LocalWorkspaceOwner,LocalEnvironment,LocalOperationRequest,LocalOperationReceipt};

#[derive(Clone,serde::Serialize,serde::Deserialize)]
pub struct LocalWorkspaceRecord {
 pub id:String,pub environment:LocalEnvironment,pub revision:u64,pub state:String,
 pub root_identity:Option<String>,pub root_path:Option<String>,
}
fn encoded<T:serde::Serialize>(value:&T)->Result<String,StoreError>{serde_json::to_string(value).map_err(|_|StoreError::Invalid)}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn canonical(id:&str)->bool{uuid::Uuid::parse_str(id).is_ok_and(|v|!v.is_nil()&&v.to_string()==id)}
fn digest_legacy(db:&Connection)->Result<String,StoreError>{
 let mut state=Sha256::new();
 let mut query=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'local_%' ORDER BY name")?;
 let tables=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
 for (name,sql) in tables {
  state.update((name.len() as u64).to_le_bytes());state.update(name.as_bytes());state.update(sql.as_bytes());
  let mut rows=db.prepare(&format!("SELECT * FROM \"{}\" ORDER BY rowid",name.replace('"',"\"\"")))?;
  let count=rows.column_count();let mut cursor=rows.query([])?;
  while let Some(row)=cursor.next()?{
   for i in 0..count {
    use rusqlite::types::ValueRef;
    match row.get_ref(i)? {
     ValueRef::Null=>state.update([0]),
     ValueRef::Integer(v)=>{state.update([1]);state.update(v.to_le_bytes());}
     ValueRef::Real(v)=>{state.update([2]);state.update(v.to_bits().to_le_bytes());}
     ValueRef::Text(v)=>{state.update([3]);state.update((v.len() as u64).to_le_bytes());state.update(v);}
     ValueRef::Blob(v)=>{state.update([4]);state.update((v.len() as u64).to_le_bytes());state.update(v);}
    }
   }
  }
 }
 Ok(format!("{:x}",state.finalize()))
}
impl ProjectStore {
 /// The existing startup supplies its original utility library ID, never an
 /// account ID or ephemeral service instance. No current request can bind it.
 pub fn open_local(path:&Path,custody:Arc<LocalCustody>,installation_id:&str)->Result<Self,StoreError>{
  if !canonical(installation_id)||path.parent()!=Some(custody.root()){return Err(StoreError::Invalid);}
  custody.verify().map_err(|_|StoreError::Invalid)?;
  for name in ["workspace.db","workspace.db-wal","workspace.db-shm"]{
   let file=custody.root().join(name);
   if file.exists(){custody.verify_private_file(&file).map_err(|_|StoreError::Invalid)?;}
  }
  custody.prepare_database(path).map_err(|_|StoreError::Invalid)?;
  let probe=Connection::open(path)?;
  let version=schema_version(&probe)?;
  if version>6{return Err(StoreError::NewerSchema);}drop(probe);
  let mut store=if version==6 {
   let connection=Connection::open(path)?;
   connection.busy_timeout(std::time::Duration::from_secs(5))?;
   connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
   validate_schema(&connection,5)?;
   Self{connection,local_custody:None,local_installation_id:None}
  }else{Self::open(path)?};
  let tx=store.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
  let current=schema_version(&tx)?;
  if current==5 {
   let unexpected:i64=tx.query_row("SELECT count(*) FROM sqlite_master WHERE name LIKE 'local_%'",[],|r|r.get(0))?;
   if unexpected!=0{return Err(StoreError::Corrupt);}
   let before=digest_legacy(&tx)?;
   tx.execute_batch(include_str!("0006.sql"))?;
   tx.execute("INSERT INTO local_installation VALUES(1,?,?,?,?,?,0,?)",
    params![installation_id,custody.scheme(),custody.subject(),custody.physical(),custody.key(),before])?;
   tx.execute("INSERT INTO local_migration_receipts VALUES(6,?,?,?)",params![installation_id,custody.key(),before])?;
   if digest_legacy(&tx)?!=before{return Err(StoreError::Corrupt);}
  }else if current!=6{return Err(StoreError::Corrupt);}
  // Every restart compares actual OS and original physical-root custody. A
  // different account/root/library cannot acquire old data by reopening it.
  let actual:(String,String,String,String,String)=tx.query_row(
   "SELECT installation_id,custodian_scheme,custodian_subject,state_identity,custodian_key FROM local_installation WHERE singleton=1",[],
   |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
  if actual!=(installation_id.into(),custody.scheme().into(),custody.subject().into(),custody.physical().into(),custody.key().into())
   {return Err(StoreError::Conflict);}
  let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM local_migration_receipts r JOIN local_installation i ON i.installation_id=r.installation_id AND i.custodian_key=r.custodian_key AND i.legacy_manifest_sha256=r.legacy_manifest_sha256 WHERE r.version=6)",[],|r|r.get(0))?;
  if !valid{return Err(StoreError::Corrupt);}
  let expected=Connection::open_in_memory()?;
  expected.execute_batch(include_str!("0006.sql"))?;
  fn ddl(db:&Connection)->Result<Vec<(String,String)>,StoreError>{
   let mut statement=db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'local_%' AND sql IS NOT NULL ORDER BY name")?;
   let values=statement.query_map([],|row|Ok((row.get(0)?,row.get(1)?)))?.collect::<Result<Vec<_>,_>>()?;
   Ok(values)
  }
  if ddl(&tx)?!=ddl(&expected)?{return Err(StoreError::Corrupt);}
  custody.verify().map_err(|_|StoreError::Conflict)?;tx.commit()?;
  store.local_custody=Some(custody);store.local_installation_id=Some(installation_id.into());Ok(store)
 }
 pub fn local_custody(&self)->Result<Arc<LocalCustody>,StoreError>{
  let custody=self.local_custody.as_ref().ok_or(StoreError::Invalid)?;
  custody.verify().map_err(|_|StoreError::Conflict)?;Ok(custody.clone())
 }
 pub fn local_installation_id(&self)->Result<&str,StoreError>{self.local_installation_id.as_deref().ok_or(StoreError::Invalid)}
 pub fn local_workspace(&self,id:&str)->Result<LocalWorkspaceRecord,StoreError>{
  if !canonical(id){return Err(StoreError::Invalid);}
  self.local_custody()?;
  let row=self.connection.query_row("SELECT environment,revision,state,root_identity,root_path FROM local_workspaces WHERE id=? AND installation_id=? AND custodian_key=?",
   params![id,self.local_installation_id()?,self.local_custody()?.key()],
   |r|Ok((r.get::<_,String>(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?.ok_or(StoreError::NotFound)?;
  Ok(LocalWorkspaceRecord{id:id.into(),environment:serde_json::from_str(&row.0).map_err(|_|StoreError::Corrupt)?,revision:row.1,state:row.2,root_identity:row.3,root_path:row.4})
 }
 /// Reserve before any directory call. Existing UUIDs NEVER call allocation.
 pub fn reserve_local_workspace(&mut self,id:&str,environment:&LocalEnvironment,original:&str)->Result<bool,StoreError>{
  if !canonical(id)||original.len()!=64{return Err(StoreError::Invalid);}
  let custody=self.local_custody()?;let installation=self.local_installation_id()?.to_owned();
  let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
  let existing=tx.query_row("SELECT environment,creation_sha256 FROM local_workspaces WHERE id=?",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
  let environment=encoded(environment)?;
  if let Some(prior)=existing {
   if prior!=(environment,original.into()){return Err(StoreError::Conflict);}tx.commit()?;return Ok(false);
  }
  let count:i64=tx.query_row("SELECT count(*) FROM local_workspaces",[],|r|r.get(0))?;
  if count>=128{return Err(StoreError::Invalid);}
  tx.execute("INSERT INTO local_workspaces(id,installation_id,custodian_key,environment,creation_sha256,state) VALUES(?,?,?,?,?,'reserved')",
   params![id,installation,custody.key(),environment,original])?;
  tx.commit()?;Ok(true)
 }
 pub fn activate_local_workspace(&mut self,id:&str,root:&LocalCustody)->Result<(),StoreError>{
  let record=self.local_workspace(id)?;
  if record.environment!=LocalEnvironment::Windows||record.state!="reserved"{return Err(StoreError::Conflict);}
  let custody=self.local_custody()?;root.verify().map_err(|_|StoreError::Conflict)?;
  if root.root().parent()!=Some(custody.root())||root.root().file_name().and_then(|name|name.to_str())!=Some(id)||root.subject()!=custody.subject(){return Err(StoreError::Invalid);}
  let n=self.connection.execute("UPDATE local_workspaces SET state='active',root_identity=?,root_path=? WHERE id=? AND state='reserved'",
   params![root.physical(),root.root().to_str().ok_or(StoreError::Invalid)?,id])?;
  if n!=1{return Err(StoreError::Conflict);}Ok(())
 }
 pub fn check_local_owner(&self,owner:&LocalWorkspaceOwner,instance:&str)->Result<LocalWorkspaceRecord,StoreError>{
  let custody=self.local_custody()?;let record=self.local_workspace(&owner.workspace_id)?;
  if owner.installation_id!=self.local_installation_id()?||owner.custodian_key!=custody.key()||
   owner.service_instance_id!=instance||owner.revision!=record.revision||owner.environment!=record.environment||record.state!="active"
   {return Err(StoreError::Conflict);}Ok(record)
 }
 pub fn local_receipt(&self,id:&str)->Result<Option<LocalOperationReceipt>,StoreError>{
  self.local_custody()?;
  self.connection.query_row("SELECT owner_json,request_sha256,state,result_json FROM local_workspace_operations WHERE id=?",[id],
   |r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?))).optional()?
   .map(|r|Ok(LocalOperationReceipt{request_id:id.into(),owner:serde_json::from_str(&r.0).map_err(|_|StoreError::Corrupt)?,
    request_sha256:r.1,state:r.2,result:r.3.map(|v|serde_json::from_str(&v)).transpose().map_err(|_|StoreError::Corrupt)?})).transpose()
 }
 /// Return false for every retained original, including unknown. No replay.
 pub fn reserve_local_operation(&mut self,request:&LocalOperationRequest,instance:&str)->Result<bool,StoreError>{
  if !canonical(&request.request_id){return Err(StoreError::Invalid);}
  self.check_local_owner(&request.owner,instance)?;
  let bytes=encoded(request)?;if bytes.len()>1024*1024{return Err(StoreError::Invalid);}
  let digest=hash(bytes.as_bytes());
  if let Some(prior)=self.local_receipt(&request.request_id)?{
   if prior.request_sha256!=digest||prior.owner!=request.owner{return Err(StoreError::Conflict);}return Ok(false);
  }
  let kind=encoded(&request.operation)?.split(',').next().unwrap_or("").to_owned();
  let count:i64=self.connection.query_row("SELECT count(*) FROM local_workspace_operations",[],|r|r.get(0))?;
  if count>=4096{return Err(StoreError::Invalid);}
  self.connection.execute("INSERT INTO local_workspace_operations VALUES(?,?,?,?,?,'intent',NULL)",
   params![request.request_id,request.owner.workspace_id,encoded(&request.owner)?,digest,kind])?;Ok(true)
 }
 pub fn fence_local_operation(&mut self,id:&str)->Result<(),StoreError>{
  self.local_custody()?;
  if self.connection.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id=? AND state='intent'",[id])?!=1{return Err(StoreError::Conflict);}Ok(())
 }
 pub fn settle_local_operation(&mut self,id:&str,result:&serde_json::Value)->Result<(),StoreError>{
  let bytes=encoded(result)?;if bytes.len()>1024*1024{return Err(StoreError::Invalid);}
  if self.connection.execute("UPDATE local_workspace_operations SET state='committed',result_json=? WHERE id=? AND state='unknown'",params![bytes,id])?!=1
   {return Err(StoreError::Conflict);}Ok(())
 }
}

impl ProjectStore {
 pub fn unknown_local_workspace(&mut self,id:&str)->Result<(),StoreError>{
  self.connection.execute("UPDATE local_workspaces SET state='unknown' WHERE id=? AND state='reserved'",[id])?;Ok(())
 }
 pub fn activate_local_wsl_workspace(&mut self,id:&str,created:&crate::local_execution::LocalWslCreated)->Result<(),StoreError>{
  let record=self.local_workspace(id)?;
  if record.state!="reserved"||created.workspace_id()!=id||created.installation_id()!=self.local_installation_id()?||
   created.environment()!=&record.environment{return Err(StoreError::Conflict);}
  self.local_custody()?;created.verify().map_err(|_|StoreError::Conflict)?;
  if self.connection.execute("UPDATE local_workspaces SET state='active',root_identity=?,root_path=? WHERE id=? AND state='reserved'",
   params![created.physical(),created.directory(),id])?!=1{return Err(StoreError::Conflict);}Ok(())
 }
 pub fn require_local_session(&self,workspace:&str,session:&str)->Result<(),StoreError>{
  self.local_custody()?;
  let count:i64=self.connection.query_row("SELECT count(*) FROM local_workspace_operations WHERE workspace_id=? AND state='committed' AND json_extract(result_json,'$.result_kind')='session_created' AND json_extract(result_json,'$.session.id')=?",
   params![workspace,session],|r|r.get(0))?;
  if count!=1{return Err(StoreError::NotFound);}Ok(())
 }
}

impl ProjectStore {
 /// Inventory-only getter, including a currently refused guard. This never
 /// authorizes execution or discards an unresolved original.
 pub fn local_custody_originals(&self)->Option<Arc<crate::local_custody::LocalCustodyOriginals>>{
  self.local_custody.as_ref().map(|custody|custody.originals())
 }
}

impl ProjectStore{
 /// Existing Project metadata is read only. No synthetic Project is made.
 pub(super) fn require_private_namespace_separation(&self,environment:&veyra_contracts::ExecutionEnvironment,primary:&str,roots:&[String])->Result<(),StoreError>{
  let Some(custody)=&self.local_custody else{return Ok(());}; // explicit v5 unenrolled profile
  custody.verify().map_err(|_|StoreError::Conflict)?;
  let paths=std::iter::once(primary.to_owned()).chain(roots.iter().cloned()).collect::<Vec<_>>();
  match environment{
   veyra_contracts::ExecutionEnvironment::Windows=>{
    #[cfg(windows)] custody.originals().separate(custody.root().to_str().ok_or(StoreError::Invalid)?,&paths).map_err(|_|StoreError::Conflict)?;
    #[cfg(not(windows))] return Err(StoreError::Invalid);
   },
   veyra_contracts::ExecutionEnvironment::Wsl{distro,user:Some(user)}=>{
    let protected=self.local_wsl_protected_facts()?;
    if !protected.is_empty(){
     let environment=LocalEnvironment::Wsl{distro:distro.clone(),user:user.clone()};
     crate::wsl_workspace::local_private_request(&environment,serde_json::json!({"action":"namespace_check","roots":paths,"protected_facts":protected}),&||custody.verify().is_ok()).map_err(|_|StoreError::Conflict)?;
    }
   },
   _=>return Err(StoreError::Invalid),
  }
  Ok(())
 }
 fn local_wsl_protected_facts(&self)->Result<Vec<serde_json::Value>,StoreError>{
  let custody=self.local_custody()?;
  let mut query=self.connection.prepare("SELECT id,environment,root_identity FROM local_workspaces WHERE state='active'")?;
  let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?)))?.collect::<Result<Vec<_>,_>>()?;
  let mut facts=Vec::new();
  for (id,environment,physical) in rows{
   let environment:LocalEnvironment=serde_json::from_str(&environment).map_err(|_|StoreError::Corrupt)?;
   if matches!(environment,LocalEnvironment::Wsl{..}){
    let expected:serde_json::Value=serde_json::from_str(&physical.ok_or(StoreError::Corrupt)?).map_err(|_|StoreError::Corrupt)?;
    let observed=crate::wsl_workspace::local_private_request(&environment,serde_json::json!({
     "action":"namespace_snapshot","installation_id":self.local_installation_id()?,"workspace_id":id,"expected":expected
    }),&||custody.verify().is_ok()).map_err(|_|StoreError::Conflict)?;
    facts.push(observed);
   }
  }Ok(facts)
 }
 pub fn require_local_allocation_separation(&self,environment:&LocalEnvironment)->Result<Vec<serde_json::Value>,StoreError>{
  let custody=self.local_custody()?;
  let mut query=self.connection.prepare("SELECT environment,primary_root,roots FROM projects WHERE archived=0")?;
  let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<Result<Vec<_>,_>>()?;
  let mut paths=Vec::new();let mut facts=Vec::new();
  for (saved,primary,additional) in rows{
   let saved:veyra_contracts::ExecutionEnvironment=serde_json::from_str(&saved).map_err(|_|StoreError::Corrupt)?;
   let roots=std::iter::once(primary).chain(serde_json::from_str::<Vec<String>>(&additional).map_err(|_|StoreError::Corrupt)?)
    .collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>();
   match (environment,saved){
    (LocalEnvironment::Windows,veyra_contracts::ExecutionEnvironment::Windows)=>paths.extend(roots),
    (LocalEnvironment::Wsl{..},veyra_contracts::ExecutionEnvironment::Wsl{distro,user:Some(user)})=>{
     // Probe each real Project's selected environment. Fresh kernel/physical
     // chains catch same-kernel cross-distro mounts without reading private data.
     let observed=crate::wsl_workspace::local_private_request(&LocalEnvironment::Wsl{distro,user},
      serde_json::json!({"action":"namespace_paths","roots":roots}),&||custody.verify().is_ok()).map_err(|_|StoreError::Conflict)?;
     facts.push(observed);
    },
    (LocalEnvironment::Wsl{..},veyra_contracts::ExecutionEnvironment::Wsl{user:None,..})=>return Err(StoreError::Invalid),
    _=>(),
   }
  }
  if matches!(environment,LocalEnvironment::Windows)&&!paths.is_empty(){
   #[cfg(windows)] custody.originals().separate(custody.root().to_str().ok_or(StoreError::Invalid)?,&paths).map_err(|_|StoreError::Conflict)?;
   #[cfg(not(windows))] return Err(StoreError::Invalid);
  }
  Ok(facts)
 }
}

impl ProjectStore{
 /// Cleanup uses current real OS-account custody and the retained immutable
 /// process owner. It does not acquire new workspace or engine permission.
 pub fn reserve_local_cleanup(&mut self,request:&LocalOperationRequest,instance:&str)->Result<bool,StoreError>{
  let custody=self.local_custody.as_ref().ok_or(StoreError::Invalid)?;
  custody.verify_account().map_err(|_|StoreError::Conflict)?;
  if !canonical(&request.request_id)||request.owner.installation_id!=self.local_installation_id()?||
   request.owner.custodian_key!=custody.key()||request.owner.service_instance_id!=instance||
   !matches!(request.operation,veyra_contracts::local_workspaces::LocalOperation::TerminalClose{..}){return Err(StoreError::Invalid);}
  let bytes=encoded(request)?;let digest=hash(bytes.as_bytes());
  let prior=self.connection.query_row("SELECT request_sha256 FROM local_workspace_operations WHERE id=?",[&request.request_id],|row|row.get::<_,String>(0)).optional()?;
  if let Some(prior)=prior{if prior!=digest{return Err(StoreError::Conflict);}return Ok(false);}
  let count:i64=self.connection.query_row("SELECT count(*) FROM local_workspace_operations",[],|row|row.get(0))?;
  if count>=4096{return Err(StoreError::Invalid);}
  self.connection.execute("INSERT INTO local_workspace_operations VALUES(?,?,?,?,?,'intent',NULL)",
   params![request.request_id,request.owner.workspace_id,encoded(&request.owner)?,digest,"terminal_close"])?;
  // The cleanup fence is durable even if fresh root admission now refuses.
  self.connection.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id=? AND state='intent'",[&request.request_id])?;
  Ok(true)
 }
}

impl ProjectStore{
 /// Bounded references to unique committed creations, never an engine catalog
 /// scan or transcript mirror. Each later read revalidates the actual binding.
 pub fn local_session_ids(&self,workspace:&str,after:Option<&str>,limit:u32)->Result<Vec<String>,StoreError>{
  self.local_custody()?;
  if !(1..=100).contains(&limit)||after.is_some_and(|id|id.is_empty()||id.len()>256||id.chars().any(char::is_control)){return Err(StoreError::Invalid);}
  let mut statement=self.connection.prepare("SELECT json_extract(result_json,'$.session.id') AS session_id FROM local_workspace_operations WHERE workspace_id=? AND state='committed' AND json_extract(result_json,'$.result_kind')='session_created' AND (? IS NULL OR json_extract(result_json,'$.session.id')>?) GROUP BY session_id HAVING count(*)=1 ORDER BY session_id LIMIT ?")?;
  let values=statement.query_map(params![workspace,after,after,limit],|row|row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
  Ok(values)
 }
}
