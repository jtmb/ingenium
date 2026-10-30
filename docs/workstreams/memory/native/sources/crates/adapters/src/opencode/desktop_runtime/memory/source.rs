//! Pure projection of an already-authorized bounded canonical page.
//! Selection is not session-wide quiescence and never traverses a cursor.
use super::*;
use crate::opencode::{EngineMessage,TimelineContent,ToolState};
use crate::goal_store::SavedMemory;

pub(super) fn candidate_pairs(messages:&[EngineMessage],chat:&str)->Result<Vec<(usize,usize)>,RuntimeError>{
 if messages.len()>32{return Err(RuntimeError::Binding)}
 let mut ids=std::collections::BTreeSet::new();
 if messages.iter().any(|m|m.session_id!=chat||!ids.insert(&m.id)){return Err(RuntimeError::Binding)}
 let mut pairs=vec![];
 for (i,pair) in messages.windows(2).enumerate(){
  let (u,a)=(&pair[0],&pair[1]);
  if u.kind!="user"||a.kind!="assistant"||a.parent_id.as_deref().is_some_and(|id|id!=u.id)||
     u.text.as_ref().is_none_or(String::is_empty)||a.text.as_ref().is_none_or(String::is_empty)||
     a.error.is_some()||a.finish.as_deref()!=Some("stop"){continue}
  let Some(user_created)=u.time.as_ref().and_then(|t|t.get("created")).and_then(Value::as_u64) else{continue};
  let Some(created)=a.time.as_ref().and_then(|t|t.get("created")).and_then(Value::as_u64) else{continue};
  let Some(completed)=a.time.as_ref().and_then(|t|t.get("completed")).and_then(Value::as_u64) else{continue};
  if user_created>created||completed<created||a.content.iter().any(|p|matches!(p,
    TimelineContent::Tool{state:ToolState::Streaming{..}|ToolState::Running{..}|ToolState::Error{..},..})){continue}
  pairs.push((i,i+1));
 }
 Ok(pairs)
}

#[derive(Deserialize)]
#[allow(dead_code)] // Every field is parsed to refuse malformed provenance.
#[serde(deny_unknown_fields)]
struct LearnedWitness{
 stamp:ExecutionStamp,chat_id:String,policy_revision:u64,chat_revision:u64,
 entries:Vec<veyra_memory::LearnedEntry>,source_chat_revisions:BTreeMap<String,u64>,
}
#[derive(Deserialize)]
#[allow(dead_code)]
#[serde(deny_unknown_fields)]
struct MemoryWitness{
 entries:Vec<SavedMemory>,goal_memory_ids:Option<Vec<String>>,learned:Option<LearnedWitness>,
}
/// Null means no captured memory. Empty retained admission is known empty;
/// malformed or unrecognized retained context stays unknown.
pub(super) fn memory_used(value:&Value)->Option<bool>{
 if value.is_null(){return Some(false)}
 let witness:MemoryWitness=serde_json::from_value(value.clone()).ok()?;
 Some(!witness.entries.is_empty()||witness.learned.is_some_and(|l|!l.entries.is_empty()))
}
pub(super) fn external(original:&veyra_contracts::PromptOriginal,tool_bearing:bool)->Option<bool>{
 let files=original.files.as_array()?;
 let memory=memory_used(&original.memory)?;
 let hooks=hooks_used(&original.hooks)?;
 Some(!files.is_empty()||!original.skill_ids.is_empty()||memory||hooks||tool_bearing)
}
pub(super) fn external_local(original:&veyra_contracts::LocalPromptOriginal,tool_bearing:bool)->Option<bool>{
 Some(!original.files.as_array()?.is_empty()||!original.skill_ids.is_empty()||
  memory_used(&original.memory)?||tool_bearing)
}
fn hooks_used(value:&Value)->Option<bool>{
 let hooks:crate::project_actions::lifecycle::HookConfig=serde_json::from_value(value.clone()).ok()?;
 Some(hooks.before_prompt.is_some()||hooks.after_turn.is_some())
}

