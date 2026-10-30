//! In-process custody of an actual original request, enrolled BEFORE HTTP.
//! Neither a Run queue nor durable replay authority; unknown slots never send.
use super::*;
use crate::opencode::local_web_transport::{OriginalWebPromptRequest,WebPromptObservation,WebTransportPhase};
use crate::projects::{NativeWebDispatch,NativeWebPublished};

/// Unforgeable allocation identity shared by the pre-send slot and the private
/// original writer's publication witness. No deserialization or public mint.
pub(crate) struct NativeWebCompletionIdentity{nonce:uuid::Uuid}
struct CompletionState{
 request:Option<OriginalWebPromptRequest>,outcome:Option<Arc<super::web_original::LocalWebPromptOutcome>>,
 published:Option<NativeWebPublished>,
}
pub(crate) struct NativeWebSendSlot{
 dispatch:NativeWebDispatch,identity:Arc<NativeWebCompletionIdentity>,state:Mutex<CompletionState>,
}
/// Constructed by the actual LiveRuntime; service binds this same allocation.
#[derive(Default)]
pub struct NativeWebCompletions{slots:Mutex<BTreeMap<String,Arc<NativeWebSendSlot>>>}
impl NativeWebCompletions{
 pub(crate) fn enroll(&self,dispatch:NativeWebDispatch)->Result<Arc<NativeWebSendSlot>,RuntimeError>{
  let mut slots=self.slots.lock().map_err(|_|RuntimeError::Storage)?;
  let operation=dispatch.parts().0.operation_id().to_owned();
  if slots.contains_key(&operation)||slots.len()>=128{return Err(RuntimeError::AdmissionPending);}
  let slot=Arc::new(NativeWebSendSlot{dispatch,identity:Arc::new(NativeWebCompletionIdentity{nonce:uuid::Uuid::new_v4()}),
   state:Mutex::new(CompletionState{request:None,outcome:None,published:None})});
  slots.insert(operation,slot.clone());Ok(slot)
 }
 pub fn outcomes(&self)->Result<Vec<Arc<super::web_original::LocalWebPromptOutcome>>,String>{
  let slots=self.slots.lock().map_err(|_|"Original Web completion registry poisoned")?;
  let mut outcomes=Vec::new();
  for slot in slots.values(){
   let state=slot.state.lock().map_err(|_|"Original Web request retained after interrupted completion")?;
   if state.published.is_none(){if let Some(outcome)=&state.outcome{outcomes.push(outcome.clone());}}
  }Ok(outcomes)
 }
 pub fn retain_publication(&self,published:NativeWebPublished)->Result<(),String>{
  let slots=self.slots.lock().map_err(|_|"Original Web completion registry poisoned")?;
  let slot=slots.get(published.operation_id()).ok_or("Original request slot missing")?;
  let mut state=slot.state.lock().map_err(|_|"Original request slot poisoned")?;
  let outcome=state.outcome.as_ref().ok_or("Original completion unavailable")?;
  if !published.matches_outcome(outcome){return Err("Publication belongs to a different actual request slot".into());}
  state.published=Some(published);
  // Deliberately no remove()/drop/read-close here. Publication alone is NOT a
  // SessionInbox.User materialization join or engine-tree retirement witness.
  Ok(())
 }
 pub fn check_empty(&self)->Result<(),String>{
  let slots=self.slots.lock().map_err(|_|"Original Web completion registry poisoned")?;
  if slots.is_empty(){Ok(())}else{Err("Actual original Web request/read ownership remains retained".into())}
 }
}
impl NativeWebSendSlot{
 pub(crate) fn parts(&self)->(&super::web_original::NativeWebOriginal,&super::web_materialization::EffectiveWebBody,&crate::opencode::attachments::NativeWebFilesOriginal){self.dispatch.parts()}
 pub(crate) fn send_retained(&self,request:OriginalWebPromptRequest,upstream:Option<String>)->Result<Arc<super::web_original::LocalWebPromptOutcome>,RuntimeError>{
  // Acquire BEFORE HTTP. No post-send enrollment/lock is needed to keep bytes.
  let mut state=self.state.lock().map_err(|_|RuntimeError::Storage)?;
  if state.request.is_some()||state.outcome.is_some(){return Err(RuntimeError::AdmissionPending);}
  state.request=Some(request);
  state.request.as_mut().expect("request retained before send").execute_retained();
  let observed=state.request.as_ref().expect("original request retained").observation.clone();
  let original=self.dispatch.parts().0;
  let (admission,ack)=classify(&observed,original.session_id(),upstream.as_deref());
  let outcome=Arc::new(super::web_original::LocalWebPromptOutcome{
   operation_id:original.operation_id().into(),input_sha256:original.input_sha256().into(),owner:original.owner().clone(),
   session_id:original.session_id().into(),upstream_id:ack.or(upstream),admission,
   observed,identity:self.identity.clone(),writer:self.dispatch.writer_identity().clone(),
   scope:self.dispatch.original_scope().to_owned(),
  });
  state.outcome=Some(outcome.clone());Ok(outcome)
 }
}
fn classify(observed:&WebPromptObservation,session:&str,expected:Option<&str>)->(&'static str,Option<String>){
 if observed.phase!=WebTransportPhase::Complete{return("uncertain",None);}
 if observed.status.is_some_and(|s|matches!(s,400|401|403|404)){return("rejected",None);}
 if observed.status!=Some(200){return("uncertain",None);}
 let Ok(value)=serde_json::from_slice::<Value>(&observed.body)else{return("uncertain",None)};
 let Some(user)=value.get("data")else{return("uncertain",None)};
 let id=user.get("id").and_then(Value::as_str).filter(|id|id.starts_with("msg_")&&id.len()>4&&id.len()<=160&&id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'));
 // This is admission classification ONLY. Payload shape is not a file-read
 // join witness; future join must bind the actual materialization semantics.
 if user.get("sessionID").and_then(Value::as_str)==Some(session)&&user.get("type").and_then(Value::as_str)==Some("user")
  &&user.pointer("/time/created").is_some_and(Value::is_number)&&user.get("payload").is_some_and(Value::is_object)
  &&user.get("delivery").and_then(Value::as_str).is_some_and(|v|matches!(v,"steer"|"queue"))
  &&id.is_some()&&expected.is_none_or(|v|id==Some(v)){("admitted",id.map(str::to_owned))}else{("uncertain",None)}
}
