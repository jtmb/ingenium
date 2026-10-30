use veyra_memory::*;
fn scope()->NativeScope{NativeScope{library_id:"actual-library".into(),os_custodian_id:"actual-custodian".into(),execution_id:"actual-execution".into(),namespace:NativeNamespace::Project{project_id:"project".into()}}}
fn snapshot(external:Option<bool>)->Result<CompletedSnapshot,MemoryError>{
 let scope=scope();
 let stamp=ExecutionStamp{scope,binding_revision:1,service_instance_id:"service".into(),engine_instance_id:"engine".into(),engine_revision:1,engine_project_id:"engine-project".into(),directory:"original-directory".into()};
 let messages=[("user",Role::User),("assistant",Role::Assistant)].into_iter().map(|(id,role)|CompletedMessage{
  source:SourceRef{chat_id:"chat".into(),message_id:id.into(),role,content_hash:content_hash("exact text"),revision:content_hash(id),turn_id:"user".into(),terminal_id:"assistant".into()},
  text:"exact text".into(),completed_ms:1,terminal:true,external_context:external}).collect();
 CompletedSnapshot::capture(stamp,"chat".into(),messages,21_600_001,
  &Policy{enabled:true,generate:true,..Policy::default()},&ChatPolicy{contribute:true,..ChatPolicy::default()})
}
#[test]fn defaults_require_explicit_generation_and_contribution(){assert!(!Policy::default().enabled);assert!(!Policy::default().generate);assert!(!ChatPolicy::default().contribute)}
#[test]fn absent_external_provenance_is_unavailable(){assert_eq!(snapshot(None),Err(MemoryError::Unavailable));assert_eq!(snapshot(Some(true)),Err(MemoryError::Excluded))}
#[test]fn exact_selected_refresh_rejects_mutation(){
 let s=snapshot(Some(false)).unwrap();let p=Policy{enabled:true,generate:true,..Policy::default()};let c=ChatPolicy{contribute:true,..ChatPolicy::default()};
 assert!(s.verify(&s.stamp,&s.messages,&p,&c).is_ok());
 let mut changed=s.messages.clone();changed[1].text.push('!');
 assert_eq!(s.verify(&s.stamp,&changed,&p,&c),Err(MemoryError::SourceChanged));
}
#[test]fn policy_receipt_is_idempotent_and_revision_fenced(){
 let mut state=LearnedState::default();let p=Policy{enabled:true,..Policy::default()};
 let receipt=state.set_policy(&scope(),"operation",0,p.clone()).unwrap();
 assert_eq!(state.set_policy(&scope(),"operation",0,p.clone()).unwrap(),receipt);
 assert_eq!(state.set_policy(&scope(),"other",0,p),Err(MemoryError::Conflict));
}
#[test]fn forget_survives_stale_restore_and_suppresses_stable_source(){
 let s=snapshot(Some(false)).unwrap();let mut state=LearnedState::default();
 state.set_policy(&scope(),"policy",0,Policy{enabled:true,generate:true,..Policy::default()}).unwrap();
 state.set_chat(&scope(),"chat","chat",0,ChatPolicy{contribute:true,..ChatPolicy::default()}).unwrap();
 let s=CompletedSnapshot::capture(s.stamp,s.chat_id,s.messages,s.captured_ms,&state.policy(&scope()).unwrap(),&state.chat(&scope(),"chat").unwrap()).unwrap();
 let entry=LearnedEntry{id:"entry".into(),scope:scope(),revision:1,content:"learned".into(),content_hash:content_hash("learned"),sources:s.sources(),source_watermark:s.watermark.clone(),model:"original-model".into(),created_ms:s.captured_ms,input_hash:s.input_hash().unwrap()};
 state.accept(&s,&s.stamp,&s.messages,"learn",entry.clone()).unwrap();let backup=state.clone();
 state.forget(&scope(),"entry","forget",1).unwrap();state.restore(backup).unwrap();
 assert!(state.entries.is_empty());
 let mut edited=entry;edited.id="changed".into();edited.content_hash=content_hash("paraphrase");
 for source in &mut edited.sources{source.revision=content_hash("edited")}
 assert!(state.suppressed(&scope(),&edited).unwrap());
}
