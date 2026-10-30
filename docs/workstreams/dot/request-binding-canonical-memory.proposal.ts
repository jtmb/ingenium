import { createHash } from "node:crypto";
import type { Request } from "express";
import type { toAuthorizationPrincipal } from "../authorization-policy.js";
import type { RequestPrincipal, AttestedCoordinationIdentity } from "../middleware/auth.js";
import type { Actor, Authorization, DotScope } from "../../../../packages/veyra-automation/contracts.js";
import type { CoreJob, CoreRun, CoreDotBindingPolicy, CoreDotExecution } from "./core-binding.js";
import type { DotQueueReader, DotRequestContext } from "./router.js";
import { DotError, type JobAuthority } from "./service.js";
import { existingJobsAuthority } from "./existing-jobs.js";
import { scopeKey } from "./repository.js";

export interface DotRequestSelection {projectId:string|null;workspaceId:string;runtimeId:string;chatId:string|null}
export interface RequestExecutionFacts {
  organizationId:string;ownerUserId:string;projectId:string|null;workspaceId:string;bindingHash:string;bindingEpoch:number;
  status:"authorized";runtimeId:string;mode:"runtime"|"native"|"compatibility";hostId:string;environmentId:string;available:true;
}
export interface RequestChatFacts extends RequestExecutionFacts {chatId:string;visibility:"private";engineSessionId:string}
interface CanonicalConversation {id:string;project_id:string;organization_id:string;owner_user_id:string|null;visibility:string;metadata:string}
interface ContextMessage {id:string;project_id:string;conversation_id:string;role:string;content:string;content_hash:string;metadata:string}
interface TrustedEvent {id:string;project_id:string;event_type:string;schema_version:number;producer:string;source_audit_event_id:string;created_at:string;payload:unknown}
interface MemoryScope {organizationId:string;ownerUserId:string;projectId:string|null;workspaceId:string;hostId:string;environmentId:string;bindingHash:string;bindingEpoch:number;visibility:"private"}
interface MemoryItem {id:string;version:number;contentHash:string;scope:MemoryScope;instructionAuthority:false;contentKind:"untrusted_memory_data"}
interface ExplicitMemoryItem {memory:{id:string;organizationId:string;ownerUserId:string;projectId:string;workspaceId:string;contentHash:string;version:number;state:string;visibility:string};instructionAuthority:false;contentKind:"untrusted_memory_data"}
export interface RequestDotMemorySession {
  resolveScope(permission:"read",chatId:string|null):MemoryScope;
  memory:{policy(scope:MemoryScope,chatId:string):{policy:{enabled:boolean;useMemory:boolean};chat:{useMemory:boolean}};recall(scope:MemoryScope,chatId:string,budget:{maxItems:number;maxTokens:number}):{items:MemoryItem[];excluded:boolean}};
}
export interface QualifiedDotRequestRunner {
  assertExecutionSupported(execution:RequestExecutionFacts,job:CoreJob):void;
  capabilitiesForJob(job:CoreJob):readonly string[]|null;
  killRunProcess(projectId:string,runId:string):boolean;
  inspectSettlement(execution:RequestExecutionFacts,run:CoreRun):"active"|"settled"|"unknown";
  executeJobRun(runId:string,job:CoreJob,prompt:string):Promise<void>;
}
export interface DotRequestAuthorities {
  revalidateRequestIdentity(request:Request):{principal:RequestPrincipal;attestation?:Readonly<AttestedCoordinationIdentity>}|null;
  resolveRequestExecution(request:Request,selection:Omit<DotRequestSelection,"chatId">):RequestExecutionFacts;
  resolveRequestChatBinding(request:Request,execution:RequestExecutionFacts,chatId:string):RequestChatFacts;
  toAuthorizationPrincipal(principal:RequestPrincipal):ReturnType<typeof toAuthorizationPrincipal>;
  requireProjectPermission(principal:ReturnType<typeof toAuthorizationPrincipal>,projectId:string,resource:string,permission:"read"|"write"|"execute"):{allowed:boolean;organizationId?:string;projectId?:string};
  requireCapabilities(principal:RequestPrincipal,execution:RequestExecutionFacts,capabilities:readonly string[]):void;
  getContextConversation(projectId:string,chatId:string):CanonicalConversation|undefined;
  getContextMessage(projectId:string,chatId:string,messageId:string):ContextMessage|undefined;
  getTrustedJobEvent(projectId:string,eventId:string):TrustedEvent|undefined;
  createRequestMemorySession(request:Request,selection:Omit<DotRequestSelection,"chatId">):RequestDotMemorySession;
  readExplicitMemory(scope:{organizationId:string;ownerUserId:string;projectId:string;workspaceId:string;allowProjectVisibility:false},id:string,visibility:"private"):ExplicitMemoryItem|undefined;
  jobs:{getJob(projectId:string,id:string):CoreJob|undefined;getJobRun(projectId:string,id:string):CoreRun|undefined;startJobRun(projectId:string,id:string,trigger:"cron",provenance:{scheduledFor:string;expectedScheduleRevision:number;sourceActor?:{type:"user"|"service";id:string}}):CoreRun|{reason:string};cancelJobRun(projectId:string,id:string):unknown};
  bindings:{hasOtherLiveBinding(projectId:string,jobId:string,scope:DotScope):boolean;hasJobBinding(projectId:string,jobId:string,scope:DotScope):boolean;hasRunBinding(projectId:string,runId:string,jobId:string,scope:DotScope):boolean};
  listJobEventDeliveries(projectId:string,options:{limit:number;cursor?:string}):{data:{id:string;job_id:string;state:string}[];nextCursor:string|null};
  runner:QualifiedDotRequestRunner;
}
interface SourceReference {v:1;id:string;hash:string;chatId?:string;memoryKind?:"explicit"|"derived";version?:number}
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const text=(value:unknown,max=256):value is string=>typeof value==="string"&&value.length>0&&value.length<=max;
const hash=(value:unknown):value is string=>typeof value==="string"&&value.length===64&&[...value].every(c=>"0123456789abcdef".includes(c));
export function dotSourceReference(input:Omit<SourceReference,"v">):string {
  const value={v:1 as const,id:input.id,hash:input.hash,...(input.chatId?{chatId:input.chatId}:{}),...(input.memoryKind?{memoryKind:input.memoryKind,version:input.version}:{})};
  if(!text(value.id,128)||!hash(value.hash)||(value.chatId!==undefined&&!text(value.chatId))||(value.memoryKind!==undefined&&(!["explicit","derived"].includes(value.memoryKind)||!Number.isSafeInteger(value.version)||value.version!<1)))throw new DotError("DOT_VALIDATION");
  const serialized=JSON.stringify(value);if(serialized.length>512)throw new DotError("DOT_VALIDATION");return serialized;
}
function sourceReference(value:string):SourceReference {
  try{if(!text(value,512))throw Error();const parsed=JSON.parse(value);if(parsed.v!==1 || dotSourceReference(parsed)!==value)throw Error();return parsed;}catch{throw new DotError("DOT_SOURCE_REVOKED");}
}
function executionAxes(value:RequestExecutionFacts|RequestChatFacts):unknown[] {return [value.organizationId,value.ownerUserId,value.projectId,value.workspaceId,value.bindingHash,value.bindingEpoch,value.runtimeId,value.hostId,value.environmentId];}
function memoryKey(scope:MemoryScope):string{return JSON.stringify([scope.organizationId,scope.ownerUserId,scope.projectId,scope.workspaceId,scope.bindingHash,scope.bindingEpoch,scope.hostId,scope.environmentId,scope.visibility]);}
export function dotExecutionFingerprint(execution:RequestExecutionFacts,sessionId:string|null=null):string {return sha(JSON.stringify(["veyra-dot-request-v1",...executionAxes(execution),execution.mode,sessionId]));}
export function dotEventDigest(event:TrustedEvent,sessionId:string):string {return sha(JSON.stringify([event.id,event.project_id,event.event_type,event.schema_version,event.producer,event.source_audit_event_id,event.created_at,event.payload,sessionId]));}

