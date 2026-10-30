import type {Buffer} from 'node:buffer';
/** Structural projection of original Core facts; this module never owns their authority. */
export interface Core126Limits {cpuMillis:number;memoryBytes:number;pidsLimit:number;diskBytes:number;processLimit:number}
export interface Core126Facts {
 runtime:Core126Limits & {id:string;organizationId:string;projectId:string;ownerUserId:string;workspaceId:string;backendContainerId:string|null;securityEpoch:number;revision:number;state:string;absoluteExpiresAt:string|null;idleExpiresAt:string|null};
 workspace:{id:string;organizationId:string;projectId:string;ownerUserId:string;securityEpoch:number;status:string;storageMappingHash:string};
 job:{id:string;project_id:string;organization_id:string};
 run:{id:string;job_id:string;project_id:string;organization_id:string};
 agentConfig:unknown;
}
export interface Core126ImageConfig {User:string;WorkingDir:string;Entrypoint:readonly string[];Cmd:readonly string[]|null}
export interface Core126ParentProof {
 id:string;name:string;startIdentity:string;imageId:string;runtimeId:string;organizationId:string;projectId:string;ownerUserId:string;workspaceId:string;bindingHash:string;bindingEpoch:number;provisioningRevision:number;publicProfileSha256:string;memoryBytes:number;nanoCpus:number;effectivePids:number;
}
export interface Core126ManagerProof {schemaVersion:1;kind:'original-manager-core126-parent-v1';observedAt:number;expiresAt:number;daemonId:string;hostId:string;parent:Readonly<Core126ParentProof>;image:{id:string;config:Readonly<Core126ImageConfig>}}
/** Must come from the original provision owner. Never reconstruct from current labels/probe. */
export interface Core126OriginalProvisionProfile {imageId:string;startIdentity:string;runtimeId:string;parentContainerId:string;hostId:string;workspaceId:string;bindingHash:string;bindingEpoch:number;provisioningRevision:number;publicProfileSha256:string;limits:Core126Limits}
export interface Core126ImageApproval {imageId:string;manifestSha256:string;sourceRevision:string;sourceSha256:string;validUntil:number}
declare const observationBrand:unique symbol,clientBrand:unique symbol,definitionBrand:unique symbol,registryBrand:unique symbol;
export interface Core126Observation {readonly [observationBrand]:true}
export interface Core126ImageDefinition {readonly [definitionBrand]:true}
export interface Core126ObservationClient {readonly [clientBrand]:true;acquire(runtimeId:string):Promise<Core126Observation>}
export interface Core126ImageRegistry {readonly [registryBrand]:true;load(imageId:string):Promise<Core126ImageDefinition>}
export interface Core126QualifiedImage {
 readonly qualified:true;readonly id:string;readonly hash:string;readonly imageId:string;readonly parentImageId:string;readonly daemonId:string;readonly provisioningRevision:number;readonly approvedScopes:readonly string[];readonly expiresAt:number;readonly agentHash:string;readonly model:string;readonly modelBindingHash:string;readonly jobRunAudience:'job-run';readonly transport:'scoped-core126-mcp-v1';
}
/** Original Core admission projection, including its existing provider/agent/resource identity. */
export interface Core126ImageAdmission {
 runId:string;jobId:string;projectId:string;organizationId:string;ownerUserId:string;runtimeId:string;runtimeRevision:number;parentContainerId:string;workspaceId:string;bindingHash:string;bindingEpoch:number;limits:Core126Limits;agentHash:string;profileId:string;profileHash:string;imageId:string;daemonId:string;provisioningRevision:number;model:string;modelBindingHash:string;approvedScopes:readonly string[];deadlineAt:string;
}
export interface Core126ImageOwner {
 /** Invoke outside DB transaction; original Core must reread facts inside its write. */
 withFreshOriginalJobRole<T>(facts:Core126Facts,work:()=>T|Promise<T>):Promise<T>;
 qualifyOriginalJobRole(facts:Core126Facts & {model:string;modelBindingHash:string}):Promise<Core126QualifiedImage>;
 /** Synchronous, no network/refresh; throws on missing, closed, stale or changed request. */
 assertCurrentOriginalJobRole(admission:Core126ImageAdmission,facts:Core126Facts):true;
}
/** Wire callback only in the original private authenticated runtime-manager client. */
export function createCore126ObservationClient(ports:{requestOriginalManager:(path:string)=>Promise<unknown>;now?:()=>number}):Core126ObservationClient;
/** Approval is independently reviewed policy; a produced manifest grants no authority. */
export function createCore126ImageRegistry(ports:{loadManifestBytes:(imageId:string)=>Promise<Buffer>;now?:()=>number},approvedImages:readonly Core126ImageApproval[]):Core126ImageRegistry;
export function createCore126ImageOwner(ports:{client:Core126ObservationClient;registry:Core126ImageRegistry;originalProvisionProfile:(facts:Core126Facts)=>Core126OriginalProvisionProfile|null|undefined;inTransaction:()=>boolean;now?:()=>number}):Core126ImageOwner;
/** Original manager calls with its own fresh probe before EACH create and start. */
export function assertAdmissionOriginalImage(admission:Core126ImageAdmission,proof:Core126ManagerProof,definition:Core126ImageDefinition,registry:Core126ImageRegistry,now?:number):true;