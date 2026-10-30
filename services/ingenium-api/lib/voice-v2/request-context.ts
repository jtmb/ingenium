import {createHash} from 'node:crypto';
import type {Request} from 'express';
import {authorization,contextConversations,getDb,runtimes,type VoiceOperationAuthorities} from 'ingenium-core';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {revalidateRequestIdentity} from '../request-identity.js';
import {withManagedRequestPlacement} from '../runtime-placement.js';
import {inspectManagedRuntimeJobRole} from '../runtime-manager-client.js';
import {resolveRequestExecution,resolveRequestContextChatBinding,type RequestExecutionFacts} from '../projects-v2/request-execution.js';
import {isRequestChatConversationActive} from '../projects-v2/request-chat-source.mjs';
import {opencodeClient,isOpenCodeError} from '../opencode-client.js';
import {withOpenCodeRuntimeTarget} from '../runtime-opencode-context.js';
import {sameScope,type VoiceScope} from '../../../../packages/veyra-voice/session.mjs';
import {ManagedCpuSupervisor,type SupervisedCpuScope} from './managed-supervisor.mjs';

declare const contextBrand:unique symbol;
export interface HostedVoiceRequestContext {readonly [contextBrand]:true}
export interface HostedVoiceSelection {projectId:string;workspaceId:string;runtimeId:string;contextConversationId:string;agentId:string}
type RecordContext={request:Request;selection:Readonly<HostedVoiceSelection>;scope:Readonly<VoiceScope>;execution:Readonly<RequestExecutionFacts>;backendId:string;startIdentity:string;sessionId:string;authSessionId:string;deadlineAt:number;resource?:{scope:SupervisedCpuScope<HostedVoiceRequestContext>;producer:ManagedCpuSupervisor<HostedVoiceRequestContext>}};
const contexts=new WeakMap<HostedVoiceRequestContext,RecordContext>();
const resourceContexts=new WeakMap<SupervisedCpuScope<HostedVoiceRequestContext>,WeakMap<HostedVoiceRequestContext,HostedVoiceRequestContext>>();
const fail=(code='VOICE_CONTEXT_UNAVAILABLE',status=503):never=>{throw Object.assign(Error(code),{code,status});};
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const axes=['organizationId','ownerUserId','projectId','workspaceId','bindingHash','bindingEpoch','mode','hostId','environmentId'] as const;
const revision=(e:RequestExecutionFacts,backendId:string,startIdentity:string)=>createHash('sha256').update(JSON.stringify(['veyra-voice-execution-v1',...axes.map(k=>e[k]),backendId,startIdentity])).digest('hex');
function original(context:HostedVoiceRequestContext):RecordContext {const record=contexts.get(context);if(!record)return fail();return record;}
function user(request:Request){const identity=revalidateRequestIdentity(request),p=identity?.principal;if(p?.type!=='user'||!p.session||p.id!==p.session.user_id)return fail('VOICE_UNAUTHENTICATED',401);return p;}
function privateChat(record:RecordContext){
 const p=user(record.request);if(p.id!==record.scope.actorId||p.id!==record.scope.accountId||p.session!.id!==record.authSessionId)return fail('VOICE_UNAUTHENTICATED',401);
 const chat=contextConversations.getContextConversation(record.selection.projectId,record.selection.contextConversationId);
 if(!chat||chat.project_id!==record.scope.projectId||chat.organization_id!==record.scope.organizationId||chat.owner_user_id!==p.id||chat.visibility!=='private')return fail('VOICE_FORBIDDEN',403);
 let metadata:Record<string,unknown>;try{metadata=JSON.parse(chat.metadata);}catch{return fail('VOICE_CONVERSATION_CHANGED',409);}
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||metadata.source!=='opencode-chat'||metadata.sourceRuntimeId!==record.scope.runtimeId||metadata.sourceSessionId!==record.sessionId)return fail('VOICE_CONVERSATION_CHANGED',409);
 if(!authorization.requireContentPermission(toAuthorizationPrincipal(p),{resourceType:'context_conversation',resourceId:chat.id,organizationId:chat.organization_id,projectId:chat.project_id,visibility:chat.visibility,ownerUserId:chat.owner_user_id},'read').allowed)return fail('VOICE_FORBIDDEN',403);
 if(!isRequestChatConversationActive((sql,parameters)=>getDb().prepare<string[]>(sql).get(...parameters) as {event_type:string}|undefined,chat.project_id,chat.id))return fail('VOICE_CONVERSATION_CHANGED',409);
 return p;
}
function liveFacts(record:RecordContext){
 const p=privateChat(record),runtime=runtimes.getRuntimeInstance(record.selection.runtimeId),workspace=runtimes.getAuthorizedWorkspace(record.selection.workspaceId);
 if(!runtime||!workspace||workspace.status!=='authorized'||runtime.id!==record.scope.runtimeId||runtime.backendContainerId!==record.backendId||runtime.backendName!==`ingenium-runtime-${runtime.id.replaceAll('-','')}`||runtime.ownerUserId!==p.id||runtime.organizationId!==record.scope.organizationId||runtime.projectId!==record.scope.projectId||runtime.workspaceId!==workspace.id||workspace.ownerUserId!==p.id||workspace.organizationId!==runtime.organizationId||workspace.projectId!==runtime.projectId||workspace.securityEpoch!==runtime.securityEpoch||workspace.storageMappingHash!==record.execution.bindingHash||workspace.securityEpoch!==record.execution.bindingEpoch)return fail('VOICE_EXECUTION_CHANGED',409);
 return {p,runtime,workspace};
}
/** Read-only capture through the real user, private Context, manager and selected
 * engine session. No resource/model/agent operation is created by capture. */