/** Request-local composition: every action reuses and rechecks the existing identity/execution owners. */
export function createRequestDotBinding(request:Request,selected:DotRequestSelection,ports:DotRequestAuthorities) {
  if(!selected || (selected.projectId!==null&&!text(selected.projectId)) || !text(selected.workspaceId)||!text(selected.runtimeId)||(selected.chatId!==null&&!text(selected.chatId)))throw new DotError("DOT_VALIDATION");
  const selection={projectId:selected.projectId,workspaceId:selected.workspaceId,runtimeId:selected.runtimeId};
  const selectedChat=selected.chatId;
  type Identity=NonNullable<ReturnType<DotRequestAuthorities["revalidateRequestIdentity"]>>;
  const identity=():Identity=>{
    const current=ports.revalidateRequestIdentity(request);
    if(!current || (current.principal.type!=="user"&&current.principal.type!=="service"))throw new DotError("DOT_REQUEST_UNAUTHENTICATED");
    const p=current.principal;
    if(p.type==="service" && (!current.attestation || current.attestation.credentialId!==p.tokenId || current.attestation.workspaceId!==selection.workspaceId || p.workspaceId!==selection.workspaceId || current.attestation.storageMappingHash!==p.storageMappingHash))throw new DotError("DOT_FORBIDDEN");
    return current;
  };
  const identityKey=(value:Identity)=>{const p=value.principal;return JSON.stringify([p.type,p.id,"tokenId" in p?p.tokenId:null,p.type==="user"?p.session?.id:null,[...p.scopes].sort(),"organizationId" in p?p.organizationId:null,"projectId" in p?p.projectId:null,"projectIds" in p?p.projectIds:null,value.attestation??null]);};
  const permission=(p:RequestPrincipal,e:RequestExecutionFacts,resource:string,action:"read"|"write"|"execute")=>{
    if(!e.projectId)throw new DotError("DOT_PROJECTLESS_UNBOUND");
    const decision=ports.requireProjectPermission(ports.toAuthorizationPrincipal(p),e.projectId,resource,action);
    if(!decision.allowed||decision.organizationId!==e.organizationId)throw new DotError("DOT_FORBIDDEN");
  };
  const chat=(p:RequestPrincipal,e:RequestExecutionFacts,id:string)=>{
    permission(p,e,"context","read");
    const bound=ports.resolveRequestChatBinding(request,e,id);
    if(!bound || bound.available!==true||bound.visibility!=="private"||bound.chatId!==id||JSON.stringify(executionAxes(bound))!==JSON.stringify(executionAxes(e)))throw new DotError("DOT_REQUEST_BINDING_CHANGED");
    const record=ports.getContextConversation(e.projectId!,id);
    if(!record||record.id!==id||record.project_id!==e.projectId||record.organization_id!==e.organizationId||record.owner_user_id!==e.ownerUserId||record.visibility!=="private")throw new DotError("DOT_SOURCE_REVOKED");
    let metadata:Record<string,unknown>;try{metadata=JSON.parse(record.metadata);}catch{throw new DotError("DOT_SOURCE_REVOKED");}
    if(metadata.source!=="opencode-chat"||metadata.sourceRuntimeId!==e.runtimeId||!text(metadata.sourceSessionId)||bound.engineSessionId!==metadata.sourceSessionId)throw new DotError("DOT_SOURCE_REVOKED");
    return {id,sessionId:metadata.sourceSessionId};
  };
  const resolve=()=>{
    const authenticated=identity(),p=authenticated.principal,e=ports.resolveRequestExecution(request,selection);
    if(!e||e.status!=="authorized"||e.available!==true||!["runtime","native","compatibility"].includes(e.mode)||!text(e.hostId)||!text(e.environmentId)||!hash(e.bindingHash)||!Number.isSafeInteger(e.bindingEpoch)||e.bindingEpoch<0||e.workspaceId!==selection.workspaceId||e.runtimeId!==selection.runtimeId||e.projectId!==selection.projectId||!text(e.organizationId)||!text(e.ownerUserId))throw new DotError("DOT_EXECUTION_UNAVAILABLE");
    if(p.type==="user"&&p.id!==e.ownerUserId)throw new DotError("DOT_FORBIDDEN");
    permission(p,e,"jobs","read");
    const bound=selectedChat?chat(p,e,selectedChat):null;
    const scope:DotScope={organizationId:e.organizationId,ownerUserId:e.ownerUserId,projectId:e.projectId,executionBindingId:e.workspaceId,executionBindingFingerprint:dotExecutionFingerprint(e,bound?.sessionId??null),conversationId:selectedChat};
    return {authenticated,principal:p,execution:e,scope,actor:{id:e.ownerUserId,organizationId:e.organizationId} as Actor};
  };
  const initial=resolve(),initialIdentity=identityKey(initial.authenticated),initialScope=scopeKey(initial.scope);
  const current=()=>{const value=resolve();if(identityKey(value.authenticated)!==initialIdentity||scopeKey(value.scope)!==initialScope)throw new DotError("DOT_REQUEST_BINDING_CHANGED");return value;};
  const requireScope=(actor:Actor,scope:DotScope)=>{const c=current();if(actor.id!==c.actor.id||actor.organizationId!==c.actor.organizationId||scopeKey(scope)!==scopeKey(c.scope))throw new DotError("DOT_FORBIDDEN");return c;};
  const memory=()=>{
    const c=current();if(!selectedChat)return null;
    permission(c.principal,c.execution,"memory","read");
    const engineSessionId=chat(c.principal,c.execution,selectedChat).sessionId;
    const session=ports.createRequestMemorySession(request,selection),scope=session.resolveScope("read",engineSessionId);
    if(scope.visibility!=="private"||JSON.stringify([scope.organizationId,scope.ownerUserId,scope.projectId,scope.workspaceId,scope.bindingHash,scope.bindingEpoch,scope.hostId,scope.environmentId])!==JSON.stringify([c.execution.organizationId,c.execution.ownerUserId,c.execution.projectId,c.execution.workspaceId,c.execution.bindingHash,c.execution.bindingEpoch,c.execution.hostId,c.execution.environmentId]))throw new DotError("DOT_REQUEST_BINDING_CHANGED");
    const policy=session.memory.policy(scope,engineSessionId);
    return policy.policy.enabled&&policy.policy.useMemory&&policy.chat.useMemory?{c,session,scope,engineSessionId}:null;
  };
  const authorization:Authorization={
    require(actor,scope,action,capabilities){const c=requireScope(actor,scope);permission(c.principal,c.execution,"jobs",action==="read"||action==="notify"?"read":action==="dispatch"?"execute":"write");if(action==="approve")permission(c.principal,c.execution,"jobs","execute");ports.requireCapabilities(c.principal,c.execution,capabilities);},
    canReadMemory(actor,scope){requireScope(actor,scope);return !!memory();},
    requireSource(actor,scope,source){
      const c=requireScope(actor,scope),ref=sourceReference(source.reference);
      if(source.kind==="user"){
        if(!ref.chatId || (selectedChat!==null&&ref.chatId!==selectedChat))throw new DotError("DOT_SOURCE_REVOKED");
        const canonical=chat(c.principal,c.execution,ref.chatId),message=ports.getContextMessage(c.execution.projectId!,ref.chatId,ref.id);
        if(!message||message.id!==ref.id||message.project_id!==c.execution.projectId||message.conversation_id!==ref.chatId||message.role!=="user"||message.content_hash!==ref.hash||sha(message.content)!==ref.hash)throw new DotError("DOT_SOURCE_REVOKED");
        let metadata:Record<string,unknown>;try{metadata=JSON.parse(message.metadata);}catch{throw new DotError("DOT_SOURCE_REVOKED");}
        if(metadata.source!=="opencode-chat"||metadata.sourceRuntimeId!==c.execution.runtimeId||metadata.sourceSessionId!==canonical.sessionId)throw new DotError("DOT_SOURCE_REVOKED");
      }else if(source.kind==="event"){
        const event=ports.getTrustedJobEvent(c.execution.projectId!,ref.id);
        if(!event||event.id!==ref.id||event.project_id!==c.execution.projectId||event.producer!=="context.maintenance"||event.schema_version!==1||!event.payload||typeof event.payload!=="object")throw new DotError("DOT_SOURCE_REVOKED");
        const payload=event.payload as Record<string,unknown>,id=payload.targetConversationId??payload.conversationId;
        if(!text(id)||(selectedChat!==null&&id!==selectedChat))throw new DotError("DOT_SOURCE_REVOKED");
        const canonical=chat(c.principal,c.execution,id);
        if(dotEventDigest(event,canonical.sessionId)!==ref.hash)throw new DotError("DOT_SOURCE_REVOKED");
      }else if(source.kind==="memory"){
        const admitted=memory();if(!admitted)throw new DotError("DOT_MEMORY_DISABLED");
        if(ref.memoryKind==="explicit"){
          const item=ports.readExplicitMemory({organizationId:admitted.scope.organizationId,ownerUserId:admitted.scope.ownerUserId,projectId:c.execution.projectId!,workspaceId:admitted.scope.workspaceId,allowProjectVisibility:false},ref.id,"private");
          const m=item?.memory;
          if(!item||item.instructionAuthority!==false||item.contentKind!=="untrusted_memory_data"||!m||m.id!==ref.id||m.state!=="active"||m.visibility!=="private"||m.organizationId!==c.scope.organizationId||m.ownerUserId!==c.scope.ownerUserId||m.projectId!==c.scope.projectId||m.workspaceId!==c.execution.workspaceId||m.version!==ref.version||m.contentHash!==ref.hash)throw new DotError("DOT_SOURCE_REVOKED");
        }else if(ref.memoryKind==="derived"){
          const page=admitted.session.memory.recall(admitted.scope,admitted.engineSessionId,{maxItems:16,maxTokens:2048}),item=page.items.find(m=>m.id===ref.id);
          if(page.excluded||!item||item.instructionAuthority!==false||item.contentKind!=="untrusted_memory_data"||item.version!==ref.version||item.contentHash!==ref.hash||memoryKey(item.scope)!==memoryKey(admitted.scope))throw new DotError("DOT_SOURCE_REVOKED");
        }else throw new DotError("DOT_SOURCE_REVOKED");
      }else throw new DotError("DOT_SOURCE_REVOKED");
    },
  };
  const visibleJob=(p:RequestPrincipal,value:CoreJob)=>value.visibility==="organization" || (value.visibility==="private"&&p.type==="user"&&value.owner_user_id===p.id);
  const job=(actor:Actor,scope:DotScope,id:string,action:"read"|"dispatch")=>{
    const c=requireScope(actor,scope);permission(c.principal,c.execution,"jobs",action==="dispatch"?"execute":"read");
    const value=ports.jobs.getJob(c.execution.projectId!,id);
    if(!value||!visibleJob(c.principal,value)||value.id!==id||value.project_id!==scope.projectId||value.organization_id!==scope.organizationId||(value.owner_kind==="user"&&value.owner_user_id!==scope.ownerUserId)||ports.bindings.hasOtherLiveBinding(value.project_id,id,scope))throw new DotError("DOT_FORBIDDEN");
    ports.runner.assertExecutionSupported(c.execution,value);
    const capabilities=ports.runner.capabilitiesForJob(value);if(!Array.isArray(capabilities)||capabilities.length>32||capabilities.some(capability=>!text(capability,128)))throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");
    ports.requireCapabilities(c.principal,c.execution,capabilities);
    return {c,value,capabilities:[...capabilities]};
  };
  const run=(scope:DotScope,id:string,action:"read"|"cancel")=>{
    const c=requireScope({id:scope.ownerUserId,organizationId:scope.organizationId},scope);permission(c.principal,c.execution,"jobs",action==="cancel"?"write":"read");
    const value=ports.jobs.getJobRun(c.execution.projectId!,id);
    if(!value||value.id!==id||value.project_id!==scope.projectId||value.organization_id!==scope.organizationId||!ports.bindings.hasRunBinding(value.project_id,id,value.job_id,scope))throw new DotError("DOT_FORBIDDEN");
    const currentJob=ports.jobs.getJob(value.project_id,value.job_id);
    if(!currentJob||currentJob.id!==value.job_id||currentJob.project_id!==scope.projectId||currentJob.organization_id!==scope.organizationId||!visibleJob(c.principal,currentJob)||(currentJob.owner_kind==="user"&&currentJob.owner_user_id!==scope.ownerUserId))throw new DotError("DOT_FORBIDDEN");
    ports.runner.assertExecutionSupported(c.execution,currentJob);return {c,value,job:currentJob};
  };
  const execution:CoreDotExecution={
    async executeJobRun(id,value,prompt){const admitted=run(current().scope,id,"read");if(value.id!==admitted.value.job_id)throw new DotError("DOT_RUN_BINDING_CHANGED");const fresh=job(admitted.c.actor,admitted.c.scope,value.id,"dispatch");if(fresh.value.revision!==admitted.value.job_revision||fresh.value.schedule_revision!==admitted.value.schedule_revision||fresh.value.service_principal_id!==admitted.value.effective_service_principal_id)throw new DotError("DOT_RUN_BINDING_CHANGED");if(fresh.value.revision!==value.revision||fresh.value.schedule_revision!==value.schedule_revision||fresh.value.prompt_template!==prompt)throw new DotError("DOT_JOB_BINDING_CHANGED");await ports.runner.executeJobRun(id,fresh.value,prompt);},
    requestCancellation(scope,value){const admitted=run(scope,value.id,"cancel"),state=ports.runner.inspectSettlement(admitted.c.execution,admitted.value);if(state==="settled"){if(admitted.value.status==="running"||admitted.value.status==="queued")ports.jobs.cancelJobRun(admitted.value.project_id,admitted.value.id);return;}ports.runner.killRunProcess(admitted.value.project_id,admitted.value.id);},
    inspectOwnedRun(scope,value){const admitted=run(scope,value.id,"read"),state=ports.runner.inspectSettlement(admitted.c.execution,admitted.value);if(state==="active")return "running";if(state!=="settled"||admitted.value.status==="running"||admitted.value.status==="queued")return "unknown";return admitted.value.status==="timeout"?"failed":admitted.value.status;},
  };
  const bindingPolicy:CoreDotBindingPolicy={authorizeJob(actor,scope,value,action){const result=job(actor,scope,value.id,action);if(result.value.revision!==value.revision)throw new DotError("DOT_JOB_BINDING_CHANGED");return {scope:result.c.scope,capabilities:result.capabilities};},authorizeRun(actor,scope,value,action){requireScope(actor,scope);run(scope,value.id,action);}};
  const adaptedJobs=existingJobsAuthority({resolveAuthorizedBinding(actor,scope,id){const j=job(actor,scope,id,"read");return {id:j.value.id,scope:j.c.scope,revision:j.value.revision,scheduleRevision:j.value.schedule_revision,prompt:j.value.prompt_template,enabled:j.value.enabled,cron:j.value.schedule_cron??null,capabilities:j.capabilities};},startJobRun(projectId,id,trigger,provenance){const c=current(),j=job(c.actor,c.scope,id,"dispatch");if(j.value.project_id!==projectId||j.value.schedule_revision!==provenance.expectedScheduleRevision)throw new DotError("DOT_JOB_BINDING_CHANGED");return ports.jobs.startJobRun(projectId,id,trigger,{...provenance,sourceActor:{type:c.principal.type==="service"?"service":"user",id:c.principal.id}});},cancelOwnedRun(scope,id){const r=run(scope,id,"cancel");execution.requestCancellation(scope,r.value);},inspectOwnedRun(scope,id){const r=run(scope,id,"read");return execution.inspectOwnedRun(scope,r.value);}});
  const jobs:JobAuthority={...adaptedJobs,claim(bound,scheduledFor,policy){const c=current(),fresh=job(c.actor,c.scope,bound.id,"dispatch");if(scopeKey(bound.scope)!==scopeKey(c.scope)||bound.revision!==fresh.value.revision||bound.scheduleRevision!==fresh.value.schedule_revision||bound.prompt!==fresh.value.prompt_template||fresh.capabilities.some(capability=>!bound.capabilities.includes(capability)))throw new DotError("DOT_JOB_BINDING_CHANGED");return adaptedJobs.claim(bound,scheduledFor,policy);}};
  const queue:DotQueueReader={page(context,after,limit){const c=requireScope(context.actor,context.scope);permission(c.principal,c.execution,"jobs","read");if(!Number.isInteger(limit)||limit<1||limit>100||typeof after!=="string"||after.length>512)throw new DotError("DOT_VALIDATION");const page=ports.listJobEventDeliveries(c.execution.projectId!,{limit,...(after?{cursor:after}:{})});const data=[];for(const item of page.data){if(!ports.bindings.hasJobBinding(c.execution.projectId!,item.job_id,c.scope))continue;const j=ports.jobs.getJob(c.execution.projectId!,item.job_id);if(!j||j.id!==item.job_id||j.project_id!==c.execution.projectId||!visibleJob(c.principal,j)||j.organization_id!==c.scope.organizationId||(j.owner_kind==="user"&&j.owner_user_id!==c.scope.ownerUserId))continue;data.push({id:item.id,state:item.state,projectId:c.execution.projectId!});}return {data,nextCursor:page.nextCursor};}};
  return {context:():DotRequestContext=>{const c=current();return {actor:c.actor,scope:c.scope};},authorization,bindingPolicy,jobs,execution,queue};
}
