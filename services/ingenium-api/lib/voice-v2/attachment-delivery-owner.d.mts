import type Database from "better-sqlite3";
import type {VoiceScope} from "ingenium-core/lib/tools/voice-operation-ledger";
export type AttachmentKind="message"|"cancel-agent";
export interface AttachmentInput {scope:Readonly<VoiceScope>;requestId:string;kind:AttachmentKind;originalMessageId:string;inputHash:string}
export interface AttachmentAck {originalMessageId:string;sessionId:string;state:"delivered"|"pending"|"rejected"}
export interface AttachmentMetadata {requestId:string;originalMessageId:string;state:"delivered"|"pending"|"rejected"|"unknown";dispatchPending:boolean;executionCompleted:false;agentSettlementProof:false}
export interface AttachmentDeliveryOwner<C> {
 reserve(context:C,input:AttachmentInput):{fresh:true;handle:object;receipt:AttachmentMetadata}|{fresh:false;receipt:AttachmentMetadata};
 claim(handle:object):void;
 acknowledge(handle:object,ack:AttachmentAck):AttachmentMetadata;
 unknown(handle:object):AttachmentMetadata;
 read(context:C,input:AttachmentInput):AttachmentMetadata|null;
}
export function createAttachmentDeliveryOwner<C>(ports:{db():Database.Database;assertContext(context:C,scope:Readonly<VoiceScope>,action:AttachmentKind|"read"):void;now?:()=>number}):AttachmentDeliveryOwner<C>;
