import type {CoreVoiceLedger,VoiceOperationAuthorities} from 'ingenium-core';
import type {ManagedCpuSupervisor,ManagedCpuDependencies} from './managed-supervisor.mjs';
export interface CpuResourceStage {additionalBytes:number;additionalTasks:number;cpuMilli:number}
export interface CpuResourcePlan {
 version:1;profileDigest:string;codeBundleDigest:string;helperSha256:string;witnessSha256:string;
 modelManifestSha256:string;modelSetDigest:string;qualificationDigest:string;
 assets:readonly {role:'transcription'|'kokoro-model'|'kokoro-voices';file:string;sha256:string;bytes:number}[];
 workerAddressSpaceBytes:number;cpuThreads:number;
 components:{modelsResidentBytes:number;modelWarmupExtraBytes:number;helperBytes:number;witnessBytes:number;probeBytes:number;hotWorkspaceBytes:number;coldTasks:number;hotAdditionalTasks:number;witnessTasks:number};
 stages:{cold:CpuResourceStage;hot:CpuResourceStage;witness:CpuResourceStage};
 qualifiedAt:number;expiresAt:number;retirementExpiresAt:number;maxLifetimeMs:number;maxWitnessLifetimeMs:number;
}
export interface LinuxCpuSupervisorOptions<C> {
 /** Fixed server-owned protected paths; never renderer parameters. */
 profilePath:string;resourceApprovalPath:string;ledger:CoreVoiceLedger<C>;
 bindContext:ManagedCpuDependencies<C>['bindContext'];currentScope:VoiceOperationAuthorities<C>['currentScope'];
}
export function createLinuxCpuSupervisor<C>(options:LinuxCpuSupervisorOptions<C>):ManagedCpuSupervisor<C>;
/** Pure arithmetic only; this does not issue admission or retirement authority. */
export function checkCpuResourceBudget(plan:CpuResourcePlan,facts:{memoryHeadroom:number;pidsHeadroom:number;cpuMilli:number;cpus:number},stage:'cold'|'hot'|'witness'):void;
