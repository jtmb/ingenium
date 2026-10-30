//! Separate cleanup eligibility; retained ownership and every proof stay intact.
use super::*;
impl ProviderState{
 pub(super) fn check_queue_cleanup(&self,state:&ServiceState,rows:&[veyra_adapters::task_store::StoredTask],deadline:Instant)->Result<(),GatewayError>{
  budget(deadline)?;
  let queue=self.registry.provider_queue();let census=queue.cleanup_census()?;
  let records=acquisition::history::records(self)?;
  let mut matched=std::collections::BTreeSet::new();
  for entry in census.prepared(){
   let mut found=None;
   for record in &records{
    if acquisition::queue_cleanup::matches_task(record,entry)?{
     if found.is_some(){return Err(GatewayError::InvalidCorrelation)}found=Some(record);
    }
   }
   let record=found.ok_or(GatewayError::InvalidCorrelation)?;
   if !matched.insert(Arc::as_ptr(record) as usize){return Err(GatewayError::InvalidCorrelation)}
   acquisition::queue_cleanup::check_task(record,entry,self,rows,&state.provider_transports)?;
  }
  for entry in census.refused(){
   if !rows.iter().any(|row|row.original.task_id==entry.grant.task_id)||records.iter().any(|record|acquisition::queue_cleanup::uses_cancellation(record,&entry.cancellation)){
    return Err(GatewayError::InvalidCorrelation)
   }
  }
  for entry in census.retired_memory(){
   let record=entry.record.try_lock().map_err(unavailable)?.clone().ok_or(GatewayError::InvalidCorrelation)?;
   if !records.iter().any(|actual|Arc::ptr_eq(actual,&record))||!matched.insert(Arc::as_ptr(&record) as usize){return Err(GatewayError::InvalidCorrelation)}
   acquisition::memory::check_queue_entry(&record,entry)?;
   acquisition::memory::check_history(&record,self,&state.provider_transports,deadline)?;
  }
  for entry in census.refused_memory(){
   if entry.record.try_lock().map_err(unavailable)?.is_some()||records.iter().any(|record|acquisition::queue_cleanup::uses_cancellation(record,&entry.cancellation)){
    return Err(GatewayError::InvalidCorrelation)
   }
  }
  if matched.len()!=records.len()||census.closed_tasks().iter().any(|id|!rows.iter().any(|row|&row.original.task_id==id)){
   return Err(GatewayError::InvalidCorrelation)
  }
  // Slot and whole acquisition/native census are also checked by the caller.
  // Refuse every membership/phase/worker change before authorizing cleanup.
  census.check_current(&queue)?;budget(deadline)
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn empty_original_provider_census_has_no_retained_request_to_retire(){
  let state=ServiceState::in_memory_task_names_fixture().unwrap();let _serial=state.serial.try_lock().unwrap();let provider=state.provider.lock().unwrap();
  provider.check_queue_cleanup(&state,&[],Instant::now()+Duration::from_secs(3)).unwrap();
  provider.check_engine_cleanup_census(&[],&[],&state,Instant::now()+Duration::from_secs(3)).unwrap();
  assert!(!provider.registry.provider_queue().has_retained().unwrap());assert!(provider.acquisition.is_none());
 }
 #[test]
 fn original_task_fence_cannot_be_closed_by_an_unrelated_empty_task_census(){
  let state=ServiceState::in_memory_task_names_fixture().unwrap();let _serial=state.serial.try_lock().unwrap();let provider=state.provider.lock().unwrap();let queue=provider.registry.provider_queue();
  let id=uuid::Uuid::new_v4().to_string();let _closed=queue.close_task(&id).unwrap();
  assert_eq!(provider.check_queue_cleanup(&state,&[],Instant::now()+Duration::from_secs(3)),Err(GatewayError::InvalidCorrelation));
  assert_eq!(provider.check_engine_cleanup_census(&[],&[],&state,Instant::now()+Duration::from_secs(3)),Err(GatewayError::InvalidCorrelation));
  assert!(queue.has_retained().unwrap());assert!(!queue.allows_task(&id).unwrap());
 }
}
