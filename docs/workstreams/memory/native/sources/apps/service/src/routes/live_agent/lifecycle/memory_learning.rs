//! Two phases in the existing productivity worker. No scheduler or HTTP ingress.
use super::*;
use crate::routes::provider::{memory_admission::{MemorySubject,MemorySynthesisAdmission},memory_synthesis};
#[derive(Default)]
pub(super) struct Cursor{projects:String,private:String}
/// Called with original Serial/hook guard. Read existing owners and capture at
/// most one eligible source; candidate fields alone confer no authority.
pub(super) fn capture(state:&ServiceState,cursor:&mut Cursor)->Option<Arc<MemorySynthesisAdmission>>{
 if state.draining.load(Ordering::Acquire){return None}
 let projects=state.live_agent.hooks.completed_memory_candidates(&cursor.projects,16).ok()?;
 if projects.is_empty(){cursor.projects.clear()}
 for intent in projects{
  cursor.projects=intent.request_id.clone();
  let Some(message)=intent.message_id.as_deref() else{continue};
  if let Ok(original)=MemorySynthesisAdmission::capture(state,MemorySubject::Project(intent.project),
   &intent.session_id,message,uuid::Uuid::new_v4().to_string(),veyra_memory::SynthesisBudget::default()){return Some(original)}
 }
 let private=state.live_agent.runtime.local_memory_candidates(&cursor.private,16).ok()?;
 if private.is_empty(){cursor.private.clear()}
 for hint in private{
  cursor.private=hint.request_id;
  if let Ok(original)=MemorySynthesisAdmission::capture(state,MemorySubject::Private(hint.owner),
   &hint.session_id,&hint.message_id,uuid::Uuid::new_v4().to_string(),veyra_memory::SynthesisBudget::default()){return Some(original)}
 }
 None
}
/// Serial and all store/Core/hook guards have been released before this await.
/// The original native owners retain the request independently of this waiter.
pub(super) async fn generate(state:Arc<ServiceState>,original:Arc<MemorySynthesisAdmission>){
 let Ok(result)=memory_synthesis::synthesize(state.clone(),original).await else{return};
 let serial=state.serial.clone().lock_owned().await;
 let owner=state.clone();
 let _=state.provider_workers.run(move||{
  let _serial=serial;
  // Known result acceptance rechecks original custody, source, policy,
  // forget suppression and model under the original single Goals writer.
  result.accept(&owner)
 }).await;
}
