import type {VoiceKind,VoiceOwner,VoiceScope} from './voice-operation-ledger.js';

/** Additive family. Legacy VoiceKind/VoiceOriginal/VoiceControl stay EXACT. */
export type VoiceGpuKind='voice-gpu-supervisor'|'voice-gpu-speech-stt'|'voice-gpu-speech-tts';
export type SpeechParentKind=Extract<VoiceKind,'voice-cpu-supervisor'>|'voice-gpu-supervisor';
export interface VoiceGpuDescriptor {
 version:1;resourceKind:'voice-gpu-v1';backend:'directml'|'rocm'|'cuda';platform:'win32'|'linux';
 providerDigest:string;deviceIdentityDigest:string;deviceBootId:string;profileDigest:string;
 modelSetDigest:string;measurementDigest:string;admissionId:string;
}
export interface VoiceGpuControlOriginal {
 version:1;kind:'voice-gpu-supervisor';operationId:string;requestId:string;scope:VoiceScope;
 descriptor:VoiceGpuDescriptor;deadlineAt:number;
}
export interface VoiceGpuIdentity {
 version:1;resourceKind:'voice-gpu-dispatch-v1';controlOperationId:string;operationId:string;
 requestId:string;generation:string;workerBootId:string;kind:'transcribe'|'synthesize';
 inputSha256:string;descriptor:VoiceGpuDescriptor;
}
export interface VoiceGpuSpeechOriginal {
 version:1;kind:'voice-gpu-speech-stt'|'voice-gpu-speech-tts';operationId:string;requestId:string;
 scope:VoiceScope;turnGeneration:number;controlOperationId:string;deadlineAt:number;identity:VoiceGpuIdentity;
}
export interface VoiceGpuResourceView {
 family:'voice-gpu-v1';kind:VoiceGpuKind;operationId:string;owner:VoiceOwner;
 descriptor:VoiceGpuDescriptor;phase:'reserved'|'running'|'unknown'|'retired';
 fenced:boolean;replayAllowed:false;
}
/** These signatures describe a CLOSED Core extension, not a provider factory.
 * No CPU physicalProof/retentionId type is accepted here. Unknown is an opaque
 * input to an unavailable method, NOT a duck-typed proof validator. */
export interface ClosedVoiceGpuLedger<C> {
 reserveGpuControl(context:C,original:VoiceGpuControlOriginal,owner:VoiceOwner,actualGpuLease:object):never;
 reserveGpuSpeech(context:C,original:VoiceGpuSpeechOriginal,owner:VoiceOwner,actualGpuDispatch:object):never;
 claimGpuDispatch(context:C,actualGpuDispatch:object):never;
 retainGpuResult(context:C,actualGpuResult:object):never;
 retireGpuOriginal(context:C,actualGpuCleanup:object):never;
}
