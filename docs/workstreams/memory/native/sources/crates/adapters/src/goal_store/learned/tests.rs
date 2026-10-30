//! Real original GoalStore file writes/reopen; synthetic domain data only.
//! No NativeMemoryOwner/model admission or native retirement is fabricated.
use super::*;
use crate::memory_test_fixture::MemoryFixture;
use veyra_memory::*;
fn scope()->NativeScope{NativeScope{library_id:"fixture-library".into(),os_custodian_id:"fixture-custodian".into(),execution_id:"fixture-execution".into(),namespace:NativeNamespace::Projectless{namespace_id:"fixture-private".into()}}}
fn enabled(store:&mut GoalStore)->(NativeScope,Receipt){
 let scope=scope();let policy=Policy{enabled:true,generate:true,..Policy::default()};
 let receipt=store.change_learned(|state|state.set_policy(&scope,"fixture-policy",0,policy)).unwrap();
 store.change_learned(|state|state.set_chat(&scope,"source-chat","fixture-chat",0,ChatPolicy{contribute:true,..ChatPolicy::default()})).unwrap();
 (scope,receipt)
}
fn source(store:&GoalStore,scope:&NativeScope)->CompletedSnapshot{
 let stamp=ExecutionStamp{scope:scope.clone(),binding_revision:1,service_instance_id:"fixture-service".into(),engine_instance_id:"fixture-engine".into(),engine_revision:1,engine_project_id:"fixture-project".into(),directory:"fixture-directory".into()};
 let messages=[("fixture-user",Role::User),("fixture-assistant",Role::Assistant)].into_iter().map(|(id,role)|CompletedMessage{
  source:SourceRef{chat_id:"source-chat".into(),message_id:id.into(),role,content_hash:content_hash("exact fixture source"),revision:content_hash(id),turn_id:"fixture-user".into(),terminal_id:"fixture-assistant".into()},
  text:"exact fixture source".into(),completed_ms:1,terminal:true,external_context:Some(false)}).collect();
 let state=store.learned().unwrap();CompletedSnapshot::capture(stamp,"source-chat".into(),messages,21_600_001,&state.policy(scope).unwrap(),&state.chat(scope,"source-chat").unwrap()).unwrap()
}
fn entry(snapshot:&CompletedSnapshot)->LearnedEntry{LearnedEntry{id:"fixture-entry".into(),scope:snapshot.stamp.scope.clone(),revision:1,content:" exact learned bytes\n".into(),content_hash:content_hash(" exact learned bytes\n"),sources:snapshot.sources(),source_watermark:snapshot.watermark.clone(),model:"fixture-model".into(),created_ms:snapshot.captured_ms,input_hash:snapshot.input_hash().unwrap()}}
fn pinned()->SavedMemory{SavedMemory{id:"fixture-pinned".into(),scope:MemoryScope::Local,project_id:None,session_id:None,content:"protected explicit memory".into(),origin:"user_pinned".into(),created_at:1,revision:1}}
#[test]
fn policy_receipt_reopens_without_rewriting_legacy_and_privacy_keeps_both(){
 let fixture=MemoryFixture::new();let mut store=GoalStore::open(fixture.directory()).unwrap();
 store.save_memory(pinned()).unwrap();let legacy=fs::read(fixture.directory().join("goals.json")).unwrap();
 let (scope,receipt)=enabled(&mut store);let expected=store.learned().unwrap().clone();drop(store);
 let reopened=GoalStore::open(fixture.directory()).unwrap();
 assert_eq!(fs::read(fixture.directory().join("goals.json")).unwrap(),legacy);
 assert_eq!(reopened.learned().unwrap(),&expected);
 assert_eq!(reopened.learned().unwrap().receipt(&scope,"fixture-policy",&receipt.request_hash).unwrap(),Some(receipt));
 let export=reopened.privacy_export().unwrap();
 assert_eq!(export["learned_memory_v1"],serde_json::to_value(&expected).unwrap());
 assert_eq!(export["memories"]["fixture-pinned"]["content"],"protected explicit memory");
}
#[test]
fn fresh_chat_recall_forget_receipt_and_stale_restore_survive_real_reopen(){
 let fixture=MemoryFixture::new();let mut store=GoalStore::open(fixture.directory()).unwrap();
 let (scope,_)=enabled(&mut store);let snapshot=source(&store,&scope);let learned=entry(&snapshot);
 let receipt=store.change_learned(|state|state.accept(&snapshot,&snapshot.stamp,&snapshot.messages,"fixture-learn",learned.clone())).unwrap();
 let backup=store.learned().unwrap().clone();drop(store);
 let mut reopened=GoalStore::open(fixture.directory()).unwrap();
 assert_eq!(reopened.learned().unwrap().recall(&scope,"fresh-chat").unwrap(),vec![learned.clone()]);
 assert_eq!(reopened.change_learned(|state|state.accept(&snapshot,&snapshot.stamp,&snapshot.messages,"fixture-learn",learned.clone())).unwrap(),receipt);
 let forgotten=reopened.change_learned(|state|state.forget(&scope,"fixture-entry","fixture-forget",1)).unwrap();drop(reopened);
 let mut reopened=GoalStore::open(fixture.directory()).unwrap();
 assert_eq!(reopened.change_learned(|state|state.forget(&scope,"fixture-entry","fixture-forget",1)).unwrap(),forgotten);
 reopened.change_learned(|state|state.restore(backup)).unwrap();drop(reopened);
 let reopened=GoalStore::open(fixture.directory()).unwrap();let state=reopened.learned().unwrap();
 assert!(state.recall(&scope,"another-fresh-chat").unwrap().is_empty());
 assert_eq!(state.receipt(&scope,"fixture-forget",&forgotten.request_hash).unwrap(),Some(forgotten));
 let mut changed=snapshot.messages.clone();for message in &mut changed{message.source.revision=content_hash("edited source revision")}
 let changed=CompletedSnapshot::capture(snapshot.stamp.clone(),snapshot.chat_id.clone(),changed,snapshot.captured_ms,&state.policy(&scope).unwrap(),&state.chat(&scope,"source-chat").unwrap()).unwrap();
 assert_eq!(state.can_generate(&changed),Err(MemoryError::Forgotten));
}
#[test]
fn refused_mutation_and_replayed_receipt_leave_committed_file_exact(){
 let fixture=MemoryFixture::new();let mut store=GoalStore::open(fixture.directory()).unwrap();let (scope,_)=enabled(&mut store);
 let path=fixture.directory().join("learned-memory-v1.json");let bytes=fs::read(&path).unwrap();let expected=store.learned().unwrap().clone();
 let refused:Result<(),String>=store.change_learned(|state|{state.set_chat(&scope,"new-chat","fixture-refused",0,ChatPolicy::default())?;Err(MemoryError::SourceChanged)});
 assert!(refused.is_err());assert_eq!(store.learned().unwrap(),&expected);assert_eq!(fs::read(&path).unwrap(),bytes);
 let policy=Policy{enabled:true,generate:true,..Policy::default()};
 store.change_learned(|state|state.set_policy(&scope,"fixture-policy",0,policy)).unwrap();
 assert_eq!(fs::read(&path).unwrap(),bytes);
 assert_eq!(fs::read_dir(fixture.directory()).unwrap().count(),2); // marker + committed learned file
}
#[test]
fn actual_replace_failure_latches_uncertainty_without_publishing_or_legacy_io(){
 let fixture=MemoryFixture::new();let mut store=GoalStore::open(fixture.directory()).unwrap();store.save_memory(pinned()).unwrap();
 let legacy=fs::read(fixture.directory().join("goals.json")).unwrap();
 let target=fixture.directory().join("learned-memory-v1.json");fs::create_dir(&target).unwrap();
 let error=store.change_learned(|state|state.set_policy(&scope(),"fixture-failed",0,Policy{enabled:true,..Policy::default()})).unwrap_err();
 #[cfg(windows)]assert_eq!(error,"Goal database could not be atomically committed");
 #[cfg(not(windows))]assert_eq!(error,"Goal database could not be committed");
 assert!(store.learned().is_err());
 let count=fs::read_dir(fixture.directory()).unwrap().count();
 assert!(store.change_learned(|state|state.set_policy(&scope(),"fixture-retry",0,Policy::default())).is_err());
 assert!(store.set_memory_enabled("fixture-pinned",1,false).is_err());
 assert_eq!(fs::read_dir(fixture.directory()).unwrap().count(),count);
 assert_eq!(fs::read(fixture.directory().join("goals.json")).unwrap(),legacy);
 assert!(target.is_dir());drop(store);
 match GoalStore::open(fixture.directory()){
  Err(error)=>assert_eq!(error,"Learned memory file bound or kind invalid"),
  Ok(_)=>panic!("bad target became a fresh empty learned store"),
 }
}