#[cfg(test)]
mod tests{
 use super::*;
 fn message(id:&str,kind:&str,parent:Option<&str>,terminal:bool)->EngineMessage{
  serde_json::from_value(json!({"id":id,"sessionID":"chat","type":kind,"text":id,
    "parentID":parent,"time":{"created":if kind=="user"{1}else{2},"completed":if terminal{Some(3)}else{None}},
    "finish":if terminal{Some("stop")}else{None},"content":[]})).unwrap()
 }
 #[test]fn later_unfinished_tail_and_odd_offset_preserve_selected_pair(){
  let page=vec![message("offset","assistant",None,false),message("u","user",None,false),
   message("a","assistant",Some("u"),true),message("tail","user",None,false),message("partial","assistant",Some("tail"),false)];
  assert_eq!(candidate_pairs(&page,"chat").unwrap(),vec![(1,2)]);
 }
 #[test]fn unrelated_multi_assistant_records_do_not_reject_verified_neighbor(){
  let page=vec![message("u0","user",None,false),message("tool-step","assistant",Some("u0"),false),
   message("final0","assistant",Some("u0"),true),message("u1","user",None,false),message("final1","assistant",Some("u1"),true)];
  assert_eq!(candidate_pairs(&page,"chat").unwrap(),vec![(3,4)]);
 }
 #[test]fn foreign_scope_and_duplicate_member_refuse_page(){
  let mut page=vec![message("u","user",None,false),message("a","assistant",Some("u"),true)];
  page[1].session_id="foreign".into();assert!(candidate_pairs(&page,"chat").is_err());
  page[1].session_id="chat".into();page[1].id="u".into();assert!(candidate_pairs(&page,"chat").is_err());
 }
 #[test]fn exact_selected_members_remain_a_pair_without_unrelated_tail(){
  let pair=vec![message("u","user",None,false),message("a","assistant",Some("u"),true)];
  assert_eq!(candidate_pairs(&pair,"chat").unwrap(),vec![(0,1)]);
  let mut changed=pair;changed[1].finish=None;assert!(candidate_pairs(&changed,"chat").unwrap().is_empty());
 }
 #[test]fn null_and_empty_admission_are_not_external_and_unknown_is_not_false(){
  assert_eq!(memory_used(&Value::Null),Some(false));
  assert_eq!(memory_used(&json!({"entries":[],"goal_memory_ids":null})),Some(false));
  assert_eq!(memory_used(&json!({"entries":[],"goal_memory_ids":null,"learned":null})),Some(false));
  assert_eq!(memory_used(&json!({"entries":[],"future_context":[]})),None);
  assert_eq!(memory_used(&json!({"entries":"invalid"})),None);
  assert_eq!(memory_used(&json!({"entries":[],"learned":{"entries":[]}})),None);
 }
 #[test]fn actual_retained_pinned_entry_counts_as_external(){
  let entry=json!({"id":"pinned","scope":"local","project_id":null,"session_id":null,"content":"exact","origin":"user_pinned","created_at":1,"revision":1});
  assert_eq!(memory_used(&json!({"entries":[entry],"goal_memory_ids":null})),Some(true));
 }
 #[test]fn hook_metadata_is_not_injected_context_but_actual_action_is(){
  let mut hooks=json!({"project_id":"original","revision":2,"environment":{"kind":"windows"},"cwd":"original",
   "before_prompt":null,"after_turn":null});
  assert_eq!(hooks_used(&hooks),Some(false));
  hooks["after_turn"]=json!({"action_id":"action","action_revision":1,"argv":["original"],"name":"after"});
  assert_eq!(hooks_used(&hooks),Some(true));
  assert_eq!(hooks_used(&json!({"before_prompt":null})),None);
 }
}
