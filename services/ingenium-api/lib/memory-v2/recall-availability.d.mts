import type {MemoryScope,SourceRef,SqlConnection,SourceState} from './lifecycle.mjs';
import type {AuthenticatedExecution} from './adapters.mjs';
import type {VerifiedOpenCodeMemoryOwner} from './opencode-snapshot.mjs';
import type {MessageEnvelope,SessionInfo,OpenCodeResult} from '../opencode-client.js';
declare const readView:unique symbol;
export interface RecallReadView {readonly [readView]:true;readonly version:'verified-recall-source-v1'}
export interface RecallSourceRef extends SourceRef {chatId:string}
export interface RecallSourceReaderOptions {
 scope:MemoryScope;execution:AuthenticatedExecution;
 getOwner:(input:{scope:MemoryScope;execution:AuthenticatedExecution;chatId:string})=>VerifiedOpenCodeMemoryOwner|null|Promise<VerifiedOpenCodeMemoryOwner|null>;
 verifyPair?:(input:{owner:VerifiedOpenCodeMemoryOwner;chatId:string;user:MessageEnvelope;assistant:MessageEnvelope})=>null|{ownerInstanceId:string;chatId:string;userId:string;assistantId:string}|Promise<null|{ownerInstanceId:string;chatId:string;userId:string;assistantId:string}>;
}
export interface RecallSourceReader {
 readonly view:RecallReadView;
 prime(refs:readonly RecallSourceRef[]):Promise<{verifiedSources:number;unavailableSources:{id:string;chatId:string;reason:string}[];memberReads:number;chatReads:number;acceptedBytes:number}>;
 withVerifiedSources<T>(work:()=>T):T;invalidate():void;
}
export const RECALL_SOURCE_LIMITS:Readonly<{maxSources:32;maxMembers:32;maxChats:16;maxBytes:number;maxRecordBytes:number}>;
export function createRecallSourceReader(input:RecallSourceReaderOptions&{getDb:()=>SqlConnection;transport:{
 getSession:(owner:VerifiedOpenCodeMemoryOwner,chatId:string)=>Promise<OpenCodeResult<SessionInfo>>;
 getMessages:(owner:VerifiedOpenCodeMemoryOwner,chatId:string,limit:number)=>Promise<OpenCodeResult<MessageEnvelope[]>>;
 getSessionMessage:(owner:VerifiedOpenCodeMemoryOwner,chatId:string,messageId:string)=>Promise<OpenCodeResult<MessageEnvelope>>;
}}):RecallSourceReader;
export function readVerifiedRecallSource(view:RecallReadView|null,input:{db:SqlConnection;scope:MemoryScope;execution:AuthenticatedExecution;chatId:string;messageId:string;contentHash:string}):Pick<SourceState,'active'|'excluded'|'uncertain'|'idleEligible'>|null;
