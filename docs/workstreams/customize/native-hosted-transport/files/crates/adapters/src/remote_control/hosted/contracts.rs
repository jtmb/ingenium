use serde::{Serialize,Deserialize};
use serde_json::Value;
use veyra_contracts::Project;
#[derive(Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Binding {
 pub authority_id:String,pub connection_id:String,pub grant_id:String,pub grant_revision:u32,pub epoch:String,
 pub native_library_id:String,pub native_service_instance_id:String,pub hosted_service_instance_id:String,
 pub native_project_id:Option<String>,pub native_project_revision:Option<u32>,pub actor_id:String,
 pub installation_id:String,pub hosted_project_id:String,pub api_project:String,pub visibility:Visibility,
}
#[derive(Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="lowercase")]
pub enum Visibility {Project,System}
#[derive(Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="kebab-case")]
pub enum Capability {Catalog,Skill,Archived,ProposalCounts,ProposalPage,Proposal,SynthesisStatus,SynthesisModels,Pipeline,Create,Save,Archive,Restore,Enable,Disable,Approve,Reject,Rollback,Submit,SynthesisRun}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(tag="op",rename_all="kebab-case",deny_unknown_fields)]
pub enum Read {
 Catalog {kind:CatalogKind,offset:u32,limit:u32},Skill{name:String},Archived,ProposalCounts,
 ProposalPage{view:ProposalView,#[serde(skip_serializing_if="Option::is_none")]cursor:Option<String>},Proposal{id:String,#[serde(skip_serializing_if="Option::is_none")]enrich:Option<bool>},
 SynthesisStatus,SynthesisModels,Pipeline,
}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="lowercase")]
pub enum CatalogKind{Skill,Plugin}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="lowercase")]
pub enum ProposalView{Open,History}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Target {pub id:String,pub revision:u32}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Source {pub id:String,pub project_id:String,pub name:String,pub revision:u32}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Reviewed {
 pub status:String,pub updated_at:String,pub target_skill_id:Option<String>,pub source_project_id:Option<String>,pub source_name:Option<String>,
 pub expected_revision:Option<u32>,pub expected_source_revision:Option<u32>,pub current_target:Option<Target>,pub current_source:Option<Source>,pub proposal_hash:String,
}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Extra {#[serde(skip_serializing_if="Option::is_none")]pub tags:Option<String>,pub always_apply:i64,#[serde(skip_serializing_if="Option::is_none")]pub files:Option<String>}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Model {pub provider_id:String,pub model_id:String}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(tag="op",rename_all="kebab-case",deny_unknown_fields)]
pub enum Write {
 Create {#[serde(rename="reviewedAbsent")]reviewed_absent:bool,name:String,description:String,content:String},
 Save{name:String,#[serde(rename="filePath")]file_path:String,target:Target,content:String,extra:Extra},
 Archive{name:String,target:Target},Restore{name:String,target:Target},Enable{name:String,target:Target},Disable{name:String,target:Target},
 Approve{id:String,reviewed:Reviewed,reviewer:String,#[serde(skip_serializing_if="Option::is_none")]reason:Option<String>},
 Reject{id:String,reviewed:Reviewed,reviewer:String,#[serde(skip_serializing_if="Option::is_none")]reason:Option<String>},
 Rollback{id:String,reviewed:Reviewed,reviewer:String,#[serde(skip_serializing_if="Option::is_none")]reason:Option<String>},
 Submit{id:String,reviewed:Reviewed,#[serde(skip_serializing_if="Option::is_none")]reviewer:Option<String>,#[serde(skip_serializing_if="Option::is_none")]reason:Option<String>},
 SynthesisRun{#[serde(rename="sessionId",skip_serializing_if="Option::is_none")]session_id:Option<String>,#[serde(skip_serializing_if="Option::is_none")]model:Option<Model>},
}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Original {pub id:String,pub binding:Binding,pub command:Write}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Receipt {pub original:Original,pub outcome:Outcome,#[serde(skip_serializing_if="Option::is_none")]pub value:Option<Value>,#[serde(skip_serializing_if="Option::is_none")]pub error:Option<PublicError>}
#[derive(Clone,Copy,Serialize,Deserialize,PartialEq)]
#[serde(rename_all="lowercase")]
pub enum Outcome{Succeeded,Refused,Unknown}
#[derive(Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PublicError{#[serde(skip_serializing_if="Option::is_none")]pub status:Option<u16>,pub code:String,pub message:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {pub binding:Binding,pub capabilities:Vec<Capability>,#[serde(rename="capabilityRevision")]pub capability_revision:String,pub session_actor_id:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeOwner {pub library_id:String,pub service_instance_id:String,pub project:Option<Project>}
impl Write {
 pub fn capability(&self)->Capability {match self{Self::Create{..}=>Capability::Create,Self::Save{..}=>Capability::Save,Self::Archive{..}=>Capability::Archive,Self::Restore{..}=>Capability::Restore,Self::Enable{..}=>Capability::Enable,Self::Disable{..}=>Capability::Disable,Self::Approve{..}=>Capability::Approve,Self::Reject{..}=>Capability::Reject,Self::Rollback{..}=>Capability::Rollback,Self::Submit{..}=>Capability::Submit,Self::SynthesisRun{..}=>Capability::SynthesisRun}}
 pub fn validate(&self)->bool{
  let name=|s:&str|!s.is_empty()&&s.len()<=64&&!s.chars().any(char::is_control)&&!s.contains(['/', '\\'])&&s!="."&&s!="..";
  let target=|t:&Target|!t.id.is_empty()&&t.id.len()<=256;
  match self{
   Self::Create{reviewed_absent,name:n,..}=>*reviewed_absent&&name(n),
   Self::Save{name:n,file_path,target:t,extra,..}=>name(n)&&target(t)&&!file_path.is_empty()&&!file_path.contains('\\')&&file_path.split('/').all(|p|!["",".",".."].contains(&p))&&[0,1].contains(&extra.always_apply),
   Self::Archive{name:n,target:t}|Self::Restore{name:n,target:t}|Self::Enable{name:n,target:t}|Self::Disable{name:n,target:t}=>name(n)&&target(t),
   Self::Approve{id,reviewed,reviewer,..}|Self::Reject{id,reviewed,reviewer,..}|Self::Rollback{id,reviewed,reviewer,..}=>{
    reviewed.proposal_hash.len()==64&&reviewed.proposal_hash.bytes().all(|b|b.is_ascii_hexdigit())&&!id.is_empty()&&!reviewer.trim().is_empty()&&reviewer.len()<=256&&!reviewed.status.is_empty()&&!reviewed.updated_at.is_empty()&&
    reviewed.current_target.as_ref().is_none_or(|t|target(t)&&reviewed.target_skill_id.as_ref()==Some(&t.id))&&
    (reviewed.target_skill_id.is_none()||reviewed.current_target.is_some())&&
    match (&reviewed.source_project_id,&reviewed.source_name,&reviewed.current_source){
     (None,None,None)=>true,(Some(project),Some(n),Some(source))=>!source.id.is_empty()&&source.project_id==*project&&source.name==*n,_=>false
    }},
   Self::Submit{id,reviewed,..}=>reviewed.proposal_hash.len()==64&&reviewed.proposal_hash.bytes().all(|b|b.is_ascii_hexdigit())&&!id.is_empty()&&!reviewed.updated_at.is_empty()&&(reviewed.source_project_id.is_none()||reviewed.current_source.is_some()),
   Self::SynthesisRun{session_id,model}=>session_id.as_ref().is_none_or(|id|!id.is_empty()&&id.len()<=256)&&model.as_ref().is_none_or(|m|!m.provider_id.is_empty()&&!m.model_id.is_empty())
  }
 }
}
impl Read {pub fn capability(&self)->Capability{match self{Self::Catalog{..}=>Capability::Catalog,Self::Skill{..}=>Capability::Skill,Self::Archived=>Capability::Archived,Self::ProposalCounts=>Capability::ProposalCounts,Self::ProposalPage{..}=>Capability::ProposalPage,Self::Proposal{..}=>Capability::Proposal,Self::SynthesisStatus=>Capability::SynthesisStatus,Self::SynthesisModels=>Capability::SynthesisModels,Self::Pipeline=>Capability::Pipeline}}}
