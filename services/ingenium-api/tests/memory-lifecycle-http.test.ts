import { createHash,randomUUID } from "node:crypto";
import { basename,isAbsolute,join,relative } from "node:path";
import { mkdtempSync,realpathSync,statSync,writeFileSync } from "node:fs";
import { createServer,type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { customizeCatalog,authentication,contextConversations,getDb,identity,mcpCredentials,organizations,projects,resetDbForTest,runtimes,skills,skillGovernance,maintenanceLocks } from "ingenium-core";
import { config } from "../config/index.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import {createScopedCustomizeRouter} from "../lib/routes/customize-scoped.js";
import { createMemoryLifecycleRouter } from "../lib/routes/memory-lifecycle.js";
import { skillsRouter } from "../lib/routes/skills.js";
import { observeManagedRuntime } from "../lib/runtime-placement-contract.js";
import { createRequestMemorySession } from "../lib/memory-v2/request-session.js";
import { positionalCoreConnection } from "../lib/memory-v2/core-session.js";
import { MemoryLifecycle } from "../lib/memory-v2/lifecycle.mjs";
import { withManagedRequestPlacement } from "../lib/runtime-placement.js";
import { opencodeClient,type MessageEnvelope } from "../lib/opencode-client.js";

let admittedRequest:import("express").Request|undefined;
import * as manager from "../lib/runtime-manager-client.js";
let root="",directory="",origin="",sequence=0,server:Server;
let fixture:ReturnType<typeof setup>;
function setup(createChat=true){
 const index=++sequence,project=projects.createProject(`http-memory-${index}`),owner=identity.createUser(`http-memory-owner-${index}@example.test`,"Fixture owner"),other=identity.createUser(`http-memory-other-${index}@example.test`,"Other fixture owner");
 organizations.addOrganizationMember(project.organization_id,owner.id,"admin");organizations.addOrganizationMember(project.organization_id,other.id,"admin");
 const workspace=runtimes.authorizeWorkspace({id:`http-memory-workspace-${index}`,organizationId:project.organization_id,projectId:project.id,ownerUserId:owner.id,storagePath:join(directory,`workspace-${index}`)});
 let runtime=runtimes.createRuntimeInstance(workspace.id,{cpuMillis:1000,memoryBytes:536870912,pidsLimit:128,diskBytes:536870912,processLimit:64});
 const runtimeCredential=mcpCredentials.createMcpCredential({kind:"runtime",audience:"runtime",name:`HTTP runtime ${index}`,servicePrincipalName:`HTTP runtime principal ${index}`,scopes:["child-mcp:runtime","projects:read"],organizationId:project.organization_id,projectId:project.id,workspaceId:workspace.id,launcherWorktree:workspace.storagePath,expiresAt:new Date(Date.now()+600000),createdByUserId:owner.id});
 runtimes.bindRuntimeCapability(runtime.id,runtimeCredential.id);
 for(const state of ["PROVISIONING","STARTING","READY","IDLE"] as const)runtime=runtimes.transitionRuntime({id:runtime.id,expectedRevision:runtime.revision,toState:state,backendContainerId:"b".repeat(64),actorType:"system",actorId:"http-memory-fixture",idleExpiresAt:new Date(Date.now()+300000),absoluteExpiresAt:new Date(Date.now()+600000)});
 const chatId=`session-http-${index}`,chat=createChat?contextConversations.createContextConversation(project.id,{title:"Private fixture conversation",organizationId:project.organization_id,ownerUserId:owner.id,visibility:"private",metadata:{source:"opencode-chat",sourceRuntimeId:runtime.id,sourceSessionId:chatId},idempotencyKey:`http-chat-${index}`}):null;
 const session=authentication.createSession(owner.id,new Date(),"HTTP fixture",true),otherSession=authentication.createSession(other.id);
 const credential=mcpCredentials.createMcpCredential({kind:"service",audience:"mcp",name:`HTTP memory reader ${index}`,servicePrincipalName:`HTTP memory reader principal ${index}`,scopes:["memory:read","projects:read"],organizationId:project.organization_id,projectId:project.id,workspaceId:workspace.id,launcherWorktree:workspace.storagePath,expiresAt:new Date(Date.now()+600000),createdByUserId:owner.id});
 const observation=()=>observeManagedRuntime({Id:runtime.backendContainerId!,Name:"/"+runtime.backendName,State:{Status:"running",Health:{Status:"healthy"}},Config:{Labels:{"com.ingenium.managed":"runtime-manager","com.ingenium.runtime.id":runtime.id,"com.ingenium.runtime.organization":project.organization_id,"com.ingenium.runtime.project":project.id,"com.ingenium.runtime.owner":owner.id,"com.ingenium.runtime.workspace":workspace.id,"com.ingenium.runtime.storage":workspace.storageMappingHash,"com.ingenium.runtime.security-epoch":String(runtime.securityEpoch),"com.ingenium.runtime.revision":"1","org.opencontainers.image.revision":"c".repeat(40)}}},"fixture-owned-daemon",Date.now());
 return{project,owner,other,workspace,runtime,chatId,chat,session,otherSession,credential,observation};
}
function url(path:string,query:Record<string,string>={}){return `${origin}/api/v1/memory/lifecycle${path}?`+new URLSearchParams({projectId:fixture.project.id,workspaceId:fixture.workspace.id,runtimeId:fixture.runtime.id,...query});}
function browser(session=fixture.session,write=false):Record<string,string>{return{cookie:`${authentication.SESSION_COOKIE_NAME}=${session.token}`,...(write?{origin:config.dashboardOrigins[0]!,"x-csrf-token":session.csrfToken,"content-type":"application/json"}: {})};}
const reader=()=>({authorization:`Bearer ${fixture.credential.token}`,"x-ingenium-audience":"mcp","x-ingenium-workspace":fixture.workspace.id,"x-ingenium-launcher-worktree":fixture.workspace.storagePath});
const memoryRows=()=>getDb().prepare("SELECT count(*) AS n FROM veyra_memory_policy").get();
beforeAll(async()=>{
 const configured=process.env.VEYRA_MEMORY_HTTP_TEST_ROOT;if(!configured||!isAbsolute(configured))throw Error("Explicit task-owned HTTP fixture root required");root=realpathSync(configured);if(!statSync(root).isDirectory())throw Error("Fixture root unavailable");
 directory=mkdtempSync(join(root,"memory-http-"));if(relative(root,realpathSync(directory)).startsWith(".."))throw Error("Fixture escaped root");const key=join(directory,"fixture-auth-key");writeFileSync(key,Buffer.alloc(32,29).toString("base64url"),{flag:"wx",mode:0o600});
 vi.stubEnv("INGENIUM_HOME",directory);vi.stubEnv("INGENIUM_CORE_DB_PATH",join(directory,"data.db"));vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH",join(directory,"opencode-global"));vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE",key);vi.stubEnv("INGENIUM_API_TOKEN","fixture-installation-key-".repeat(3));vi.stubEnv("INGENIUM_API_TOKEN_FILE","");vi.stubEnv("INGENIUM_DEPLOYMENT_MODE","control-plane");resetDbForTest();getDb();
 const app=express();app.use(express.json());app.use(authMiddleware);app.use((req,_res,next)=>{admittedRequest=req;next();});app.use(csrfMiddleware);app.use(authorizationMiddleware);app.use("/api/v1/memory/lifecycle",createMemoryLifecycleRouter());app.use("/api/v1/skills",skillsRouter);app.use("/api/v1/customize",createScopedCustomizeRouter());app.use(errorHandler);
 server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(()=>{vi.restoreAllMocks();fixture=setup();vi.spyOn(manager,"inspectManagedRuntimePlacement").mockImplementation(async()=>fixture.observation());});
afterAll(async()=>{vi.restoreAllMocks();if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));resetDbForTest();vi.unstubAllEnvs();if(directory)writeFileSync(join(root,`${basename(directory)}-fixture.json`),JSON.stringify({owner:"01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",directory,databaseClosed:true,httpServerClosed:true,containsRealUserData:false,regeneration:"Run memory-lifecycle-http.test.ts with existing task-owned root",consumer:"Review first result then safety-checked exact fixture cleanup"},null,2),{flag:"wx"});});
describe("real HTTP, authentication, CSRF and memory ownership composition",()=>{
 it("acquires hosted Work binding from actual workspace ownership without a client Project ID",async()=>{
  const endpoint=`${origin}/api/v1/memory/lifecycle/work-binding?`+new URLSearchParams({workspaceId:fixture.workspace.id,runtimeId:fixture.runtime.id,engineSessionId:fixture.chatId});
  const response=await fetch(endpoint,{headers:browser()});expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");const binding=(await response.json()).data;
  expect(binding).toMatchObject({schemaVersion:1,available:true,actorUserId:fixture.owner.id,organizationId:fixture.project.organization_id,
   projectId:fixture.project.id,workspaceId:fixture.workspace.id,runtimeId:fixture.runtime.id,engineSessionId:fixture.chatId,
   contextConversationId:fixture.chat!.id,canChange:true,canForget:true});
  expect(binding.contextConversationId).not.toBe(binding.engineSessionId);expect(binding.scopeHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await fetch(endpoint+"&expectedProjectId=wrong-project",{headers:browser()})).status).toBe(409);
  expect((await fetch(endpoint,{headers:browser(fixture.otherSession)})).status).toBe(403);
  expect((await fetch(endpoint+"&actorUserId="+fixture.owner.id,{headers:browser()})).status).toBe(422);
 });
 it("rejects a changed canonical chat or partial hosted header before a memory write",async()=>{
  const acquired=await fetch(`${origin}/api/v1/memory/lifecycle/work-binding?`+new URLSearchParams({workspaceId:fixture.workspace.id,runtimeId:fixture.runtime.id,engineSessionId:fixture.chatId}),{headers:browser()});
  expect(acquired.status).toBe(200);const binding=(await acquired.json()).data;
  const headers={"X-Veyra-Memory-Scope":binding.scopeHash,"X-Veyra-Memory-Binding":binding.bindingHash,"X-Veyra-Memory-Epoch":String(binding.bindingEpoch),"X-Veyra-Memory-Context":binding.contextConversationId};
  const body={operationId:randomUUID(),expectedRevision:0,enabled:true,generate:false,useMemory:false,externalContext:false};
  const send=(guard:Record<string,string>)=>fetch(url("/policy",{chatId:fixture.chatId}),{method:"PUT",headers:{...browser(fixture.session,true),...guard},body:JSON.stringify(body)});
  const before=memoryRows();const drift=await send({...headers,"X-Veyra-Memory-Context":"wrong-context"});
  expect(drift.status).toBe(409);expect((await drift.json()).error.code).toBe("BINDING_CHANGED");expect(memoryRows()).toEqual(before);
  expect((await send({"X-Veyra-Memory-Scope":binding.scopeHash})).status).toBe(422);expect(memoryRows()).toEqual(before);
  expect((await send({...headers,"X-Veyra-Memory-Epoch":String(binding.bindingEpoch+1)})).status).toBe(409);expect(memoryRows()).toEqual(before);
  const committed=await send(headers);expect(committed.status).toBe(200);expect((await committed.json()).data.receipt.operationId).toBe(body.operationId);
 });
 it("previews reset through genuine GET write permission without mutating SQLite",async()=>{
  const before=memoryRows(),receipts=getDb().prepare("SELECT count(*) AS n FROM veyra_memory_receipt").get();
  const response=await fetch(url("/reset-preview",{chatId:fixture.chatId}),{headers:browser()});
  expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({count:0});
  expect(memoryRows()).toEqual(before);expect(getDb().prepare("SELECT count(*) AS n FROM veyra_memory_receipt").get()).toEqual(receipts);
  expect((await fetch(url("/reset-preview"),{headers:reader()})).status).toBe(403);
 });

 it("requires current source mutation permission and its original maintenance lock for merge approve and rollback",async()=>{
  const sourceOrg=organizations.createOrganization("Merge mutation source fixture",`merge-mutation-${sequence}`);
  const sourceProject=projects.createProject(`http-merge-mutation-${sequence}`,false,sourceOrg);
  skills.createSkill(sourceProject.id,"merge-origin","Fixture description","Retained original fixture");
  const proposal=skillGovernance.createProposal(fixture.project.id,"merge","merge-result",JSON.stringify({description:"Candidate",content:"Merged fixture"}),{sourceProjectId:sourceProject.id,sourceName:"merge-origin"});
  skillGovernance.submitProposal(fixture.project.id,proposal.id);
  const endpoint=`${origin}/api/v1/skills/proposals/${proposal.id}`;
  const act=(action:string,extra:Record<string,string>={})=>fetch(`${endpoint}/${action}?project=${fixture.project.name}`,{method:"POST",headers:{...browser(fixture.session,true),...extra},body:JSON.stringify({reviewer:"Fixture reviewer"})});
  const before=skills.getSkill(sourceProject.id,"merge-origin");
  expect((await act("approve")).status).toBe(404);expect(skills.getSkill(sourceProject.id,"merge-origin")).toEqual(before);expect(skillGovernance.getProposal(fixture.project.id,proposal.id)?.status).toBe("pending");
  organizations.addOrganizationMember(sourceOrg,fixture.owner.id,"admin");
  const token="fixture-source-maintenance-owner";expect(maintenanceLocks.acquireLock("skills",sourceProject.id,token,300000)).toBe(true);
  try {
   const locked=await act("approve");expect(locked.status).toBe(423);expect((await locked.json()).error.lock.projectId).toBe(sourceProject.id);expect(skills.getSkill(sourceProject.id,"merge-origin")).toEqual(before);
   expect((await act("approve",{"x-ingenium-source-lock-token":token})).status).toBe(200);expect(skillGovernance.getProposal(fixture.project.id,proposal.id)?.status).toBe("applied");
   const archived=skills.getSkill(sourceProject.id,"merge-origin");expect(archived?.archived_at).toBeTruthy();
   organizations.removeOrganizationMember(sourceOrg,fixture.owner.id);
   expect((await act("rollback",{"x-ingenium-source-lock-token":token})).status).toBe(404);expect(skills.getSkill(sourceProject.id,"merge-origin")).toEqual(archived);
   organizations.addOrganizationMember(sourceOrg,fixture.owner.id,"admin");
   expect((await act("rollback")).status).toBe(423);
   expect((await act("rollback",{"x-ingenium-source-lock-token":token})).status).toBe(200);expect(skills.getSkill(sourceProject.id,"merge-origin")?.archived_at).toBeNull();
  } finally {maintenanceLocks.releaseLock("skills",sourceProject.id,token);}
 });
 it("checks current source-project permission before merge skill enrichment",async()=>{
  const sourceOrg=organizations.createOrganization("Foreign source fixture",`merge-source-${sequence}`);
  const sourceProject=projects.createProject(`http-merge-source-${sequence}`,false,sourceOrg);
  skills.createSkill(sourceProject.id,"source-only","Fixture description","Private source fixture bytes");
  const proposal=skillGovernance.createProposal(fixture.project.id,"merge","merged-fixture",JSON.stringify({description:"Reviewed candidate",content:"Candidate fixture"}),{sourceProjectId:sourceProject.id,sourceName:"source-only"});
  const endpoint=`${origin}/api/v1/skills/proposals/${proposal.id}?project=${fixture.project.name}`;
  const reads=vi.spyOn(skills,"getSkill");
  const denied=await fetch(endpoint,{headers:browser()});expect(denied.status).toBe(404);expect(await denied.json()).toEqual({error:{code:"NOT_FOUND",message:"Resource not found"}});
  expect(reads.mock.calls.some(([project])=>project===sourceProject.id)).toBe(false);
  const plain=await fetch(endpoint+"&enrich=false",{headers:browser()});expect(plain.status).toBe(200);expect((await plain.json()).data).not.toHaveProperty("sourceSkill");
  organizations.addOrganizationMember(sourceOrg,fixture.owner.id,"admin");
  const allowed=await fetch(endpoint,{headers:browser()});expect(allowed.status).toBe(200);expect((await allowed.json()).data.sourceSkill).toMatchObject({projectId:sourceProject.id,name:"source-only",content:"Private source fixture bytes"});
  reads.mockClear();organizations.removeOrganizationMember(sourceOrg,fixture.owner.id);
  expect((await fetch(endpoint,{headers:browser()})).status).toBe(404);expect(reads.mock.calls.some(([project])=>project===sourceProject.id)).toBe(false);
 });
 it("primes actual-owner canonical source reads before fresh-chat recall and preserves a later incomplete tail",async()=>{
  expect((await fetch(url("/scope-policy"),{headers:browser()})).status).toBe(200);
  const request=admittedRequest!;
  const selected={projectId:fixture.project.id,workspaceId:fixture.workspace.id,runtimeId:fixture.runtime.id};
  const scope=await withManagedRequestPlacement(request,selected,()=>createRequestMemorySession(request,selected).resolveScope("read",fixture.chatId));
  const userId="engine-user",assistantId="engine-answer",userContent="Remember the fixture preference",assistantContent="A complete canonical response";
  const turn=contextConversations.persistContextChatTurn(fixture.project.id,fixture.chat!.id,{expectedRevision:0,sourceRuntimeId:fixture.runtime.id,sourceSessionId:fixture.chatId,userMessageId:userId,assistantMessageId:assistantId,userContent,assistantContent});
  const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
  const refs=[{id:turn.userMessage.id,contentHash:hash(userContent)},{id:turn.assistantMessage.id,contentHash:hash(assistantContent)}];
  // Seed an existing generated record through its real SQLite lifecycle owner;
  // only its extraction source/model are fixtures. This public test runs no inference.
  const seeded=new MemoryLifecycle({db:positionalCoreConnection(getDb()),authorize:()=>true,sources:(_scope,_chat,id)=>({contentHash:refs.find(ref=>ref.id===id)!.contentHash,active:false,excluded:false,uncertain:false,idleEligible:true,kind:"transcript"}),checkpoint:()=>{}});
  seeded.setPolicy(scope,{operationId:randomUUID(),expectedRevision:0,enabled:true,generate:true,useMemory:true,externalContext:false});
  seeded.setChatPolicy(scope,fixture.chatId,{operationId:randomUUID(),expectedRevision:0,useMemory:true,contribute:true});
  seeded.commitRecall(scope,{operationId:randomUUID(),admission:seeded.admit(scope,fixture.chatId,refs),content:"The fixture user prefers concise answers.",model:"model-free-fixture"});
  seeded.setPolicy(scope,{operationId:randomUUID(),expectedRevision:1,enabled:true,generate:false,useMemory:true,externalContext:false});
  contextConversations.appendContextMessage(fixture.project.id,fixture.chat!.id,{role:"user",content:"An unrelated unfinished later turn",expectedRevision:turn.revision,idempotencyKey:"later-unfinished",metadata:{source:"opencode-chat",sourceRuntimeId:fixture.runtime.id,sourceSessionId:fixture.chatId,sourceMessageId:"later-engine-user"}});
  const freshId="fresh-engine-chat";contextConversations.createContextConversation(fixture.project.id,{title:"Fresh private chat",organizationId:fixture.project.organization_id,ownerUserId:fixture.owner.id,visibility:"private",metadata:{source:"opencode-chat",sourceRuntimeId:fixture.runtime.id,sourceSessionId:freshId},idempotencyKey:"fresh-recall-chat"});
  const now=Date.now()-10000;
  const envelope=(id:string,role:"user"|"assistant",text:string,created:number):MessageEnvelope=>({info:{id,sessionID:fixture.chatId,role,time:{created,...(role==="assistant"?{completed:created+1}: {})},...(role==="assistant"?{finish:"stop"}: {})},parts:[{id:id+"-text",sessionID:fixture.chatId,messageID:id,type:"text",text}]});
  const messages=[envelope(userId,"user",userContent,now-10),envelope(assistantId,"assistant",assistantContent,now)];
  vi.spyOn(opencodeClient,"getSession").mockResolvedValue({id:fixture.chatId,slug:"fixture",projectID:"original-engine-project",directory:"/workspace",path:"/workspace",title:"Not exported",version:"2.0.11",time:{created:now-1000,updated:now+1},cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}}});
  const exact=vi.spyOn(opencodeClient,"getSessionMessage").mockImplementation(async(_chat,id)=>messages.find(message=>message.info.id===id)!);
  vi.spyOn(opencodeClient,"getRecentMessages").mockResolvedValue(messages);
  const response=await fetch(url("/recall",{chatId:freshId}),{headers:browser()});
  expect(response.status).toBe(200);const body=await response.json();expect(body.data.items).toHaveLength(1);expect(body.data.items[0].content).toBe("The fixture user prefers concise answers.");expect(body.sourceWindow.verifiedSources).toBe(2);expect(exact).toHaveBeenCalledTimes(2);
  const inspect=await fetch(url("/entries",{candidateOffset:"0",limit:"10"}),{headers:browser()});expect(inspect.status).toBe(200);const managed=(await inspect.json());expect(managed.data.items).toHaveLength(1);expect(managed.data.items[0]).toEqual(seeded.inspect(scope).items[0]);expect(managed.data).not.toHaveProperty("total");expect(managed.sourceWindow).toMatchObject({candidateOffset:0,returned:1,verifiedSources:2,hasMore:false,nextCandidateOffset:null});
  const disabled=await fetch(url(`/chats/${freshId}/policy`),{method:"PUT",headers:browser(fixture.session,true),body:JSON.stringify({operationId:randomUUID(),expectedRevision:0,useMemory:false,contribute:false})});expect(disabled.status).toBe(200);
  const callsBeforeDisabled=exact.mock.calls.length,withoutMemory=await fetch(url("/recall",{chatId:freshId}),{headers:browser()});expect((await withoutMemory.json()).data.excluded).toBe(true);expect(exact.mock.calls).toHaveLength(callsBeforeDisabled);
  const manageDisabled=await fetch(url("/entries"),{headers:browser()});expect(manageDisabled.status).toBe(200);expect((await manageDisabled.json()).data.items[0].id).toBe(body.data.items[0].id);
  expect((await fetch(url(`/chats/${freshId}/policy`),{method:"PUT",headers:browser(fixture.session,true),body:JSON.stringify({operationId:randomUUID(),expectedRevision:1,useMemory:true,contribute:false})})).status).toBe(200);
  exact.mockImplementation(async(_chat,id)=>id===userId?{...messages[0]!,parts:[{...messages[0]!.parts[0]!,text:"Selected source changed"}]}:messages[1]!);
  const changed=await fetch(url("/recall",{chatId:freshId}),{headers:browser()});expect(changed.status).toBe(200);const omitted=await changed.json();expect(omitted.data.items).toHaveLength(0);expect(omitted.sourceWindow.unavailableSourceCount).toBe(2);
  const inspectChanged=await fetch(url("/entries"),{headers:browser()});expect(inspectChanged.status).toBe(200);expect((await inspectChanged.json()).data.items).toHaveLength(0);
  const forgotten=await fetch(url("/forget"),{method:"POST",headers:browser(fixture.session,true),body:JSON.stringify({operationId:randomUUID(),memoryId:body.data.items[0].id,expectedVersion:1})});expect(forgotten.status).toBe(200);
  exact.mockImplementation(async(_chat,id)=>messages.find(message=>message.info.id===id)!);
  const callsBeforeForgetRead=exact.mock.calls.length,afterForget=await fetch(url("/recall",{chatId:freshId}),{headers:browser()});expect((await afterForget.json()).data.items).toHaveLength(0);expect(exact.mock.calls).toHaveLength(callsBeforeForgetRead);
  const inspectForgotten=await fetch(url("/entries"),{headers:browser()});expect(inspectForgotten.status).toBe(200);expect((await inspectForgotten.json()).data.items).toHaveLength(0);expect(exact.mock.calls).toHaveLength(callsBeforeForgetRead);
 });
 it("reads scope settings before chat creation without inserting defaults",async()=>{fixture=setup(false);expect(getDb().prepare("SELECT count(*) AS n FROM context_conversations WHERE project_id=?").get(fixture.project.id)).toEqual({n:0});const before=memoryRows();const response=await fetch(url("/scope-policy"),{headers:browser()});expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");const data=(await response.json()).data;expect(data.policy).toMatchObject({revision:0,enabled:true,generate:false,useMemory:true,externalContext:false});expect(data).not.toHaveProperty("chatId");expect(data).not.toHaveProperty("chat");expect(memoryRows()).toEqual(before);});
 it("uses actual engine identity distinct from the canonical Context record",async()=>{expect(fixture.chatId).not.toBe(fixture.chat!.id);const response=await fetch(url("/policy",{chatId:fixture.chatId}),{headers:browser()});expect(response.status).toBe(200);expect((await response.json()).data.chatId).toBe(fixture.chatId);const wrong=await fetch(url("/policy",{chatId:fixture.chat!.id}),{headers:browser()});expect(wrong.status).toBe(403);});
 it("persists and reconciles exactly the original operation, with CAS/conflict semantics",async()=>{const operationId=randomUUID(),body={operationId,expectedRevision:0,enabled:true,generate:false,useMemory:false,externalContext:false};const send=(value:unknown,extra:Record<string,string>={})=>fetch(url("/policy"),{method:"PUT",headers:{...browser(fixture.session,true),...extra},body:JSON.stringify(value)});const first=await send(body,{"Idempotency-Key":operationId});expect(first.status).toBe(200);const result=(await first.json()).data;expect(result.receipt.operationId).toBe(operationId);const repeated=await send(body);expect(repeated.status).toBe(200);expect((await repeated.json()).data).toMatchObject({receipt:result.receipt,idempotent:true});const receipt=await fetch(url(`/operations/${operationId}`),{headers:browser()});expect(receipt.status).toBe(200);expect((await receipt.json()).data).toEqual(result.receipt);expect((await send({...body,useMemory:true})).status).toBe(409);expect((await send({...body,operationId:randomUUID()})).status).toBe(409);const policy=await fetch(url("/scope-policy"),{headers:browser()});expect((await policy.json()).data.policy).toMatchObject({revision:1,useMemory:false});});
 it("requires original browser CSRF/origin before mutation",async()=>{const before=memoryRows();const response=await fetch(url("/policy"),{method:"PUT",headers:{...browser(),"content-type":"application/json"},body:JSON.stringify({operationId:randomUUID(),expectedRevision:0,enabled:true,generate:false,useMemory:true,externalContext:false})});expect(response.status).toBe(403);expect(memoryRows()).toEqual(before);expect(manager.inspectManagedRuntimePlacement).not.toHaveBeenCalled();});
 it("denies anonymous, revoked and wrong-owner requests without changing memory",async()=>{const before=memoryRows();expect((await fetch(url("/scope-policy"))).status).toBe(401);expect((await fetch(url("/scope-policy"),{headers:browser(fixture.otherSession)})).status).toBe(403);authentication.revokeSession(fixture.owner.id,fixture.session.session.id);expect((await fetch(url("/scope-policy"),{headers:browser()})).status).toBe(401);expect(memoryRows()).toEqual(before);});
 it("rechecks revocation after asynchronous manager observation",async()=>{vi.mocked(manager.inspectManagedRuntimePlacement).mockImplementationOnce(async()=>{authentication.revokeSession(fixture.owner.id,fixture.session.session.id);return fixture.observation();});const before=memoryRows(),response=await fetch(url("/scope-policy"),{headers:browser()});expect(response.status).toBe(403);expect(memoryRows()).toEqual(before);});
 it("rejects false current placement and never falls back to another runtime",async()=>{vi.mocked(manager.inspectManagedRuntimePlacement).mockImplementationOnce(async()=>({...fixture.observation(),bindingEpoch:fixture.runtime.securityEpoch+1}));const before=memoryRows(),response=await fetch(url("/scope-policy"),{headers:browser()});expect(response.status).toBe(503);expect((await response.json()).error.code).toBe("MEMORY_ADAPTER_UNAVAILABLE");expect(memoryRows()).toEqual(before);});
 it("retains exact service attestation and read-only delegation limits",async()=>{const response=await fetch(url("/scope-policy"),{headers:reader()});expect(response.status).toBe(200);const mutation=await fetch(url("/policy"),{method:"PUT",headers:{...reader(),"content-type":"application/json"},body:JSON.stringify({operationId:randomUUID(),expectedRevision:0,enabled:true,generate:false,useMemory:true,externalContext:false})});expect(mutation.status).toBe(403);const forged=await fetch(url("/scope-policy"),{headers:{...reader(),"x-ingenium-storage-mapping-hash":"f".repeat(64)}});expect(forged.status).toBe(404);});
 it("rejects extra identity/query fields, arrays and invalid numeric budgets",async()=>{expect((await fetch(url("/scope-policy",{ownerUserId:fixture.other.id}),{headers:browser()})).status).toBe(422);expect((await fetch(url("/entries",{limit:"1.5"}),{headers:browser()})).status).toBe(422);expect((await fetch(url("/scope-policy")+"&projectId=another",{headers:browser()})).status).toBe(422);expect(manager.inspectManagedRuntimePlacement).not.toHaveBeenCalled();});
 it("rejects header/body operation identity mismatch before owner I/O",async()=>{const response=await fetch(url("/policy"),{method:"PUT",headers:{...browser(fixture.session,true),"Idempotency-Key":"other-operation"},body:JSON.stringify({operationId:randomUUID(),expectedRevision:0,enabled:true,generate:false,useMemory:true,externalContext:false})});expect(response.status).toBe(422);expect(manager.inspectManagedRuntimePlacement).not.toHaveBeenCalled();});
 it("denies ambiguous engine source records without selecting a latest row",async()=>{contextConversations.createContextConversation(fixture.project.id,{title:"Duplicate private source",organizationId:fixture.project.organization_id,ownerUserId:fixture.owner.id,visibility:"private",metadata:{source:"opencode-chat",sourceRuntimeId:fixture.runtime.id,sourceSessionId:fixture.chatId},idempotencyKey:`duplicate-${sequence}`});const response=await fetch(url("/policy",{chatId:fixture.chatId}),{headers:browser()});expect(response.status).toBe(403);});
 it("keeps stable project identity through a rename",async()=>{projects.updateProject(fixture.project.name,fixture.project.name+"-renamed");const response=await fetch(url("/scope-policy"),{headers:browser()});expect(response.status).toBe(200);});
});

