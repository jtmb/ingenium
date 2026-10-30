//! Bind actual retained queue owners to the original acquisition/native proofs.
use super::*;
use crate::inference::provider_queue::QueuedProvider;
pub(in crate::routes::provider) fn uses_cancellation(record:&ProviderAcquisition,cancel:&CancellationHandle)->bool{
 record.cancellation.same_original(cancel)
}
pub(in crate::routes::provider) fn matches_task(record:&ProviderAcquisition,entry:&QueuedProvider)->Result<bool,GatewayError>{
 let held=record.originals.try_lock().map_err(unavailable)?;
 match &*held{
  Originals::Native(o)=>Ok(o.grant==entry.grant&&uses_cancellation(record,&entry.cancellation)),
  Originals::Memory(_)=>Ok(false),
  #[cfg(test)] Originals::Source(_)=>Err(GatewayError::InvalidCorrelation),
 }
}
pub(in crate::routes::provider) fn check_task(record:&ProviderAcquisition,entry:&QueuedProvider,provider:&ProviderState,
 rows:&[veyra_adapters::task_store::StoredTask],transports:&TransportSupervisor)->Result<(),GatewayError>{
 if !matches_task(record,entry)?{return Err(GatewayError::InvalidCorrelation)}
 slot_yield::check_reusable(record)?;
 let mut held=record.originals.try_lock().map_err(unavailable)?;let o=held.native_mut()?;
 let task=&rows.iter().find(|row|row.original.task_id==o.grant.task_id).ok_or(GatewayError::InvalidCorrelation)?.original;
 o.durable.check_retained(&o.grant,task)?;
 let identity=o.request.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
 let attempt=o.attempt.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
 if o.grant.turn_id!=task.task_id||o.grant.project_id!=task.engine_project_id||o.grant.session_id!=task.engine_session_id||
    o.grant.epoch!=task.engine_epoch||o.grant.binding!=task.model||o.grant.model!=task.engine_model||
    identity.task_id()!=task.task_id||identity.turn_id()!=o.grant.turn_id||identity.epoch()!=&o.grant.epoch||
    identity.binding()!=&o.grant.binding||attempt.request_id!=identity.request_id(){return Err(GatewayError::InvalidCorrelation)}
 let provenance=provider.journal.retained_provenance().ok_or(GatewayError::RuntimeUnavailable)?;
 if !provenance.owns_yielded(o.yield_journal.as_ref().ok_or(GatewayError::RuntimeUnavailable)?,attempt){return Err(GatewayError::InvalidCorrelation)}
 o.retirement.as_ref().ok_or(GatewayError::RuntimeUnavailable)?.check_transport(transports,identity,&record.cancellation)
}