export async function captureHostedVoiceRequest(request:Request,selected:HostedVoiceSelection):Promise<HostedVoiceRequestContext>{
 if(!selected||Object.keys(selected).sort().join()!==['projectId','workspaceId','runtimeId','contextConversationId','agentId'].sort().join()||Object.values(selected).some(v=>!text(v)))return fail('VOICE_SELECTION_INVALID',422);
 const selection=Object.freeze({...selected}),placement={projectId:selection.projectId,workspaceId:selection.workspaceId,runtimeId:selection.runtimeId};
 return withManagedRequestPlacement(request,placement,async()=>{
  const p=user(request),execution=resolveRequestExecution(request,placement),chat=resolveRequestContextChatBinding(request,execution,selection.contextConversationId);
  if(execution.mode!=='runtime'||execution.ownerUserId!==p.id)return fail('VOICE_FORBIDDEN',403);
  const runtime=runtimes.getRuntimeInstance(execution.runtimeId);if(!runtime||!hex(runtime.backendContainerId)||runtime.backendName!==`ingenium-runtime-${runtime.id.replaceAll('-','')}`)return fail();
  const raw=await inspectManagedRuntimeJobRole(runtime.id);if(!raw||typeof raw!=='object'||!('parent'in raw)||!raw.parent||typeof raw.parent!=='object'||!('schemaVersion'in raw)||raw.schemaVersion!==1||!('kind'in raw)||raw.kind!=='original-manager-core126-parent-v1'||!('expiresAt'in raw)||typeof raw.expiresAt!=='number'||!Number.isSafeInteger(raw.expiresAt)||!('observedAt'in raw)||typeof raw.observedAt!=='number'||!Number.isSafeInteger(raw.observedAt)||raw.observedAt>Date.now()||raw.expiresAt!==raw.observedAt+5000||raw.expiresAt<=Date.now()||!('daemonId'in raw)||typeof raw.daemonId!=='string'||!text(raw.daemonId)||!('hostId'in raw)||raw.hostId!==execution.hostId||raw.hostId!=='docker-daemon:'+createHash('sha256').update('veyra-docker-host-v1\0'+raw.daemonId).digest('hex'))return fail();
  const parent=raw.parent;if(!('id'in parent)||parent.id!==runtime.backendContainerId||!('startIdentity'in parent)||!hex(parent.startIdentity)||!('runtimeId'in parent)||parent.runtimeId!==runtime.id||!('workspaceId'in parent)||parent.workspaceId!==execution.workspaceId||!('organizationId'in parent)||parent.organizationId!==execution.organizationId||!('projectId'in parent)||parent.projectId!==execution.projectId||!('ownerUserId'in parent)||parent.ownerUserId!==p.id||!('bindingHash'in parent)||parent.bindingHash!==execution.bindingHash||!('bindingEpoch'in parent)||parent.bindingEpoch!==execution.bindingEpoch)return fail('VOICE_EXECUTION_CHANGED',409);
  const session=await withOpenCodeRuntimeTarget({baseUrl:`http://${runtime.backendName}:4098`,directory:'/workspace'},()=>opencodeClient.getSession(chat.engineSessionId,'/workspace'));
  if(isOpenCodeError(session)||session.id!==chat.engineSessionId||session.directory!=='/workspace'||session.agent!==selection.agentId)return fail('VOICE_AGENT_SELECTION_CHANGED',409);
  const startIdentity=parent.startIdentity,backendId=runtime.backendContainerId,expiresAt=raw.expiresAt,agentId=selection.agentId;
  return withManagedRequestPlacement(request,placement,()=>{
   const current=resolveRequestExecution(request,placement),currentChat=resolveRequestContextChatBinding(request,current,selection.contextConversationId);
   if(axes.some(k=>current[k]!==execution[k])||currentChat.engineSessionId!==chat.engineSessionId||Date.now()>=expiresAt)return fail('VOICE_EXECUTION_CHANGED',409);
   const scope=Object.freeze({actorId:p.id,accountId:p.id,organizationId:execution.organizationId,projectId:execution.projectId,conversationId:chat.engineSessionId,runtimeId:execution.runtimeId,executionBindingId:execution.workspaceId,executionRevision:revision(execution,backendId,startIdentity),agentId});
   const deadlineAt=Math.min(Date.now()+1800000,Date.parse(p.session!.idle_expires_at),Date.parse(p.session!.absolute_expires_at));if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())return fail('VOICE_UNAUTHENTICATED',401);
   const context=Object.freeze({}) as HostedVoiceRequestContext;const record={request,selection,scope,execution,backendId,startIdentity,sessionId:chat.engineSessionId,authSessionId:p.session!.id,deadlineAt};contexts.set(context,record);liveFacts(record);return context;
  });
 });
}
export function hostedVoiceRequestScope(context:HostedVoiceRequestContext):Readonly<VoiceScope>{const record=original(context);liveFacts(record);return record.scope;}
/** Bind only the actual supervisor's private scope. This grants no new action:
 * public ledger operations still revalidate user/runtime authority; private
 * retirement remains available through its original retained physical owner. */
