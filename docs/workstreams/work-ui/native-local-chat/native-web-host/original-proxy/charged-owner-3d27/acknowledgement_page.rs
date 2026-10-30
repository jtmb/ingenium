//! Proposed child of projects::local_web_originals. Same original connection.
use super::*;
use crate::native_web_payload::{Payload,Pool};
use std::sync::{Arc,Mutex};
use std::time::Instant;
const PAGE:usize=64*1024;
const WINDOW:usize=8192;
/// Retained by the actual worker capsule before any Blob opens. No DTO mint.
pub(crate) struct PageReadCustody{state:Mutex<ReadState>}
pub struct NativeWebPageRead{pub(crate) pool:Arc<Pool>,custody:Arc<PageReadCustody>}
impl NativeWebPageRead{
 pub(crate) fn for_registry(pool:Arc<Pool>)->Self{Self{pool,custody:PageReadCustody::reserved()}}
 // Reserved also means this private reader never ran/opened a Blob. Service
 // may use this only AFTER joining the same actual worker, never by itself.
 pub fn no_live_blob_after_join(&self)->bool{self.custody.state.lock().is_ok_and(|s|matches!(*s,ReadState::Reserved|ReadState::NoBlob|ReadState::Closed))}
}
#[derive(Clone,Copy,PartialEq,Eq)]enum ReadState{Reserved,NoBlob,CloseUnknown,Closed,CloseFailed}
impl PageReadCustody{
 pub(crate) fn reserved()->Arc<Self>{Arc::new(Self{state:Mutex::new(ReadState::Reserved)})}
 fn begin_once(&self)->Result<(),StoreError>{let mut s=self.state.lock().map_err(|_|StoreError::Conflict)?;if *s!=ReadState::Reserved{return Err(StoreError::Conflict)}*s=ReadState::NoBlob;Ok(())}
 fn opened(&self)->Result<(),StoreError>{let mut s=self.state.lock().map_err(|_|StoreError::Conflict)?;if *s!=ReadState::NoBlob{return Err(StoreError::Conflict)}*s=ReadState::CloseUnknown;Ok(())}
 fn close_actual(&self,blob:rusqlite::blob::Blob<'_>)->Result<(),StoreError>{
  // A panic/missing result remains CloseUnknown. Consumed close error latches
  // BEFORE close takes ownership, and no second close/reopen retry is provided.
  let mut s=self.state.lock().map_err(|_|StoreError::Conflict)?;
  if *s!=ReadState::CloseUnknown{return Err(StoreError::Conflict)}
  *s=ReadState::CloseFailed;
  blob.close()?;*s=ReadState::Closed;Ok(())
 }
 pub(crate) fn checked_closed(&self)->bool{self.state.lock().is_ok_and(|s|*s==ReadState::Closed)}
}
/// Bytes are an actual charged allocation; metadata never releases its charge.
pub struct NativeWebAcknowledgementPage{
 writer:Arc<NativeWebWriterOriginal>,operation:[u8;16],
 pub(crate) bytes:Payload,pub(crate) offset:usize,pub(crate) total:usize,
 pub(crate) status:u16,pub(crate) content_type:Option<Payload>,pub(crate) hash:[u8;64],
}
impl NativeWebAcknowledgementPage{
 pub fn body(&self)->&[u8]{self.bytes.as_ref()}
 pub fn body_owner(&self)->Payload{self.bytes.clone()}
 pub fn offset(&self)->usize{self.offset}
 pub fn total(&self)->usize{self.total}
 pub fn status(&self)->u16{self.status}
 pub fn content_type(&self)->Option<&str>{self.content_type.as_ref().and_then(|p|std::str::from_utf8(p.as_ref()).ok())}
 pub fn body_sha256(&self)->&str{std::str::from_utf8(&self.hash).expect("checked ASCII hash")}
}
impl ProjectStore{
 pub fn handoff_native_web_acknowledgement_page(&self,owner:&veyra_contracts::local_workspaces::LocalWorkspaceOwner,session:&str,operation:&str,instance:&str,page:&NativeWebAcknowledgementPage)->Result<Payload,StoreError>{
  self.check_local_owner(owner,instance)?;self.require_local_session(&owner.workspace_id,session)?;
  let id=uuid::Uuid::parse_str(operation).map_err(|_|StoreError::Invalid)?;
  if !Arc::ptr_eq(&self.native_web_writer,&page.writer)||id.as_bytes()!=&page.operation{return Err(StoreError::Conflict)}
  let current:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM local_web_original_acknowledgements a WHERE a.operation_id=?1 AND a.body_sha256=?2 AND NOT EXISTS(SELECT 1 FROM local_web_original_forget_receipts f WHERE f.operation_id=a.operation_id))",params![operation,page.body_sha256()],|r|r.get(0))?;
  if !current{return Err(StoreError::Conflict)}Ok(page.body_owner())
 }
 pub fn read_native_web_acknowledgement_page(
  &mut self,owner:&veyra_contracts::local_workspaces::LocalWorkspaceOwner,
  session:&str,operation:&str,instance:&str,read:&NativeWebPageRead,offset:usize,
  expected_hash:Option<&str>,deadline:Instant,
 )->Result<Option<NativeWebAcknowledgementPage>,StoreError>{
  use sha2::{Digest,Sha256};
  let pool=&read.pool;let custody=&read.custody;
  let operation_uuid=*uuid::Uuid::parse_str(operation).map_err(|_|StoreError::Invalid)?.as_bytes();
  // Reserve BOTH actual destination and prepass scratch BEFORE row/BLOB load.
  let mut page=pool.allocate(PAGE).map_err(|_|StoreError::Conflict)?;
  let mut scratch=pool.allocate(WINDOW).map_err(|_|StoreError::Conflict)?;
  let mut content=pool.allocate(16384).map_err(|_|StoreError::Conflict)?;
  custody.begin_once()?;
  self.check_local_owner(owner,instance)?;self.require_local_session(&owner.workspace_id,session)?;
  // Preserve original reattachment rules: current service/revision checked
  // above; historical receipt compares stable owner fields, not old instance.
  let environment=crate::native_web_payload::json_payload(pool,&owner.environment).map_err(|_|StoreError::Conflict)?;
  let environment=std::str::from_utf8(environment.as_ref()).map_err(|_|StoreError::Corrupt)?;
  // Borrow scalar values from SQLite; copy only the fixed hash and the bounded
  // precharged content-type buffer. No full scope/header JSON Value is loaded.
  let tx=self.connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
  let row:Option<(i64,i64,[u8;64],i64,bool)>=tx.query_row(
   "SELECT a.rowid,a.status,a.body_sha256,length(a.body),json_array_length(a.content_headers_json),json_extract(a.content_headers_json,'$[0][1]') FROM local_web_original_acknowledgements a JOIN local_web_original_payloads p ON p.operation_id=a.operation_id JOIN local_workspace_operations o ON o.id=a.operation_id WHERE a.operation_id=?1 AND a.input_sha256=o.request_sha256 AND json_extract(p.scope_engine_json,'$.engine.session_id')=?2 AND json_extract(o.owner_json,'$.installation_id')=?3 AND json_extract(o.owner_json,'$.custodian_key')=?4 AND json_extract(o.owner_json,'$.workspace_id')=?5 AND json_extract(o.owner_json,'$.environment')=json_extract(?6,'$') AND json_type(a.content_headers_json)='array' AND (json_array_length(a.content_headers_json)=0 OR (json_array_length(a.content_headers_json)=1 AND json_type(a.content_headers_json,'$[0]')='array' AND json_array_length(a.content_headers_json,'$[0]')=2 AND json_extract(a.content_headers_json,'$[0][0]')='content-type' AND json_type(a.content_headers_json,'$[0][1]')='text')) AND NOT EXISTS(SELECT 1 FROM local_web_original_forget_receipts f WHERE f.operation_id=a.operation_id)",
   params![operation,session,owner.installation_id,owner.custodian_key,owner.workspace_id,environment],|r|{
    let raw=r.get_ref(2)?.as_str()?;
    if raw.len()!=64||!raw.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err(rusqlite::Error::InvalidQuery)}
    let mut hash=[0;64];hash.copy_from_slice(raw.as_bytes());
    let present=r.get::<_,i64>(4)?==1;
    if present{let raw=r.get_ref(5)?.as_str()?;if raw.chars().any(char::is_control){return Err(rusqlite::Error::InvalidQuery)}content.append(raw.as_bytes()).map_err(|_|rusqlite::Error::InvalidQuery)?;}
    Ok((r.get(0)?,r.get(1)?,hash,r.get(3)?,present))
   }).optional()?;
  let Some((row,status,hash,total,present))=row else{return Ok(None)};
  let total=usize::try_from(total).map_err(|_|StoreError::Corrupt)?;
  if offset>total||expected_hash.is_some_and(|h|h.as_bytes()!=hash){return Err(StoreError::Conflict)}
  let content_type=if present{Some(content.freeze())}else{None};
  let status=u16::try_from(status).map_err(|_|StoreError::Corrupt)?;
  if !(100..600).contains(&status)||(300..400).contains(&status){return Err(StoreError::Corrupt)}
  let blob=tx.blob_open(rusqlite::MAIN_DB,"local_web_original_acknowledgements","body",row,true)?;
  custody.opened()?;
  // All fallible post-open work is inside this closure; explicit close runs
  // even after length/hash/deadline/read/refill failure. Panic => unknown latch.
  let read_result=(||{
   if blob.len()!=total{return Err(StoreError::Corrupt)}
   let mut position=0usize;let mut digest=Sha256::new();
   while position<total{
    if Instant::now()>=deadline{return Err(StoreError::BackupTimeout)}
    let count=WINDOW.min(total-position);
    scratch.refill(count,|dst|blob.read_at_exact(dst,position)).map_err(|e|e.map(StoreError::Database).unwrap_or(StoreError::Conflict))?;
    digest.update(scratch.as_ref());position=position.checked_add(count).ok_or(StoreError::Corrupt)?;
   }
   let actual=digest.finalize();let alphabet=b"0123456789abcdef";
   if actual.iter().enumerate().any(|(i,b)|hash[2*i]!=alphabet[(b>>4)as usize]||hash[2*i+1]!=alphabet[(b&15)as usize]){return Err(StoreError::Corrupt)}
   let count=PAGE.min(total-offset);
   page.refill(count,|dst|blob.read_at_exact(dst,offset)).map_err(|e|e.map(StoreError::Database).unwrap_or(StoreError::Conflict))?;
   Ok(())
  })();
  // Same handle/row/read transaction from prepass through returned-page read.
  let close_result=custody.close_actual(blob);
  close_result?;read_result?;
  tx.commit()?;
  if !custody.checked_closed(){return Err(StoreError::Conflict)}
  Ok(Some(NativeWebAcknowledgementPage{writer:self.native_web_writer.clone(),operation:operation_uuid,bytes:page.freeze(),offset,total,status,content_type,hash}))
 }
}
