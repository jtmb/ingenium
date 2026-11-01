import {decodeOriginalTranscriptionResult} from "./current-call-http-protocol.mjs";
import {sendOriginalAttachedPrompt} from "../opencode-client.js";
import {createActualAttachmentDeliveryOwner} from "./attachment-delivery-binding.js";
import type {AttachmentMetadata} from "./attachment-delivery-owner.mjs";
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {readOriginalCallSessionSelection,readOriginalRawAssistantMessage,takeOriginalRawAssistantRead,discardOriginalRawAssistantRead,openOriginalCallEventBody,type OriginalRawAssistantRead,type OriginalRawAssistantReadData} from '../opencode-client.js';
import {rawAssistantRange,type RawSessionSelection} from './raw-assistant-wire.mjs';
import {deriveAttachedVerbatimPlan,ATTACHED_SPEECH_POLICY_ID,ATTACHED_SPEECH_POLICY_SHA256,ATTACHED_SPEECH_SEGMENTER_SHA256} from './attached-verbatim-policy.mjs';
import {parseSelectedCallEvent,type SelectedCallEvent} from './attached-call-protocol.mjs';
import {inspectOriginalCallRuntimeJobRole} from '../runtime-manager-client.js';
import type {Request} from 'express';
import {authorization,contextConversations,getDb,runtimes,type VoiceOperationAuthorities,type OriginalAssistantPlanFacts,type OriginalAssistantDispatchFacts,type OriginalAssistantSourceInspectors} from 'ingenium-core';
import {toAuthorizationPrincipal} from '../authorization-policy.js';
import {revalidateRequestIdentity} from '../request-identity.js';
import {withManagedRequestPlacement} from '../runtime-placement.js';
import {inspectManagedRuntimeJobRole} from '../runtime-manager-client.js';
import {resolveRequestExecution,resolveRequestChatBinding,resolveRequestContextChatBinding,type RequestExecutionFacts} from '../projects-v2/request-execution.js';
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

export type VoiceAttachmentAction='read'|'speech'|'message'|'cancel-agent';
export function assertHostedVoiceAttachment(context:HostedVoiceRequestContext,scope:Readonly<VoiceScope>,action:VoiceAttachmentAction):void{
 if(!['read','speech','message','cancel-agent'].includes(action))return fail('VOICE_ATTACHMENT_ACTION_INVALID',422);
 const record=original(context),facts=liveFacts(record);
 if(!sameScope(scope,record.scope)||Date.now()>=record.deadlineAt)return fail('VOICE_EXECUTION_CHANGED',409);
 const permission=action==='message'||action==='cancel-agent'?'write':'read';
 const principal=toAuthorizationPrincipal(facts.p);
 if(!authorization.requireProjectPermission(principal,record.selection.projectId,'context',permission).allowed)return fail('VOICE_FORBIDDEN',403);
 const chat=contextConversations.getContextConversation(record.selection.projectId,record.selection.contextConversationId);
 if(!chat||!authorization.requireContentPermission(principal,{resourceType:'context_conversation',resourceId:chat.id,organizationId:chat.organization_id,projectId:chat.project_id,visibility:chat.visibility,ownerUserId:chat.owner_user_id},permission).allowed)return fail('VOICE_FORBIDDEN',403);
}

// APPEND to actual voice-v2/request-context.ts. Deliberately unavailable until
// original attachment incarnation + immutable plan owner is implemented there.
// Do NOT replace this refusal with a supplied callback, DTO/hash or role label.
declare const hostedAssistantObservationBrand:unique symbol;
export interface HostedAssistantObservation {readonly [hostedAssistantObservationBrand]:true}
export async function observeHostedAssistantSpeech(context:HostedVoiceRequestContext,messageId:string,signal:AbortSignal):Promise<HostedAssistantObservation> {
 const record=original(context);liveFacts(record);
 assertHostedVoiceAttachment(context,record.scope,'speech');signal.throwIfAborted();
 if(typeof messageId!=='string'||!/^msg_[A-Za-z0-9._:-]{1,123}$/u.test(messageId))return fail('VOICE_ASSISTANT_SELECTOR_INVALID',422);
 // Concrete missing ownership: this private record has no original call handle,
 // call generation or immutable redaction/profile/voice/segment plan. Reading
 // the engine now could not supply those facts. No request/network/Core write
 // or observation capability is made by this unavailable constructor.
 return fail('VOICE_ASSISTANT_CALL_PLAN_ORIGINAL_UNAVAILABLE');
}

