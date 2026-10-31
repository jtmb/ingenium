import type {Request} from 'express';
export interface WorkspaceExecutionSelection {projectId:null;workspaceId:string;runtimeId:string}
export interface WorkspaceExecutionFacts {projectId:null;organizationId:string;ownerUserId:string;workspaceId:string;runtimeId:string;bindingHash:string;bindingEpoch:number;executionGeneration:string;available:true}
export interface WorkspaceContextConversation {id:string;project_id:null;organization_id:string;owner_user_id:string;workspace_id:string;runtime_id:string;scope_kind:'workspace';binding_hash:string;binding_epoch:number;execution_generation:string;visibility:'private';title:string;metadata:string;tags:string;priority:number;created_at:string;revision?:number;archived?:boolean}
export interface WorkspaceContextMessage {id:string;project_id:null;conversation_id:string;sequence:number;role:'system'|'user'|'assistant'|'tool';content:string;content_hash:string;metadata:string;tags:string;priority:number;created_at:string}
export interface WorkspaceContextCheckpoint {id:string;project_id:null;conversation_id:string;sequence:number;through_message_id:string;message_count:number;state_hash:string;metadata:string;created_at:string}
export interface CreateWorkspaceContextInput {title:string;tags?:string[];priority?:number;metadata?:Record<string,unknown>;idempotencyKey?:string}
export interface AppendWorkspaceMessageInput {role:WorkspaceContextMessage['role'];content:string;expectedRevision:number;idempotencyKey?:string;tags?:string[];priority?:number;metadata?:Record<string,unknown>}
export interface WorkspaceCheckpointInput {expectedRevision:number;idempotencyKey?:string;metadata?:Record<string,unknown>;ragSourceIds?:never[]}
export interface WorkspaceMaintenanceInput {operation:'archive_conversation'|'unarchive_conversation'|'restore_checkpoint';checkpointId?:string;expectedRevision:number}
export interface WorkspaceMaintenanceAuthorization {operation:WorkspaceMaintenanceInput['operation'];conversationId:string;checkpointId:string|null;expectedRevision:number;confirmationToken:string;expiresAt:string}
export function getWorkspaceExecutionV2(request:Request,selection:WorkspaceExecutionSelection):WorkspaceExecutionFacts;
export function createWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection,input:CreateWorkspaceContextInput):{conversation:WorkspaceContextConversation;idempotent:boolean};
export function getWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection,id:string):WorkspaceContextConversation;
export function listWorkspaceContexts(request:Request,selection:WorkspaceExecutionSelection,options?:{afterCreatedAt?:string;afterId?:string;limit?:number;includeArchived?:boolean}):WorkspaceContextConversation[];
export function resolveWorkspaceEngineMapping(request:Request,selection:WorkspaceExecutionSelection,id:string,options?:{purpose?:'active'|'history'}):{contextConversationId:string;engineSessionId:string;runtimeId:string;executionGeneration:string;purpose:'active'|'history'};
export function listWorkspaceMessages(request:Request,selection:WorkspaceExecutionSelection,id:string,options?:{afterSequence?:number;limit?:number}):Omit<WorkspaceContextMessage,'content'>[];
export function retrieveWorkspaceMessages(request:Request,selection:WorkspaceExecutionSelection,id:string,ids:string[]):{messages:WorkspaceContextMessage[];missingIds:string[]};
export function appendWorkspaceMessage(request:Request,selection:WorkspaceExecutionSelection,id:string,input:AppendWorkspaceMessageInput):{message:WorkspaceContextMessage;revision:number;idempotent:boolean};
export function checkpointWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection,id:string,input:WorkspaceCheckpointInput):{checkpoint:WorkspaceContextCheckpoint;revision:number;idempotent:boolean};
export function listWorkspaceCheckpoints(request:Request,selection:WorkspaceExecutionSelection,id:string,options?:{beforeSequence?:number;limit?:number}):WorkspaceContextCheckpoint[];
export function authorizeWorkspaceContextMaintenance(request:Request,selection:WorkspaceExecutionSelection,id:string,input:WorkspaceMaintenanceInput):WorkspaceMaintenanceAuthorization;
export function archiveWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection,id:string,input:{archived:boolean;expectedRevision:number;confirmationToken:string}):{archived:boolean;event:Record<string,unknown>};
export function restoreWorkspaceCheckpoint(request:Request,selection:WorkspaceExecutionSelection,id:string,checkpointId:string,input:{title?:string;metadata?:Record<string,unknown>;expectedRevision:number;confirmationToken:string;idempotencyKey?:string}):{conversation:WorkspaceContextConversation;checkpoint?:WorkspaceContextCheckpoint;revision?:number;idempotent:boolean};
export function deleteWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection):never;
export function forgetWorkspaceContext(request:Request,selection:WorkspaceExecutionSelection):never;
export function searchWorkspaceMessages(request:Request,selection:WorkspaceExecutionSelection,id:string,query:string,limit?:number):(Omit<WorkspaceContextMessage,'content'>&{rank:number})[];
