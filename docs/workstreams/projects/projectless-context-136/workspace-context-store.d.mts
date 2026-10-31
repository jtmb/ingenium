/** Internal canonical-writer primitives, not authenticated request or placement capabilities. */
import type Database from 'better-sqlite3';
export interface WorkspaceStoreScope {projectId:null;organizationId:string;ownerUserId:string;workspaceId:string;runtimeId:string;bindingHash:string;bindingEpoch:number;executionGeneration:string}
export type ContextRow=Record<string,unknown>&{id:string;project_id:null;conversation_id?:string};
export interface EngineMapping {contextConversationId:string;engineSessionId:string;runtimeId:string;executionGeneration:string;purpose:'active'|'history'}
export interface CreateInput {title:string;tags?:string[];priority?:number;metadata?:Record<string,unknown>;idempotencyKey?:string}
export interface AppendInput {role:'system'|'user'|'assistant'|'tool';content:string;expectedRevision:number;idempotencyKey?:string;tags?:string[];priority?:number;metadata?:Record<string,unknown>}
export interface CheckpointInput {expectedRevision:number;idempotencyKey?:string;metadata?:Record<string,unknown>;ragSourceIds?:never[]}
export function assertWorkspaceStoreScope(db:Database.Database,scope:WorkspaceStoreScope,options?:{activeExecution?:boolean}):{revision:number;backend_container_id:string};
export function isArchived(db:Database.Database,id:string):boolean;
export function createInTransaction(db:Database.Database,scope:WorkspaceStoreScope,input:CreateInput):{conversation:ContextRow;idempotent:boolean};
/** Original private retained successful engine-response owner only; no route DTO. */
export function linkOriginalEngineInTransaction(db:Database.Database,scope:WorkspaceStoreScope,input:{engineSessionId:string;title:string}):{conversation:ContextRow;idempotent:boolean};
export function resolveEngineMapping(db:Database.Database,scope:WorkspaceStoreScope,id:string,options?:{purpose?:'active'|'history'}):EngineMapping;
export function getConversation(db:Database.Database,scope:WorkspaceStoreScope,id:string):ContextRow&{revision:number;archived:boolean};
export function listConversations(db:Database.Database,scope:WorkspaceStoreScope,options?:{afterCreatedAt?:string;afterId?:string;limit?:number;includeArchived?:boolean}):ContextRow[];
export function listMessageSummaries(db:Database.Database,scope:WorkspaceStoreScope,id:string,options?:{afterSequence?:number;limit?:number}):ContextRow[];
export function retrieveMessages(db:Database.Database,scope:WorkspaceStoreScope,id:string,ids:string[]):{messages:ContextRow[];missingIds:string[]};
export function appendInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,input:AppendInput):{message:ContextRow;revision:number;idempotent:boolean};
export function checkpointInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,input:CheckpointInput):{checkpoint:ContextRow;revision:number;idempotent:boolean};
export function listCheckpoints(db:Database.Database,scope:WorkspaceStoreScope,id:string,options?:{beforeSequence?:number;limit?:number}):ContextRow[];
export function authorizeMaintenanceInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,input:{operation:'archive_conversation'|'unarchive_conversation'|'restore_checkpoint';checkpointId?:string;expectedRevision:number}):{confirmationToken:string;expiresAt:string};
export function archiveInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,input:{archived:boolean;expectedRevision:number;confirmationToken:string}):{archived:boolean;event:ContextRow};
export function restoreInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,checkpointId:string,input:{title?:string;metadata?:Record<string,unknown>;expectedRevision:number;confirmationToken:string;idempotencyKey?:string}):{conversation:ContextRow;checkpoint?:ContextRow;revision?:number;idempotent:boolean};
/** Original retained successful engine-turn response owner only; no browser content DTO. */
export function persistOriginalEngineTurnInTransaction(db:Database.Database,scope:WorkspaceStoreScope,id:string,input:{engineSessionId:string;userMessageId:string;assistantMessageId:string;userContent:string;assistantContent:string;expectedRevision:number}):{conversation:ContextRow;userMessage:ContextRow;assistantMessage:ContextRow;checkpoint:ContextRow;revision:number;idempotent:boolean};
export function deleteInTransaction():never;
export function forgetInTransaction():never;
export function searchMessageSummaries(db:Database.Database,scope:WorkspaceStoreScope,id:string,sanitizedQuery:string,limit?:number):ContextRow[];
