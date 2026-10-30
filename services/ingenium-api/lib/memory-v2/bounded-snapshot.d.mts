import type { MemoryScope } from './lifecycle.mjs';
import type { AuthenticatedExecution } from './adapters.mjs';
export interface CompletedEngineMessage {
  id:string; revision:string; turnId:string; terminalAssistantId:string; role:'user'|'assistant'; content:string;
  completion:'complete'; completedAtMs:number;
}
export interface CompletedEngineSnapshot {
  scope:MemoryScope; runtimeId:string; chatId:string; ownerInstanceId:string; watermark:string;
  capturedAtMs:number; lastActivityAtMs:number; externalContextUsed:boolean; messages:CompletedEngineMessage[];
}
declare const opaqueSnapshot: unique symbol;
export interface CompletedMemorySnapshot { readonly [opaqueSnapshot]:true; readonly version:'completed-source-snapshot-v1'; readonly fingerprint:string; readonly messageCount:number; readonly selectedSources:readonly Readonly<{engineMessageId:string;role:'user'|'assistant';contentHash:string;terminalAssistantId:string}>[] }
export const COMPLETED_SNAPSHOT_LIMITS:Readonly<{maxBytes:number;maxRecordBytes:number;maxMessages:32}>;
export function createCompletedMemorySnapshot(input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;minRolloutIdleHours:number;nowMs?:number;
  captureSnapshot:(input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;maxBytes:number;maxRecordBytes:number;maxMessages:number})=>CompletedEngineSnapshot|null;
  readCanonicalMessage:(input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;ownerInstanceId:string;watermark:string;messageId:string;revision:string})=>(CompletedEngineMessage & {ownerInstanceId:string;externalContextUsed:boolean})|null;
}):CompletedMemorySnapshot;
export function readCompletedSnapshotSource(snapshot:CompletedMemorySnapshot,input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;engineMessageId:string;role:string;content:string;contentHash:string;minRolloutIdleHours:number}):{
  userMessageId:string;userContentHash:string;terminalAssistantId:string;terminalContentHash:string;externalContextUsed:boolean;eligibilityVersion:string;
}|null;
