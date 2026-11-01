/** Fixed private runtime memory read composition. Never impersonates a browser. */
import type {Request}from'express';
import {z}from'zod';
import {authorization,workspaceContext,workspaceRuntimeCredentialsV2}from'ingenium-core';
import {createCoreMemorySession,positionalCoreConnection}from'../memory-v2/core-session.js';
import {contextMemorySourceState}from'../memory-v2/source-state.mjs';
import {createCanonicalRecallSourceReader}from'../memory-v2/recall-availability.js';
import type {RecallReadView}from'../memory-v2/recall-availability.mjs';
import {MemoryError,scopeKey,type MemoryScope}from'../memory-v2/lifecycle.mjs';
import type {AuthenticatedExecution}from'../memory-v2/adapters.mjs';
import type {VerifiedOpenCodeMemoryOwner}from'../memory-v2/opencode-snapshot.mjs';
import type {WorkspaceContextConversation}from'./projectless-context.mjs';
import {createWorkspaceRequestChatResolver}from'./workspace-chat-binding.mjs';
import {resolveOriginalWorkspaceMcpFacts,withOriginalWorkspaceMcpPlacement}from'./workspace-mcp-identity.mjs';
const identifier=z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/).refine(v=>v===v.trim());
const policyInput=z.object({chatId:identifier}).strict(),recallInput=policyInput.extend({maxItems:z.number().int().min(1).max(16).optional(),maxTokens:z.number().int().min(1).max(2048).optional(),sourceOffset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-16).optional()}).strict();
const axes=['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch']as const;
function facts(request:Request){const value=resolveOriginalWorkspaceMcpFacts(request);if(!value.credential.scopes.includes('memory:read'))throw new MemoryError('FORBIDDEN');return value}
function actor(request:Request){const {credential:c}=facts(request);return {principal:{type:'service' as const,id:c.servicePrincipalId,tokenId:c.credentialId,organizationId:c.organizationId,projectId:null,projectIds:[],workspaceId:c.workspaceId,storageMappingHash:c.bindingHash,scopes:c.scopes},attestation:{credentialId:c.credentialId,workspaceId:c.workspaceId,storageMappingHash:c.bindingHash}}}
function snapshot<T>(request:Request,read:(f:ReturnType<typeof facts>)=>T):T{
 const first=facts(request),key=JSON.stringify([first.credential,first.execution]);
 const work=()=>{const before=facts(request);if(before.db!==first.db||JSON.stringify([before.credential,before.execution])!==key)throw new MemoryError('FORBIDDEN');workspaceContext.assertWorkspaceStoreScope(before.db,before.execution);const value=read(before);if(JSON.stringify([facts(request).credential,facts(request).execution])!==key)throw new MemoryError('FORBIDDEN');return value};
 return first.db.inTransaction?work():first.db.transaction(work).deferred();
}
const conversationSchema=z.object({id:z.string().uuid(),project_id:z.null(),organization_id:z.string().min(1).max(256),owner_user_id:z.string().min(1).max(256),workspace_id:z.string().min(1).max(256),runtime_id:z.string().uuid(),scope_kind:z.literal('workspace'),binding_hash:z.string().regex(/^[a-f0-9]{64}$/),binding_epoch:z.number().int().nonnegative(),execution_generation:z.string().regex(/^[a-f0-9]{64}$/),visibility:z.literal('private'),title:z.string().min(1).max(256),metadata:z.string(),tags:z.string(),priority:z.number().int().min(0).max(10),created_at:z.string().min(1).max(64),revision:z.number().int().nonnegative().optional(),archived:z.boolean().optional()}).passthrough();
function conversation(row:ReturnType<typeof workspaceContext.getConversation>):WorkspaceContextConversation{try{return conversationSchema.parse(row)}catch{throw new MemoryError('SOURCE_UNAVAILABLE')}}
function chatResolver(request:Request){return createWorkspaceRequestChatResolver({
 resolveExecution:(_request,selection)=>{const f=facts(request);if(selection.projectId!==null||selection.workspaceId!==f.execution.workspaceId||selection.runtimeId!==f.execution.runtimeId)throw new MemoryError('FORBIDDEN');return f.execution},
 findEngineContext:(_request,_selection,id,purpose='active')=>snapshot(request,f=>{const rows=f.db.prepare('SELECT conversation_id FROM context_conversation_sources WHERE project_id IS NULL AND workspace_id=? AND runtime_id=? AND execution_generation=? AND source_session_id=?').all(f.execution.workspaceId,f.execution.runtimeId,f.execution.executionGeneration,id)as{conversation_id:string}[];if(rows.length!==1)throw new MemoryError('SOURCE_UNAVAILABLE');const mapping=workspaceContext.resolveEngineMapping(f.db,f.execution,rows[0]!.conversation_id,{purpose});return {conversation:conversation(workspaceContext.getConversation(f.db,f.execution,mapping.contextConversationId)),mapping}}),
 getConversation:(_request,_selection,id)=>snapshot(request,f=>conversation(workspaceContext.getConversation(f.db,f.execution,id))),
 resolveMapping:(_request,_selection,id,options)=>snapshot(request,f=>workspaceContext.resolveEngineMapping(f.db,f.execution,id,options)),
})}
function session(request:Request,readAvailability:RecallReadView|null=null){const first=facts(request),resolveChat=chatResolver(request);return createCoreMemorySession({
 request,selected:{projectId:null,workspaceId:first.execution.workspaceId,runtimeId:first.execution.runtimeId},authenticate:actor,
 resolveExecution:()=>facts(request).execution,
 resolveProjectlessServiceScope:()=>{const f=facts(request);return {...f.execution,projectId:null,visibility:'private' as const,servicePrincipalId:f.credential.servicePrincipalId,credentialId:f.credential.credentialId}},
 resolveChatBinding:({execution,chatId,permission})=>resolveChat(request,execution,chatId,permission==='read-source'?'history':'active'),
 authorizeOperation:({principal,scope,execution,permission})=>{if(!['read','read-source'].includes(permission)||principal.type!=='service')return false;const f=facts(request),c=f.credential;if(principal.id!==c.servicePrincipalId||principal.tokenId!==c.credentialId||axes.some(k=>scope[k]!==f.execution[k]||execution[k]!==f.execution[k]))return false;return authorization.requireOrganizationPermission({type:'service-principal',id:c.servicePrincipalId,scopes:[...c.scopes],organizationId:c.organizationId,projectId:null,projectIds:[]},c.organizationId,'memory','read').allowed},
 resolveSourceState:({scope,execution,chatId,messageId,conversationId,contentHash})=>contextMemorySourceState({db:positionalCoreConnection(facts(request).db),scope,execution,chatId,messageId,conversationId,contentHash,readAvailability}),
})}
async function engineOwner(request:Request,expectedScope:MemoryScope,expectedExecution:AuthenticatedExecution,chatId:string):Promise<VerifiedOpenCodeMemoryOwner>{return withOriginalWorkspaceMcpPlacement(request,()=>{
 const f=facts(request),s=session(request),scope=s.resolveScope('read-source',chatId);if(scopeKey(scope)!==scopeKey(expectedScope)||axes.some(k=>expectedExecution[k]!==f.execution[k]))throw new MemoryError('FORBIDDEN');
 return Object.freeze({scope:Object.freeze({...scope}),execution:f.execution,ownerInstanceId:'managed-container:'+f.original.parentContainerId,directory:'/workspace',target:Object.freeze({baseUrl:`http://ingenium-runtime-${f.execution.runtimeId.replaceAll('-','')}:4098`,directory:'/workspace',authHeader:workspaceRuntimeCredentialsV2.workspaceRuntimeOpenCodeAuthV2(f.execution.runtimeId)})});
})}
export async function executeWorkspaceMcpMemoryTool(request:Request,name:string,arguments_:Record<string,unknown>){
 if(name==='ingenium_workspace_memory_policy'){const input=policyInput.parse(arguments_);return withOriginalWorkspaceMcpPlacement(request,()=>{const s=session(request),scope=s.resolveScope('read',input.chatId);return s.memory.policy(scope,input.chatId)})}
 if(name!=='ingenium_workspace_memory_read')throw new MemoryError('INVALID_INPUT');const input=recallInput.parse(arguments_);
 return withOriginalWorkspaceMcpPlacement(request,async()=>{
  const first=facts(request),bootstrap=session(request),scope=bootstrap.resolveScope('read',input.chatId),policy=bootstrap.memory.policy(scope,input.chatId);
  if(!policy.policy.enabled||!policy.policy.useMemory||!policy.chat.useMemory)return {items:[],omitted:[],excluded:true,usedTokens:0};
  const reader=createCanonicalRecallSourceReader({scope,execution:first.execution,getOwner:({scope,execution,chatId})=>engineOwner(request,scope,execution,chatId)});
  try{const current=session(request,reader.view),plan=current.memory.planSourceReads(scope,input.chatId,{offset:input.sourceOffset??0,limit:16,maxSources:32});const verified=await reader.prime(plan.sourceRefs);
   return await withOriginalWorkspaceMcpPlacement(request,()=>{const final=facts(request);if(final.original.parentContainerId!==first.original.parentContainerId||final.original.startIdentity!==first.original.startIdentity||scopeKey(current.resolveScope('read',input.chatId))!==scopeKey(scope))throw new MemoryError('SOURCE_UNAVAILABLE');const data=reader.withVerifiedSources(()=>current.memory.withSourceReadPlan(scope,input.chatId,plan,()=>current.memory.recall(scope,input.chatId,{maxItems:input.maxItems??16,maxTokens:input.maxTokens??2048})));return {...data,sourceWindow:{offset:plan.offset,scanned:plan.scanCount,hasMore:plan.hasMore,nextOffset:plan.hasMore?plan.offset+plan.limit:null,verifiedSources:verified.verifiedSources,unavailableSourceCount:verified.unavailableSources.length}}});
  }finally{reader.invalidate()}
 });
}
