/** Frozen private-owner API wire. No bearer/session/CSRF/maintenance material enters these DTOs. */
export interface HostedBinding {
  authorityId:string; connectionId:string; grantId:string; grantRevision:number; epoch:string;
  nativeLibraryId:string; nativeServiceInstanceId:string; hostedServiceInstanceId:string;
  nativeProjectId:string|null; nativeProjectRevision:number|null; actorId:string; installationId:string;
  hostedProjectId:string; apiProject:string; visibility:"project"|"system";
}
export interface ReviewedProposal {
  status:string; updatedAt:string; targetSkillId:string|null; sourceProjectId:string|null; sourceName:string|null;
  expectedRevision:number|null; expectedSourceRevision:number|null; proposalHash:string;
  currentTarget:{id:string;revision:number}|null;
  currentSource:{id:string;projectId:string;name:string;revision:number}|null;
}
export type HostedWriteCommand =
 | {op:"create";reviewedAbsent:true;name:string;description:string;content:string}
 | {op:"save";name:string;filePath:string;target:{id:string;revision:number};content:string;extra:{always_apply:0|1;tags?:string;files?:string}}
 | {op:"archive"|"restore"|"enable"|"disable";name:string;target:{id:string;revision:number}}
 | {op:"submit";id:string;reviewed:ReviewedProposal;reviewer?:string;reason?:string}
 | {op:"approve"|"reject"|"rollback";id:string;reviewed:ReviewedProposal;reviewer:string;reason?:string};
export interface HostedOriginal {id:string;binding:HostedBinding;command:HostedWriteCommand}
export interface HostedContext {
 binding:HostedBinding;capabilities:readonly string[];capabilityRevision:string;session_actor_id:string;
}
export interface EffectReceipt {
 operationId:string;payloadHash:string|null;outcome:"succeeded"|"refused"|"unknown";
 valueRef?:{kind:"skill"|"proposal";id:string;projectId:string;revision?:number;status?:string;updatedAt?:string};
 error?:{code:string;status:number;message:string};firstFailureCode?:string;
}
export type Envelope<T>={data:T};
export type PendingEnvelope=Envelope<{data:EffectReceipt[];pagination:{nextCursor:string|null;hasMore:boolean}}>;
