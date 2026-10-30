import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {stripTypeScriptTypes} from "node:module";
const sha=s=>createHash("sha256").update(s).digest("hex");
const manifest=JSON.parse(readFileSync(new URL("./managed-job-proposal.json",import.meta.url),"utf8"));
const patch=readFileSync(new URL("./managed-job-async-dot.patch",import.meta.url),"utf8");assert.equal(sha(patch),manifest.asyncPatchSha256);
function apply(original,patch){const lines=original.match(/.*\n|.+$/g)??[],out=[];let cursor=0;for(const part of patch.split(/^@@ /m).slice(1)){const [header,...body]=part.match(/.*\n|.+$/g)??[];const m=header.match(/^-(\d+)(?:,(\d+))?/),start=Number(m[1])-(m[2]==="0"?0:1);out.push(...lines.slice(cursor,start));cursor=start;for(const line of body){if(line[0]===" "){assert.equal(lines[cursor++],line.slice(1));out.push(line.slice(1));}else if(line[0]==="-")assert.equal(lines[cursor++],line.slice(1));else if(line[0]==="+")out.push(line.slice(1));}}out.push(...lines.slice(cursor));return out.join("");}
const proposed={};
for(const section of patch.split(/^--- a\//m).slice(1)){const file=section.slice(0,section.indexOf("\n"));const source=readFileSync(process.env.VEYRA_DOT_PROPOSAL_SOURCE_ROOT?resolve(process.env.VEYRA_DOT_PROPOSAL_SOURCE_ROOT,file):new URL("../../../"+file,import.meta.url),"utf8");assert.equal(sha(source),manifest.preimages[file]);proposed[file]=apply(source,"--- a/"+section);stripTypeScriptTypes(proposed[file],{mode:"strip"});}
const source=proposed["services/ingenium-api/lib/dot-v2/service.ts"];
const methods=source.slice(source.indexOf("  persistCancellationIntent("),source.indexOf("  private recoverRecord("));
const code=stripTypeScriptTypes(`class ProposedService {constructor(repository,auth){this.repository=repository;this.auth=auth;this.now=()=>"now";}require(...args){this.auth(...args);}recover(){throw Error("Sync recovery not allowed");}\n${methods}\n}`,{mode:"strip"});
class DotError extends Error{constructor(code){super(code);this.code=code;}}
class DotConflict extends Error{}
const ProposedService=new Function("terminal","DotError","DotConflict","text",`${code}\nreturn ProposedService;`)(new Set(["success","failed","cancelled","skipped","blocked"]),DotError,DotConflict,()=>{});
function fixture(){
 let inTransaction=false,allowed=true;const scope={organizationId:"org",ownerUserId:"owner",projectId:"project"},actor={id:"owner",organizationId:"org"};
 const rows={followup:{id:"followup",revision:0,state:"active",scope},operation:{id:"operation",revision:0,state:"running",runId:"run",followupId:"followup",scope,code:null}};
 const repository={transaction(fn){assert.equal(inTransaction,false);inTransaction=true;try{return fn();}finally{inTransaction=false;}},get(kind,id){const row=rows[kind];return row?.id===id?structuredClone(row):undefined;},put(kind,next,revision){assert.equal(rows[kind].revision,revision);rows[kind]=structuredClone(next);},page(kind){return {data:rows[kind]?[structuredClone(rows[kind])]:[],nextCursor:null};}};
 const service=new ProposedService(repository,()=>{if(!allowed)throw new DotError("DOT_FORBIDDEN");});let resolveInspect;const effects=[];
 const jobs={async requestCancellation(){assert.equal(inTransaction,false);assert.equal(rows.operation.state,"cancel_requested");effects.push("cancel");},async inspect(){assert.equal(inTransaction,false);effects.push("inspect");return await new Promise(resolve=>resolveInspect=resolve);}};
 return {service,jobs,scope,actor,rows,effects,repository,deny(){allowed=false;},resolve(state){resolveInspect(state);},async started(){while(!resolveInspect)await Promise.resolve();},inTransaction:()=>inTransaction};
}
test("both proposed modules parse and async runtime blocks accidental synchronous recovery",()=>{
 const core=proposed["services/ingenium-api/lib/dot-v2/core-binding.ts"];assert.match(core,/async recoverOperationsAsync/);assert.match(core,/await service.recoverOperationAsync/);assert.match(core,/async cancelFollowupAsync/);assert.match(core,/if\(options.asyncExecution\)throw new DotError\("DOT_ASYNC_RECOVERY_REQUIRED"\)/);
});
test("cancel intent commits before async remote cancellation and unknown stays cancel_requested",async()=>{
 const f=fixture(),pending=f.service.cancelAsync(f.actor,f.scope,"followup",0,f.jobs);await f.started();assert.equal(f.rows.followup.state,"cancelled");assert.equal(f.rows.operation.state,"cancel_requested");assert.equal(f.inTransaction(),false);assert.deepEqual(f.effects,["cancel","inspect"]);f.resolve("unknown");await pending;assert.equal(f.rows.operation.state,"cancel_requested");
});
test("positive async retirement may finish cancellation only after remote join returns",async()=>{
 const f=fixture(),pending=f.service.cancelAsync(f.actor,f.scope,"followup",0,f.jobs);await f.started();assert.equal(f.rows.operation.state,"cancel_requested");f.resolve("cancelled");await pending;assert.equal(f.rows.operation.state,"cancelled");
});
test("remote cancellation failure preserves durable intent for later idempotent retry",async()=>{
 const f=fixture();f.jobs.requestCancellation=async()=>{assert.equal(f.inTransaction(),false);throw Error("remote unavailable");};await assert.rejects(f.service.cancelAsync(f.actor,f.scope,"followup",0,f.jobs));assert.equal(f.rows.operation.state,"cancel_requested");
});
test("authorization is rechecked after awaited inspection before persisting result",async()=>{
 const f=fixture(),pending=f.service.recoverOperationAsync(f.actor,f.scope,"operation",f.jobs);await f.started();f.deny();f.resolve("success");await assert.rejects(pending,error=>error.code==="DOT_FORBIDDEN");assert.equal(f.rows.operation.state,"running");
});
test("cancellation arriving while inspection waits cannot be regressed to running",async()=>{
 const f=fixture(),pending=f.service.recoverOperationAsync(f.actor,f.scope,"operation",f.jobs);await f.started();f.service.persistCancellationIntent(f.actor,f.scope,"followup",0);f.resolve("running");await pending;assert.equal(f.rows.operation.state,"cancel_requested");
});
test("changed original run or completed operation during wait cannot be overwritten",async()=>{
 const f=fixture(),pending=f.service.recoverOperationAsync(f.actor,f.scope,"operation",f.jobs);await f.started();f.rows.operation.runId="replacement";f.resolve("success");await assert.rejects(pending,error=>error.code==="DOT_RUN_BINDING_CHANGED");assert.equal(f.rows.operation.state,"running");
 const g=fixture(),other=g.service.recoverOperationAsync(g.actor,g.scope,"operation",g.jobs);await g.started();g.rows.operation.state="failed";g.resolve("success");await other;assert.equal(g.rows.operation.state,"failed");
});

test("managed HTTP and singleton scheduler select the async authority without local launch fallback",()=>{
 const router=proposed["services/ingenium-api/lib/dot-v2/router.ts"],session=proposed["services/ingenium-api/lib/dot-v2/request-session.ts"],scheduler=proposed["services/ingenium-api/lib/scheduler.ts"];
 assert.match(router,/Number.isSafeInteger\(command.revision\)/);assert.match(router,/await asyncCancel/);assert.match(session,/binding.bindingPolicy,execution,options/);assert.match(session,/executeJobRun:options.asyncExecution.executeJobRun/);assert.match(scheduler,/await dotRuntime.recoverOperationsAsync/);assert.match(scheduler,/trackTask\(runJobScheduler/);
});
