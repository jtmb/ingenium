//! Native-local identities are OS custodians, never API organization/user UUIDs.
use serde::{Deserialize,Serialize};
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum LocalEnvironment { Windows, Wsl { distro:String, user:String } }
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalWorkspaceOwner {
 pub installation_id:String, pub custodian_key:String, pub workspace_id:String,
 pub revision:u64, pub service_instance_id:String, pub environment:LocalEnvironment,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum LocalOperation {
 SessionCreate { title:String, agent:String },
 AgentTurn { session_id:String, text:String },
 SessionInterrupt { session_id:String },
 SessionSelectModel { session_id:String, model_id:String },
 SessionSelectAgent { session_id:String, agent:String },
 TerminalOpen { shell:String, columns:u16, rows:u16 },
 TerminalInput { terminal_id:String, text:String },
 TerminalResize { terminal_id:String, columns:u16, rows:u16 },
 TerminalClose { terminal_id:String },
 GitStatus, GitDiff,
 GitBranch { name:String },
 WorktreeCreate { name:String, branch:String },
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalOperationRequest { pub request_id:String,pub owner:LocalWorkspaceOwner,pub operation:LocalOperation }
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct LocalOperationReceipt {
 pub request_id:String,pub owner:LocalWorkspaceOwner,pub request_sha256:String,
 pub state:String,pub result:Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn refuses_forged_principal_and_project_scope(){
  let owner=serde_json::json!({"installation_id":"library","custodian_key":"key","workspace_id":"private",
   "revision":0,"service_instance_id":"original","environment":{"kind":"windows"}});
  let mut request=serde_json::json!({"request_id":"retained","owner":owner,"operation":{"kind":"git_status"}});
  assert!(serde_json::from_value::<LocalOperationRequest>(request.clone()).is_ok());
  request["principal"]=serde_json::json!({"id":"forged"});
  assert!(serde_json::from_value::<LocalOperationRequest>(request.clone()).is_err());
  request.as_object_mut().unwrap().remove("principal");
  request["owner"]["project_id"]=serde_json::json!("global");
  assert!(serde_json::from_value::<LocalOperationRequest>(request).is_err());
 }
 #[test] fn wsl_requires_explicit_non_optional_user(){
  assert!(serde_json::from_value::<LocalEnvironment>(serde_json::json!({"kind":"wsl","distro":"Ubuntu"})).is_err());
  assert!(serde_json::from_value::<LocalEnvironment>(serde_json::json!({"kind":"wsl","distro":"Ubuntu","user":null})).is_err());
 }
}
