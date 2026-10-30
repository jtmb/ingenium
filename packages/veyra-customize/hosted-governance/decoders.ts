import type {Binding, ModelProvider, ProposalCounts, ProposalDetail, ProposalPage, ProposalSummary, SynthesisStatus} from "./contracts";
export const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const integer=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const nullable=(v:unknown)=>v===null||typeof v==="string";
export function data(value:unknown):unknown {if(!record(value)||!("data" in value))throw new Error("The hosted response has no data envelope.");return value.data;}
function summary(v:unknown):v is ProposalSummary & Record<string,unknown> {return record(v)&&typeof v.id==="string"&&!!v.id&&typeof v.status==="string"&&typeof v.proposalType==="string"&&typeof v.targetName==="string"&&nullable(v.sourceName)&&typeof v.qualityScore==="number"&&Number.isFinite(v.qualityScore)&&typeof v.noveltyScore==="number"&&Number.isFinite(v.noveltyScore)&&typeof v.createdAt==="string";}
export function counts(value:unknown):ProposalCounts {
  const v=data(value);if(!record(v)||!integer(v.open)||!integer(v.history)||!record(v.byStatus)||Object.values(v.byStatus).some(n=>!integer(n)))throw new Error("Invalid hosted proposal totals.");return v as ProposalCounts;
}
export function proposalPage(value:unknown):ProposalPage {
  if(!record(value)||!Array.isArray(value.data)||value.data.length>25||!value.data.every(summary)||new Set(value.data.map(v=>v.id)).size!==value.data.length||!record(value.pagination)||!nullable(value.pagination.nextCursor)||typeof value.pagination.hasMore!=="boolean"||value.pagination.hasMore&&!value.pagination.nextCursor)throw new Error("Invalid bounded proposal page.");
  return value as ProposalPage;
}
export function proposal(value:unknown,b:Binding,id:string):ProposalDetail {
  const v=data(value);if(!summary(v)||!record(v)||v.id!==id||v.projectId!==b.hostedProjectId||typeof v.updatedAt!=="string"||!record(v.proposedState)||!Array.isArray(v.evidence)||!Array.isArray(v.observationIds)||!(v.expectedRevision===null||integer(v.expectedRevision))||!(v.expectedSourceRevision===null||integer(v.expectedSourceRevision))||!nullable(v.targetSkillId)||!nullable(v.sourceProjectId)||!nullable(v.reviewer)||!nullable(v.reviewReason)||!nullable(v.appliedAt)||!nullable(v.rolledBackAt))throw new Error("Proposal differs from the original hosted project.");
  if(v.currentSkill!==undefined&&v.currentSkill!==null&&(!record(v.currentSkill)||typeof v.currentSkill.content!=="string"||!integer(v.currentSkill.revision)))throw new Error("Invalid current skill comparison.");
  if(v.sourceSkill!==undefined&&v.sourceSkill!==null&&(!record(v.sourceSkill)||v.sourceSkill.projectId!==v.sourceProjectId||typeof v.sourceSkill.content!=="string"||!integer(v.sourceSkill.revision)||typeof v.sourceSkill.name!=="string"))throw new Error("Invalid source skill comparison.");
  if(v.observations!==undefined&&(!Array.isArray(v.observations)||v.observations.some(o=>!record(o)||!integer(o.id)||o.contentPreview!==undefined&&typeof o.contentPreview!=="string")))throw new Error("Invalid enriched observations.");
  return v as ProposalDetail;
}
export function synthesisStatus(value:unknown):SynthesisStatus {
  const v=data(value);if(!record(v)||!["total_observations","pending_count","processed_count","trait_count"].every(k=>integer(v[k]))||!nullable(v.last_synthesis_at))throw new Error("Invalid synthesis status.");
  if(v.incompleteBatch!==null){const batch=v.incompleteBatch;if(!record(batch)||typeof batch.stage!=="string"||!integer(batch.observationCount)||!integer(batch.errorCount)||typeof batch.hasStoredProposalPlan!=="boolean"||!nullable(batch.lastErrorCode)||typeof batch.createdAt!=="string"||typeof batch.updatedAt!=="string"||typeof batch.leaseState!=="string")throw new Error("Invalid incomplete synthesis batch.");}
  return v as SynthesisStatus;
}
export function modelProviders(value:unknown):ModelProvider[] {
  const v=data(value);if(!record(v)||!Array.isArray(v.providers)||v.providers.some(p=>!record(p)||typeof p.providerId!=="string"||!p.providerId||typeof p.label!=="string"||!Array.isArray(p.models)||p.models.some(m=>!record(m)||typeof m.id!=="string"||!m.id||typeof m.label!=="string")))throw new Error("The actual synthesis model catalog is unavailable.");
  return v.providers as ModelProvider[];
}
export type PipelineEvent={id:number;project_id:string;event_type:string;event_source:string;title:string;description?:string;data?:unknown;created_at:string};
export function pipeline(value:unknown,b:Binding):PipelineEvent[] {
  const rows=data(value);if(!Array.isArray(rows)||rows.length>100||rows.some(v=>!record(v)||!integer(v.id)||v.project_id!==b.hostedProjectId||typeof v.event_type!=="string"||typeof v.event_source!=="string"||typeof v.title!=="string"||v.description!==undefined&&typeof v.description!=="string"||typeof v.created_at!=="string"))throw new Error("Invalid original-project pipeline events.");return rows as PipelineEvent[];
}
