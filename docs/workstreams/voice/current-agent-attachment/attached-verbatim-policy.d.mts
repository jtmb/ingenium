export const ATTACHED_SPEECH_POLICY_ID:'verbatim-assistant-text-v1';
export const ATTACHED_SPEECH_POLICY_SHA256:string;
export const ATTACHED_SPEECH_SEGMENTER_SHA256:string;
export interface AttachedVerbatimPlan {readonly policyId:'verbatim-assistant-text-v1';readonly policyImplementationSha256:string;readonly segmenterImplementationSha256:string;readonly rawTextSha256:string;readonly rawBytes:number;readonly projectedSha256:string;readonly projectedBytes:number;readonly segments:readonly Readonly<{index:number;total:number;sourceStart:number;sourceEnd:number;sourceDigest:string;digest:string;kind:'tts'|'text-gap';text:string}>[]}
export function deriveAttachedVerbatimPlan(original:string):Promise<AttachedVerbatimPlan>;
