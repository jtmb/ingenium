import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequestDotBinding,dotSourceReference,dotEventDigest} from "../lib/dot-v2/request-binding.ts";
const sha=value=>createHash("sha256").update(value).digest("hex");
const rejects=(fn,code)=>assert.throws(fn,error=>error.code===code);
function fixture(options={}){
 const selected={projectId:"project",workspaceId:"workspace",runtimeId:"runtime",chatId:"chat"};
 const facts={organizationId:"org",ownerUserId:"owner",...selected,bindingHash:"a".repeat(64),bindingEpoch:1,status:"authorized",mode:"runtime",hostId:"host",environmentId:"env",available:true};delete facts.chatId;
 const principal={type:"user",id:"owner",scopes:["read","write","execute"],tokenId:"token",organizationId:"org",projectId:"project"};
 const state={identity:{principal},facts,chat:{id:"chat",project_id:"project",organization_id:"org",owner_user_id:"owner",visibility:"private",metadata:JSON.stringify({source:"opencode-chat",sourceRuntimeId:"runtime",sourceSessionId:"session"})},message:{id:"message",project_id:"project",conversation_id:"chat",role:"user",content:"Review this",content_hash:sha("Review this"),metadata:JSON.stringify({source:"opencode-chat",sourceRuntimeId:"runtime",sourceSessionId:"session"})},permissions:[],denied:new Set(),capabilities:["read"],capabilityDenied:false,jobBound:true,runBound:true,otherBinding:false,settlement:"active",kills:[],cancels:[],claims:[],launches:[],policyEnabled:true,chatMemory:true,recallExcluded:false,recall:[],explicit:undefined,queue:{data:[],nextCursor:null}};
 const job={id:"job",project_id:"project",organization_id:"org",owner_kind:"user",owner_user_id:"owner",visibility:"private",service_principal_id:"automation",agent:"agent",prompt_template:"Review this",timeout_minutes:1,revision:1,schedule_revision:2,enabled:true,schedule_cron:null};
 const run={id:"run",job_id:"job",project_id:"project",organization_id:"org",effective_service_principal_id:"automation",job_revision:1,schedule_revision:2,status:"running"};
 const scope={organizationId:"org",ownerUserId:"owner",projectId:"project",workspaceId:"workspace",hostId:"host",environmentId:"env",bindingHash:"a".repeat(64),bindingEpoch:1,visibility:"private"};
 const event={id:"event",project_id:"project",event_type:"context.summary.completed",schema_version:1,producer:"context.maintenance",source_audit_event_id:"audit",created_at:"2026-10-29T00:00:00Z",payload:{conversationId:"chat"}};
 const ports={
  revalidateRequestIdentity:()=>state.identity,
  resolveRequestExecution:(_request,selection)=>{assert.deepEqual(selection,{projectId:selected.projectId,workspaceId:selected.workspaceId,runtimeId:selected.runtimeId});return state.facts;},
  resolveRequestChatBinding:(_request,e,id)=>({...e,chatId:id,visibility:"private",engineSessionId:JSON.parse(state.chat.metadata).sourceSessionId}),
  toAuthorizationPrincipal:p=>p,
  requireProjectPermission(p,project,resource,permission){state.permissions.push({principal:p,project,resource,permission});return {allowed:!state.denied.has(resource+":"+permission),organizationId:"org",projectId:project};},
  requireCapabilities(p,e,caps){assert.equal(p,state.identity.principal);if(state.capabilityDenied)throw Object.assign(Error("Denied"),{code:"DOT_FORBIDDEN"});},
  getContextConversation:(_project,id)=>id===state.chat.id?state.chat:undefined,
  getContextMessage:(_project,_chat,id)=>id===state.message.id?state.message:undefined,
  getTrustedJobEvent:(_project,id)=>id===event.id?event:undefined,
  createRequestMemorySession:()=>({resolveScope:()=>scope,memory:{policy:()=>({policy:{enabled:state.policyEnabled,useMemory:true},chat:{useMemory:state.chatMemory}}),recall:()=>({items:state.recall,excluded:state.recallExcluded})}}),
  readExplicitMemory:()=>state.explicit,
  jobs:{getJob:(_p,id)=>id===job.id?job:undefined,getJobRun:(_p,id)=>id===run.id?run:undefined,startJobRun(p,id,trigger,provenance){state.claims.push({p,id,trigger,provenance});return run;},cancelJobRun(p,id){state.cancels.push({p,id});run.status="cancelled";}},
  bindings:{hasOtherLiveBinding:()=>state.otherBinding,hasJobBinding:()=>state.jobBound,hasRunBinding:()=>state.runBound},
  listJobEventDeliveries:()=>state.queue,
  runner:{assertExecutionSupported(){},capabilitiesForJob:()=>state.capabilities,killRunProcess(p,id){state.kills.push({p,id});return false;},inspectSettlement:()=>state.settlement,async executeJobRun(...args){state.launches.push(args);}},
 };
 Object.assign(selected,options.selected);if(options.service){state.identity={principal:{type:"service",id:"service",scopes:["jobs:read","jobs:write"],tokenId:"credential",organizationId:"org",projectId:"project",workspaceId:"workspace",storageMappingHash:"mapping"},attestation:{credentialId:"credential",workspaceId:"workspace",storageMappingHash:"mapping"}};}
 const request={body:{ownerUserId:"attacker",organizationId:"other",projectId:"forged",capabilities:["everything"]}};
 const binding=createRequestDotBinding(request,selected,ports),context=binding.context();
 const userSource=()=>({kind:"user",reference:dotSourceReference({id:state.message.id,hash:state.message.content_hash,chatId:"chat"})});
 return {state,ports,selected,job,run,event,scope,request,binding,context,userSource};
}
test("request body authority is ignored; lookup and trusted owner determine scope",()=>{
 const f=fixture();assert.equal(f.context.actor.id,"owner");assert.equal(f.context.scope.organizationId,"org");assert.equal(f.context.scope.executionBindingId,"workspace");assert.equal(f.context.scope.conversationId,"chat");
 f.binding.authorization.require(f.context.actor,f.context.scope,"approve",["read"]);
 assert.ok(f.state.permissions.some(p=>p.resource==="jobs"&&p.permission==="write"));assert.ok(f.state.permissions.some(p=>p.resource==="jobs"&&p.permission==="execute"));
 f.state.denied.add("jobs:execute");rejects(()=>f.binding.authorization.require(f.context.actor,f.context.scope,"approve",[]),"DOT_FORBIDDEN");
});
test("identity revocation and changed credential deny before claim",()=>{
 const f=fixture(),bound=f.binding.jobs.readAuthorizedJob(f.context.actor,f.context.scope,"job");f.state.identity=null;
 rejects(()=>f.binding.jobs.claim(bound,"2026-10-29T00:00:00Z","existing-grants-only"),"DOT_REQUEST_UNAUTHENTICATED");assert.equal(f.state.claims.length,0);
 const g=fixture();g.state.identity.principal.tokenId="replacement";rejects(()=>g.binding.context(),"DOT_REQUEST_BINDING_CHANGED");
});
test("execution and canonical session drift invalidate an existing request",()=>{
 for(const [key,value] of [["bindingHash","b".repeat(64)],["bindingEpoch",2],["hostId","other"],["environmentId","other"]]){const f=fixture();f.state.facts[key]=value;rejects(()=>f.binding.context(),"DOT_REQUEST_BINDING_CHANGED");}
 const f=fixture();f.state.chat.metadata=JSON.stringify({source:"opencode-chat",sourceRuntimeId:"runtime",sourceSessionId:"replacement"});rejects(()=>f.binding.context(),"DOT_REQUEST_BINDING_CHANGED");
 const g=fixture();g.state.facts.available=false;rejects(()=>g.binding.context(),"DOT_EXECUTION_UNAVAILABLE");
 const h=fixture();h.state.facts.ownerUserId="attacker";rejects(()=>h.binding.context(),"DOT_FORBIDDEN");
});
test("service requires attestation and keeps its actual policy identity",()=>{
 const f=fixture({service:true});f.job.owner_kind="organization";f.job.visibility="organization";
 f.binding.authorization.require(f.context.actor,f.context.scope,"approve",[]);assert.equal(f.state.permissions.at(-1).principal.type,"service");
 const bound=f.binding.jobs.readAuthorizedJob(f.context.actor,f.context.scope,"job");f.binding.jobs.claim(bound,"2026-10-29T00:00:00Z","existing-grants-only");assert.deepEqual(f.state.claims[0].provenance.sourceActor,{type:"service",id:"service"});
 f.job.visibility="private";rejects(()=>f.binding.jobs.readAuthorizedJob(f.context.actor,f.context.scope,"job"),"DOT_FORBIDDEN");
 const g=fixture({service:true});g.state.identity.attestation=undefined;rejects(()=>g.binding.context(),"DOT_FORBIDDEN");
});
test("exact job capability, revision, prompt and live scope are rechecked before claim",()=>{
 for(const mutate of [f=>f.job.revision++,f=>f.job.schedule_revision++,f=>f.job.prompt_template="new",f=>f.state.capabilities.push("send"),f=>f.state.otherBinding=true]){
  const f=fixture(),bound=f.binding.jobs.readAuthorizedJob(f.context.actor,f.context.scope,"job");mutate(f);assert.throws(()=>f.binding.jobs.claim(bound,"2026-10-29T00:00:00Z","existing-grants-only"));assert.equal(f.state.claims.length,0);
 }
 const f=fixture();f.state.capabilities=null;rejects(()=>f.binding.jobs.readAuthorizedJob(f.context.actor,f.context.scope,"job"),"DOT_CAPABILITIES_UNAVAILABLE");
});
test("user provenance needs canonical user role, immutable hash and matching engine session",()=>{
 const f=fixture();f.binding.authorization.requireSource(f.context.actor,f.context.scope,f.userSource());
 for(const mutate of [f=>f.state.message.role="assistant",f=>f.state.message.content="tampered",f=>f.state.message.metadata="{}",f=>f.state.chat.visibility="organization",f=>f.state.chat.owner_user_id="other"]){const g=fixture();mutate(g);rejects(()=>g.binding.authorization.requireSource(g.context.actor,g.context.scope,g.userSource()),"DOT_SOURCE_REVOKED");}
 const g=fixture();rejects(()=>g.binding.authorization.requireSource(g.context.actor,g.context.scope,{kind:"user",reference:"untrusted text"}),"DOT_SOURCE_REVOKED");
});
test("trusted events bind exact canonical chat and immutable event digest",()=>{
 const f=fixture(),source={kind:"event",reference:dotSourceReference({id:"event",hash:dotEventDigest(f.event,"session")})};f.binding.authorization.requireSource(f.context.actor,f.context.scope,source);
 f.event.payload.conversationId="other";rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");
 const g=fixture(),ref=dotSourceReference({id:"event",hash:dotEventDigest(g.event,"session")});g.event.created_at="new";rejects(()=>g.binding.authorization.requireSource(g.context.actor,g.context.scope,{kind:"event",reference:ref}),"DOT_SOURCE_REVOKED");
});
test("memory use needs current policy and exact explicit private version",()=>{
 const f=fixture();f.state.explicit={memory:{id:"memory",organizationId:"org",ownerUserId:"owner",projectId:"project",workspaceId:"workspace",contentHash:sha("memory"),version:1,state:"active",visibility:"private"},instructionAuthority:false,contentKind:"untrusted_memory_data"};
 const source={kind:"memory",reference:dotSourceReference({id:"memory",hash:sha("memory"),memoryKind:"explicit",version:1})};f.binding.authorization.requireSource(f.context.actor,f.context.scope,source);
 f.state.explicit.memory.version=2;rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");
 f.state.policyEnabled=false;assert.equal(f.binding.authorization.canReadMemory(f.context.actor,f.context.scope),false);rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_MEMORY_DISABLED");
 const g=fixture({selected:{chatId:null}});assert.equal(g.binding.authorization.canReadMemory(g.context.actor,g.context.scope),false);
});
test("derived memory requires recall eligibility, untrusted marker, version and exact execution axes",()=>{
 const f=fixture(),item={id:"memory",version:1,contentHash:sha("memory"),scope:{...f.scope},instructionAuthority:false,contentKind:"untrusted_memory_data"};f.state.recall=[item];
 const source={kind:"memory",reference:dotSourceReference({id:"memory",hash:sha("memory"),memoryKind:"derived",version:1})};f.binding.authorization.requireSource(f.context.actor,f.context.scope,source);
 item.scope.bindingEpoch=9;rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");item.scope.bindingEpoch=1;item.instructionAuthority=true;rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");item.instructionAuthority=false;f.state.recallExcluded=true;rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");
});
test("queue exposes only scoped metadata and preserves pagination when filtered",()=>{
 const f=fixture();f.state.queue={data:[{id:"delivery",job_id:"job",state:"pending",payload:"private",secret:"x"}],nextCursor:"next"};
 assert.deepEqual(f.binding.queue.page(f.context,"",20),{data:[{id:"delivery",state:"pending",projectId:"project"}],nextCursor:"next"});
 f.state.jobBound=false;assert.deepEqual(f.binding.queue.page(f.context,"",20),{data:[],nextCursor:"next"});f.state.identity=null;rejects(()=>f.binding.queue.page(f.context,"",20),"DOT_REQUEST_UNAUTHENTICATED");
});
test("cancel remains pending until real settlement, regardless of missing handle or DB cancellation",()=>{
 const f=fixture();f.binding.execution.requestCancellation(f.context.scope,f.run);assert.equal(f.state.kills.length,1);assert.equal(f.state.cancels.length,0);assert.equal(f.binding.execution.inspectOwnedRun(f.context.scope,f.run),"running");
 f.run.status="cancelled";f.state.settlement="unknown";assert.equal(f.binding.execution.inspectOwnedRun(f.context.scope,f.run),"unknown");f.state.settlement="settled";assert.equal(f.binding.execution.inspectOwnedRun(f.context.scope,f.run),"cancelled");
 const g=fixture();g.state.settlement="settled";g.binding.execution.requestCancellation(g.context.scope,g.run);assert.equal(g.state.cancels.length,1);assert.equal(g.state.kills.length,0);
});
test("foreign operation/run bindings cannot signal or inspect a process",()=>{
 const f=fixture();f.state.runBound=false;rejects(()=>f.binding.execution.requestCancellation(f.context.scope,f.run),"DOT_FORBIDDEN");rejects(()=>f.binding.execution.inspectOwnedRun(f.context.scope,f.run),"DOT_FORBIDDEN");assert.equal(f.state.kills.length,0);
});
test("source references reject injected fields and noncanonical encodings",()=>{
 const f=fixture(),source=f.userSource();source.reference=JSON.stringify({...JSON.parse(source.reference),ownerUserId:"other"});rejects(()=>f.binding.authorization.requireSource(f.context.actor,f.context.scope,source),"DOT_SOURCE_REVOKED");
});

test("launcher rejects a changed run grant revision or another job identity",async()=>{
 const f=fixture();await f.binding.execution.executeJobRun("run",f.job,f.job.prompt_template);assert.equal(f.state.launches.length,1);
 f.run.job_revision=2;await assert.rejects(f.binding.execution.executeJobRun("run",f.job,f.job.prompt_template),error=>error.code==="DOT_RUN_BINDING_CHANGED");assert.equal(f.state.launches.length,1);
 const g=fixture();await assert.rejects(g.binding.execution.executeJobRun("run",{...g.job,id:"other"},g.job.prompt_template),error=>error.code==="DOT_RUN_BINDING_CHANGED");assert.equal(g.state.launches.length,0);
});