function publishCatalogSkill(visibility:'public'|'personal',name='catalog-source'){
 skills.createSkill(fixture.project.id,name,'Published qualification skill','Preserve this source as data.');
 const owner=customizeCatalog.createCustomizeCatalogOwner({type:'browser-user',id:fixture.owner.id,scopes:['user:*']}),snapshot=owner.projectSource(fixture.project.id,'skill',name);
 const published=owner.command({operationId:randomUUID(),op:'publish',projectId:fixture.project.id,kind:'skill',name,expectedRevision:snapshot.revision,sourceSha256:snapshot.sourceSha256,visibility});expect(published.outcome).toBe('succeeded');return {owner,source:published.value};
}
function catalogUrl(visibility='public',extra:Record<string,string>={}){return origin+'/api/v1/customize/catalog?'+new URLSearchParams({projectId:fixture.project.id,kind:'skill',visibility,...extra});}
describe('published catalog uses the original authenticated owner and exact installation records',()=>{
 it('serves Public and Personal from real sources, isolates another owner, and does not create catalog writes during reads',async()=>{
  const pub=publishCatalogSkill('public','catalog-public'),personal=publishCatalogSkill('personal','catalog-personal');const before=getDb().prepare('SELECT count(*) AS n FROM customize_commands').get();
  const publicResult=await fetch(catalogUrl(),{headers:browser()});expect(publicResult.status).toBe(200);const page=(await publicResult.json()).data;
  expect(page).toMatchObject({projectId:fixture.project.id,kind:'skill',visibility:'public',next:null});expect(page.data).toEqual([expect.objectContaining({id:pub.source.id,sourceSha256:pub.source.sourceSha256,installed:false,enabled:false,connectionState:'available',resourceId:null,actions:['connect']})]);
  const privatePage=await fetch(catalogUrl('personal'),{headers:browser()});expect((await privatePage.json()).data.data[0].id).toBe(personal.source.id);
  expect((await(await fetch(catalogUrl('personal'),{headers:browser(fixture.otherSession)})).json()).data.data).toEqual([]);
  expect((await(await fetch(catalogUrl(),{headers:browser(fixture.otherSession)})).json()).data.data[0].id).toBe(pub.source.id);
  expect(getDb().prepare('SELECT count(*) AS n FROM customize_commands').get()).toEqual(before);
 });
 it('distinguishes a skill proposal from installation and follows its actual applied resource ID',async()=>{
  const {owner,source}=publishCatalogSkill('public');const connected=owner.command({operationId:randomUUID(),op:'connect',sourceId:source.id,expectedRevision:source.revision,sourceSha256:source.sourceSha256,projectId:fixture.project.id,targetName:'catalog-connected'});expect(connected.outcome).toBe('succeeded');
  const read=async()=>{const response=await fetch(catalogUrl(),{headers:browser()});expect(response.status).toBe(200);return(await response.json()).data.data.find((entry:{id:string})=>entry.id===source.id)};
  expect(await read()).toMatchObject({installed:false,connectionState:'proposal-review-required',resourceId:null,actions:['review']});
  const proposalId=connected.value.proposalId;skillGovernance.submitProposal(fixture.project.id,proposalId);
  const approved=await fetch(origin+'/api/v1/skills/proposals/'+proposalId+'/approve?project='+fixture.project.name,{method:'POST',headers:browser(fixture.session,true),body:JSON.stringify({reviewer:'Qualification reviewer'})});expect(approved.status).toBe(200);
  const actual=skills.getSkill(fixture.project.id,'catalog-connected')!;expect(await read()).toMatchObject({installed:true,enabled:true,connectionState:'installed',resourceId:actual.id,targetName:actual.name,installedSourceSha256:source.sourceSha256});
 });
 it('requires the target project and original browser identity and rejects invented selector fields',async()=>{
  publishCatalogSkill('public');expect((await fetch(catalogUrl())).status).toBe(401);expect((await fetch(catalogUrl('public',{projectId:randomUUID()}),{headers:browser()})).status).toBe(404);
  expect((await fetch(catalogUrl('public',{ownerUserId:fixture.other.id}),{headers:browser()})).status).toBe(422);expect((await fetch(catalogUrl('public',{limit:'1.5'}),{headers:browser()})).status).toBe(422);
  authentication.revokeSession(fixture.owner.id,fixture.session.session.id);expect((await fetch(catalogUrl(),{headers:browser()})).status).toBe(401);
 });
});
