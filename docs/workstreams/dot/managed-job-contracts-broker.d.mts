import type {ChildProcess} from "node:child_process";
import type {IncomingHttpHeaders} from "node:http";
import type {agents,authorization,getDb,execTransaction,checkpointAfterWrite,jobs,runtimes,mcpCredentials,mcpAuthorizationPolicy} from "ingenium-core";
import type {CoreJob,CoreRun} from "./core-binding.js";
import type {DotScope} from "../../../../packages/veyra-automation/contracts.js";
import type {RuntimeProvisionRequest,DockerContainerSpec} from "../runtime-manager-contract.js";
export type ManagedPhase="prepared"|"create_intent"|"created"|"start_intent"|"running"|"create_unknown"|"start_unknown"|"cancel_requested"|"retired";
export type ManagedEffectFence="untracked"|"open-v1"|"material-admitted-v1"|"create-admitted-v1"|"closed-no-create-v1";
export interface OriginalContainerRetirementProof {
 schemaVersion:1;kind:"original-daemon-container-wait-join";runId:string;attemptId:string;
 containerId:string;daemonId:string;specHash:string;exitCode:number;
}
export interface CoreNoCreateProof {
 schemaVersion:1;kind:"core-no-create-effect-v1";runId:string;attemptId:string;specHash:string;
 runIdentityHash:string;effectFence:"closed-no-create-v1";closedRevision:number;closedAt:string;
}
export type ManagedRetirementProof=OriginalContainerRetirementProof|CoreNoCreateProof;
export interface ManagedJobAdmission {
 runId:string;jobId:string;projectId:string;organizationId:string;ownerUserId:string;attemptId:string;
 runtimeId:string;runtimeRevision:number;provisioningRevision:number;parentContainerId:string;
 workspaceId:string;bindingHash:string;bindingEpoch:number;jobRevision:number;scheduleRevision:number;
 grantRevision:number;principalSecurityEpoch:number;profileId:string;profileHash:string;promptHash:string;
 specHash:string;daemonId:string;imageId:string;approvedScopes:string[];resourceAdmissionId:string;
 agentHash:string;modelBindingHash:string;model:string;limits:runtimes.RuntimeLimits;projectName:string;deadlineAt:string;
 phase:ManagedPhase;revision:number;containerId:string|null;cancelRequested:boolean;outcomeConsumed:boolean;
 effectFenceIssuer?:string;effectFence?:ManagedEffectFence;retirementProof?:ManagedRetirementProof|null;
}
export interface ManagedLaunchMaterial {
 admission:ManagedJobAdmission;runId:string;attemptId:string;credentialRunId:string;
 profileQualified:true;capability:string;provision:RuntimeProvisionRequest;
}
export interface ManagedSpecMaterial {admission:ManagedJobAdmission;capability:string;spec:DockerContainerSpec}
export interface JournalKey {attemptId:string;revision:number;specHash:string}
export type JournalAction="launch"|"inspect"|"cancel"|"cleanup";
export type EffectDecision={accepted:false}|{accepted:true;admission:ManagedJobAdmission};
export interface ManagedJobCoreClient {
 admit(runId:string,action:JournalAction):Promise<ManagedJobAdmission>;
 claimEffect(admission:ManagedJobAdmission,kind:"create"|"start"):Promise<EffectDecision>;
 recordCreated(admission:ManagedJobAdmission,containerId:string):Promise<ManagedJobAdmission>;
 recordStarted(admission:ManagedJobAdmission):Promise<ManagedJobAdmission>;
 recordUnknown(admission:ManagedJobAdmission,phase:"create"|"start"):Promise<ManagedJobAdmission>;
 recordRetired(admission:ManagedJobAdmission,proof:OriginalContainerRetirementProof):Promise<ManagedJobAdmission>;
 recordRemoved(admission:ManagedJobAdmission):Promise<ManagedJobAdmission>;
 launchMaterial(admission:ManagedJobAdmission):Promise<ManagedLaunchMaterial>;
 closeNoCreate(admission:ManagedJobAdmission):Promise<ManagedJobAdmission>;
}
export interface DockerOwnerResponse {status:number;data:unknown}
export type DockerOwnerRequest=(method:"GET"|"POST"|"DELETE",path:string,body?:object)=>Promise<DockerOwnerResponse>;
export interface ManagedJobContainerPorts {
 core:ManagedJobCoreClient;docker:DockerOwnerRequest;
 buildRuntimeSpec(admission:ManagedJobAdmission):Promise<ManagedSpecMaterial>;
 handoff(containerId:string,admission:ManagedJobAdmission,capability:string):Promise<void>;
}
export type ManagedObservation={state:"active"|"unknown";code:string}|{state:"settled";code:string;proof:ManagedRetirementProof};
export type ManagedCleanupObservation=ManagedObservation|{state:"removed";code:string};
export interface ManagedJobContainerOwner {
 launch(input:{runId:string;runtimeId:string}):Promise<ManagedObservation>;
 inspect(runId:string):Promise<ManagedObservation>;
 cancel(runId:string):Promise<ManagedObservation>;
 cleanup(runId:string):Promise<ManagedCleanupObservation>;
}
export interface ManagedJobIdentity {runId:string;attemptId:string}
export interface ManagedJobAssignment extends ManagedJobIdentity {
 workspaceId:string;bindingHash:string;runtimeId:string;projectId:string;organizationId:string;ownerUserId:string;
 profileQualified:true;executable:"opencode";cwd:"/workspace";credentialBoundToOriginalRun:true;
 agent:string;prompt:string;promptHash:string;model:string;
}
export interface ManagedChildResult {exitCode:number;verifiedResponse:boolean;events:string[]}
export interface ResponseVerifier {accept(chunk:Buffer|string):void;finish():{verified:boolean}}
export interface ManagedChildPorts {
 fetchAssignment(identity:ManagedJobIdentity):Promise<unknown>;
 reportResult(identity:ManagedJobIdentity,result:ManagedChildResult):Promise<unknown>;
 spawn(command:"opencode",args:string[],options:{cwd:"/workspace";env:NodeJS.ProcessEnv;stdio:["ignore","pipe","pipe"];shell:false;detached:false}):ChildProcess;
 verifierFactory():ResponseVerifier;environment:NodeJS.ProcessEnv;
}
export interface ManagerContext {request:{headers:IncomingHttpHeaders}}
export interface CoreActorContext {revalidate():authorization.AuthorizationPrincipal|null|undefined}
export interface Core126Selection {runId:string;projectId:string;runtimeId:string;workspaceId:string}
export interface Core126Facts {
 run:NonNullable<ReturnType<typeof jobs.getJobRun>>;job:NonNullable<ReturnType<typeof jobs.getJob>>;
 runtime:runtimes.RuntimeInstance;workspace:runtimes.AuthorizedWorkspace;principalEpoch:number;
 agentConfig:ReturnType<typeof agents.getJobAgentConfig>;
}
export interface QualifiedManagedProfile {
 qualified:true;id:string;hash:string;imageId:string;parentImageId:string;daemonId:string;
 provisioningRevision:number;approvedScopes:string[];expiresAt:number;resourceAdmissionId:string;
 modelBindingHash:string;model:string;projectName:string;limits:runtimes.RuntimeLimits;
}
export interface Core126Profiles {
 qualify(facts:Core126Facts):Promise<QualifiedManagedProfile>;
 assertCurrent(admission:ManagedJobAdmission,facts:Core126Facts):void;
}
export type ManagedJobCredential=mcpCredentials.ManagedJobCredential;
export type ManagedCredentialPorts=Pick<typeof mcpCredentials,"issueManagedJobCredential"|"inspectManagedJobCredential"|"revokeManagedJobCredential">;
export interface Core126OwnerPorts {
 getDb:typeof getDb;execTransaction:typeof execTransaction;checkpointAfterWrite:typeof checkpointAfterWrite;
 jobs:Pick<typeof jobs,"getJob"|"getJobRun"|"isJobRunAuthorizationCurrent"|"finishJobRun"|"cancelJobRun">;
 runtimes:Pick<typeof runtimes,"getAuthorizedWorkspace"|"resolveRuntimePreflightScope">;
 agents:Pick<typeof agents,"getJobAgentConfig">;authorization:Pick<typeof authorization,"requireProjectPermission">;
 credentials:ManagedCredentialPorts;profiles:Core126Profiles;requireManager(context:ManagerContext):void;
 verifierFactory():ResponseVerifier;now?:()=>Date;id?:()=>string;
}
export interface Core126Owner {
 prepare(selection:Core126Selection,context:CoreActorContext):Promise<ManagedJobAdmission>;
 admit(runId:string,action:JournalAction,context:ManagerContext):ManagedJobAdmission;
 claimEffect(runId:string,key:JournalKey&{kind:"create"|"start"},context:ManagerContext):EffectDecision;
 recordCreated(runId:string,key:JournalKey&{containerId:string},context:ManagerContext):ManagedJobAdmission;
 recordStarted(runId:string,key:JournalKey,context:ManagerContext):ManagedJobAdmission;
 recordUnknown(runId:string,key:JournalKey&{phase:"create"|"start"},context:ManagerContext):ManagedJobAdmission;
 launchMaterial(runId:string,key:JournalKey,context:ManagerContext):Promise<ManagedLaunchMaterial>;
 closeNoCreate(runId:string,key:JournalKey,context:ManagerContext):ManagedJobAdmission;
 recordRetired(runId:string,key:JournalKey&{proof:OriginalContainerRetirementProof},context:ManagerContext):ManagedJobAdmission;
 consume(runId:string,context:ManagerContext):ManagedJobAdmission;
 recordRemoved(runId:string,key:JournalKey,context:ManagerContext):ManagedJobAdmission;
 requestCancel(runId:string,context:CoreActorContext):ManagedJobAdmission;
 readOriginalRun(runId:string,scope:DotScope,context:CoreActorContext):NonNullable<ReturnType<typeof jobs.getJobRun>>;
 requireCancellationIntent(runId:string):void;requireOriginalRetirementProof(runId:string,proof:unknown):void;
 assignment(runId:string,credential:ManagedJobCredential):ManagedJobAssignment;
 result(runId:string,input:unknown,credential:ManagedJobCredential):{recorded:true};
}
export interface ClosedJobToolAuthorization {
 toolName:string;policy:mcpAuthorizationPolicy.McpAuthorizationPolicy;jobRunId:string;attemptId:string;
 projectId:string;workspaceId:string;credentialId:string;
}
export interface ExistingToolCatalog {getTool(name:string):{name:string;category:string}|undefined}
export type ClosedToolAuthorizer=(credential:ManagedJobCredential,toolName:string,body:unknown)=>ClosedJobToolAuthorization;
export type ExistingToolDispatcher=(authorization:ClosedJobToolAuthorization,body:unknown,credential:ManagedJobCredential)=>unknown|Promise<unknown>;
export interface Core126HttpRequest {path:string;method:string;headers:IncomingHttpHeaders;query?:{action?:unknown};body?:unknown}
export interface Core126ManagerGuard {requireManager(context:ManagerContext):void;context(request:{headers:IncomingHttpHeaders}):ManagerContext}
export interface Core126Handlers {
 internal(request:Core126HttpRequest):Promise<{data:unknown}|null>;
 runtime(request:Core126HttpRequest):Promise<{data:unknown}|null>;
}
export interface ManagedAsyncExecutionCorePorts {
 inTransaction():boolean;
 prepareManagedExecution(runId:string,job:CoreJob,prompt:string):Promise<ManagedJobAdmission>;
 requireOriginalRun(scope:DotScope,runId:string):CoreRun|Promise<CoreRun>;
 requireCancellationIntent(scope:DotScope,runId:string):void|Promise<void>;
 requireOriginalRetirementProof(runId:string,proof:unknown):void|Promise<void>;
}
export interface ManagedJobTransportObservation {state:"active"|"settled"|"unknown"|"removed";code:string;proof?:unknown}
export interface ManagedJobManagerClient {
 launchManagedJobRun(runId:string,runtimeId:string):Promise<ManagedJobTransportObservation>;
 cancelManagedJobRun(runId:string):Promise<ManagedJobTransportObservation>;
 inspectManagedJobRun(runId:string):Promise<ManagedJobTransportObservation>;
}
