import {isInstallationStorageProject} from "ingenium-core";
import { authorization, skills, skillGovernance, synthesis, observations, pipelineEvents, getDb, HostedRefusal, proposalReviewHash, type HostedGovernanceRow as Row } from "ingenium-core";
import type { RequestPrincipal } from "../middleware/auth.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { createProjectCatalogAuthority } from "../customize-v2/project-authority.js";
import { createCustomizeService, type CustomizeAuthority } from "../customize-v2/catalog-service.js";

const fields:Record<string,string[]>={
  catalog:["op","kind","offset","limit"],skill:["op","name"],archived:["op"],
  "proposal-counts":["op"],"proposal-page":["op","view","cursor"],proposal:["op","id","enrich"],
  "synthesis-status":["op"],pipeline:["op"],
};
function reject(code:string,status=422):never{throw new HostedRefusal(code,status);}
function proposalDto(p:Row):Row {
  const parse=(text:unknown,otherwise:unknown)=>{try{return typeof text==="string"?JSON.parse(text):otherwise;}catch{return otherwise;}};
  const state={...parse(p.proposed_state,{})};
  for(const [from,to] of [["always_apply","alwaysApply"],["file_tree","fileTree"],["file_tree_patch","fileTreePatch"]] as const) {
    if(Object.hasOwn(state,from)){state[to]=from==="always_apply"||typeof state[from]!=="string"?state[from]:parse(state[from],null);delete state[from];}
  }
  return {id:p.id,projectId:p.project_id,status:p.status==="rolled_back"?"rolledBack":p.status,proposalType:p.proposal_type,
    targetSkillId:p.target_skill_id??null,targetName:p.target_name,sourceProjectId:p.source_project_id??null,sourceName:p.source_name??null,
    expectedRevision:p.expected_revision??null,expectedSourceRevision:p.expected_source_revision??null,
    proposedState:state,evidence:parse(p.evidence_json,[]),observationIds:parse(p.observation_ids,[]),
    qualityScore:p.quality_score,noveltyScore:p.novelty_score,reviewer:p.reviewer??null,reviewReason:p.review_reason??null,
    updatedAt:p.updated_at,createdAt:p.created_at,appliedAt:p.applied_at??null,rolledBackAt:p.rolled_back_at??null};
}
/** Exact existing Core/catalog reads; no HTTP proxy, URL input or alternate domain authority. */
export async function readHostedGovernance(command:Row,binding:Row,current:()=>RequestPrincipal,
  allow:(projectId:string,permission:"read"|"write"|"admin")=>boolean):Promise<unknown> {
  if(!command||!Object.hasOwn(fields,command.op))reject("UNSUPPORTED_READ");
  const allowed=fields[command.op];
  if(!allowed||Object.keys(command).some(k=>!allowed.includes(k)))reject("UNSUPPORTED_READ");
  const projectId=binding.hostedProjectId;
  const principal=current();
  if(!allow(projectId,"read"))reject("NOT_FOUND",404);
  switch(command.op) {
    case "catalog": {
      if(!["skill","plugin"].includes(command.kind)||!Number.isSafeInteger(command.offset)||command.offset<0
        ||!Number.isSafeInteger(command.limit)||command.limit<1||command.limit>100)reject("INVALID_PAGE");
      const isSystem=()=>isInstallationStorageProject(projectId)&&!!getDb().prepare("SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL").get(projectId);
      const canRead:CustomizeAuthority["authorize"]=(context,action,kind,visibility,resourceId)=>{
        const p=current();
        if(p.id!==context.actorId||context.projectId!==projectId||action!=="read"||!["skill","plugin"].includes(kind)
          ||!(visibility==="project"||visibility==="system"&&isSystem()))return false;
        if(!authorization.requireProjectPermission(toAuthorizationPrincipal(p),projectId,kind==="skill"?"skills":"plugins","read").allowed)return false;
        if(resourceId!==undefined)return !!getDb().prepare(kind==="skill"
          ?"SELECT 1 FROM skills WHERE id=? AND project_id=?":"SELECT 1 FROM plugins WHERE id=? AND project_id=?").get(resourceId,projectId);
        return true;
      };
      const base=createProjectCatalogAuthority(canRead,skills.listSkillRecords);
      const authority:CustomizeAuthority={...base,authorize:canRead,
        scopes:()=>isSystem()?["project","system"]:["project"],
        installed:(context,kind)=>base.installed(context,kind,"project"),
        discover:(context,kind,visibility)=>visibility==="system"?base.installed(context,kind,"project"):base.discover(context,kind,visibility)};
      return createCustomizeService(authority).list({actorId:principal.id,projectId},
        {kind:command.kind,visibility:binding.visibility,offset:command.offset,limit:command.limit});
    }
    case "skill": {
      if(!skills.isSafeSkillName(command.name))reject("INVALID_NAME");
      const value=skills.getSkill(projectId,command.name);
      if(!value)reject("NOT_FOUND",404);
      return {data:value};
    }
    case "archived": {const data=skills.listArchivedSkills(projectId);return {data,total:data.length};}
    case "proposal-counts":return {data:skillGovernance.getProposalCounts(projectId)};
    case "proposal-page": {
      if(!["open","history"].includes(command.view)||command.cursor!==undefined&&(typeof command.cursor!=="string"||command.cursor.length>4096))reject("INVALID_PAGE");
      const page=skillGovernance.listProposalPage(projectId,{view:command.view,limit:25,cursor:command.cursor});
      return {data:page.data.map(p=>({id:p.id,status:p.status==="rolled_back"?"rolledBack":p.status,proposalType:p.proposal_type,
        targetName:p.target_name,sourceName:p.source_name,qualityScore:p.quality_score,noveltyScore:p.novelty_score,createdAt:p.created_at})),pagination:page.pagination};
    }
    case "proposal": {
      if(typeof command.id!=="string"||command.enrich!==undefined&&typeof command.enrich!=="boolean")reject("INVALID_PROPOSAL");
      const p=skillGovernance.getProposal(projectId,command.id);
      if(!p)reject("NOT_FOUND",404);
      const dto=proposalDto(p as unknown as Row);
      if(command.enrich===false)return {data:dto}; // Explicit basic read never enables a reviewed mutation.
      const target=p.target_skill_id?skills.getSkillById(p.target_skill_id):skills.getSkill(projectId,p.target_name);
      if(target&&target.project_id!==projectId)reject("NOT_FOUND",404);
      dto.currentSkill=target?{id:target.id,projectId,name:target.name,content:target.content,revision:target.revision}:null;
      let source:ReturnType<typeof skills.getSkill>;
      if(p.proposal_type==="merge") {
        if(!p.source_project_id||!allow(p.source_project_id,"read"))reject("NOT_FOUND",404);
        source=p.source_name?skills.getSkill(p.source_project_id,p.source_name):undefined;
        dto.sourceSkill=source?{id:source.id,projectId:source.project_id,name:source.name,content:source.content,revision:source.revision}:null;
      }
      const ids=Array.isArray(dto.observationIds)?dto.observationIds.filter((id:unknown)=>typeof id==="number"):[] as number[];
      dto.observations=observations.getObservationsByIds(projectId,ids).map(o=>({id:o.id,type:o.observation_type,
        contentPreview:(o.content??"").slice(0,200),importance:o.importance,source:o.source,sessionId:o.session_id??null}));
      dto.reviewed={status:p.status,updatedAt:p.updated_at,targetSkillId:p.target_skill_id??null,sourceProjectId:p.source_project_id??null,
        sourceName:p.source_name??null,expectedRevision:p.expected_revision??null,expectedSourceRevision:p.expected_source_revision??null,
        proposalHash:proposalReviewHash(p as unknown as Row),currentTarget:target?{id:target.id,revision:target.revision}:null,
        currentSource:source?{id:source.id,projectId:source.project_id,name:source.name,revision:source.revision}:null};
      return {data:dto};
    }
    case "synthesis-status":return {data:synthesis.getSynthesisStatus(projectId)};
    case "pipeline":return {data:pipelineEvents.getEvents(projectId,{limit:100,ownerUserId:principal.id})};
    default:return reject("UNSUPPORTED_READ");
  }
}