// APPEND to actual request-context.ts. Imports specified in exact recipe.
// Requires CPU already opened by original production owner; starts no worker.
declare const currentAgentCallBrand:unique symbol;
export interface HostedCurrentAgentCall {readonly [currentAgentCallBrand]:true}
type CallCpu=NonNullable<RecordContext['resource']>;
type CallLease=ReturnType<CallCpu['producer']['captureAttachmentLease']>;
type CallResourceFacts=ReturnType<CallCpu['producer']['inspectAttachmentLease']>;
type SourcePlan={call:CallRecord;generation:number;metadata:Readonly<Record<string,unknown>>;texts:readonly string[];bytes:number};
type CallSub={controller:AbortController;open:Promise<ReadableStream<Uint8Array>>;reader:ReadableStreamDefaultReader<Uint8Array>|null;pending:Promise<unknown>|null;stop:Promise<void>|null;buffer:string;decoder:TextDecoder;total:number;stopped:boolean;failure:unknown};
type CallRecord={handle:HostedCurrentAgentCall;context:HostedVoiceRequestContext;resource:CallCpu;lease:CallLease;callId:string;instanceId:string;scope:Readonly<VoiceScope>;deadlineAt:number;generation:number;controller:AbortController;lifetime:AbortController;state:'opening'|'open'|'fencing'|'ending'|'ended';selection:RawSessionSelection|null;sessionSha256:string|null;physicalExpiresAt:number;profile:CallResourceFacts|null;work:Set<Promise<unknown>>;plans:Set<HostedAssistantObservation>;retainedBytes:number;plannedCount:number;seen:Map<string,{end:number;prefixSha256:string}>;planning:boolean;sub:CallSub|null;barge:Promise<unknown>|null;end:Promise<unknown>|null;failure:unknown;timer:ReturnType<typeof setTimeout>|null};
const currentAgentCalls=new WeakMap<HostedCurrentAgentCall,CallRecord>();
const activeCurrentAgentCalls=new Set<HostedCurrentAgentCall>();
const currentAgentPlans=new WeakMap<HostedAssistantObservation,SourcePlan>();
const callHash=(value:unknown)=>createHash('sha256').update(callCanonical(value)).digest('hex');
function callCanonical(value:unknown):string {
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(!value||typeof value!=='object')return fail('CALL_CANONICAL_INVALID',422);
 if(Array.isArray(value))return '['+value.map(callCanonical).join(',')+']';
 const record=value as Record<string,unknown>;return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+callCanonical(record[k])).join(',')+'}';
}
function currentCall(handle:HostedCurrentAgentCall):CallRecord {const value=currentAgentCalls.get(handle);if(!value)return fail('CALL_ORIGINAL_REQUIRED',403);return value;}
function callCurrent(call:CallRecord,allowOpening=false,allowFencing=false):CallResourceFacts {
 if(!['open',...(allowOpening?['opening']:[]),...(allowFencing?['fencing']:[])].includes(call.state)||call.deadlineAt<=Date.now())return fail('CALL_GENERATION_FENCED',409);
 const record=original(call.context),facts=liveFacts(record);
 assertHostedVoiceAttachment(call.context,call.scope,'speech');
 if(record.resource!==call.resource||!sameScope(record.scope,call.scope)||!['READY','IDLE'].includes(facts.runtime.state)
  ||!facts.runtime.leaseExpiresAt||!facts.runtime.absoluteExpiresAt||!Number.isFinite(Date.parse(facts.runtime.leaseExpiresAt))||!Number.isFinite(Date.parse(facts.runtime.absoluteExpiresAt))
  ||Date.parse(facts.runtime.leaseExpiresAt)<=Date.now()||Date.parse(facts.runtime.absoluteExpiresAt)<=Date.now())return fail('CALL_SOURCE_CHANGED',409);
 const resource=call.resource.producer.inspectAttachmentLease(call.lease),profile=call.profile;if(!profile)return fail('CALL_ORIGINAL_REQUIRED',403);
 if(resource.controlOperationId!==profile.controlOperationId||resource.profileDigest!==profile.profileDigest||resource.defaultVoice!==profile.defaultVoice
  ||callHash(resource.owner)!==callHash(profile.owner)||!sameScope(resource.scope,call.scope))return fail('CALL_CPU_ORIGINAL_CHANGED',409);
 return resource;
}
async function refreshCallPhysicalSource(call:CallRecord,allowOpening=false,signal:AbortSignal=call.lifetime.signal):Promise<void> {
 callCurrent(call,allowOpening,true);const record=original(call.context);
 const raw=await inspectOriginalCallRuntimeJobRole(call.scope.runtimeId,AbortSignal.any([call.lifetime.signal,signal]));
 callCurrent(call,allowOpening,true);
 if(!raw||typeof raw!=='object'||!('schemaVersion'in raw)||raw.schemaVersion!==1||!('kind'in raw)||raw.kind!=='original-manager-core126-parent-v1'
  ||!('observedAt'in raw)||typeof raw.observedAt!=='number'||!Number.isSafeInteger(raw.observedAt)||raw.observedAt>Date.now()
  ||!('expiresAt'in raw)||typeof raw.expiresAt!=='number'||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt!==raw.observedAt+5000||raw.expiresAt<=Date.now()
  ||!('daemonId'in raw)||typeof raw.daemonId!=='string'||!text(raw.daemonId)||!('hostId'in raw)||raw.hostId!==record.execution.hostId
  ||raw.hostId!=='docker-daemon:'+createHash('sha256').update('veyra-docker-host-v1\0'+raw.daemonId).digest('hex')
  ||!('parent'in raw)||!raw.parent||typeof raw.parent!=='object')return fail('CALL_SOURCE_ATTESTATION_CHANGED',409);
 const parent=raw.parent;
 if(!('id'in parent)||parent.id!==record.backendId||!('startIdentity'in parent)||parent.startIdentity!==record.startIdentity
  ||!('runtimeId'in parent)||parent.runtimeId!==call.scope.runtimeId||!('workspaceId'in parent)||parent.workspaceId!==record.selection.workspaceId
  ||!('organizationId'in parent)||parent.organizationId!==call.scope.organizationId||!('projectId'in parent)||parent.projectId!==call.scope.projectId
  ||!('ownerUserId'in parent)||parent.ownerUserId!==call.scope.actorId||!('bindingHash'in parent)||parent.bindingHash!==record.execution.bindingHash
  ||!('bindingEpoch'in parent)||parent.bindingEpoch!==record.execution.bindingEpoch)return fail('CALL_SOURCE_ATTESTATION_CHANGED',409);
 call.physicalExpiresAt=raw.expiresAt;
}
export function refreshHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<void> {
 const call=currentCall(handle);callCurrent(call);return retainCallWork(call,()=>refreshCallPhysicalSource(call));
}
function selectedCallTarget<T>(call:CallRecord,effect:()=>T):T {
 const facts=liveFacts(original(call.context));
 return withOpenCodeRuntimeTarget({baseUrl:`http://${facts.runtime.backendName}:4098`,directory:'/workspace'},effect);
}
function retainCallWork<T>(call:CallRecord,effect:()=>Promise<T>|T,signal:AbortSignal=call.lifetime.signal):Promise<T> {
 const generation=call.generation;
 // Publish the real pending Promise before its INTERNAL effect can start.
 // This closure never arrives from an HTTP caller or authorizes any scope.
 const promise=Promise.resolve().then(()=>{
  signal.throwIfAborted();
  if(call.generation!==generation||call.controller.signal.aborted||call.lifetime.signal.aborted||!['opening','open'].includes(call.state))
   throw Object.assign(Error('CALL_WORK_FENCED_BEFORE_START'),{code:'CALL_WORK_FENCED_BEFORE_START'});
  return effect();
 });
 call.work.add(promise);promise.catch(error=>{if(error&&typeof error==='object'&&'code'in error&&String(error.code).includes('CLEANUP_UNKNOWN'))call.failure=error;}).finally(()=>call.work.delete(promise));return promise;
}
function disposeCallPlans(call:CallRecord):void {
 for(const handle of call.plans){const plan=currentAgentPlans.get(handle);if(plan){plan.texts=[];plan.bytes=0;}currentAgentPlans.delete(handle);}
 call.plans.clear();call.retainedBytes=0;
}
/** Context is the actual bound record from producer.bindAttachmentContext;
 * never a supplied callId/profile/owner/callback. Root production composition
 * opens the original CPU resource first. This only leases that SAME resource.
 */
