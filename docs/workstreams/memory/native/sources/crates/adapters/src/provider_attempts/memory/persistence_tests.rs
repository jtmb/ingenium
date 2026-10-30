//! Actual ProviderAttemptStore constructors/transactions and disk reopen.
//! All identities here are inert synthetic storage metadata, never Task grants
//! or MemorySynthesisAdmission. No mark_*_yielded/native receipt is fabricated.
use super::*;
use crate::memory_test_fixture::MemoryFixture;
use crate::opencode::{EngineEpoch,ModelRef,PINNED_VERSION};
use std::net::{Ipv4Addr,SocketAddrV4};
use veyra_contracts::{ContextSize,ModelBinding};
fn task()->ProviderAttemptMetadata{
 let binding=ModelBinding{profile_id:"fixture-profile".into(),quant:"Q4_K_M".into(),context:ContextSize::try_from(8192).unwrap()};
 ProviderAttemptMetadata{request_id:uuid::Uuid::new_v4().to_string(),task_id:uuid::Uuid::new_v4().to_string(),turn_id:uuid::Uuid::new_v4().to_string(),
  engine_epoch:EngineEpoch{launch_id:uuid::Uuid::new_v4().to_string(),instance_id:"fixture_engine".into(),pid:17,version:PINNED_VERSION.into()},
  engine_session_id:"ses_fixture".into(),engine_project_id:"fixture_project".into(),engine_model:ModelRef{id:"fixture/model".into(),provider_id:"local".into(),variant:None},
  binding:binding.clone(),runtime:RuntimeMetadata{generation:uuid::Uuid::new_v4().to_string(),binding,address:SocketAddrV4::new(Ipv4Addr::LOCALHOST,19999),listener_pid:18,listener_creation_time:99}}
}
fn memory()->MemoryAttemptMetadata{
 let task=task();MemoryAttemptMetadata{request_id:uuid::Uuid::new_v4().to_string(),scope_hash:veyra_memory::content_hash("fixture scope"),input_hash:veyra_memory::content_hash("fixture input"),
  source_watermark:veyra_memory::content_hash("fixture watermark"),payload_sha256:veyra_memory::content_hash("fixture payload"),engine_instance_id:"fixture-engine".into(),
  policy_revision:1,chat_revision:1,binding:task.binding,runtime:task.runtime}
}
fn close(store:ProviderAttemptStore){store.close().expect("actual SQLite owner must close before fixture reconciliation");}
fn close_sql(connection:Connection){connection.close().map_err(|(_,error)|error).unwrap();}
fn seed_v2(fixture:&MemoryFixture)->(ProviderAttemptMetadata,Vec<u8>){
 let connection=Connection::open(fixture.directory().join("attempts.db")).unwrap();
 connection.execute_batch(include_str!("../0002.sql")).unwrap();
 let original=task();let record=validation::encode(&original).unwrap();
 connection.execute("INSERT INTO attempts VALUES(?1,?2,?3,?4,'pending')",params![original.request_id,original.task_id,original.turn_id,record]).unwrap();
 let bytes=connection.query_row("SELECT CAST(record AS BLOB) FROM attempts",[],|row|row.get(0)).unwrap();close_sql(connection);(original,bytes)
}
fn schema(connection:&Connection)->Vec<(String,String,String,Option<String>)>{
 let mut q=connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").unwrap();
 let observed=q.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().collect::<Result<Vec<_>,_>>().unwrap();observed
}
#[test]
fn memory_pending_uuid_and_input_refuse_after_actual_private_store_reopen(){
 let fixture=MemoryFixture::new();let original=memory();let mut store=ProviderAttemptStore::open(fixture.directory()).unwrap();
 store.can_admit_memory_input(&original.request_id,&original.scope_hash,&original.input_hash).unwrap();
 store.commit_memory_once(&original).unwrap();assert!(store.pending_memory().unwrap());close(store);
 let mut reopened=ProviderAttemptStore::open(fixture.directory()).unwrap();
 assert!(reopened.pending_memory().unwrap());assert_eq!(reopened.commit_memory_once(&original),Err(ProviderAttemptStoreError::Conflict));
 let mut retry=original.clone();retry.request_id=uuid::Uuid::new_v4().to_string();retry.engine_instance_id="different-service-engine".into();
 assert_eq!(reopened.can_admit_memory_input(&retry.request_id,&retry.scope_hash,&retry.input_hash),Err(ProviderAttemptStoreError::Conflict));
 assert_eq!(reopened.commit_memory_once(&retry),Err(ProviderAttemptStoreError::Conflict));
 let different_scope=veyra_memory::content_hash("another fixture scope");
 reopened.can_admit_memory_input(&uuid::Uuid::new_v4().to_string(),&different_scope,&original.input_hash).unwrap();
 let count:i64=reopened.connection.query_row("SELECT count(*) FROM memory_attempts",[],|r|r.get(0)).unwrap();assert_eq!(count,1);close(reopened);
}
#[test]
fn both_actual_store_apis_reject_cross_purpose_uuid_without_overwriting(){
 let fixture=MemoryFixture::new();let mut store=ProviderAttemptStore::open(fixture.directory()).unwrap();
 let task=task();store.commit_once(&task).unwrap();let mut collided=memory();collided.request_id=task.request_id.clone();
 assert_eq!(store.commit_memory_once(&collided),Err(ProviderAttemptStoreError::Conflict));
 let original=memory();store.commit_memory_once(&original).unwrap();let mut other_task=self::task();other_task.request_id=original.request_id.clone();
 assert!(store.commit_once(&other_task).is_err());
 assert_eq!(store.pending(None,100).unwrap(),vec![task]);
 let record:String=store.connection.query_row("SELECT record FROM memory_attempts",[],|r|r.get(0)).unwrap();assert_eq!(record,encode(&original).unwrap());close(store);
}
#[test]
fn actual_v2_to_v3_migration_preserves_task_schema_records_and_nonreplay(){
 let fixture=MemoryFixture::new();let (original,bytes)=seed_v2(&fixture);
 let connection=Connection::open(fixture.directory().join("attempts.db")).unwrap();let before=schema(&connection);close_sql(connection);
 let mut store=ProviderAttemptStore::open(fixture.directory()).unwrap();
 let after=schema(&store.connection).into_iter().filter(|row|row.2=="attempts"&&row.0!="trigger").collect::<Vec<_>>();assert_eq!(after,before);
 let version:i64=store.connection.pragma_query_value(None,"user_version",|r|r.get(0)).unwrap();assert_eq!(version,3);
 let observed:Vec<u8>=store.connection.query_row("SELECT CAST(record AS BLOB) FROM attempts",[],|r|r.get(0)).unwrap();assert_eq!(observed,bytes);
 assert_eq!(store.pending(None,100).unwrap(),vec![original.clone()]);assert_eq!(store.commit_once(&original),Err(ProviderAttemptStoreError::Conflict));
 let learning=memory();store.commit_memory_once(&learning).unwrap();close(store);
 let store=ProviderAttemptStore::open(fixture.directory()).unwrap();assert!(store.pending_memory().unwrap());assert_eq!(store.pending(None,100).unwrap(),vec![original]);close(store);
}
#[test]
fn actual_migration_failure_rolls_back_version_schema_and_original_bytes(){
 let fixture=MemoryFixture::new();let (_,bytes)=seed_v2(&fixture);let path=fixture.directory().join("attempts.db");
 let connection=Connection::open(&path).unwrap();let before=schema(&connection);
 let pages:i64=connection.pragma_query_value(None,"page_count",|r|r.get(0)).unwrap();
 connection.pragma_update(None,"max_page_count",pages).unwrap();
 let cap:i64=connection.pragma_query_value(None,"max_page_count",|r|r.get(0)).unwrap();assert_eq!(cap,pages);
 // Real SQLite storage exhaustion during the original migration. No test
 // replacement migration, positive receipt, authorizer or injected callback.
 assert!(matches!(ProviderAttemptStore::from_connection(connection),Err(ProviderAttemptStoreError::Database)));
 let connection=Connection::open(&path).unwrap();let version:i64=connection.pragma_query_value(None,"user_version",|r|r.get(0)).unwrap();
 assert_eq!(version,2);assert_eq!(schema(&connection),before);
 let observed:Vec<u8>=connection.query_row("SELECT CAST(record AS BLOB) FROM attempts",[],|r|r.get(0)).unwrap();assert_eq!(observed,bytes);close_sql(connection);
 // Fresh actual owner can subsequently perform the unchanged migration.
 let store=ProviderAttemptStore::open(fixture.directory()).unwrap();let version:i64=store.connection.pragma_query_value(None,"user_version",|r|r.get(0)).unwrap();assert_eq!(version,3);close(store);
}
#[test]
fn unknown_legacy_schema_is_refused_without_repair_or_row_rewrite(){
 let fixture=MemoryFixture::new();let (_,bytes)=seed_v2(&fixture);let path=fixture.directory().join("attempts.db");
 let connection=Connection::open(&path).unwrap();connection.execute_batch("CREATE TABLE unowned_marker(value TEXT);").unwrap();let before=schema(&connection);close_sql(connection);
 assert!(matches!(ProviderAttemptStore::open(fixture.directory()),Err(ProviderAttemptStoreError::Corrupt)));
 let connection=Connection::open(&path).unwrap();assert_eq!(schema(&connection),before);
 let observed:Vec<u8>=connection.query_row("SELECT CAST(record AS BLOB) FROM attempts",[],|r|r.get(0)).unwrap();assert_eq!(observed,bytes);close_sql(connection);
}
#[test]
fn historical_yielded_input_stays_spent_after_private_store_reopen(){
 let fixture=MemoryFixture::new();let store=ProviderAttemptStore::open(fixture.directory()).unwrap();close(store);
 let original=memory();let record=encode(&original).unwrap();let connection=Connection::open(fixture.directory().join("attempts.db")).unwrap();
 // Inert historical DB fixture data, not a MemoryAttemptYielded/retirement
 // capability. No mark_memory_yielded is called without genuine cleanup.
 connection.execute("INSERT INTO memory_attempts VALUES(?1,?2,?3,?4,'yielded')",params![original.request_id,original.scope_hash,original.input_hash,record]).unwrap();close_sql(connection);
 let mut store=ProviderAttemptStore::open(fixture.directory()).unwrap();assert!(!store.pending_memory().unwrap());
 let retry=uuid::Uuid::new_v4().to_string();assert_eq!(store.can_admit_memory_input(&retry,&original.scope_hash,&original.input_hash),Err(ProviderAttemptStoreError::Conflict));
 let mut replay=original.clone();replay.request_id=retry;assert_eq!(store.commit_memory_once(&replay),Err(ProviderAttemptStoreError::Conflict));
 let retained:String=store.connection.query_row("SELECT record FROM memory_attempts",[],|r|r.get(0)).unwrap();assert_eq!(retained,record);close(store);
}
#[test]
fn corrupt_memory_record_refuses_reopen_and_preserves_failure_bytes(){
 let fixture=MemoryFixture::new();let store=ProviderAttemptStore::open(fixture.directory()).unwrap();close(store);
 let original=memory();let path=fixture.directory().join("attempts.db");let connection=Connection::open(&path).unwrap();
 connection.execute("INSERT INTO memory_attempts VALUES(?1,?2,?3,?4,'pending')",params![original.request_id,original.scope_hash,original.input_hash,"{corrupt fixture}"]).unwrap();close_sql(connection);
 assert!(matches!(ProviderAttemptStore::open(fixture.directory()),Err(ProviderAttemptStoreError::Corrupt)));
 let connection=Connection::open(&path).unwrap();let record:String=connection.query_row("SELECT record FROM memory_attempts",[],|r|r.get(0)).unwrap();assert_eq!(record,"{corrupt fixture}");close_sql(connection);
}
