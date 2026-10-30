// APPEND to actual voice-v2/request-context.ts. Deliberately unavailable until
// original attachment incarnation + immutable plan owner is implemented there.
// Do NOT replace this refusal with a supplied callback, DTO/hash or role label.
declare const hostedAssistantObservationBrand:unique symbol;
export interface HostedAssistantObservation {readonly [hostedAssistantObservationBrand]:true}
export async function observeHostedAssistantSpeech(context:HostedVoiceRequestContext,messageId:string,signal:AbortSignal):Promise<HostedAssistantObservation> {
 const record=original(context);liveFacts(record);
 assertHostedVoiceAttachment(context,record.scope,'speech');signal.throwIfAborted();
 if(typeof messageId!=='string'||!/^msg_[A-Za-z0-9._:-]{1,123}$/u.test(messageId))return fail('VOICE_ASSISTANT_SELECTOR_INVALID',422);
 // Concrete missing ownership: this private record has no original call handle,
 // call generation or immutable redaction/profile/voice/segment plan. Reading
 // the engine now could not supply those facts. No request/network/Core write
 // or observation capability is made by this unavailable constructor.
 return fail('VOICE_ASSISTANT_CALL_PLAN_ORIGINAL_UNAVAILABLE');
}
