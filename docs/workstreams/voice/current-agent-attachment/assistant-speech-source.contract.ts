/** DESIGN ONLY. Type declarations are not runtime authority. Core134 migration,
 * original raw reader and fixed private API constructor are NOT implemented here.
 * Existing VoiceOriginal JSON/hashes stay byte-for-byte unchanged when absent.
 */
import type {VoiceOriginal,VoiceOwner,VoiceScope} from './voice-operation-ledger.js';

export interface AssistantSpeechSourceTag {
 readonly version:1;
 readonly kind:'assistant-content-observation';
 readonly sourceId:string;                 // Core134 source UUID, not an operation
 readonly sourceHash:string;               // canonical immutable metadata SHA256
 readonly callId:string;                   // original private attachment incarnation
 readonly callGeneration:number;
 readonly planHash:string;                 // actual redaction/normalization/plan
 readonly profileDigest:string;
 readonly voiceId:string;
 readonly segmentIndex:number;
 readonly segmentCount:number;
 readonly segmentSha256:string;            // derived UTF8 segment, not raw range
 readonly cpuInputSha256:string;           // synthesize\0 + exact original payload
}
export type AttachedSpeechOriginal=VoiceOriginal & {
 readonly kind:'voice-speech-tts';
 readonly parentOperationId:string;        // SAME actual running CPU control
 readonly controlOperationId:string;       // equal parentOperationId, never null
 readonly assistantSpeechSource:AssistantSpeechSourceTag;
};
export interface AssistantObservationMetadata {
 readonly version:1;readonly sourceId:string;readonly sourceHash:string; // hash canonical metadata OMITTING sourceHash
 readonly scope:Readonly<VoiceScope>;readonly callId:string;readonly callGeneration:number;
 readonly turnGeneration:number;readonly controlOperationId:string;readonly controlOwnerHash:string;
 readonly engineSessionId:string;readonly engineMessageId:string;
 readonly contentIndex:number;readonly nativePartId:string|null;
 readonly utf8Start:number;readonly utf8End:number;readonly rangeSha256:string;
 readonly snapshotBytes:number;readonly snapshotSha256:string;readonly prefixSha256:string;
 readonly rawPayloadSha256:string;readonly observedAt:number;readonly deadlineAt:number;
 readonly userEpoch:number;readonly workspaceEpoch:number;readonly runtimeEpoch:number;
 // No plaintext, finish/outcome/retention proof, agent operation or permissions.
}
declare const originalObservation:unique symbol;
export interface OriginalAssistantObservation {readonly [originalObservation]:true}
/** Fixed implementation must resolve its module-private WeakMap original and
 * actual active call/resource at every use. A structural object or UUID is not
 * an observation. Synchronous void assertion, never a positive proof callback.
 */
export interface FixedObservedSpeechAuthority<C> {
 requireObservedSpeechSource(context:C,original:Readonly<AttachedSpeechOriginal>,owner:Readonly<VoiceOwner>):void;
}
/** API fixed constructor INPUT: only original private call and selector. It reads
 * selected authenticated raw engine payload itself and derives range/plan/text.
 * No browser text/hash/role/scope/event DTO or supplied read/proof port accepted.
 */
declare const activeCall:unique symbol;
export interface OriginalActiveCall {readonly [activeCall]:true}
export interface FixedAssistantObservationOwner<C> {
 observe(context:C,call:OriginalActiveCall,messageId:string,signal:AbortSignal):Promise<OriginalAssistantObservation>;
 // Implementations retain actual text privately until original speech ends.
 // No public method turns metadata back into a live speech capability.
 discard(observation:OriginalAssistantObservation):void;
}
