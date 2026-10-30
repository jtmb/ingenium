use super::*;
use veyra_adapters::provider_attempts::{MemoryAttemptMetadata,MemoryAttemptYielded};
impl ProviderJournal{
 pub(in crate::routes::provider) fn can_admit_memory_input(&self,original:&veyra_memory::MemorySynthesisOriginal)->Result<(),GatewayError>{
  self.can_admit()?;
  let scope=original.snapshot.stamp.scope.key().map_err(|_|GatewayError::InvalidGrant)?;
  self.original.as_ref().ok_or(GatewayError::RuntimeUnavailable)?.can_admit_memory_input(
   &original.operation_id,&scope,&original.input_hash)
   .map_err(|e|if e==ProviderAttemptStoreError::Conflict{GatewayError::Conflict}else{GatewayError::RuntimeUnavailable})
 }
 pub(in crate::routes::provider) fn commit_memory_once(&mut self,value:&MemoryAttemptMetadata)->Result<(),GatewayError>{
  self.can_admit()?;
  self.original.as_mut().ok_or(GatewayError::RuntimeUnavailable)?.commit_memory_once(value)
   .map_err(|e|if e==ProviderAttemptStoreError::Conflict{GatewayError::RequestBusy}else{GatewayError::RuntimeUnavailable})
 }
 pub(in crate::routes::provider) fn mark_memory_yielded(&mut self,value:&MemoryAttemptMetadata)->Result<MemoryAttemptYielded,GatewayError>{
  self.can_admit()?;
  self.original.as_mut().ok_or(GatewayError::RuntimeUnavailable)?.mark_memory_yielded(value).map_err(|_|GatewayError::RuntimeUnavailable)
 }
 pub(in crate::routes::provider) fn owns_memory_yielded(&self,receipt:&MemoryAttemptYielded,value:&MemoryAttemptMetadata)->bool{
  self.original.as_ref().is_some_and(|store|store.owns_memory_yielded(receipt,value))
 }
}