export async function openHostedCurrentAgentCall(context:HostedVoiceRequestContext,signal:AbortSignal):Promise<HostedCurrentAgentCall> {
 const record=original(context);assertHostedVoiceAttachment(context,record.scope,'speech');
 if(!(signal instanceof AbortSignal))return fail('CALL_SIGNAL_REQUIRED',422);signal.throwIfAborted();
 const resource=record.resource;if(!resource||!resource.producer.isOwnedScope(resource.scope))return fail('CALL_CPU_ORIGINAL_REQUIRED');
 if(activeCurrentAgentCalls.size>=16)return fail('CALL_CAPACITY',429);
 const callId=randomUUID(),instanceId=randomUUID(),deadlineAt=Math.min(record.deadlineAt,resource.scope.deadlineAt,Date.now()+1800000);
 const lease=resource.producer.captureAttachmentLease(context,resource.scope,callId,deadlineAt);
 const handle=Object.freeze({}) as HostedCurrentAgentCall;
 const call:CallRecord={handle,context,resource,lease,callId,instanceId,scope:record.scope,deadlineAt,generation:0,controller:new AbortController(),lifetime:new AbortController(),state:'opening',selection:null,sessionSha256:null,physicalExpiresAt:0,profile:null,work:new Set(),plans:new Set(),retainedBytes:0,plannedCount:0,seen:new Map(),planning:false,sub:null,barge:null,end:null,failure:null,timer:null};
 currentAgentCalls.set(handle,call);activeCurrentAgentCalls.add(handle);
 call.timer=setTimeout(()=>{void endHostedCurrentAgentCall(handle).catch(error=>{call.failure=error;});},Math.max(1,deadlineAt-Date.now()));call.timer.unref();
 const openingAbort=()=>call.lifetime.abort();signal.addEventListener('abort',openingAbort,{once:true});
 try{
  call.profile=resource.producer.inspectAttachmentLease(lease);call.deadlineAt=Math.min(call.deadlineAt,call.profile.deadlineAt);if(call.timer)clearTimeout(call.timer);call.timer=setTimeout(()=>{void endHostedCurrentAgentCall(handle).catch(error=>{call.failure=error;});},Math.max(1,call.deadlineAt-Date.now()));call.timer.unref();callCurrent(call,true);await retainCallWork(call,()=>refreshCallPhysicalSource(call,true));const combined=AbortSignal.any([signal,call.controller.signal]);
  const read=await retainCallWork(call,()=>selectedCallTarget(call,()=>readOriginalCallSessionSelection({sessionId:record.sessionId,agentId:record.scope.agentId,deadlineAt:Math.min(call.deadlineAt,Date.now()+10000),signal:combined})));
  try{await retainCallWork(call,()=>refreshCallPhysicalSource(call,true));callCurrent(call,true);combined.throwIfAborted();call.selection=read.selection;call.sessionSha256=read.sha256;call.state='open';return handle;}finally{read.raw.fill(0);}
 }catch(error){try{await endHostedCurrentAgentCall(handle);}catch(cleanup){call.failure=cleanup;const failure=Object.assign(Error('CALL_OPEN_CLEANUP_UNKNOWN'),{code:'CALL_OPEN_CLEANUP_UNKNOWN'});Object.defineProperty(failure,'originalCall',{value:handle});throw failure;}throw error;}finally{signal.removeEventListener('abort',openingAbort);}
}
export function inspectHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Readonly<Record<string,unknown>> {
 const call=currentCall(handle),profile=callCurrent(call);
 return Object.freeze({callId:call.callId,instanceId:call.instanceId,scope:call.scope,generation:call.generation,deadlineAt:call.deadlineAt,
  profileDigest:profile.profileDigest,voice:profile.defaultVoice,selection:call.selection,agentExecutionOwnedByCall:false,speechDispatchAvailable:call.resource.producer.status().ready,backend:call.resource.producer.status().backend});
}
/** Genuine raw reader is invoked INSIDE this fixed private owner. No returned
 * DTO, event text, hash, range, model/profile/voice or policy may be supplied.
 */
export function planHostedCurrentAgentSpeech(handle:HostedCurrentAgentCall,messageId:string,signal:AbortSignal):Promise<readonly HostedAssistantObservation[]> {
 const call=currentCall(handle);callCurrent(call);
 if(!(signal instanceof AbortSignal)||typeof messageId!=='string'||!/^msg_[A-Za-z0-9._:-]{1,123}$/u.test(messageId))return Promise.reject(Object.assign(Error('CALL_PLAN_INPUT'),{code:'CALL_PLAN_INPUT'}));
 if(call.planning)return Promise.reject(Object.assign(Error('CALL_PLAN_BUSY'),{code:'CALL_PLAN_BUSY'}));
 const generation=call.generation,combined=AbortSignal.any([signal,call.controller.signal]);combined.throwIfAborted();call.planning=true;
 const check=()=>{callCurrent(call);combined.throwIfAborted();if(call.generation!==generation)return fail('CALL_GENERATION_FENCED',409);};
 const task=retainCallWork(call,async()=>{
  let read:OriginalRawAssistantReadData|undefined,rawHandle:OriginalRawAssistantRead|undefined;
  try{
   check();await refreshCallPhysicalSource(call,false,combined);check();rawHandle=await selectedCallTarget(call,()=>readOriginalRawAssistantMessage({sessionId:call.scope.conversationId,messageId,agentId:call.scope.agentId,deadlineAt:Math.min(call.deadlineAt,Date.now()+10000),signal:combined}));
   // Consume genuine retained identity BEFORE revalidation; always dispose exact
   // raw arrays below, including failure/cancellation between read and plan.
   read=takeOriginalRawAssistantRead(rawHandle);rawHandle=undefined;check();await refreshCallPhysicalSource(call,false,combined);check();
   if(!call.selection||callHash(read.selection)!==callHash(call.selection))return fail('CALL_ENGINE_SELECTION_CHANGED',409);
   const staged:Array<{token:HostedAssistantObservation;plan:SourcePlan;seenKey:string;end:number;prefixSha256:string}>=[];
   let added=0;
   for(const part of read.assistant.parts){
    const seenKey=JSON.stringify([messageId,part.contentIndex]),previous=call.seen.get(seenKey),start=previous?.end??0;
    const originalBytes=Buffer.from(part.text);
    if(previous&&(originalBytes.length<start||createHash('sha256').update(originalBytes.subarray(0,start)).digest('hex')!==previous.prefixSha256))return fail('CALL_ASSISTANT_PREFIX_CHANGED',409);
    if(originalBytes.length===start)continue;
    const range=rawAssistantRange(part,start,originalBytes.length),derived=await deriveAttachedVerbatimPlan(range.text);check();
    const texts=Object.freeze(derived.segments.map(segment=>segment.text));added+=derived.projectedBytes;
    const facts=callCurrent(call),live=liveFacts(original(call.context)),sourceId=randomUUID();
    const metadata={version:1,sourceId,scope:call.scope,callId:call.callId,callInstanceId:call.instanceId,callGeneration:generation,turnGeneration:generation,speechTurnId:call.plannedCount+staged.length+1,
     engineSessionId:read.assistant.sessionId,engineMessageId:messageId,contentIndex:part.contentIndex,nativePartId:part.nativePartId,
     sessionBeforeSha256:read.sessionBeforeSha256,responseSha256:read.responseSha256,sessionAfterSha256:read.sessionAfterSha256,
     snapshotSha256:part.textSha256,snapshotBytes:originalBytes.length,utf8Start:start,utf8End:originalBytes.length,rangeSha256:range.rangeSha256,prefixSha256:range.prefixSha256,
     observedAt:read.observedAt,deadlineAt:call.deadlineAt,userEpoch:live.p.session!.security_epoch,workspaceEpoch:live.workspace.securityEpoch,runtimeEpoch:live.runtime.securityEpoch,controlOperationId:facts.controlOperationId,controlOwnerHash:callHash(facts.owner),profileDigest:facts.profileDigest,voice:facts.defaultVoice,
     policyId:derived.policyId,policyImplementationSha256:derived.policyImplementationSha256,segmenterImplementationSha256:derived.segmenterImplementationSha256,
     rawTextSha256:derived.rawTextSha256,rawBytes:derived.rawBytes,projectedSha256:derived.projectedSha256,projectedBytes:derived.projectedBytes,
     segments:derived.segments.map(({text:_text,...segment})=>Object.freeze(segment)),agentSettlementProof:false};
    const sourceHash=callHash(metadata),planHash=callHash({sourceHash,profileDigest:facts.profileDigest,voice:facts.defaultVoice,policyId:derived.policyId,policyImplementationSha256:derived.policyImplementationSha256,segmenterImplementationSha256:derived.segmenterImplementationSha256,projectedSha256:derived.projectedSha256,segments:metadata.segments}),token=Object.freeze({}) as HostedAssistantObservation;
    staged.push({token,plan:{call,generation,metadata:Object.freeze({...metadata,segments:Object.freeze(metadata.segments),sourceHash,planHash}),texts,bytes:derived.projectedBytes},seenKey,end:originalBytes.length,prefixSha256:range.prefixSha256});
   }
   await refreshCallPhysicalSource(call,false,combined);check();if(call.plans.size+staged.length>64||call.plannedCount+staged.length>256||call.retainedBytes+added>262144)return fail('CALL_PLAN_CAPACITY',429);
   for(const item of staged){currentAgentPlans.set(item.token,item.plan);call.plans.add(item.token);call.seen.set(item.seenKey,{end:item.end,prefixSha256:item.prefixSha256});call.retainedBytes+=item.plan.bytes;call.plannedCount++;}
   return Object.freeze(staged.map(item=>item.token));
  }finally{if(rawHandle)discardOriginalRawAssistantRead(rawHandle);read?.rawResponseBytes.fill(0);read?.sessionBeforeBytes.fill(0);read?.sessionAfterBytes.fill(0);}
 },combined);task.finally(()=>{call.planning=false;}).catch(()=>undefined);return task;
}
export function inspectHostedCurrentAgentPlan(callHandle:HostedCurrentAgentCall,planHandle:HostedAssistantObservation):Readonly<Record<string,unknown>> {
 const call=currentCall(callHandle),plan=currentAgentPlans.get(planHandle);callCurrent(call);
 if(call.physicalExpiresAt<=Date.now())return fail('CALL_SOURCE_ATTESTATION_EXPIRED',409);
 if(!plan||plan.call!==call||plan.generation!==call.generation||!call.plans.has(planHandle))return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 return plan.metadata;
}
/** Fixed Core ports over THESE actual private originals. Inspection data alone
 * cannot recreate a call, plan, CPU dispatch or source claim. */
