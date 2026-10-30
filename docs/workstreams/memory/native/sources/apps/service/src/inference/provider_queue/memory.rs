//! Distinct typed purpose inside the ORIGINAL queue Book and retained workers.
//! Queue metadata never supplies a native socket, lease, journal or slot claim.
use super::*;
use crate::routes::MemorySynthesisAdmission;
#[derive(Default)]
pub(super) struct MemoryBook{pub(super) entries:Vec<Arc<QueuedMemory>>,pub(super) reserved:Option<usize>}
pub(crate) struct QueuedMemory{
 pub(crate) admission:Arc<MemorySynthesisAdmission>,
 pub(crate) cancellation:CancellationHandle,
 pub(crate) worker:AsyncMutex<QueueWorker>,
 pub(crate) record:Mutex<Option<Arc<crate::routes::ProviderAcquisition>>>,
 phase:Mutex<MemoryPhase>,before_tasks:usize,
}
#[derive(Clone,Copy,PartialEq,Eq)]
enum MemoryPhase{Waiting,Reserved,Completed,RefusedBeforeNative,Unknown}
impl MemoryBook{
 pub(super) fn unknown(&self)->Result<bool,GatewayError>{
  for e in &self.entries{if *e.phase.try_lock().map_err(metadata_contention)?==MemoryPhase::Unknown{return Ok(true)}}Ok(false)
 }
 pub(super) fn earlier_waiting(&self,task:usize)->Result<bool,GatewayError>{
  for e in &self.entries{
   if e.before_tasks<=task&&matches!(*e.phase.try_lock().map_err(metadata_contention)?,MemoryPhase::Waiting|MemoryPhase::Reserved){return Ok(true)}
  }Ok(false)
 }
}
impl ProviderQueue{
 /// Metadata view of the ORIGINAL worker owners. Not admission or cleanup
 /// proof; callers must join each actual retained handle outside Book/Serial.
 pub(crate) fn memory_shutdown_workers(&self)->Result<Vec<Arc<QueuedMemory>>,GatewayError>{
  let book=self.book.try_lock().map_err(metadata_contention)?;
  Ok(book.memory.entries.clone())
 }
 /// The original service validates the sealed admission immediately beforehand
 /// under Serial; no source/store/native I/O occurs while Book is held.
 pub(crate) fn enroll_memory(&self,admission:Arc<MemorySynthesisAdmission>,cancellation:CancellationHandle)->Result<Arc<QueuedMemory>,GatewayError>{
  let mut book=self.book.try_lock().map_err(metadata_contention)?;
  if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}
  let original=admission.original();
  if !canonical_uuid(&original.operation_id){return Err(GatewayError::InvalidCorrelation)}
  let retained=book.retained_bytes.checked_add(admission.body().len()).filter(|b|*b<=64*1024*1024).ok_or(GatewayError::RequestBusy)?;
  if book.entries.len()+book.memory.entries.len()>=128{return Err(GatewayError::RequestBusy)}
  for e in &book.memory.entries{
   let previous=e.admission.original();
   if previous.operation_id==original.operation_id{return Err(GatewayError::Conflict)}
   if previous.snapshot.stamp.scope==original.snapshot.stamp.scope&&previous.input_hash==original.input_hash&&
      *e.phase.try_lock().map_err(metadata_contention)?!=MemoryPhase::RefusedBeforeNative{return Err(GatewayError::Conflict)}
  }
  // The same Book permanently spends identities across purposes. No synthesized
  // task_id/project_id or SessionGrant is created for a memory original.
  if book.entries.iter().any(|e|e.payload.call_id()==Some(original.operation_id.as_str())){return Err(GatewayError::Conflict)}
  let entry=Arc::new(QueuedMemory{admission,cancellation,worker:AsyncMutex::new(QueueWorker::Reserved),
   record:Mutex::new(None),phase:Mutex::new(MemoryPhase::Waiting),before_tasks:book.entries.len()});
  book.memory.entries.push(entry.clone());book.retained_bytes=retained;
  self.changed.notify_waiters();Ok(entry)
 }
 /// Metadata reservation ONLY. Original registry/native final claim is separate.
 pub(crate) fn reserve_memory(&self,entry:&Arc<QueuedMemory>)->Result<bool,GatewayError>{
  let mut book=self.book.try_lock().map_err(metadata_contention)?;
  if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}
  if book.dispatching.is_some()||book.memory.reserved.is_some(){return Ok(false)}
  let index=book.memory.entries.iter().position(|e|Arc::ptr_eq(e,entry)).ok_or(GatewayError::InvalidCorrelation)?;
  for prior in &book.entries[..entry.before_tasks]{
   if matches!(prior.state.try_lock().map_err(metadata_contention)?.phase,QueuePhase::Waiting|QueuePhase::Dispatching){return Ok(false)}
  }
  for prior in &book.memory.entries[..index]{
   if matches!(*prior.phase.try_lock().map_err(metadata_contention)?,MemoryPhase::Waiting|MemoryPhase::Reserved){return Ok(false)}
  }
  let mut phase=entry.phase.try_lock().map_err(metadata_contention)?;
  if *phase!=MemoryPhase::Waiting{return Err(GatewayError::Conflict)}
  *phase=MemoryPhase::Reserved;book.memory.reserved=Some(index);Ok(true)
 }
 /// Irreversible shared unknown fence; cancellation never clears reservation.
 pub(crate) fn memory_unknown(&self,entry:&Arc<QueuedMemory>)->Result<(),GatewayError>{
  let book=self.book.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  if !book.memory.entries.iter().any(|e|Arc::ptr_eq(e,entry)){return Err(GatewayError::InvalidCorrelation)}
  *entry.phase.lock().map_err(|_|GatewayError::RuntimeUnavailable)?=MemoryPhase::Unknown;
  self.changed.notify_waiters();Ok(())
 }
 pub(crate) fn complete_memory(&self,entry:&Arc<QueuedMemory>,released:&crate::inference::MemorySlotReleased)->Result<(),GatewayError>{
  let mut book=self.book.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  let index=book.memory.entries.iter().position(|e|Arc::ptr_eq(e,entry)).ok_or(GatewayError::InvalidCorrelation)?;
  if released.identity().operation_id()!=entry.admission.original().operation_id||book.memory.reserved!=Some(index){return Err(GatewayError::InvalidCorrelation)}
  let mut phase=entry.phase.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  if *phase!=MemoryPhase::Reserved{return Err(GatewayError::InvalidCorrelation)}
  *phase=MemoryPhase::Completed;book.memory.reserved=None;self.changed.notify_waiters();Ok(())
 }
 pub(crate) fn can_start_memory(&self)->Result<bool,GatewayError>{
  let book=self.book.try_lock().map_err(metadata_contention)?;
  if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}
  if book.dispatching.is_some()||book.memory.reserved.is_some(){return Ok(false)}
  for e in &book.entries{
   if matches!(e.state.try_lock().map_err(metadata_contention)?.phase,QueuePhase::Waiting|QueuePhase::Dispatching){return Ok(false)}
  }
  for e in &book.memory.entries{
   if matches!(*e.phase.try_lock().map_err(metadata_contention)?,MemoryPhase::Waiting|MemoryPhase::Reserved){return Ok(false)}
  }Ok(true)
 }
 pub(crate) fn refuse_memory_without_original(&self,entry:&Arc<QueuedMemory>)->Result<(),GatewayError>{
  let mut book=self.book.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  if entry.record.lock().map_err(|_|GatewayError::RuntimeUnavailable)?.is_some(){return Err(GatewayError::RuntimeUnavailable)}
  let index=book.memory.entries.iter().position(|e|Arc::ptr_eq(e,entry)).ok_or(GatewayError::InvalidCorrelation)?;
  let mut phase=entry.phase.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  if *phase==MemoryPhase::RefusedBeforeNative{return Ok(())}
  if !matches!(*phase,MemoryPhase::Waiting|MemoryPhase::Reserved){return Err(GatewayError::InvalidCorrelation)}
  *phase=MemoryPhase::RefusedBeforeNative;
  if book.memory.reserved==Some(index){book.memory.reserved=None}
  self.changed.notify_waiters();Ok(())
 }
}
