import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createCoreDotRuntime} from "../lib/dot-v2/core-binding.ts";
import {DotError} from "../lib/dot-v2/service.ts";
import {scopeKey} from "../lib/dot-v2/repository.ts";

function fixture(){
 const db=new DatabaseSync(":memory:");db.exec(readFileSync(new URL("../lib/dot-v2/schema.sql",import.meta.url),"utf8"));db.exec("CREATE TABLE fixture_core_runs(id TEXT PRIMARY KEY,body TEXT NOT NULL)");
 const scope={organizationId:"org",ownerUserId:"owner",projectId:"project",executionBindingId:"native",executionBindingFingerprint:"host/workspace/epoch-1",conversationId:"conversation"};const actor={id:"owner",organizationId:"org"};
 const job={id:"job",project_id:"project",organization_id:"org",owner_kind:"user",owner_user_id:"owner",service_principal_id:"principal",agent:"agent",prompt_template:"Check progress",timeout_minutes:1,revision:1,schedule_revision:2,enabled:true,schedule_cron:null};
 let depth=0,serial=0,clock="2026-10-29T00:00:00.000Z",allowed=true,source=true,epoch=true,grant=true,currentConnection,afterCommit=()=>{},launchError=false,active=true;
 const dbPort={prepare:db.prepare.bind(db),get inTransaction(){return depth>0;}};currentConnection=dbPort;
 const launches=[],cancellations=[],diagnostics=[],transactions=[];let deferredCheckpoints=0;
 const readRun=id=>{const row=db.prepare("SELECT body FROM fixture_core_runs WHERE id=?").get(id);return row?JSON.parse(row.body):undefined;};
 const writeRun=run=>db.prepare("INSERT OR REPLACE INTO fixture_core_runs(id,body) VALUES(?,?)").run(run.id,JSON.stringify(run));
 const core={getDb:()=>currentConnection,execTransaction(fn,retries){transactions.push(retries);const nested=depth>0,name="nested"+depth;db.exec(nested?`SAVEPOINT ${name}`:"BEGIN IMMEDIATE");depth++;try{const result=fn();depth--;db.exec(nested?`RELEASE ${name}`:"COMMIT");return result;}catch(error){depth--;db.exec(nested?`ROLLBACK TO ${name}`:"ROLLBACK");if(nested)db.exec(`RELEASE ${name}`);throw error;}},checkpointAfterWrite(){if(depth){deferredCheckpoints++;return;}afterCommit();},jobs:{
  getJob:()=>job,getJobRun:(_p,id)=>readRun(id),isJobRunAuthorizationCurrent:()=>grant,
  startJobRun(projectId,id,trigger,provenance){
   assert.equal(trigger,"cron");assert.equal(projectId,job.project_id);assert.equal(id,job.id);if(!grant)return {reason:"Job automation authorization is unavailable"};
   const run=core.execTransaction(()=>{const value={id:"run"+(++serial),job_id:id,project_id:projectId,organization_id:job.organization_id,effective_service_principal_id:job.service_principal_id,job_revision:job.revision,schedule_revision:provenance.expectedScheduleRevision,scheduled_for:provenance.scheduledFor,status:"running"};writeRun(value);return value;});core.checkpointAfterWrite();return run;
  },cancelJobRun(_p,id){const run=readRun(id);writeRun({...run,status:"cancelled"});cancellations.push(id);}
 }};
 const binding={authorizeJob(a,s,j,action){assert.equal(a.id,scope.ownerUserId);assert.equal(j.id,job.id);if(!allowed)throw new DotError("DOT_FORBIDDEN");return {scope:epoch?s:{...s,executionBindingFingerprint:"epoch-2"},capabilities:["read"]};},authorizeRun(a,s,r){assert.equal(a.id,s.ownerUserId);assert.equal(r.project_id,s.projectId);}};
 const auth={require(){if(!allowed)throw new DotError("DOT_FORBIDDEN");},requireSource(){if(!source)throw new DotError("DOT_SOURCE_REVOKED");},canReadMemory:()=>true};
 const execution={async executeJobRun(id,j,prompt){assert.equal(depth,0);assert.equal(readRun(id).job_id,j.id);assert.equal(prompt,j.prompt_template);assert.ok(db.prepare("SELECT id FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=?").get(id));launches.push(id);if(launchError)throw Error("unknown launch");},requestCancellation(s,r){cancellations.push(r.id);writeRun({...r,status:"cancelled"});},inspectOwnedRun:(_s,r)=>r.status==="timeout"?"failed":r.status==="queued"?"running":r.status};
 const options={nestedCheckpointPolicy:"deferred-by-core-v1",now:()=>clock,id:()=>"suggestion"+(++serial),onDiagnostic:event=>diagnostics.push(event)};
 const runtime=createCoreDotRuntime(core,auth,binding,execution,options);
 const approve=()=>{const suggestion=runtime.service.propose(actor,scope,{title:"Review progress",prompt:job.prompt_template,source:{kind:"user",reference:"message"},capabilities:["read"],expiresAt:"2026-11-01T00:00:00.000Z"});return runtime.service.approve(actor,scope,suggestion.id,0,{jobId:job.id,schedule:{kind:"interval",anchor:clock,minutes:60},missedPolicy:"latest",notificationPolicy:"meaningful"});};
 return {db,core,binding,auth,execution,options,runtime,scope,actor,job,launches,cancellations,diagnostics,transactions,approve,readRun,tick(){clock="2026-10-29T01:00:00.000Z";},isActive:()=>active,stopAfterCommit(){afterCommit=()=>{active=false;};},revokeAfterCommit(){afterCommit=()=>{grant=false;};},sourceOffAfterCommit(){afterCommit=()=>{source=false;};},deny(){allowed=false;},sourceOff(){source=false;},revokeGrant(){grant=false;},changeEpoch(){epoch=false;},replaceDb(){currentConnection={...dbPort};},failLaunch(){launchError=true;},deferred:()=>deferredCheckpoints};
}

