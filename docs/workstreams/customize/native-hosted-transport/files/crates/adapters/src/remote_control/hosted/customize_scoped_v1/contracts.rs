//! Separate explicit consent domain. Frozen governance contracts are unchanged.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::access_profiles::Policy;
use super::super::contracts::{Binding, NativeOwner};
pub const PROTOCOL: &str = "customize-scoped-v1";
pub const READ_PERMISSION: &str = "customize_scoped_v1_read";
pub const WRITE_PERMISSION: &str = "customize_scoped_v1_write";
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Visibility { Project, Personal, Public, System }
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum Verb {
 Discover, Source, ProjectSource, ArchivedPlugins, Installations, Operation, Pending,
 Publish, Withdraw, RestoreSource, RevisePluginSource, Connect, ArchivePlugin,
 RestorePlugin, ActivatePlugin, DeactivatePlugin, ReconcilePluginProjection, ReconcileLocalMetadata,
}
impl Verb {
 pub fn mutating(self)->bool { !matches!(self,Self::Discover|Self::Source|Self::ProjectSource|Self::ArchivedPlugins|Self::Installations|Self::Operation|Self::Pending) }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Selection { pub scopes:Vec<Visibility>,pub verbs:Vec<Verb> }
impl Selection {
 pub fn validate(&self)->bool { !self.scopes.is_empty()&&!self.verbs.is_empty()&&self.scopes.len()<=4&&self.verbs.len()<=18&&self.scopes.iter().enumerate().all(|(i,s)|!self.scopes[..i].contains(s))&&self.verbs.iter().enumerate().all(|(i,v)|!self.verbs[..i].contains(v)) }
 pub fn allows(&self,verb:Verb,scope:Visibility)->bool { self.scopes.contains(&scope)&&self.verbs.contains(&verb) }
 pub fn writable(&self)->bool {self.verbs.iter().any(|v|v.mutating())}
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ConsentOriginal {
 pub protocol:String,pub id:String,pub base_binding:Binding,pub native_owner:NativeOwner,
 pub account_id:String,pub selection:Selection,pub local_policy:Policy,pub review_sha256:String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Consent {
 pub original:ConsentOriginal,pub request_sha256:String,pub revision:u32,pub state:ConsentState,
 pub account_review:crate::account_vault::node_hosted::AccountReview,
 pub node_receipt:Option<NodeConsentReceipt>,pub created_at:u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct NodeConsentReceipt {
 pub protocol:String,pub consent_id:String,pub revision:u32,pub request_sha256:String,
 pub actor_id:String,pub installation_id:String,pub enrollment_request_id:String,
 pub base_binding_sha256:String,pub selection:Selection,pub physical_erasure:bool,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum ConsentState { Prepared, Active, Revoked, Unconfirmed }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Original {
 pub protocol:String,pub id:String,pub consent_id:String,pub consent_revision:u32,
 pub consent_request_sha256:String,pub base_binding:Binding,pub command:Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Receipt {
 pub protocol:String,pub operation_id:String,pub native_request_sha256:String,
 pub consent_id:String,pub outcome:Outcome,pub value:Option<Value>,pub error:Option<Value>,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
pub enum Outcome { Succeeded, Refused, Unknown }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Proof {
 pub protocol:String,pub context:Value,pub original:ConsentOriginal,pub request_sha256:String,
 pub consent_revision:u32,pub state:ConsentState,pub effective_verbs:Vec<Verb>,
 pub local_profile_revision:u32,pub parent_profile_revision:u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReadRequest { pub protocol:String,pub consent_id:String,pub consent_revision:u32,pub verb:Verb,pub query:Value }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ConsentReview {
 pub protocol:String,pub base_binding:Binding,pub native_owner:NativeOwner,pub account_id:String,
 pub offered:Selection,pub parent_profile_revision:u32,pub current_account_review:crate::account_vault::node_hosted::AccountReview,
 pub node_offer:Value,pub needs_step_up:bool,
}