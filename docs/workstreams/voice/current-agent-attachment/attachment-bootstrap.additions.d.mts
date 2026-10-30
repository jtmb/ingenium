// INSERT methods in existing ManagedCpuSupervisor<C> declaration:
// beginOriginalAttachmentScope(input:{context:C;scope:VoiceScope;deadlineAt:number;signal:AbortSignal}):AttachmentScopeBootstrap;
// waitOriginalAttachmentScope(handle:AttachmentScopeBootstrap,signal:AbortSignal):Promise<CpuSupervisorStatus>;
// bindOriginalAttachmentScope(handle:AttachmentScopeBootstrap,freshActualContext:C):C;
// releaseOriginalAttachmentScope(handle:AttachmentScopeBootstrap):Promise<void>;
declare const attachmentScopeBootstrap:unique symbol;
export interface AttachmentScopeBootstrap {readonly [attachmentScopeBootstrap]:true}
