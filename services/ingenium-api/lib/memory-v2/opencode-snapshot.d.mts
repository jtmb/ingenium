import type {MemoryScope,SourceRef} from './lifecycle.mjs';
import type {AuthenticatedExecution} from './adapters.mjs';
import type {CompletedEngineMessage,CompletedMemorySnapshot} from './bounded-snapshot.mjs';
import type {MessageEnvelope,SessionInfo,OpenCodeResult} from '../opencode-client.js';
import type {OpenCodeRuntimeTarget} from '../runtime-opencode-context.js';
export interface VerifiedOpenCodeMemoryOwner {
 scope:MemoryScope;execution:AuthenticatedExecution;ownerInstanceId:string;directory:string;target:OpenCodeRuntimeTarget;
}
export interface CanonicalContextPair {conversationId:string;sourceRefs:SourceRef[]}
export interface OpenCodeSnapshotOptions {
 scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;minRolloutIdleHours:number;clock?:()=>number;
 getOwner:()=>VerifiedOpenCodeMemoryOwner|null|Promise<VerifiedOpenCodeMemoryOwner|null>;
 externalContext:(input:{owner:VerifiedOpenCodeMemoryOwner;chatId:string;messages:MessageEnvelope[];phase:'prepare'|'refresh'})=>boolean|null|Promise<boolean|null>;
}
export interface PreparedOpenCodeSnapshot {snapshot:CompletedMemorySnapshot;conversationId:string;sourceRefs:readonly Readonly<SourceRef>[];ownerInstanceId:string}
export interface OpenCodeSnapshotReader {
 prepare():Promise<PreparedOpenCodeSnapshot>;refresh():Promise<true>;
 withVerifiedSources<T>(work:(messages:readonly Readonly<CompletedEngineMessage>[])=>T):T;invalidate():void;
}
export function createOpenCodeSnapshotReader(input:OpenCodeSnapshotOptions&{
 transport:{
  getSession:(owner:VerifiedOpenCodeMemoryOwner,chatId:string)=>Promise<OpenCodeResult<SessionInfo>>;
  getMessages:(owner:VerifiedOpenCodeMemoryOwner,chatId:string,limit:number)=>Promise<OpenCodeResult<MessageEnvelope[]>>;
  getSessionMessage:(owner:VerifiedOpenCodeMemoryOwner,chatId:string,messageId:string)=>Promise<OpenCodeResult<MessageEnvelope>>;
 };
 mapContext:(input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;user:CompletedEngineMessage;assistant:CompletedEngineMessage})=>CanonicalContextPair|null;
}):OpenCodeSnapshotReader;