test("core adapter claims on one nested transaction and launches only after commit",async t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();assert.equal(f.runtime.ownsJob("project","job"),true);f.tick();await f.runtime.dispatchJob("project","job",f.isActive);
 assert.equal(f.launches.length,1);assert.ok(f.deferred()>0);assert.ok(f.transactions.includes(1));assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].runId,f.launches[0]);
 await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,1);assert.equal(f.runtime.service.get(f.actor,f.scope,"followup",follow.id).cursor,"2026-10-29T01:00:00.000Z");
});
test("same-connection operation failure rolls back the actual claim fixture and cursor",async t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick();f.db.exec("CREATE TRIGGER fail_operation BEFORE INSERT ON veyra_dot_records WHEN NEW.kind='operation' BEGIN SELECT RAISE(ABORT,'first operation failure'); END;");
 await assert.rejects(f.runtime.dispatchJob("project","job",f.isActive),/first operation failure/);assert.equal(f.db.prepare("SELECT count(*) AS n FROM fixture_core_runs").get().n,0);assert.equal(f.launches.length,0);assert.equal(f.runtime.service.get(f.actor,f.scope,"followup",follow.id).cursor,follow.cursor);
});
test("stop or grant revocation between commit and launch cancels only the new unlaunched run",async t=>{
 for(const mode of ["stopAfterCommit","revokeAfterCommit","sourceOffAfterCommit"]){const f=fixture();try{f.approve();f.tick();f[mode]();await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,0);assert.equal(f.cancellations.length,1);assert.equal(f.readRun(f.cancellations[0]).status,"cancelled");assert.equal(f.diagnostics[0].code,"DOT_LAUNCH_NOT_STARTED");}finally{f.db.close();}}
});
test("uncertain launch persists original identity and is never replayed",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();f.failLaunch();await f.runtime.dispatchJob("project","job",f.isActive);const op=f.runtime.service.page(f.actor,f.scope,"operation").data[0];assert.equal(op.state,"unknown");assert.equal(op.runId,f.launches[0]);assert.equal(f.diagnostics[0].code,"DOT_LAUNCH_OUTCOME_UNKNOWN");await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,1);
});
test("source, grant and immutable binding eligibility are rechecked before a claim",async t=>{
 for(const mode of ["deny","sourceOff","changeEpoch"]){const f=fixture();try{f.approve();f.tick();f[mode]();await assert.rejects(f.runtime.dispatchJob("project","job",f.isActive));assert.equal(f.launches.length,0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM fixture_core_runs").get().n,0);}finally{f.db.close();}}
});
test("database replacement and unsafe outer transactions fail closed; no checkpoint prerequisite means no activation",t=>{
 const f=fixture();t.after(()=>f.db.close());assert.throws(()=>createCoreDotRuntime(f.core,f.auth,f.binding,f.execution,{...f.options,nestedCheckpointPolicy:"unsafe"}),/CHECKPOINT_PREREQUISITE/);
 f.approve();assert.throws(()=>f.core.execTransaction(()=>f.runtime.service.skipMissed(f.actor,f.scope,"missing",0)),/OUTER_TRANSACTION/);f.replaceDb();assert.throws(()=>f.runtime.ownsJob("project","job"),/DATABASE_REPLACED/);
});
test("existing lifecycle recovery observes exact core runs and never relaunches",async t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const current=f.runtime.service.get(f.actor,f.scope,"followup",follow.id);f.runtime.service.cancel(f.actor,f.scope,follow.id,current.revision);assert.equal(f.cancellations.length,1);assert.equal(f.runtime.recoverOperations(),0);assert.equal(f.launches.length,1);assert.throws(()=>f.runtime.recoverOperations(101),/VALIDATION/);
});

test("post-commit checkpoint failure is retained while known committed admission can launch",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();const checkpoint=f.core.checkpointAfterWrite;f.core.checkpointAfterWrite=()=>{if(!f.core.getDb().inTransaction)throw Error("post-commit checkpoint");return checkpoint();};
 await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,1);assert.equal(f.diagnostics[0].code,"DOT_POST_COMMIT_CHECKPOINT_FAILED");
});
test("cancel intent survives service reconstruction and pending cancellation is recovered without replay",async t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);
 const cancel=f.execution.requestCancellation;f.execution.requestCancellation=()=>{throw Error("cancellation outcome unknown");};const current=f.runtime.service.get(f.actor,f.scope,"followup",follow.id);
 assert.throws(()=>f.runtime.service.cancel(f.actor,f.scope,follow.id,current.revision),/cancellation outcome unknown/);assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].state,"cancel_requested");
 f.execution.requestCancellation=cancel;const restarted=createCoreDotRuntime(f.core,f.auth,f.binding,f.execution,f.options);assert.equal(restarted.recoverOperations(),1);assert.equal(restarted.service.page(f.actor,f.scope,"operation").data[0].state,"cancelled");assert.equal(f.launches.length,1);
});