export function inspectHostedAssistantSourceOriginal(context:HostedVoiceRequestContext,privatePlanHandle:object):OriginalAssistantPlanFacts {
 const plan=currentAgentPlans.get(privatePlanHandle as HostedAssistantObservation);
 if(!plan)return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 const call=plan.call,profile=callCurrent(call),held=original(call.context),fresh=original(context),facts=liveFacts(fresh),m=plan.metadata;
 assertHostedVoiceAttachment(context,call.scope,'speech');
 const segments=m.segments;
 if(!Array.isArray(segments)||segments.length!==plan.texts.length||segments.some(s=>!s||typeof s!=='object'||!('kind'in s)||!['tts','text-gap'].includes(s.kind)))return fail('CALL_SOURCE_ORIGINAL_CHANGED',409);
 if(call.physicalExpiresAt<=Date.now()||plan.generation!==call.generation||!call.plans.has(privatePlanHandle as HostedAssistantObservation)
  ||!sameScope(fresh.scope,call.scope)||fresh.authSessionId!==held.authSessionId||fresh.sessionId!==held.sessionId
  ||fresh.backendId!==held.backendId||fresh.startIdentity!==held.startIdentity||callHash(fresh.selection)!==callHash(held.selection)
  ||axes.some(k=>fresh.execution[k]!==held.execution[k])||fresh.resource?.scope!==call.resource.scope||fresh.resource?.producer!==call.resource.producer
  ||m.callId!==call.callId||m.callInstanceId!==call.instanceId||m.callGeneration!==call.generation||m.turnGeneration!==call.generation
  ||m.engineSessionId!==held.sessionId||m.controlOperationId!==profile.controlOperationId||m.profileDigest!==profile.profileDigest||m.voice!==profile.defaultVoice
  ||m.controlOwnerHash!==callHash(profile.owner)||m.userEpoch!==facts.p.session!.security_epoch||m.workspaceEpoch!==facts.workspace.securityEpoch||m.runtimeEpoch!==facts.runtime.securityEpoch
  ||typeof m.observedAt!=='number'||m.observedAt>Date.now()||typeof m.deadlineAt!=='number'||m.deadlineAt>call.deadlineAt||m.deadlineAt<=Date.now()
  ||m.policyId!==ATTACHED_SPEECH_POLICY_ID||m.policyImplementationSha256!==ATTACHED_SPEECH_POLICY_SHA256||m.segmenterImplementationSha256!==ATTACHED_SPEECH_SEGMENTER_SHA256)return fail('CALL_SOURCE_ORIGINAL_CHANGED',409);
 return {call:call.handle,plan:privatePlanHandle,metadata:m,authSessionId:fresh.authSessionId,backendId:fresh.backendId,startIdentity:fresh.startIdentity,owner:profile.owner,
  segments:plan.texts.map((s,index)=>({index,kind:segments[index]!.kind,textSha256:createHash('sha256').update(s).digest('hex'),bytes:Buffer.byteLength(s),characters:[...s].length}))};
}
export function inspectOriginalAssistantCallForFence(handle:object):{call:object;callId:string;callInstanceId:string;generation:number} {
 const call=currentAgentCalls.get(handle as HostedCurrentAgentCall);if(!call)return fail('CALL_ORIGINAL_REQUIRED',403);
 // Exact negative owner remains useful after auth/source loss, with no new grant.
 return {call:handle,callId:call.callId,callInstanceId:call.instanceId,generation:call.generation};
}
export function inspectHostedAssistantCpuDispatch(context:HostedVoiceRequestContext,opaqueDispatch:object):OriginalAssistantDispatchFacts {
 const record=original(context);liveFacts(record);const resource=record.resource;
 if(!resource||!resource.producer.isOwnedScope(resource.scope))return fail('CALL_CPU_ORIGINAL_REQUIRED',403);
 assertHostedVoiceAttachment(context,record.scope,'speech');const value=resource.producer.inspectOriginalAssistantCpuDispatch(context,opaqueDispatch);
 if(!sameScope(value.scope,record.scope)||!sameScope(value.scope,resource.scope.scope)||callHash(value.owner)!==callHash(resource.scope.owner))return fail('CALL_CPU_ORIGINAL_CHANGED',409);
 return value;
}
export const hostedOriginalAssistantSources:OriginalAssistantSourceInspectors<HostedVoiceRequestContext>=Object.freeze({inspectPlan:inspectHostedAssistantSourceOriginal,inspectDispatch:inspectHostedAssistantCpuDispatch,inspectCallForFence:inspectOriginalAssistantCallForFence});
/** Current-call speech assembly uses the retained actual CPU owner. Source ownership alone must
 * never be converted to a fake completed-agent row or a CPU dispatch. */
