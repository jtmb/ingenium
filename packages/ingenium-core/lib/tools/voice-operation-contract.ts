import type {OriginalAssistantSourceClaim} from './voice-assistant-source.js';
import type {VoiceScope,VoiceOwner,CpuIdentity,VoiceOriginal,VoiceMetadata,VoiceChange} from "./voice-operation-ledger.js";
export interface CpuResultFingerprint {status:number;contentType:"application/json"|"audio/wav";sha256:string;bytes:number}
export interface VoiceControl {instanceId:string;profileDigest:string;recoveryEndpointIdentity:string;retirementSecretSha256:string}
export interface CpuRetentionChange {operationId:string;owner:VoiceOwner;identity:CpuIdentity;transactionId:string;expectedCpuRevision:number;phase:"reserved"|"running"|"uncertain"|"terminal";outcome:null|"completed"|"failed"|"cancelled"|"cancelled-before-dispatch";drained:boolean}
export interface CpuRetentionAck {identity:CpuIdentity;transactionId:string;revision:number;retentionId:string}
export interface CpuPrivate {identity:CpuIdentity;revision:number;phase:"bound"|"reserved"|"running"|"uncertain"|"terminal";outcome:CpuRetentionChange["outcome"];drained:boolean;retentionId:string|null;lastTransactionId:string|null;lastTransactionDigest:string|null;resultFingerprint:CpuResultFingerprint|null;dispatchClaimed:boolean;quarantined:boolean}
export interface OriginalResourceRequest {operationId:string;owner:VoiceOwner}
export interface CoreVoiceLedger<C> {
 reserveOriginalAssistantSource(context:C,actualPrivatePlan:object):OriginalAssistantSourceClaim;
 reserveAttachedAssistantTts(context:C,claim:OriginalAssistantSourceClaim,original:VoiceOriginal,owner:VoiceOwner):{accepted:boolean;fresh:boolean;operation:VoiceMetadata};
 spendOriginalAssistantSource(context:C,claim:OriginalAssistantSourceClaim,actualOpaqueCpuDispatch:object):void;
 fenceOriginalAssistantSources(actualOriginalCall:object,reason:string):void;
 requireOriginalAssistantCpuLive(context:C,operationId:string,owner:VoiceOwner):void;
 reserve(context:C,original:VoiceOriginal,owner:VoiceOwner):{accepted:boolean;fresh:boolean;operation:VoiceMetadata};
 read(context:C,operationId:string):VoiceMetadata|null;
 cas(context:C,change:VoiceChange):VoiceMetadata;
 settle(context:C,change:VoiceChange):VoiceMetadata;
 quarantine(context:C,operationId:string,expectedRevision:number,reason:string):VoiceMetadata;
 reserveControl(context:C,input:{original:VoiceOriginal;owner:VoiceOwner;control:VoiceControl}):{accepted:boolean;fresh:boolean;operation:VoiceMetadata};
 privateRead(context:C,input:OriginalResourceRequest):VoiceMetadata;
 listControls(context:C,input:{instanceId:string;owner:VoiceOwner}):readonly VoiceMetadata[];
 bindWorkerBoot(context:C,input:OriginalResourceRequest&{workerBootId:string;physicalProof:unknown}):VoiceMetadata;
 claimCpuDispatch(context:C,input:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number}):{identity:CpuIdentity;permitId:string;revision:number};
 retainCpu(context:C,input:CpuRetentionChange):CpuRetentionAck;
 recordCpuResult(context:C,input:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number;resultFingerprint:CpuResultFingerprint}):VoiceMetadata;
 quarantineCpu(context:C,input:OriginalResourceRequest&{identity:CpuIdentity;expectedCpuRevision:number;reason:string}):VoiceMetadata;
 retireOriginal(context:C,input:OriginalResourceRequest&{physicalProof:unknown}):VoiceMetadata;
}
// Scope stays exactly the existing nine-key portable contract. No native conversation/session mapping is invented.
export type HostedVoiceScope=VoiceScope;