export function bindHostedVoiceCpuContext(context:HostedVoiceRequestContext,scope:SupervisedCpuScope<HostedVoiceRequestContext>,producer:ManagedCpuSupervisor<HostedVoiceRequestContext>):HostedVoiceRequestContext{
 const record=original(context),existing=resourceContexts.get(scope)?.get(context);
 if(existing){const captured=original(existing);if(captured.resource?.producer!==producer||captured.resource.scope!==scope||!sameScope(scope.scope,record.scope))return fail('VOICE_ORIGINAL_RESOURCE_UNAVAILABLE');return existing;}
 if(!(producer instanceof ManagedCpuSupervisor)||!producer.isOwnedScope(scope)||!sameScope(scope.scope,record.scope))return fail('VOICE_ORIGINAL_RESOURCE_UNAVAILABLE');
 const bound=Object.freeze({}) as HostedVoiceRequestContext;contexts.set(bound,{...record,resource:{scope,producer}});let bindings=resourceContexts.get(scope);if(!bindings){bindings=new WeakMap();resourceContexts.set(scope,bindings);}bindings.set(context,bound);return bound;
}
export const currentHostedVoiceScope:VoiceOperationAuthorities<HostedVoiceRequestContext>['currentScope']=(context,scope)=>{
 const record=original(context),facts=liveFacts(record),resource=record.resource;if(!resource||!resource.producer.isOwnedScope(resource.scope)||scope&&!sameScope(scope,record.scope))return fail('VOICE_ORIGINAL_RESOURCE_UNAVAILABLE');
 return {scope:record.scope,authSessionId:record.authSessionId,workspaceId:facts.workspace.id,userSecurityEpoch:facts.p.session!.security_epoch,workspaceSecurityEpoch:facts.workspace.securityEpoch,runtimeSecurityEpoch:facts.runtime.securityEpoch,deadlineAt:Math.min(record.deadlineAt,resource.scope.deadlineAt),owner:resource.scope.owner,mode:'hosted',selectedConversationVerified:true};
};
export const requireHostedVoiceResource:VoiceOperationAuthorities<HostedVoiceRequestContext>['requireOriginalResource']=(context,operation,action,request)=>{
 const record=original(context),resource=record.resource;if(!resource||action!=='retireOriginal'&&!resource.producer.isOwnedScope(resource.scope)||operation&&(!sameScope(operation.original.scope,record.scope)||operation.original.kind.startsWith('voice-agent-')))return fail('VOICE_ORIGINAL_RESOURCE_UNAVAILABLE');
 return resource.producer.requireOriginalResource(context,operation,action,request);
};
export const verifyHostedVoiceRetirement:VoiceOperationAuthorities<HostedVoiceRequestContext>['verifyRetirement']=(context,operation,proof)=>{
 const record=original(context),resource=record.resource;if(!resource||!sameScope(operation.original.scope,record.scope)||operation.original.kind.startsWith('voice-agent-'))return fail('VOICE_ORIGINAL_RESOURCE_UNAVAILABLE');
 return resource.producer.verifyRetirement(context,operation,proof);
};