declare const attachedTtsBrand:unique symbol;
export interface HostedAttachedTts {readonly [attachedTtsBrand]:true}
type AttachedTts={call:CallRecord;generation:number;context:HostedVoiceRequestContext;started:boolean;failure?:unknown;dispatch:ReturnType<CallCpu['producer']['reserveAttachedAssistantCpu']>};
const attachedTts=new WeakMap<HostedAttachedTts,AttachedTts>();
const pendingTts=new WeakMap<CallRecord,Set<HostedAttachedTts>>();
function cancelAttachedTts(token:HostedAttachedTts):void {
 const held=attachedTts.get(token);if(!held)return;if(held.failure)throw held.failure;
 try{held.call.resource.producer.cancelPrepared(held.dispatch);}
 catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='CPU_ORIGINAL_DISPATCH_SPENT'){held.failure=error;throw error;}}
 pendingTts.get(held.call)?.delete(token);attachedTts.delete(token);
}
function fenceAttachedTts(call:CallRecord,reason:'BARGE_IN'|'END'):void {
 // Fence OLD generation before the caller increments it. Negative owner needs
 // no new auth grant. Keep cancellation originals on any cleanup failure.
 try{call.resource.producer.fenceOriginalAssistantSources(call.handle,reason);}catch(error){call.failure??=error;}
 for(const token of pendingTts.get(call)??[]){try{cancelAttachedTts(token);}catch(error){call.failure??=error;}}
}
export function prepareHostedCurrentAgentTts(callHandle:HostedCurrentAgentCall,planHandle:HostedAssistantObservation,grant:HostedCurrentCallRequest):HostedAttachedTts {
 const incoming=checkCurrentCallRequest(grant),call=currentCall(callHandle);
 if(incoming.call!==call)return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 inspectHostedCurrentAgentPlan(callHandle,planHandle);
 const plan=currentAgentPlans.get(planHandle)!;
 const producer=call.resource.producer,context=incoming.context;
 const claim=producer.reserveOriginalAssistantSource(context,planHandle);
 const text=plan.texts[claim.segmentIndex];
 const turnId=plan.metadata.speechTurnId;
 if(typeof turnId!=='number'||!Number.isSafeInteger(turnId)||turnId<1||typeof text!=='string')return fail('CALL_PLAN_ORIGINAL_REQUIRED',403);
 const dispatch=producer.reserveAttachedAssistantCpu({context,scope:call.scope,kind:'synthesize',text,voice:call.profile!.defaultVoice,
  requestId:claim.requestId,deadlineAt:call.deadlineAt,turn:{sessionId:call.callId,turnId,generation:call.generation,requestId:`voice:${call.callId}:${turnId}`}},claim);
 const token=Object.freeze({}) as HostedAttachedTts;
 attachedTts.set(token,{call,generation:call.generation,context,dispatch,started:false});
 let pending=pendingTts.get(call);if(!pending){pending=new Set();pendingTts.set(call,pending);}pending.add(token);
 try{producer.spendOriginalAssistantSource(context,claim,dispatch);return token;}
 catch(error){try{cancelAttachedTts(token);}catch(cleanup){call.failure??=cleanup;}throw error;}
}
export type HostedAttachedTtsResult=Awaited<ReturnType<CallCpu['producer']['executeCpu']>>;
export function executeHostedCurrentAgentTts(grant:HostedCurrentCallRequest,token:HostedAttachedTts,signal:AbortSignal):Promise<HostedAttachedTtsResult> {
 if(!(signal instanceof AbortSignal))return fail('CALL_SIGNAL_REQUIRED',422);
 const incoming=checkCurrentCallRequest(grant),held=attachedTts.get(token);
 if(!held||held.started||held.call!==incoming.call||held.generation!==incoming.call.generation)return fail('CALL_TTS_ORIGINAL_REQUIRED',403);
 held.started=true;
 const call=held.call,combined=AbortSignal.any([signal,call.controller.signal,call.lifetime.signal]);
 const work=retainCallWork(call,async()=>{
   checkCurrentCallRequest(grant);callCurrent(call);combined.throwIfAborted();
   const result=await call.resource.producer.executeCpu(held.dispatch,{signal:combined});
   await refreshHostedCurrentAgentCall(call.handle);
   checkCurrentCallRequest(grant);callCurrent(call);combined.throwIfAborted();return result;
 },combined);
 // Also join cleanup when enrollment rejects BEFORE entering its effect.
 const joined=work.finally(()=>{try{cancelAttachedTts(token);}catch(cleanup){call.failure??=cleanup;throw cleanup;}});
 call.work.add(joined);joined.catch(()=>undefined).finally(()=>call.work.delete(joined));return joined;
}
async function stopCallSubscription(sub:CallSub):Promise<void> {
 if(sub.stop)return sub.stop;sub.stopped=true;sub.controller.abort();
 sub.stop=(async()=>{let stream:ReadableStream<Uint8Array>;try{stream=await sub.open;}catch(error){if(error&&typeof error==='object'&&'code'in error&&String(error.code).includes('CLEANUP_UNKNOWN'))throw error;return;}
  if(sub.reader){await sub.reader.cancel();if(sub.pending)await Promise.allSettled([sub.pending]);sub.reader.releaseLock();sub.reader=null;}else await stream.cancel();sub.buffer='';
 })();return sub.stop;
}
function enrollCallSubscription(call:CallRecord,controller:AbortController):CallSub {
 // The microtask closes over sub only AFTER the actual slot is published.
 const sub:CallSub={controller,open:Promise.resolve().then(()=>{
  controller.signal.throwIfAborted();
  if(sub.stopped||call.sub!==sub||call.state!=='open'||call.lifetime.signal.aborted)
   throw Object.assign(Error('CALL_SUBSCRIPTION_FENCED_BEFORE_START'),{code:'CALL_SUBSCRIPTION_FENCED_BEFORE_START'});
  callCurrent(call);return selectedCallTarget(call,()=>openOriginalCallEventBody(controller.signal));
 }),reader:null,pending:null,stop:null,buffer:'',decoder:new TextDecoder('utf-8',{fatal:true}),total:0,stopped:false,failure:null};
 call.sub=sub;sub.open.catch(error=>{sub.failure=error;});return sub;
}
export async function openHostedCurrentAgentEvents(handle:HostedCurrentAgentCall):Promise<void> {
 const call=currentCall(handle);callCurrent(call);if(call.sub)return fail('CALL_SUBSCRIPTION_ORIGINAL_EXISTS',409);
 const sub=enrollCallSubscription(call,new AbortController());
 try{const stream=await sub.open;if(sub.stopped||call.state!=='open'){await stopCallSubscription(sub);return fail('CALL_GENERATION_FENCED',409);}callCurrent(call);sub.reader=stream.getReader();}
 catch(error){await stopCallSubscription(sub);throw error;}
}
export function nextHostedCurrentAgentEvent(handle:HostedCurrentAgentCall):Promise<SelectedCallEvent|null> {
 const call=currentCall(handle);callCurrent(call);const sub=call.sub;
 if(!sub?.reader||sub.stopped||sub.pending)return Promise.reject(Object.assign(Error('CALL_SUBSCRIPTION_ORIGINAL_REQUIRED'),{code:'CALL_SUBSCRIPTION_ORIGINAL_REQUIRED'}));
 const task=Promise.resolve().then(async()=>{try{for(;;){
  callCurrent(call,false,true);const boundary=sub.buffer.indexOf('\n\n');
  if(boundary>=0){const block=sub.buffer.slice(0,boundary);sub.buffer=sub.buffer.slice(boundary+2);const event=parseSelectedCallEvent(block,call.scope.conversationId,'/workspace');if(event){if(call.physicalExpiresAt<=Date.now())await refreshCallPhysicalSource(call);callCurrent(call,false,true);return event;}continue;}
  const result=await sub.reader!.read();if(sub.stopped)return null;callCurrent(call,false,true);
  if(result.done){sub.decoder.decode();if(sub.buffer) return fail('CALL_EVENT_TRUNCATED');return fail('CALL_EVENT_STREAM_ENDED');}
  if(!(result.value instanceof Uint8Array)||result.value.length>262144||(sub.total+=result.value.length)>16777216)return fail('CALL_EVENT_BOUND');
  sub.buffer=(sub.buffer+sub.decoder.decode(result.value,{stream:true})).replace(/\r\n/g,'\n');if(Buffer.byteLength(sub.buffer)>262144)return fail('CALL_EVENT_BOUND');
 }}catch(error){sub.failure=error;throw error;}finally{sub.pending=null;}});sub.pending=task;task.catch(()=>{void stopCallSubscription(sub).catch(error=>{call.failure=error;});});return task;
}
export function bargeInHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<unknown> {
 const call=currentCall(handle);if(call.state==='ending'||call.state==='ended')return call.end??Promise.resolve({state:call.state});if(call.barge)return call.barge;
 if(call.state!=='open')return fail('CALL_GENERATION_FENCED',409);fenceAttachedTts(call,'BARGE_IN');call.state='fencing';call.generation++;call.controller.abort();disposeCallPlans(call);
 call.barge=(async()=>{await Promise.allSettled([...call.work]);if(call.failure)throw call.failure;if(call.state==='fencing'){call.controller=new AbortController();call.state='open';try{callCurrent(call);}catch(error){call.state='fencing';throw error;}}
  return Object.freeze({callId:call.callId,generation:call.generation,state:call.state,agentExecutionOwnedByCall:false,speechDispatchAvailable:call.resource.producer.status().ready,backend:call.resource.producer.status().backend});
 })();call.barge.finally(()=>{call.barge=null;}).catch(()=>undefined);return call.barge;
}
export function endHostedCurrentAgentCall(handle:HostedCurrentAgentCall):Promise<unknown> {
 const call=currentCall(handle);if(call.end)return call.end;fenceAttachedTts(call,'END');call.state='ending';call.generation++;call.controller.abort();disposeCallPlans(call);if(call.timer)clearTimeout(call.timer);call.timer=null;
 call.lifetime.abort();call.end=(async()=>{const joins=await Promise.allSettled([...call.work,...(call.barge?[call.barge]:[]),...(call.sub?[stopCallSubscription(call.sub)]:[])]);
  const subscriptionJoin=call.sub?joins.at(-1):undefined;if(call.failure)throw call.failure;if(subscriptionJoin?.status==='rejected')throw subscriptionJoin.reason;
  await call.resource.producer.releaseAttachmentLease(call.lease);call.state='ended';call.seen.clear();activeCurrentAgentCalls.delete(handle);
  return Object.freeze({callId:call.callId,state:'ended',ownedReadsJoined:true,subscriptionJoined:!!call.sub,agentExecutionOwnedByCall:false,speechDispatchAvailable:false,backend:call.resource.producer.status().backend});
 })();call.end.catch(error=>{call.failure=error;});return call.end;
}

