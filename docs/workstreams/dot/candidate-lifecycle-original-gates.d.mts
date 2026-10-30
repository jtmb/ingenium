/** Constructor interfaces only. All implementation exports are fixed UNAVAILABLE. */
export interface CandidateLifecycleBinding {readonly runId:string;readonly attemptId:string;readonly candidateIntentHash:string;readonly specHash:string;readonly selectionSha256:string;readonly deadlineAt:string;readonly deadlineMs:number;readonly runIdentityHash:string;readonly organizationId:string;readonly ownerUserId:string;readonly projectId:string;readonly jobId:string;readonly runtimeId:string;readonly parentContainerId:string;readonly workspaceId:string;readonly bindingHash:string;readonly bindingEpoch:number;readonly daemonId:string;readonly imageId:string;readonly artifactClosureSha256:string;readonly catalogSha256:string;readonly containerId:string|null;readonly childBirthHash:string|null;readonly childStartHash:string|null;readonly createEffectHash:string|null;readonly attachIdentityHash:string|null;}
declare const originalLifecycleHandle:unique symbol;
export interface OriginalCandidateLifecycleHandle {readonly [originalLifecycleHandle]:never;}
export function requireOriginalCandidateLifecycleCurrent(context:unknown,binding:CandidateLifecycleBinding):void;
export function requireOriginalCandidateLifecycleControl(context:unknown,binding:CandidateLifecycleBinding):void;
export function requireOriginalCandidateCreateIntent(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{createEffectHash:string}>;
export function requireOriginalCandidateChild(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{containerId:string;childBirthHash:string;createdAtMs:number}>;
export function requireOriginalCandidateAttachIntent(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{startEffectHash:string;attachIdentityHash:string}>;
export function requireOriginalCandidateWaiting(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{childStartHash:string;startedAtMs:number}>;
export function requireOriginalCandidateReady(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<Record<string,unknown>&{observedAt:number;expiresAt:number}>;
/** Real Root credential/frame owner must spend synchronously in the SAME final transaction. */
export function spendOriginalCandidateMaterial(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{releaseId:string;spentAtMs:number;readiness:Readonly<Record<string,unknown>&{observedAt:number;expiresAt:number}>}>;
export function requireOriginalCandidateRunning(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<Record<string,never>>;
export function requireOriginalCandidateResult(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<Record<string,unknown>>;
export function requireOriginalCandidateUnknown(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<{code:string;observedAtMs:number}>;
export function requireOriginalCandidateRetirement(handle:OriginalCandidateLifecycleHandle,binding:CandidateLifecycleBinding):Readonly<Record<string,unknown>&{retiredAtMs:number}>;