test("core grant denial is retained as blocked with no duplicate claim or external notification",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();f.revokeGrant();await f.runtime.dispatchJob("project","job",f.isActive);const op=f.runtime.service.page(f.actor,f.scope,"operation").data[0];assert.equal(op.state,"blocked");assert.equal(f.launches.length,0);assert.equal(f.db.prepare("SELECT count(*) AS n FROM fixture_core_runs").get().n,0);assert.equal(f.runtime.service.page(f.actor,f.scope,"notification").data.length,1);
});
test("organization jobs retain policy-authorized ownership; a foreign user job is rejected",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.job.owner_kind="organization";f.job.owner_user_id=null;f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,1);
 const other=fixture();try{other.job.owner_user_id="other";assert.throws(()=>other.approve(),/JOB_BINDING_CHANGED/);}finally{other.db.close();}
});
test("run/project identity drift is rejected before cancellation or process inspection",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const run=f.readRun(f.launches[0]);f.db.prepare("UPDATE fixture_core_runs SET body=? WHERE id=?").run(JSON.stringify({...run,project_id:"other"}),run.id);
 assert.equal(f.runtime.recoverOperations(),1);assert.equal(f.diagnostics[0].code,"DOT_RECOVERY_OPERATION_BLOCKED");assert.equal(f.diagnostics[0].error.code,"DOT_RUN_BINDING_CHANGED");assert.equal(f.cancellations.length,0);assert.equal(f.launches.length,1);
});

