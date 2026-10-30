//! Original inhibited Source owner; negative admission only, no runtime startup.
use super::*;
use veyra_contracts::local_workspaces::LocalEnvironment;
fn subject(state:&ServiceState)->MemorySubject{
 MemorySubject::Private(LocalWorkspaceOwner{installation_id:uuid::Uuid::new_v4().to_string(),custodian_key:"a".repeat(64),workspace_id:uuid::Uuid::new_v4().to_string(),
  revision:1,service_instance_id:state.instance_id.clone(),environment:LocalEnvironment::Windows})
}
fn unchanged(state:&ServiceState){
 let provider=state.provider.lock().unwrap();
 assert!(provider.registry.active_purpose_request().unwrap().is_none());assert!(provider.acquisition.is_none());
 assert!(provider.registry.provider_queue().memory_shutdown_workers().unwrap().is_empty());
 assert!(!state.model_work.has_retained().unwrap());assert!(state.residency.lock().unwrap().execution_holder().is_none());
}
#[test]
fn draining_original_source_refuses_before_queue_slot_or_model_lease(){
 let state=ServiceState::in_memory_task_names_fixture().unwrap();let _serial=state.serial.try_lock().unwrap();state.draining.store(true,Ordering::SeqCst);
 let result=MemorySynthesisAdmission::capture(&state,subject(&state),"fixture-chat","fixture-message",uuid::Uuid::new_v4().to_string(),SynthesisBudget::default());
 assert!(matches!(result,Err(GatewayError::RuntimeUnavailable)));unchanged(&state);
}
#[test]
fn absent_actual_project_store_refuses_without_creating_a_memory_original(){
 let state=ServiceState::in_memory_task_names_fixture().unwrap();let _serial=state.serial.try_lock().unwrap();assert!(!state.model_work.has_retained().unwrap());
 state.projects.lock().unwrap().take();
 let result=MemorySynthesisAdmission::capture(&state,subject(&state),"fixture-chat","fixture-message",uuid::Uuid::new_v4().to_string(),SynthesisBudget::default());
 assert!(matches!(result,Err(GatewayError::RuntimeUnavailable)));unchanged(&state);
}
#[test]
fn unregistered_private_owner_cannot_reach_source_capture_or_provider_enrollment(){
 let state=ServiceState::in_memory_task_names_fixture().unwrap();let _serial=state.serial.try_lock().unwrap();assert!(!state.model_work.has_retained().unwrap());
 let result=MemorySynthesisAdmission::capture(&state,subject(&state),"fixture-chat","fixture-message",uuid::Uuid::new_v4().to_string(),SynthesisBudget::default());
 assert!(matches!(result,Err(GatewayError::InvalidGrant)));unchanged(&state);
}