// APPEND inside actual request-context.ts. No public DTO authorizes a call.
declare const currentCallRequestBrand:unique symbol;
export interface HostedCurrentCallRequest {readonly [currentCallRequestBrand]:true}
type CallRequestRecord={request:Request;call:CallRecord;context:HostedVoiceRequestContext;generation:number};
const callRequests=new WeakMap<HostedCurrentCallRequest,CallRequestRecord>();

function checkCurrentCallRequest(value:HostedCurrentCallRequest,allowGenerationChange=false):CallRequestRecord {
 const grant=callRequests.get(value);if(!grant)return fail('CALL_REQUEST_ORIGINAL_REQUIRED',403);
 const {call,request,context}=grant,old=original(call.context),fresh=original(context);
 const principal=user(request);
 if(principal.id!==call.scope.actorId||principal.session!.id!==old.authSessionId
  ||fresh.request!==request||fresh.authSessionId!==old.authSessionId
  ||fresh.backendId!==old.backendId||fresh.startIdentity!==old.startIdentity||fresh.sessionId!==old.sessionId
  ||callHash(fresh.selection)!==callHash(old.selection)||!sameScope(fresh.scope,call.scope)
  ||axes.some(axis=>fresh.execution[axis]!==old.execution[axis])
  ||fresh.resource?.scope!==call.resource.scope||fresh.resource.producer!==call.resource.producer)
  return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 assertHostedVoiceAttachment(context,call.scope,'read');
 if(!allowGenerationChange&&grant.generation!==call.generation)return fail('CALL_REQUEST_GENERATION_CHANGED',409);
 return grant;
}

/** Called with THIS incoming admitted Express Request, never the opening Request.
 * Selection comes only from the private original call. Capturing it repeats the
 * actual cookie/session, placement, private chat->engine and manager checks.
 * Unsupported sessionless bearers fail through the existing user() owner.
 */
export async function captureHostedCurrentCallRequest(request:Request,handle:HostedCurrentAgentCall):Promise<HostedCurrentCallRequest> {
 const call=currentCall(handle),old=original(call.context);callCurrent(call);
 const principal=user(request);
 if(principal.id!==call.scope.actorId||principal.session!.id!==old.authSessionId)return fail('CALL_REQUEST_IDENTITY_CHANGED',403);
 const generation=call.generation;
 // Enroll before actual network capture; End joins this original as well.
 const context=await retainCallWork(call,()=>captureHostedVoiceRequest(request,{...old.selection}));
 const bound=bindHostedVoiceCpuContext(context,call.resource.scope,call.resource.producer);
 const grant=Object.freeze({}) as HostedCurrentCallRequest;
 callRequests.set(grant,{request,call,context:bound,generation});
 try{checkCurrentCallRequest(grant);await refreshHostedCurrentAgentCall(handle);checkCurrentCallRequest(grant);return grant;}
 catch(error){callRequests.delete(grant);throw error;}
}

