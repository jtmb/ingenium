export interface AttachmentCpuFacts {readonly scope:VoiceScope;readonly owner:voiceOperations.VoiceOwner;readonly controlOperationId:string;readonly profileDigest:string;readonly defaultVoice:string;readonly deadlineAt:number}
declare const attachmentLease:unique symbol;
export interface AttachmentCpuLease {readonly [attachmentLease]:true}
// Insert into existing ManagedCpuSupervisor<C> declaration:
// bindAttachmentContext(context:C):C;
// captureAttachmentLease(context:C,scope:SupervisedCpuScope<C>,callId:string,deadlineAt:number):AttachmentCpuLease;
// inspectAttachmentLease(lease:AttachmentCpuLease):AttachmentCpuFacts;
// releaseAttachmentLease(lease:AttachmentCpuLease):Promise<void>;
