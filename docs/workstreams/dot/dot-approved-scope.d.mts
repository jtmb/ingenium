import type {getDb,jobs,runtimes,contextConversations,trustedJobEvents} from "ingenium-core";
import type {DotScope} from "../../../../packages/veyra-automation/contracts.js";
import type {RequestExecutionFacts} from "./request-binding.js";
import type {scopeKey} from "./repository.js";
import type {dotExecutionFingerprint,dotEventDigest} from "./request-binding.js";
import type {createOriginalDotJobPolicy} from "./dot-job-policy.mjs";
import type {inspectManagedRuntimePlacement} from "../runtime-manager-client.js";
import type {qualifyManagedRuntimePlacement} from "../runtime-placement-contract.js";
export declare function createOriginalDotApprovedScopeReader(ports:{getDb:typeof getDb;jobs:Pick<typeof jobs,"getJob"|"getJobRun"|"isJobRunAuthorizationCurrent">;runtimes:Pick<typeof runtimes,"getAuthorizedWorkspace"|"getRuntimeInstance">;contextConversations:Pick<typeof contextConversations,"getContextConversation"|"getContextMessage">;trustedJobEvents:Pick<typeof trustedJobEvents,"getTrustedJobEvent">;jobPolicy:ReturnType<typeof createOriginalDotJobPolicy>;scopeKey:typeof scopeKey;parseReference(value:string):{id:string;hash:string;chatId?:string};inspectPlacement:typeof inspectManagedRuntimePlacement;qualifyPlacement:typeof qualifyManagedRuntimePlacement;fingerprint:typeof dotExecutionFingerprint;eventDigest:typeof dotEventDigest;runIdentity(run:NonNullable<ReturnType<typeof jobs.getJobRun>>):string;now():number;findSourceIds(execution:RequestExecutionFacts,engineSessionId:string):{id:string}[];conversationIsActive(projectId:string,contextId:string):boolean}):Readonly<{
 resolve(projectId:string,jobId:string):Promise<OriginalDotApprovalLease>;
 revalidate(lease:OriginalDotApprovalLease):OriginalDotApprovalFacts;
 operationEvidence(lease:OriginalDotApprovalLease,runId:string):OriginalDotApprovalFacts & Readonly<{operation:Readonly<{id:string;revision:number;rowDigest:string;state:string}>;runId:string;runIdentityHash:string}>;
}>;
declare const originalApprovalLease:unique symbol;
export interface OriginalDotApprovalFacts {readonly followupId:string;readonly scope:Readonly<DotScope>;readonly execution:Readonly<RequestExecutionFacts>;readonly automationPrincipalId:string;readonly approvalDigest:string;readonly rowDigests:Readonly<{followup:{id:string;revision:number;rowDigest:string};suggestion:{id:string;revision:number;rowDigest:string}}>}
export interface OriginalDotApprovalLease extends OriginalDotApprovalFacts {readonly [originalApprovalLease]:true;readonly placementExpiresAt:number;}
