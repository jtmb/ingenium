//! Borrowed, sealed startup history derived from actual retired originals and
//! fresh original TaskStore/TaskActivity reads. No Clone/Deserialize/DTO grant.
use super::*;
use crate::routes::{ServiceState,provider::ProviderState};
use veyra_adapters::task_store::StoredTask;
pub(in crate::routes) struct StartupQueueHistory<'a>{
 state:&'a ServiceState,originals:&'a OriginalTaskSlots,startup:Option<&'a Arc<StartingEngineRecord>>,
 deadline:Instant,bindings:Vec<Arc<ReadyOriginal>>,rows:Vec<StoredTask>,
}
impl OriginalTaskSlots{
 pub(in crate::routes) fn startup_queue_history<'a>(&'a self,state:&'a ServiceState,provider:&ProviderState,
  startup:Option<&'a Arc<StartingEngineRecord>>,deadline:Instant)->Result<StartupQueueHistory<'a>,RetentionError>{
  let bindings=self.retired_bindings_before_startup(startup,deadline)?;
  let tasks=self.tasks.values().cloned().collect::<Vec<_>>();
  state.task_activity.check_original_census(&tasks).map_err(|_|RetentionError::Conflict)?;
  // Require the genuine current store owner, even for an empty live census.
  // Release this guard before CompletedEngineActivity performs its own reads.
  {let guard=state.tasks.try_lock().map_err(|_|RetentionError::Unknown)?;guard.as_ref().ok_or(RetentionError::Unknown)?;}
  let mut rows=Vec::new();let mut ids=std::collections::BTreeSet::new();
  for ready in &bindings{
   let retirement=self.idle_retirement(ready)?.ok_or(RetentionError::Bound)?;
   let batch=retirement.startup_queue_rows(state,provider,self,ready,deadline).map_err(|_|RetentionError::Unknown)?;
   for row in batch{
    if row.original.engine_epoch!=ready.epoch||!ids.insert(row.original.task_id.clone()){return Err(RetentionError::Conflict)}
    rows.push(row);
   }
  }
  if ids.len()!=self.tasks.len()||self.tasks.keys().any(|id|!ids.contains(id)){return Err(RetentionError::Conflict)}
  if Instant::now()>=deadline{return Err(RetentionError::Closed)}
  Ok(StartupQueueHistory{state,originals:self,startup,deadline,bindings,rows})
 }
}
impl StartupQueueHistory<'_>{
 pub(in crate::routes) fn bindings(&self)->&[Arc<ReadyOriginal>]{&self.bindings}
 pub(in crate::routes) fn rows(&self)->&[StoredTask]{&self.rows}
 pub(in crate::routes) fn check_current(&self,provider:&ProviderState)->Result<(),RetentionError>{
  let now=self.originals.startup_queue_history(self.state,provider,self.startup,self.deadline)?;
  if self.rows!=now.rows||self.bindings.len()!=now.bindings.len()||self.bindings.iter().zip(&now.bindings)
   .any(|(a,b)|a.epoch!=b.epoch||!Arc::ptr_eq(&a.owner,&b.owner)){return Err(RetentionError::Conflict)}
  Ok(())
 }
}
#[cfg(test)]
mod tests{
 use super::*;
 use crate::inference::GatewayError;
 use std::time::Duration;
 fn state()->ServiceState{ServiceState::in_memory_inhibited_retirement_fixture().unwrap()}
 #[test]
 fn empty_actual_owners_allow_metadata_preflight_without_erasing_history(){
  let state=state();let _serial=state.serial.try_lock().unwrap();let slots=state.task_originals.lock().unwrap();let provider=state.provider.lock().unwrap();
  provider.preflight_retained_startup(&state,&slots,None,Instant::now()+Duration::from_secs(3)).unwrap();
  assert!(!slots.has_retained());assert_eq!(provider.shutdown_blocked(),Ok(false));
 }
 #[test]
 fn missing_actual_task_store_refuses_even_an_empty_startup_snapshot(){
  let state=state();let _serial=state.serial.try_lock().unwrap();state.tasks.lock().unwrap().take();
  let slots=state.task_originals.lock().unwrap();let provider=state.provider.lock().unwrap();
  assert_eq!(provider.preflight_retained_startup(&state,&slots,None,Instant::now()+Duration::from_secs(3)),Err(GatewayError::RuntimeUnavailable));
 }
 #[test]
 fn borrowed_history_refuses_when_its_actual_store_owner_disappears(){
  let state=state();let _serial=state.serial.try_lock().unwrap();let slots=state.task_originals.lock().unwrap();let provider=state.provider.lock().unwrap();
  let history=slots.startup_queue_history(&state,&provider,None,Instant::now()+Duration::from_secs(3)).unwrap();
  state.tasks.lock().unwrap().take();assert!(history.check_current(&provider).is_err());
 }
 #[test]
 fn closed_actual_original_ledger_never_reopens_through_startup_history(){
  let state=state();let _serial=state.serial.try_lock().unwrap();let mut slots=state.task_originals.lock().unwrap();slots.close_admission();let provider=state.provider.lock().unwrap();
  assert!(matches!(slots.startup_queue_history(&state,&provider,None,Instant::now()+Duration::from_secs(3)),Err(RetentionError::Closed)));
 }
 #[test]
 fn only_the_exact_enrolled_inert_startup_may_be_excluded(){
  let state=state();let _serial=state.serial.try_lock().unwrap();let mut slots=state.task_originals.lock().unwrap();let id=uuid::Uuid::new_v4().to_string();
  let actual=slots.enroll_starting(&id).unwrap();let provider=state.provider.lock().unwrap();let deadline=Instant::now()+Duration::from_secs(3);
  assert!(slots.startup_queue_history(&state,&provider,None,deadline).is_err());
  provider.preflight_retained_startup(&state,&slots,Some(&actual),deadline).unwrap();
  let mut other=OriginalTaskSlots::new();let foreign=other.enroll_starting(&id).unwrap();
  assert!(matches!(slots.startup_queue_history(&state,&provider,Some(&foreign),deadline),Err(RetentionError::Conflict)));
  assert!(slots.has_retained()); // no engine constructed/started or history removed
 }
 #[test]
 fn expired_original_cap_refuses_before_any_new_startup(){
  let state=state();let _serial=state.serial.try_lock().unwrap();let slots=state.task_originals.lock().unwrap();let provider=state.provider.lock().unwrap();
  assert!(matches!(slots.startup_queue_history(&state,&provider,None,Instant::now()),Err(RetentionError::Closed)));
  assert!(!slots.has_retained());
 }
}
