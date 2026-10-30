//! Additive retained original for genuine projectless native turns.
//! Never deserialize caller metadata as custody; runtime captures this after
//! genuine LocalWorkspaceBinding/current-registry/engine checks.
use serde::{Deserialize,Serialize};
use crate::local_workspaces::LocalOperationRequest;
#[derive(Clone,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalPromptOriginal{
 pub request:LocalOperationRequest,
 pub operation_request_sha256:String,
 pub engine_revision:u64,
 pub engine_instance_id:String,
 pub engine_project_id:String,
 pub session:serde_json::Value,
 pub model:serde_json::Value,
 pub effective_text_sha256:String,
 pub files:serde_json::Value,
 pub skill_ids:Vec<String>,
 pub memory:serde_json::Value,
 pub require_idle:bool,
}
