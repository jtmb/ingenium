//! Actual shared queue metadata refusals; no invented Memory admission/native
//! return, no queue replacement, worker, model, engine or filesystem fixture.
use super::*;
#[test]
fn busy_original_book_refuses_memory_admission_and_shutdown_worker_snapshot(){
 let queue=ProviderQueue::default();let guard=queue.book.lock().unwrap();
 assert_eq!(queue.can_start_memory(),Err(GatewayError::RequestBusy));
 assert!(matches!(queue.memory_shutdown_workers(),Err(GatewayError::RequestBusy)));
 drop(guard);assert_eq!(queue.can_start_memory(),Ok(true));
 assert!(queue.memory_shutdown_workers().unwrap().is_empty());assert_eq!(queue.has_retained(),Ok(false));
}
#[test]
fn poisoned_original_book_never_becomes_available_or_empty_memory_state(){
 let queue=Arc::new(ProviderQueue::default());let held=queue.clone();
 assert!(std::thread::spawn(move||{let _guard=held.book.lock().unwrap();panic!("synthetic queue poison")}).join().is_err());
 assert_eq!(queue.can_start_memory(),Err(GatewayError::RuntimeUnavailable));
 assert!(matches!(queue.memory_shutdown_workers(),Err(GatewayError::RuntimeUnavailable)));
 assert_eq!(queue.has_retained(),Err(GatewayError::RuntimeUnavailable));
}
#[test]
fn original_task_fence_and_queue_identity_are_retained_without_fake_memory_grants(){
 let queue=Arc::new(ProviderQueue::default());let task=uuid::Uuid::new_v4().to_string();
 let closed=queue.close_task(&task).unwrap();
 assert_eq!(queue.allows_task(&task),Ok(false));assert_eq!(queue.has_retained(),Ok(true));
 let other=Arc::new(ProviderQueue::default());
 assert_eq!(closed.check_joined(&other),Err(GatewayError::InvalidCorrelation));
 assert!(queue.memory_shutdown_workers().unwrap().is_empty());
 // A historical owner is retained. This is not a native cleanup/exit proof.
 assert_eq!(queue.allows_task(&task),Ok(false));
}
