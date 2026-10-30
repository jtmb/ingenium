//! Fresh startup rows from this exact completed idle-engine original. No new
//! cleanup, collector, runtime owner or caller-supplied status projection.
use super::*;
impl IdleEngineRetirement{
 pub(in crate::routes) fn startup_queue_rows(&self,state:&ServiceState,provider:&crate::routes::provider::ProviderState,
  originals:&OriginalTaskSlots,ready:&ReadyOriginal,deadline:Instant)->Result<Vec<veyra_adapters::task_store::StoredTask>,String>{
  self.check_members(originals)?;
  self.check_completed(ready,deadline)?;
  self.activity.check_tasks(&self.census.tasks_for(&self.engine)).map_err(|_|"Retired startup task membership changed")?;
  // Reuses the actual sealed activity object. capture_completed_engine would
  // try to borrow task_originals again while the caller already owns its guard.
  self.activity.check_current(&state.task_activity,state,provider,deadline).map_err(|_|"Retired startup activity or actual task rows changed")?;
  self.check_completed(ready,deadline)?;
  Ok(self.activity.rows())
 }
}
