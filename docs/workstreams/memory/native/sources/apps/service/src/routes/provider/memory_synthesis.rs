//! CLOSED internal MemorySynthesis purpose; never an HTTP/arbitrary-prompt API.
use super::*;
use super::memory_admission::MemorySynthesisAdmission;
use veyra_memory::ValidatedSynthesisOutput;
use crate::inference::{provider_queue::QueueWorker,owned_transport::CancellationHandle,registry::memory::MemorySlotReleased};
/// Only the original retained native request/result consumer may construct this
/// after exact UUID/payload/runtime matching and actual joined retirement/resume.
/// No Deserialize/Clone/public constructor; parsing output alone cannot mint it.
pub(in crate::routes) struct KnownMemorySynthesisResult{
 admission:Arc<MemorySynthesisAdmission>,output:ValidatedSynthesisOutput,
}
impl KnownMemorySynthesisResult{
 pub(super) fn from_retired(admission:Arc<MemorySynthesisAdmission>,output:ValidatedSynthesisOutput,released:&MemorySlotReleased)->Result<Self,GatewayError>{
  if !released.identity().matches_original(admission.original())||released.identity().binding()!=admission.binding(){return Err(GatewayError::InvalidCorrelation)}
  Ok(Self{admission,output})
 }
 pub(in crate::routes) fn accept(self,state:&ServiceState)->Result<(),GatewayError>{
  self.admission.accept_retained_result(state,self.output)
 }
}
pub(in crate::routes) async fn synthesize(
 state:Arc<ServiceState>,admission:Arc<MemorySynthesisAdmission>,
)->Result<KnownMemorySynthesisResult,GatewayError>{
 let serial=state.serial.clone().lock_owned().await;
 let owner=state.clone();let authority=admission.clone();let runtime=tokio::runtime::Handle::current();
 let entry=state.provider_workers.run(move||{
  let _serial=serial;authority.check_current(&owner)?;
  let cancellation=CancellationHandle::new();
  running(&owner,Instant::now()+Duration::from_secs(10),&cancellation)?;
  let provider=owner.provider.try_lock().map_err(unavailable)?;provider.journal.can_admit()?;
  if provider.registry.active_purpose_request()?.is_some(){return Err(GatewayError::RequestBusy)}
  let residency=owner.residency.try_lock().map_err(unavailable)?;
  if residency.execution_holder().is_some()||residency.queued_transitions()!=0{return Err(GatewayError::RequestBusy)}
  drop(residency);
  let queue=provider.registry.provider_queue();
  if !queue.can_start_memory()?{return Err(GatewayError::RequestBusy)}
  let entry=queue.enroll_memory(authority,cancellation)?;
  let mut worker=entry.worker.try_lock().map_err(|_|GatewayError::RequestBusy)?;
  let work=entry.clone();let state=owner.clone();let book=queue.clone();
  let (publish,published)=tokio::sync::oneshot::channel();
  *worker=QueueWorker::Running(runtime.spawn(async move{
   if published.await.is_err(){book.refuse_memory_without_original(&work)?;return Err(GatewayError::RuntimeUnavailable)}
   let result=acquisition::memory::drive(state,book.clone(),work.clone()).await;
   if result.is_err(){
    let record=work.record.lock().map_err(unavailable)?.clone();
    if let Some(record)=record{
     record.memory_inhibit();work.cancellation.cancel();book.memory_unknown(&work)?;
    }else{book.refuse_memory_without_original(&work)?}
   }result
  }));
  drop(worker);publish.send(()).map_err(unavailable)?;Ok(entry)
 }).await?;
 // Dropping this waiter retains its actual worker in the SAME queue entry.
 let mut worker=entry.worker.lock().await;
 if let QueueWorker::Running(handle)=&mut *worker{
  let result=handle.await.map_err(unavailable).and_then(|value|value);*worker=QueueWorker::Joined(result);
 }
 let outcome=match &*worker{QueueWorker::Joined(result)=>*result,_=>Err(GatewayError::RuntimeUnavailable)};
 drop(worker);outcome?;
 let record=entry.record.lock().map_err(unavailable)?.clone().ok_or(GatewayError::RuntimeUnavailable)?;
 acquisition::memory::take_result(&record)
}
