use serde::{Serialize,Deserialize};
use std::collections::{BTreeMap,BTreeSet};
use crate::{fingerprint,id};
#[derive(Clone,Debug,PartialEq,Eq)]
pub enum MemoryError{Invalid,Scope,Unavailable,Conflict,Excluded,SourceChanged,Forgotten,AlreadyProcessed,Capacity,OutcomeUnknown}
impl std::fmt::Display for MemoryError{fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{self:?}")}}
impl std::error::Error for MemoryError{}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum NativeNamespace{Project{project_id:String},Projectless{namespace_id:String}}
/// Values come from the existing library/OS-custodian/execution/ProjectStore owner,
/// never a Cloud org/user placeholder, caller slug or inferred default project.
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeScope{pub library_id:String,pub os_custodian_id:String,pub execution_id:String,pub namespace:NativeNamespace}
impl NativeScope{
 pub fn validate(&self)->Result<(),MemoryError>{
  let namespace=match &self.namespace{NativeNamespace::Project{project_id}=>project_id,NativeNamespace::Projectless{namespace_id}=>namespace_id};
  if [&self.library_id,&self.os_custodian_id,&self.execution_id,namespace].iter().all(|v|id(v)){Ok(())}else{Err(MemoryError::Scope)}
 }
 pub fn key(&self)->Result<String,MemoryError>{self.validate()?;fingerprint(self)}
}
/// Ephemeral verified owner; service/engine generations guard current execution,
/// but are not new durable learned-memory namespaces.
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionStamp{pub scope:NativeScope,pub binding_revision:u64,pub service_instance_id:String,pub engine_instance_id:String,pub engine_revision:u64,pub engine_project_id:String,pub directory:String}
impl ExecutionStamp{pub fn validate(&self)->Result<(),MemoryError>{self.scope.validate()?;if [&self.service_instance_id,&self.engine_instance_id,&self.engine_project_id,&self.directory].iter().all(|v|id(v)){Ok(())}else{Err(MemoryError::Scope)}}}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy{pub revision:u64,pub enabled:bool,pub generate:bool,pub use_memories:bool,pub external_context:bool,pub min_idle_hours:u8}
impl Default for Policy{fn default()->Self{Self{revision:0,enabled:false,generate:false,use_memories:true,external_context:false,min_idle_hours:6}}}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatPolicy{pub revision:u64,pub use_memories:bool,pub contribute:bool}
impl Default for ChatPolicy{fn default()->Self{Self{revision:0,use_memories:true,contribute:false}}}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Role{User,Assistant}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceRef{pub chat_id:String,pub message_id:String,pub role:Role,pub content_hash:String,pub revision:String,pub turn_id:String,pub terminal_id:String}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LearnedEntry{pub id:String,pub scope:NativeScope,pub revision:u64,pub content:String,pub content_hash:String,pub sources:Vec<SourceRef>,pub source_watermark:String,pub model:String,pub created_ms:u64,pub input_hash:String}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt{pub operation_id:String,pub request_hash:String,pub scope_hash:String,pub kind:String,pub revision:u64,pub memory_id:Option<String>}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRecord{pub scope:NativeScope,pub policy:Policy}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatRecord{pub scope:NativeScope,pub chat_id:String,pub policy:ChatPolicy}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LearnedState{
 pub version:u32,pub policies:BTreeMap<String,PolicyRecord>,pub chats:BTreeMap<String,ChatRecord>,
 pub entries:BTreeMap<String,LearnedEntry>,pub receipts:BTreeMap<String,Receipt>,
 pub suppressions:BTreeSet<String>,pub processed_inputs:BTreeSet<String>,
}
impl Default for LearnedState{fn default()->Self{Self{version:1,policies:BTreeMap::new(),chats:BTreeMap::new(),entries:BTreeMap::new(),receipts:BTreeMap::new(),suppressions:BTreeSet::new(),processed_inputs:BTreeSet::new()}}}
