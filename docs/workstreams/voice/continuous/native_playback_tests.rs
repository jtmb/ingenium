//! In-memory metadata and the actual Voice playback method. No model, worker,
//! device, socket, service, file or engine action is permitted by this fixture.
use super::*;
struct NoEngine;
impl VoiceEngine for NoEngine {
    fn admit(&self, _: &Binding, _: &str, _: &str) -> Result<Value> { panic!("engine forbidden") }
    fn observe(&self, _: &Binding, _: &str) -> Result<Turn> { panic!("engine forbidden") }
    fn interrupt(&self, _: &Binding, _: &str) -> Result<Value> { panic!("engine forbidden") }
}
fn fixture() -> (Arc<Voice>,String,String,String,String) {
    let directory=Path::new("inert-continuous-voice-source");
    let voice=Voice::new(directory,Arc::new(Speech::new(directory)),Arc::new(NoEngine));
    *voice.source_persist.lock().unwrap()=Some(Arc::new(|_| Ok(())));
    let session=uuid::Uuid::new_v4().to_string();let id=uuid::Uuid::new_v4().to_string();
    let claim=uuid::Uuid::new_v4().to_string();
    let mut children=segments::text_children("The full original reply.").unwrap();
    let child=children[0].request_id.clone();children[0].state="completed".into();
    children[0].playback_state=Some("ready".into());children[0].wav_digest=Some("fixture-digest".into());
    let record=Record {version:1,id:session.clone(),binding:Binding {project_id:"p".into(),session_id:"ses_source".into(),
        directory:"inert".into(),environment:ExecutionEnvironment::Windows,profile_id:"unchanged".into(),quant:"q".into(),context:1},
        authority:None,read_replies:true,voice:Some("af_sarah".into()),state:"speaking".into(),active:Some(id.clone()),
        last_turn:Some(id.clone()),controls:BTreeMap::new(),message:None,
        utterances:vec![Utterance {original_audio:Some("retained-original-source".into()),digest:"original-digest".into(),
            asr_id:uuid::Uuid::new_v4().to_string(),tts_id:Some(child.clone()),admission_started:true,turn_terminal:true,interrupt_attempt:None,
            view:UtteranceView {children,id:id.clone(),state:"awaiting_playback".into(),transcript:Some("full transcript".into()),
                prompt_request_id:id.clone(),prompt_admission:Some("admitted".into()),reply_text:Some("The full original reply.".into()),
                speech_operation_id:Some(child.clone()),wav_base64:None,message:None}}]};
    voice.slots.lock().unwrap().insert(session.clone(),Arc::new(Slot {record:Mutex::new(record),dispatch:Mutex::new(())}));
    voice.cache_audio(&child,"current-bounded-wav".into()).unwrap();
    (voice,session,id,child,claim)
}
#[test] fn claim_does_not_acknowledge_playback_or_release_current_audio() {
    let (voice,session,id,child,claim)=fixture();
    let result=voice.playback(&session,&id,&child,&claim,1,false).unwrap();
    assert_eq!(result.children[0].playback_state.as_deref(),Some("claimed"));
    assert!(voice.audio.lock().unwrap().entries.contains_key(&child));
    assert_eq!(voice.slot(&session).unwrap().record.lock().unwrap().active.as_deref(),Some(id.as_str()));
}
#[test] fn only_exact_claim_generation_and_original_can_acknowledge_playback() {
    let (voice,session,id,child,claim)=fixture();
    assert!(voice.playback(&session,&id,&child,&claim,1,true).is_err());
    voice.playback(&session,&id,&child,&claim,1,false).unwrap();
    assert!(voice.playback(&session,&id,&child,&uuid::Uuid::new_v4().to_string(),1,true).is_err());
    assert!(voice.playback(&session,&id,&child,&claim,2,true).is_err());
    assert!(voice.playback(&session,&uuid::Uuid::new_v4().to_string(),&child,&claim,1,true).is_err());
    assert!(voice.audio.lock().unwrap().entries.contains_key(&child));
    let result=voice.playback(&session,&id,&child,&claim,1,true).unwrap();
    assert_eq!(result.children[0].playback_state.as_deref(),Some("played"));
    assert!(!voice.audio.lock().unwrap().entries.contains_key(&child));
}
#[test] fn failed_ack_retention_does_not_release_wav_or_fabricate_terminal_parent() {
    let (voice,session,id,child,claim)=fixture();
    voice.playback(&session,&id,&child,&claim,1,false).unwrap();
    *voice.source_persist.lock().unwrap()=Some(Arc::new(|_| Err(Error::Unavailable)));
    assert!(voice.playback(&session,&id,&child,&claim,1,true).is_err());
    assert!(voice.audio.lock().unwrap().entries.contains_key(&child));
    assert_eq!(voice.slot(&session).unwrap().record.lock().unwrap().state,"speaking");
    assert_eq!(voice.slot(&session).unwrap().record.lock().unwrap().utterances[0].view.children[0].playback_state.as_deref(),Some("claimed"));
}
#[test] fn cancellation_or_retirement_fences_late_browser_ended_acknowledgement() {
    let (voice,session,id,child,claim)=fixture();
    voice.playback(&session,&id,&child,&claim,1,false).unwrap();
    voice.slot(&session).unwrap().record.lock().unwrap().state="interruption_pending".into();
    assert!(voice.playback(&session,&id,&child,&claim,1,true).is_err());
    voice.close_admission();
    assert!(voice.playback(&session,&id,&child,&claim,1,true).is_err());
    assert!(voice.audio.lock().unwrap().entries.contains_key(&child));
}
#[test] fn current_audio_cannot_be_evicted_or_replaced_by_duplicate_child() {
    let (voice,_,_,child,_)=fixture();
    assert!(voice.cache_audio(&child,"replacement".into()).is_err());
    assert_eq!(voice.audio.lock().unwrap().entries[&child],"current-bounded-wav");
}
