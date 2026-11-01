import type Database from 'better-sqlite3';
export interface VoiceAttachmentRestoreRow {
 scope_hash:string;request_id:string;kind:'message'|'cancel-agent';scope_json:string;
 input_hash:string;original_message_id:string;state:'intent'|'ack'|'unknown';
 ack_kind:'delivered'|'pending'|'rejected'|null;ack_hash:string|null;
 revision:1|2;created_at:number;updated_at:number;
}
export interface VoiceAttachmentRestoreLedger {version:1;count:number;entries:VoiceAttachmentRestoreRow[];sha256:string}
export const VOICE_ATTACHMENT_RESTORE_LIMITS:Readonly<{rows:16384;perScope:4096;bytes:8388608}>;
export function captureVoiceAttachmentRestoreLedger(db:Database.Database):VoiceAttachmentRestoreLedger;
export function validateVoiceAttachmentRestoreLedger(ledger:unknown):void;
export function mergeVoiceAttachmentRestoreLedger(db:Database.Database,ledger:VoiceAttachmentRestoreLedger|undefined):{preserved:number;inserted:number;sealed:number};