/** Fixed operation set; no caller callbacks, owner facts, source DTOs or plans.
 * Router holds opaque grants and call handles privately; serialize only results.
 * Each NEW HTTP request captures a NEW grant. Drop it in the route's finally.
 */
export async function dispatchHostedCurrentCallRequest(grant:HostedCurrentCallRequest,operation:'status'|'barge-in'|'end'|'open-events'|'next-event'):Promise<unknown> {
 const {call}=checkCurrentCallRequest(grant),handle=call.handle;
 if(operation==='status'){callCurrent(call);return inspectHostedCurrentAgentCall(handle);}
 if(operation==='barge-in'){
  const result=await bargeInHostedCurrentAgentCall(handle);
  checkCurrentCallRequest(grant,true);return result;
 }
 if(operation==='end'){
  const result=await endHostedCurrentAgentCall(handle);
  // Authenticate THIS request after join without pretending the ended CPU
  // resource remains live. No speech/subscription effect follows this check.
  checkCurrentCallRequest(grant,true);return result;
 }
 if(operation==='open-events'){
  await openHostedCurrentAgentEvents(handle);checkCurrentCallRequest(grant);callCurrent(call);return null;
 }
 if(operation==='next-event'){
  const event=await nextHostedCurrentAgentEvent(handle);
  checkCurrentCallRequest(grant);callCurrent(call);return event;
 }
 return fail('CALL_REQUEST_OPERATION_INVALID',422);
}
export function releaseHostedCurrentCallRequest(grant:HostedCurrentCallRequest):void {callRequests.delete(grant);}

/** Cleanup authority is narrower than a current speech/read grant: only THIS
 * authenticated original owner/session may join End on its retained call. It
 * cannot read messages, plan speech, dispatch audio or cancel the agent. */
declare const currentCallCleanupBrand:unique symbol;
export interface HostedCurrentCallCleanupRequest {readonly [currentCallCleanupBrand]:true}
type CleanupRequestRecord={request:Request;call:CallRecord;promise?:Promise<unknown>};
const cleanupRequests=new WeakMap<HostedCurrentCallCleanupRequest,CleanupRequestRecord>();
function checkCleanupRequest(grant:HostedCurrentCallCleanupRequest):CleanupRequestRecord{
 const record=cleanupRequests.get(grant);if(!record)return fail('CALL_CLEANUP_REQUEST_ORIGINAL_REQUIRED',403);
 const principal=user(record.request),old=original(record.call.context);
 if(principal.id!==record.call.scope.actorId||principal.id!==record.call.scope.accountId||principal.session!.id!==old.authSessionId)return fail('CALL_CLEANUP_REQUEST_IDENTITY_CHANGED',403);
 return record;
}
export function captureHostedCurrentCallCleanupRequest(request:Request,handle:HostedCurrentAgentCall):HostedCurrentCallCleanupRequest{
 const call=currentCall(handle),grant=Object.freeze({}) as HostedCurrentCallCleanupRequest;cleanupRequests.set(grant,{request,call});try{checkCleanupRequest(grant);return grant;}catch(error){cleanupRequests.delete(grant);throw error;}
}
export function endHostedCurrentCallForRequest(grant:HostedCurrentCallCleanupRequest):Promise<unknown>{
 const record=checkCleanupRequest(grant);if(record.promise)return record.promise;
 record.promise=Promise.resolve().then(async()=>{checkCleanupRequest(grant);const result=await endHostedCurrentAgentCall(record.call.handle);checkCleanupRequest(grant);return result;});record.promise.catch(()=>undefined);return record.promise;
}
export function releaseHostedCurrentCallCleanupRequest(grant:HostedCurrentCallCleanupRequest):void{cleanupRequests.delete(grant);}
/** Read-only original authority check for the server's NEGATIVE cleanup watch.
 * No activity refresh, positive grant, CPU admission or engine/network effect. */
export function assertHostedCurrentAgentOriginAuthorized(handle:HostedCurrentAgentCall):void{
 const call=currentCall(handle),record=original(call.context);liveFacts(record);assertHostedVoiceAttachment(call.context,call.scope,'read');
}



/** Fresh authenticated current-call admission to the canonical engine inbox.
 * SQL132 identity is durable before the one send; retry reads the same receipt
 * and never replays an intent/unknown result. No agent execution is owned here. */
export function deliverHostedCurrentCallMessage(grant:HostedCurrentCallRequest,input:{requestId:string;text:string;delivery:'queue'|'steer'},signal:AbortSignal):Promise<AttachmentMetadata>{
 const {call,context}=checkCurrentCallRequest(grant);callCurrent(call);
 if(!input||Object.keys(input).sort().join()!=='delivery,requestId,text'||! /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.requestId)
  ||typeof input.text!=='string'||!input.text.trim()||[...input.text].length>2000||Buffer.byteLength(input.text)>8000||Buffer.from(input.text).toString()!==input.text
  ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.text)||!['queue','steer'].includes(input.delivery)||!(signal instanceof AbortSignal))return fail('CALL_MESSAGE_INPUT_INVALID',422);
 assertHostedVoiceAttachment(context,call.scope,'message');if(!call.selection)return fail('CALL_ENGINE_SELECTION_UNAVAILABLE',409);
 const selection=call.selection,originalMessageId='msg_veyra_call_'+callHash([call.scope,input.requestId]).slice(0,48),identity={scope:call.scope,requestId:input.requestId,kind:'message' as const,originalMessageId,inputHash:callHash([input.text,input.delivery,selection])},delivery=createActualAttachmentDeliveryOwner();
 return retainCallWork(call,async()=>{
  checkCurrentCallRequest(grant);callCurrent(call);assertHostedVoiceAttachment(context,call.scope,'message');signal.throwIfAborted();
  const reserved=delivery.reserve(context,identity);if(!reserved.fresh)return reserved.receipt;
  let ack:Awaited<ReturnType<typeof sendOriginalAttachedPrompt>>;
  try{
   checkCurrentCallRequest(grant);callCurrent(call);delivery.claim(reserved.handle);
   const combined=AbortSignal.any([signal,call.controller.signal,call.lifetime.signal]),deadlineAt=Math.min(Date.now()+10000,call.deadlineAt);
   ack=await selectedCallTarget(call,()=>sendOriginalAttachedPrompt({grant,selection,messageId:originalMessageId,text:input.text,delivery:input.delivery,deadlineAt,signal:combined}));
  }catch(error){
   // Negative private completion survives revocation. Preserve both failures;
   // do not mask a missing receipt with a resend or an inferred ACK.
   try{delivery.unknown(reserved.handle);}catch(receiptError){throw Object.assign(new AggregateError([error,receiptError],'CALL_MESSAGE_UNKNOWN_RECEIPT_FAILURE'),{code:error&&typeof error==='object'&&'code'in error&&String(error.code).includes('CLEANUP_UNKNOWN')?'CALL_MESSAGE_CLEANUP_UNKNOWN':'CALL_MESSAGE_UNKNOWN_RECEIPT_FAILURE'});}throw error;
  }
  // Deliberately outside the dispatch catch. If ACK persistence/checkpoint
  // fails after local commit, never overwrite it with unknown or mask failure.
  const receipt=delivery.acknowledge(reserved.handle,ack);checkCurrentCallRequest(grant);callCurrent(call);return receipt;
 },signal);
}

