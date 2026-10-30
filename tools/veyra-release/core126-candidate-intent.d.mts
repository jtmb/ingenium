export const CANDIDATE_PURPOSE:'candidate-inert-v1';
export const MAX_CANDIDATE_LEASE_MS:120000;
export const CANDIDATE_CASE_IDS:readonly string[];
export interface CandidateInertIntent {
 schemaVersion:1;purpose:'candidate-inert-v1';caseId:string;nonce:string;
 source:{revision:string;sha256:string;filesSha256:string};imageId:string;artifactClosureSha256:string;rawSchemaSha256:string;probeSha256:string;
 parent:{runtimeId:string;containerId:string;daemonId:string;hostId:string;startIdentity:string;publicProfileSha256:string;provisioningRevision:number};
 scope:{organizationId:string;projectId:string;ownerUserId:string;workspaceId:string;bindingHash:string;bindingEpoch:number;principalId:string;principalSecurityEpoch:number;grantRevision:number};
 run:{runId:string;jobId:string;attemptId:string;runIdentityHash:string;jobRevision:number;scheduleRevision:number;promptHash:string;agentHash:string};
 resource:{admissionId:string;runtimeRevision:number;limits:{cpuMillis:number;memoryBytes:number;pidsLimit:number;diskBytes:number;processLimit:number}};
 canary:{agent:'qualification';model:'opencode/qualification-canary';tool:'ingenium_project_detail';projectName:string;trapOrigin:'http://127.0.0.1:39261';catalogSha256:string};issuedAt:string;expiresAt:string;
}
/** Data only: none of these functions issues a brand, lease, approval or credential. */
export function candidateInertIntentHash(value:unknown):string;
export function assertCandidateInertIntentLive(value:unknown,now?:number):asserts value is CandidateInertIntent;
export function assertCandidateInertBinding(value:unknown,recomputedFromOriginalOwners:unknown,now?:number):void;
export function freezeCandidateInertIntent(value:unknown):Readonly<CandidateInertIntent>;
