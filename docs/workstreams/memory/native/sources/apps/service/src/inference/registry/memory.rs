//! Memory purpose in the SAME single active request slot.
use super::*;
use crate::{routes::{MemorySynthesisAdmission,ServiceState},inference::request_purpose::{MemoryTransportIdentity,TransportRequestIdentity}};
use veyra_adapters::model::runtime_authority::RuntimeIdentity;
use crate::inference::owned_transport::ResumedTransport;
use veyra_adapters::model::request_barrier::ResumedRequestObservation;
use std::sync::Arc;
pub(crate) struct MemoryCandidate{
 identity:MemoryTransportIdentity,admission:Arc<MemorySynthesisAdmission>,
}
pub(crate) struct MemoryClaim{
 identity:MemoryTransportIdentity,_admission:Arc<MemorySynthesisAdmission>,
}
pub(crate) struct MemorySlotReleased{identity:MemoryTransportIdentity}
impl MemorySlotReleased{pub(crate) fn identity(&self)->&MemoryTransportIdentity{&self.identity}}
impl MemoryCandidate{
 pub(crate) fn identity(&self)->&MemoryTransportIdentity{&self.identity}
 pub(crate) fn binding(&self)->&ModelBinding{self.admission.binding()}
 pub(crate) fn framing_parts(&self)->(HeaderMap,Bytes){
  let mut headers=HeaderMap::new();
  headers.insert("content-type",axum::http::HeaderValue::from_static("application/json"));
  (headers,Bytes::copy_from_slice(self.admission.body()))
 }
}
impl MemoryClaim{pub(crate) fn identity(&self)->&MemoryTransportIdentity{&self.identity}}
impl GatewayRegistry{
 pub(crate) fn active_purpose_request(&self)->Result<Option<TransportRequestIdentity>,GatewayError>{
  self.request.lock().map(|v|v.clone()).map_err(|_|GatewayError::RuntimeUnavailable)
 }
 pub(crate) fn candidate_memory_request(&self,admission:Arc<MemorySynthesisAdmission>,state:&ServiceState,runtime:&RuntimeIdentity,residency:&Residency)->Result<MemoryCandidate,GatewayError>{
  admission.check_source_current(state)?;
  let identity=MemoryTransportIdentity::capture(&admission,runtime)?;
  residency.validate_dispatch(identity.operation_id(),identity.binding()).map_err(|_|GatewayError::LeaseDenied)?;
  if self.active_purpose_request()?.is_some(){return Err(GatewayError::RequestBusy)}
  Ok(MemoryCandidate{identity,admission})
 }
 pub(crate) fn check_memory_candidate(&self,candidate:&MemoryCandidate,state:&ServiceState,runtime:&RuntimeIdentity,residency:&Residency)->Result<(),GatewayError>{
  candidate.admission.check_source_current(state)?;
  if MemoryTransportIdentity::capture(&candidate.admission,runtime)?!=candidate.identity{return Err(GatewayError::InvalidCorrelation)}
  residency.validate_dispatch(candidate.identity.operation_id(),candidate.identity.binding()).map_err(|_|GatewayError::LeaseDenied)?;
  if self.active_purpose_request()?.is_some(){return Err(GatewayError::RequestBusy)}
  Ok(())
 }
 /// Caller holds original final Serial after its durable same-journal commit.
 pub(crate) fn claim_memory_request(&self,candidate:MemoryCandidate,state:&ServiceState,runtime:&RuntimeIdentity,residency:&Residency)->Result<MemoryClaim,GatewayError>{
  self.check_memory_candidate(&candidate,state,runtime,residency)?;
  let mut slot=self.request.lock().map_err(|_|GatewayError::RuntimeUnavailable)?;
  if slot.is_some(){return Err(GatewayError::RequestBusy)}
  *slot=Some(TransportRequestIdentity::MemorySynthesis(candidate.identity.clone()));
  Ok(MemoryClaim{identity:candidate.identity,_admission:candidate.admission})
 }
 /// Cleanup consumes original native evidence, not current generation policy.
 /// Revoking source contribution cannot turn known joined cleanup into replay.
 pub(crate) fn validate_memory_terminal(&self,identity:&MemoryTransportIdentity,resumed:&ResumedTransport,observation:&ResumedRequestObservation,residency:&Residency)->Result<(),GatewayError>{
  let expected=TransportRequestIdentity::MemorySynthesis(identity.clone());
  if resumed.identity()!=&expected||self.active_purpose_request()?.as_ref()!=Some(&expected)||
     observation.request_id()!=identity.request_id()||observation.identity().binding()!=identity.binding()||
     observation.identity().generation()!=identity.runtime_generation()||observation.identity().address()!=identity.address(){return Err(GatewayError::InvalidCorrelation)}
  observation.check_live().map_err(|_|GatewayError::RuntimeUnavailable)?;
  residency.validate_execution_yield(identity.operation_id(),identity.binding()).map_err(|_|GatewayError::LeaseDenied)
 }
 pub(crate) fn finish_memory_terminal(&self,identity:&MemoryTransportIdentity,resumed:&ResumedTransport,observation:&ResumedRequestObservation,residency:&mut Residency)->Result<MemorySlotReleased,GatewayError>{
  self.validate_memory_terminal(identity,resumed,observation,residency)?;
  let mut slot=self.request.try_lock().map_err(|_|GatewayError::RequestBusy)?;
  let expected=TransportRequestIdentity::MemorySynthesis(identity.clone());
  if slot.as_ref()!=Some(&expected){return Err(GatewayError::InvalidCorrelation)}
  observation.check_live().map_err(|_|GatewayError::RuntimeUnavailable)?;
  // The memory root has no Task/agent lifetime beyond its actual model request.
  residency.observe_terminal(identity.operation_id()).map_err(|_|GatewayError::LeaseDenied)?;
  *slot=None;Ok(MemorySlotReleased{identity:identity.clone()})
 }
}
