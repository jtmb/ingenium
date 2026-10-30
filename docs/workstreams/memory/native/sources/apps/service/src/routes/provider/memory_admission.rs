//! Internal producer. No HTTP route, external credential or caller-built grant.
use super::*;
use veyra_adapters::{native_memory_owner::NativeMemoryOwner,local_execution::LocalWorkspaceBinding};
use veyra_contracts::{Project,ModelBinding,local_workspaces::LocalWorkspaceOwner};
use veyra_memory::{ClosedSynthesisPayload,MemorySynthesisOriginal,SynthesisBudget,ValidatedSynthesisOutput,LearnedEntry,content_hash};
pub(in crate::routes) enum MemorySubject{Project(Project),Private(LocalWorkspaceOwner)}
/// Constructed only here from actual original owners. No Clone/Deserialize/
/// public constructor, and a serialized MemorySynthesisOriginal is NOT this.
pub(crate) struct MemorySynthesisAdmission{
 owner:NativeMemoryOwner,payload:ClosedSynthesisPayload,binding:ModelBinding,
}
impl MemorySynthesisAdmission{
 pub(in crate::routes) fn capture(state:&ServiceState,subject:MemorySubject,chat:&str,source_message:&str,original_uuid:String,budget:SynthesisBudget)->Result<Arc<Self>,GatewayError>{
  if state.draining.load(Ordering::SeqCst)||state.model_work.has_retained().unwrap_or(true){return Err(GatewayError::RuntimeUnavailable)}
  let projects=state.projects.try_lock().map_err(|_|GatewayError::RequestBusy)?;
  let store=projects.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
  let owner=match subject{
   MemorySubject::Project(project)=>NativeMemoryOwner::project(store,&project,&state.instance_id),
   MemorySubject::Private(owner)=>LocalWorkspaceBinding::acquire(store,&owner,&state.instance_id)
    .and_then(|binding|NativeMemoryOwner::private(store,binding,&state.instance_id)),
  }.map_err(|_|GatewayError::InvalidGrant)?;
  owner.verify_chat(store,chat).map_err(|_|GatewayError::InvalidGrant)?;
  let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|GatewayError::RuntimeUnavailable)?.as_millis();
  let now=u64::try_from(now).map_err(|_|GatewayError::RuntimeUnavailable)?;
  let snapshot=state.live_agent.capture_learning(&state.goals,store,&owner,chat,now).map_err(|_|GatewayError::InvalidGrant)?;
  // A retained original is only a bounded discovery hint. Its actual user
  // message must be in the newly owner-verified completed source snapshot.
  if !snapshot.messages.iter().any(|m|m.source.role==veyra_memory::Role::User&&m.source.message_id==source_message){return Err(GatewayError::InvalidGrant)}
  let (stamp,binding,model)=state.live_agent.memory_synthesis_model(store,&owner,chat).map_err(|_|GatewayError::BindingMismatch)?;
  if stamp!=snapshot.stamp{return Err(GatewayError::StaleEpoch)}
  state.residency.try_lock().map_err(|_|GatewayError::RequestBusy)?.validate_observed_ready(&binding).map_err(|_|GatewayError::LeaseDenied)?;
  let payload=ClosedSynthesisPayload::prepare(original_uuid,snapshot,model,budget).map_err(|_|GatewayError::InvalidBody)?;
  owner.verify_chat(store,chat).map_err(|_|GatewayError::InvalidGrant)?;
  Ok(Arc::new(Self{owner,payload,binding}))
 }
 pub(crate) fn original(&self)->&MemorySynthesisOriginal{self.payload.original()}
 pub(crate) fn body(&self)->&[u8]{self.payload.body()}
 pub(crate) fn binding(&self)->&ModelBinding{&self.binding}
 /// Synchronous fresh check; caller holds original Serial, never across await.
 /// Called at enrollment, before native acquisition/final journal+slot claim,
 /// and before publication/acceptance. Snapshot membership alone grants nothing.
 pub(crate) fn check_current(&self,state:&ServiceState)->Result<(),GatewayError>{
  self.check_source_current(state)?;
  state.residency.try_lock().map_err(|_|GatewayError::RequestBusy)?.validate_observed_ready(&self.binding).map_err(|_|GatewayError::LeaseDenied)
 }
 pub(crate) fn check_source_current(&self,state:&ServiceState)->Result<(),GatewayError>{
  if state.draining.load(Ordering::SeqCst){return Err(GatewayError::LeaseDenied)}
  let projects=state.projects.try_lock().map_err(|_|GatewayError::RequestBusy)?;
  let store=projects.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
  let original=self.original();
  self.owner.verify_chat(store,&original.snapshot.chat_id).map_err(|_|GatewayError::InvalidGrant)?;
  let (stamp,binding,model)=state.live_agent.memory_synthesis_model(store,&self.owner,&original.snapshot.chat_id).map_err(|_|GatewayError::BindingMismatch)?;
  if stamp!=original.snapshot.stamp||binding!=self.binding||model!=original.model{return Err(GatewayError::StaleEpoch)}
  state.live_agent.verify_learning(&state.goals,store,&self.owner,&original.snapshot).map_err(|_|GatewayError::InvalidGrant)?;
  Ok(())
 }
 /// Provider-private: only its opaque known-result consumer calls this after
 /// physical request retirement. Generated JSON never supplies provenance.
 pub(super) fn accept_retained_result(&self,state:&ServiceState,output:ValidatedSynthesisOutput)->Result<(),GatewayError>{
  let original=self.original();
  let content=output.content().to_owned();
  // Stable identity/time belong to the original synthesis intent. A read of
  // its retained known result never creates a different entry or hash.
  let entry=LearnedEntry{id:format!("learned-{}",original.operation_id),scope:original.snapshot.stamp.scope.clone(),revision:1,
   content_hash:content_hash(&content),content,sources:original.snapshot.sources(),source_watermark:original.snapshot.watermark.clone(),
   model:original.model.model_id.clone(),created_ms:original.snapshot.captured_ms,input_hash:original.input_hash.clone()};
  {
   let projects=state.projects.try_lock().map_err(|_|GatewayError::RequestBusy)?;
   let store=projects.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
   self.owner.verify_chat(store,&original.snapshot.chat_id).map_err(|_|GatewayError::InvalidGrant)?;
   if state.goals.learning_receipt(&original.snapshot,&original.operation_id,&entry).map_err(|_|GatewayError::InvalidGrant)?.is_some(){return Ok(())}
  }
  self.check_current(state)?;
  let projects=state.projects.try_lock().map_err(|_|GatewayError::RequestBusy)?;
  let store=projects.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
  state.live_agent.accept_learning(&state.goals,store,&self.owner,&original.snapshot,&original.operation_id,entry)
   .map_err(|_|GatewayError::InvalidGrant)?;
  Ok(())
 }
}