/** Fixed immediate dispatch checkpoint. Only the same private NEW-request grant
 * can reach the one original inbox POST after its asynchronous selection read. */
export function assertHostedCurrentCallMessageDispatch(grant:HostedCurrentCallRequest):void{
 const {call,context}=checkCurrentCallRequest(grant);callCurrent(call);assertHostedVoiceAttachment(context,call.scope,'message');
}


type CallTranscriptionResult=Readonly<{requestId:string;text:string;language:'en';durationMs:number;executionCompleted:false;agentSettlementProof:false}>;
const callTranscriptions=new WeakMap<CallRecord,Map<string,{inputHash:string;generation:number;work:Promise<CallTranscriptionResult>}>>();
/** One bounded utterance over the SAME actual call CPU owner. Results remain
 * private and bounded for this call's retries; no transcript/audio database. */
export function transcribeHostedCurrentCall(grant:HostedCurrentCallRequest,requestId:string,pcm:Uint8Array,signal:AbortSignal):Promise<CallTranscriptionResult>{
 const {call,context}=checkCurrentCallRequest(grant);callCurrent(call);assertHostedVoiceAttachment(context,call.scope,'speech');
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(requestId)||!(pcm instanceof Uint8Array)||pcm.length<8000||pcm.length>480000||pcm.length%2||!(signal instanceof AbortSignal))return fail('CALL_TRANSCRIPTION_INPUT_INVALID',422);
 const generation=call.generation,inputHash=createHash('sha256').update(pcm).digest('hex');let records=callTranscriptions.get(call);if(!records){records=new Map();callTranscriptions.set(call,records);}const prior=records.get(requestId);
 if(prior){if(prior.inputHash!==inputHash||prior.generation!==generation)return fail('CALL_TRANSCRIPTION_ORIGINAL_CONFLICT',409);return prior.work.then(result=>{checkCurrentCallRequest(grant);callCurrent(call);signal.throwIfAborted();return result;});}
 if(records.size>=128)return fail('CALL_TRANSCRIPTION_CAPACITY',429);const turnId=records.size+1,owned=Uint8Array.from(pcm),combined=AbortSignal.any([signal,call.controller.signal,call.lifetime.signal]);
 const work=retainCallWork(call,async()=>{
  let dispatch:ReturnType<CallCpu['producer']['reserveCpu']>|undefined,result:HostedAttachedTtsResult|undefined;
  try{
   checkCurrentCallRequest(grant);callCurrent(call);assertHostedVoiceAttachment(context,call.scope,'speech');combined.throwIfAborted();
   dispatch=call.resource.producer.reserveCpu({context,scope:call.scope,kind:'transcribe',pcm:owned,requestId:`stt:${call.callId}:${requestId}`,deadlineAt:Math.min(call.deadlineAt,Date.now()+60000),turn:{sessionId:call.callId,turnId,generation,requestId:`voice:${call.callId}:${turnId}`}});
   // No await between original reservation and execute custody. End/barge joins
   // the retained work; supervisor owns HTTP cancel/EOF/ledger physical joins.
   result=await call.resource.producer.executeCpu(dispatch,{signal:combined});
   await refreshHostedCurrentAgentCall(call.handle);checkCurrentCallRequest(grant);callCurrent(call);combined.throwIfAborted();
   const decoded=decodeOriginalTranscriptionResult(result,owned.length);return Object.freeze({requestId,...decoded,executionCompleted:false as const,agentSettlementProof:false as const});
  }finally{
   owned.fill(0);result?.bytes?.fill(0);
   if(dispatch){try{call.resource.producer.cancelPrepared(dispatch);}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='CPU_ORIGINAL_DISPATCH_SPENT'){call.failure??=error;throw error;}}}
  }
 },combined);const joined=work.finally(()=>owned.fill(0));call.work.add(joined);joined.catch(()=>undefined).finally(()=>call.work.delete(joined));records.set(requestId,{inputHash,generation,work:joined});return joined;
}


/** Resolve only the actual selected workspace/runtime/engine session through
 * existing private owners. No project-name/global-project fallback, no CPU or
 * agent action; begin repeats fresh authority rather than trusting this DTO. */
export async function resolveHostedCurrentCallSelection(request:Request,input:{workspaceId:string;runtimeId:string;engineSessionId:string}):Promise<Readonly<HostedVoiceSelection>>{
 if(!input||Object.keys(input).sort().join()!=='engineSessionId,runtimeId,workspaceId'||Object.values(input).some(v=>!text(v)))return fail('VOICE_SELECTION_INVALID',422);
 const p=user(request),workspace=runtimes.getAuthorizedWorkspace(input.workspaceId);
 if(!workspace||workspace.status!=='authorized'||workspace.ownerUserId!==p.id)return fail('VOICE_FORBIDDEN',403);
 if(workspace.projectId===null)return fail('VOICE_PROJECTLESS_CONTEXT_UNAVAILABLE',503);
 const placement={projectId:workspace.projectId,workspaceId:workspace.id,runtimeId:input.runtimeId};
 return withManagedRequestPlacement(request,placement,async()=>{
  const execution=resolveRequestExecution(request,placement),chat=resolveRequestChatBinding(request,execution,input.engineSessionId),runtime=runtimes.getRuntimeInstance(input.runtimeId);
  if(!runtime||runtime.ownerUserId!==p.id||runtime.workspaceId!==workspace.id||runtime.projectId!==workspace.projectId||runtime.organizationId!==workspace.organizationId||!hex(runtime.backendContainerId)||runtime.backendName!==`ingenium-runtime-${runtime.id.replaceAll('-','')}`)return fail('VOICE_EXECUTION_CHANGED',409);
  const session=await withOpenCodeRuntimeTarget({baseUrl:`http://${runtime.backendName}:4098`,directory:'/workspace'},()=>opencodeClient.getSession(chat.engineSessionId,'/workspace'));
  if(isOpenCodeError(session)||session.id!==chat.engineSessionId||session.directory!=='/workspace'||!text(session.agent))return fail('VOICE_AGENT_SELECTION_CHANGED',409);
  const selected=Object.freeze({projectId:workspace.projectId!,workspaceId:workspace.id,runtimeId:runtime.id,contextConversationId:chat.contextConversationId,agentId:session.agent});
  const context=await captureHostedVoiceRequest(request,selected);hostedVoiceRequestScope(context);return selected;
 });
}
