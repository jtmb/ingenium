//! Read-only eligibility over the SAME retained queue. Not native cleanup proof.
//! The service must match every entry to actual acquisition/native/journal owners.
use super::*;
pub(crate) struct QueueCleanupCensus{
 queue:Arc<ProviderQueue>,tasks:Vec<Arc<QueuedProvider>>,memory:Vec<Arc<QueuedMemory>>,
 prepared:Vec<Arc<QueuedProvider>>,refused:Vec<Arc<QueuedProvider>>,
 retired_memory:Vec<Arc<QueuedMemory>>,refused_memory:Vec<Arc<QueuedMemory>>,closed:Vec<String>,
}
fn same<T>(a:&[Arc<T>],b:&[Arc<T>])->bool{a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|Arc::ptr_eq(a,b))}
impl ProviderQueue{
 pub(crate) fn cleanup_census(self:&Arc<Self>)->Result<QueueCleanupCensus,GatewayError>{
  let book=self.book.try_lock().map_err(metadata_contention)?;
  if book.dispatching.is_some()||book.memory.reserved.is_some(){return Err(GatewayError::RequestBusy)}
  if book.memory.unknown()?{return Err(GatewayError::RuntimeUnavailable)}
  let mut result=QueueCleanupCensus{queue:self.clone(),tasks:book.entries.clone(),memory:book.memory.entries.clone(),
   prepared:Vec::new(),refused:Vec::new(),retired_memory:Vec::new(),refused_memory:Vec::new(),closed:book.closed_tasks.clone()};
  let mut closed=std::collections::BTreeSet::new();
  if result.closed.iter().any(|id|!canonical_uuid(id)||!closed.insert(id.clone())){return Err(GatewayError::InvalidCorrelation)}
  for (index,entry) in book.entries.iter().enumerate(){
   if entry.id!=index||entry.worker_panicked.load(Ordering::SeqCst){return Err(GatewayError::InvalidCorrelation)}
   let state=entry.state.try_lock().map_err(metadata_contention)?;
   if state.phase==QueuePhase::Unknown{return Err(GatewayError::RuntimeUnavailable)}
   let worker=entry.worker.try_lock().map_err(|_|GatewayError::RequestBusy)?;
   let QueueWorker::Joined(outcome)=&*worker else{return Err(GatewayError::RequestBusy)};
   if !valid_joined_phase(state.phase,outcome){return Err(GatewayError::RuntimeUnavailable)}
   match state.phase{
    QueuePhase::Prepared=>result.prepared.push(entry.clone()),
    QueuePhase::Refused=>result.refused.push(entry.clone()),
    _=>return Err(GatewayError::RuntimeUnavailable),
   }
  }
  for entry in &book.memory.entries{
   match entry.cleanup_disposition()?{
    memory::MemoryCleanupDisposition::Retired=>result.retired_memory.push(entry.clone()),
    memory::MemoryCleanupDisposition::RefusedBeforeNative=>result.refused_memory.push(entry.clone()),
   }
  }
  Ok(result)
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 fn task_metadata_only(queue:&ProviderQueue)->Arc<QueuedProvider>{
  // Ordinary Task queue FORMAT data only, never a Memory substitute or native
  // admission. Actual original queue APIs must reject cleanup without workers.
  let id=uuid::Uuid::new_v4().to_string();
  let binding=veyra_contracts::ModelBinding{profile_id:"fixture-model".into(),quant:"Q4_K_M".into(),context:veyra_contracts::ContextSize::K8};
  let grant=SessionGrant{task_id:id.clone(),turn_id:id,epoch:veyra_adapters::opencode::EngineEpoch{launch_id:uuid::Uuid::new_v4().to_string(),instance_id:"fixture_engine".into(),pid:17,version:veyra_adapters::opencode::PINNED_VERSION.into()},
   project_id:"fixture_project".into(),session_id:"ses_fixture".into(),parent_session:None,
   model:veyra_adapters::opencode::ModelRef{id:"fixture-model".into(),provider_id:"local".into(),variant:None},binding};
  let payload=ValidatedProviderRequest::new(axum::http::HeaderMap::new(),axum::body::Bytes::from_static(b"{\"model\":\"fixture-model\"}")).unwrap();
  queue.enroll(grant,payload,CancellationHandle::new()).unwrap()
 }
 #[test]
 fn cancelling_an_unjoined_original_request_never_grants_cleanup(){
  let queue=Arc::new(ProviderQueue::default());let entry=task_metadata_only(&queue);entry.cancellation.cancel();
  assert!(matches!(queue.cleanup_census(),Err(GatewayError::RequestBusy)));assert!(queue.has_retained().unwrap());
 }
 #[test]
 fn unknown_original_request_cannot_be_reclassified_as_known_cleanup(){
  let queue=Arc::new(ProviderQueue::default());let entry=task_metadata_only(&queue);queue.finish(&entry,QueuePhase::Unknown).unwrap();
  assert!(matches!(queue.cleanup_census(),Err(GatewayError::RuntimeUnavailable)));
  assert_eq!(queue.can_start_memory(),Err(GatewayError::RuntimeUnavailable));assert!(queue.has_retained().unwrap());
 }
 #[test]
 fn empty_original_census_cannot_be_adopted_by_another_queue(){
  let queue=Arc::new(ProviderQueue::default());let proof=queue.cleanup_census().unwrap();
  assert!(proof.prepared().is_empty()&&proof.refused().is_empty()&&proof.retired_memory().is_empty()&&proof.refused_memory().is_empty());
  proof.check_current(&queue).unwrap();
  let other=Arc::new(ProviderQueue::default());assert_eq!(proof.check_current(&other),Err(GatewayError::InvalidCorrelation));
 }
 #[test]
 fn later_real_ingress_fence_invalidates_old_census_without_dropping_ownership(){
  let queue=Arc::new(ProviderQueue::default());let proof=queue.cleanup_census().unwrap();
  let id=uuid::Uuid::new_v4().to_string();let _closed=queue.close_task(&id).unwrap();
  assert_eq!(proof.check_current(&queue),Err(GatewayError::InvalidCorrelation));assert_eq!(queue.has_retained(),Ok(true));
  let current=queue.cleanup_census().unwrap();assert_eq!(current.closed_tasks(),&[id]);current.check_current(&queue).unwrap();
 }
 #[test]
 fn contended_book_never_issues_cleanup_eligibility(){
  let queue=Arc::new(ProviderQueue::default());let _guard=queue.book.lock().unwrap();
  assert!(matches!(queue.cleanup_census(),Err(GatewayError::RequestBusy)));
 }
 #[test]
 fn poisoned_book_never_issues_cleanup_eligibility(){
  let queue=Arc::new(ProviderQueue::default());let worker=queue.clone();
  assert!(std::thread::spawn(move||{let _guard=worker.book.lock().unwrap();panic!("synthetic cleanup census poison")}).join().is_err());
  assert!(matches!(queue.cleanup_census(),Err(GatewayError::RuntimeUnavailable)));
 }
}
impl QueueCleanupCensus{
 pub(crate) fn prepared(&self)->&[Arc<QueuedProvider>]{&self.prepared}
 pub(crate) fn refused(&self)->&[Arc<QueuedProvider>]{&self.refused}
 pub(crate) fn retired_memory(&self)->&[Arc<QueuedMemory>]{&self.retired_memory}
 pub(crate) fn refused_memory(&self)->&[Arc<QueuedMemory>]{&self.refused_memory}
 pub(crate) fn closed_tasks(&self)->&[String]{&self.closed}
 pub(crate) fn check_current(&self,queue:&Arc<ProviderQueue>)->Result<(),GatewayError>{
  if !Arc::ptr_eq(queue,&self.queue){return Err(GatewayError::InvalidCorrelation)}
  let now=queue.cleanup_census()?;
  if !same(&self.tasks,&now.tasks)||!same(&self.memory,&now.memory)||!same(&self.prepared,&now.prepared)||!same(&self.refused,&now.refused)||
     !same(&self.retired_memory,&now.retired_memory)||!same(&self.refused_memory,&now.refused_memory)||self.closed!=now.closed{return Err(GatewayError::InvalidCorrelation)}
  Ok(())
 }
}