function insertOperation(f,op){f.db.prepare("INSERT INTO veyra_dot_records(kind,id,organization_id,owner_user_id,scope_key,revision,body) VALUES('operation',?,?,?,?,?,?)").run(op.id,op.scope.organizationId,op.scope.ownerUserId,scopeKey(op.scope),op.revision,JSON.stringify(op));}
test("a denied prefix cannot starve later authorized recovery; only selected rows are inspected",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const healthy=f.runtime.service.page(f.actor,f.scope,"operation").data[0];
 const denied={...healthy,id:"000-denied",scope:{...f.scope,ownerUserId:"revoked-owner"},state:"cancel_requested",runId:"revoked-run"};insertOperation(f,denied);
 const original=f.auth.require;f.auth.require=(a,s,...rest)=>{if(s.ownerUserId==="revoked-owner")throw new DotError("DOT_FORBIDDEN");return original(a,s,...rest);};
 const inspect=f.execution.inspectOwnedRun;let inspections=0;f.execution.inspectOwnedRun=(...args)=>{inspections++;return inspect(...args);};
 assert.equal(f.runtime.recoverOperations(1),1);assert.equal(inspections,0);assert.equal(f.diagnostics.length,1);assert.equal(f.diagnostics[0].error.code,"DOT_FORBIDDEN");
 assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].state,"claimed");
 assert.equal(f.runtime.recoverOperations(1),1);assert.equal(inspections,1);assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].state,"running");
 assert.equal(f.runtime.recoverOperations(1),1);assert.equal(f.diagnostics.length,1);assert.equal(f.cancellations.length,0);assert.equal(f.launches.length,1);
 const retained=JSON.parse(f.db.prepare("SELECT body FROM veyra_dot_records WHERE id=?").get(denied.id).body);assert.deepEqual(retained,denied);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM veyra_dot_records WHERE kind='notification' AND scope_key=?").get(scopeKey(denied.scope)).n,0);
});
test("one unavailable run does not abort another operation in the same authorized scope",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const healthy=f.runtime.service.page(f.actor,f.scope,"operation").data[0];
 const unavailable={...healthy,id:"000-unavailable",runId:"missing-run"};insertOperation(f,unavailable);assert.equal(f.runtime.recoverOperations(),2);
 assert.equal(f.runtime.service.get(f.actor,f.scope,"operation",healthy.id).state,"running");assert.deepEqual(f.runtime.service.get(f.actor,f.scope,"operation",unavailable.id),unavailable);assert.equal(f.diagnostics[0].error.code,"DOT_RUN_BINDING_CHANGED");assert.equal(f.launches.length,1);
});
test("recovery rechecks eligibility after denial and emits again only after a new denial transition",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const original=f.auth.require;let denied=true;
 f.auth.require=(...args)=>{if(denied)throw new DotError("DOT_FORBIDDEN");return original(...args);};
 f.runtime.recoverOperations(1);f.runtime.recoverOperations(1);assert.equal(f.diagnostics.length,1);
 denied=false;f.runtime.recoverOperations(1);assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].state,"running");
 denied=true;f.runtime.recoverOperations(1);assert.equal(f.diagnostics.length,2);assert.equal(f.launches.length,1);
});
test("unexpected core storage failures propagate without changing operation state or hiding the first failure",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);
 f.core.jobs.getJobRun=()=>{throw Error("first fatal core read");};assert.throws(()=>f.runtime.recoverOperations(),/first fatal core read/);assert.equal(f.runtime.service.page(f.actor,f.scope,"operation").data[0].state,"claimed");assert.equal(f.diagnostics.length,0);assert.equal(f.launches.length,1);
});

test("a denied prefix longer than one batch remains fair and diagnostic retention is bounded",async t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();f.tick();await f.runtime.dispatchJob("project","job",f.isActive);const healthy=f.runtime.service.page(f.actor,f.scope,"operation").data[0];
 const denied=[];for(let i=0;i<110;i++){const op={...healthy,id:"000-denied-"+String(i).padStart(3,"0"),scope:{...f.scope,ownerUserId:"revoked-owner"},state:"cancel_requested",runId:"revoked-run-"+i};insertOperation(f,op);denied.push(op);}
 let deniedChecks=0;const require=f.auth.require;f.auth.require=(a,s,...rest)=>{if(s.ownerUserId==="revoked-owner"){deniedChecks++;throw new DotError("DOT_FORBIDDEN");}return require(a,s,...rest);};
 assert.equal(f.runtime.recoverOperations(100),100);assert.equal(f.diagnostics.length,100);assert.equal(f.runtime.service.get(f.actor,f.scope,"operation",healthy.id).state,"claimed");
 assert.equal(f.runtime.recoverOperations(100),11);assert.equal(f.diagnostics.length,110);assert.equal(f.runtime.service.get(f.actor,f.scope,"operation",healthy.id).state,"running");
 const emitted=f.diagnostics.length;assert.equal(f.runtime.recoverOperations(100),100);assert.ok(f.diagnostics.length>emitted,"old denial diagnostics must be evicted rather than retained without bound");assert.ok(f.diagnostics.length<=emitted+100);assert.equal(f.diagnostics[emitted].runId,denied[0].runId);assert.equal(deniedChecks,210);
 for(const op of denied)assert.deepEqual(JSON.parse(f.db.prepare("SELECT body FROM veyra_dot_records WHERE id=?").get(op.id).body),op);
 await f.runtime.dispatchJob("project","job",f.isActive);assert.equal(f.launches.length,1);assert.equal(f.cancellations.length,0);
});
