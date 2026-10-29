import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, openSync, closeSync, realpathSync, lstatSync, readdirSync, readlinkSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DotRepository } from "../lib/dot-v2/repository.ts";
import { collectProactiveSuggestions } from "../lib/dot-v2/proactive.ts";
import { DotService, DotError } from "../lib/dot-v2/service.ts";
const scope={organizationId:"org",ownerUserId:"user",projectId:"p",executionBindingId:"native",executionBindingFingerprint:"host-native/workspace-immutable/epoch-1/revision-1",conversationId:"chat"};
const actor={id:"user",organizationId:"org"};
function fixture(path=":memory:") {
 const db=new DatabaseSync(path);
 db.exec(readFileSync(new URL("../lib/dot-v2/schema.sql",import.meta.url),"utf8"));
 let clock="2026-10-29T00:00:00.000Z", sequence=0, allowed=true, memory=true, sourceAllowed=true;
 const transaction=fn=>{db.exec("BEGIN IMMEDIATE");try{const result=fn();db.exec("COMMIT");return result;}catch(e){db.exec("ROLLBACK");throw e;}};
 const repo=new DotRepository(db,transaction), states=new Map(), claims=[], cancels=[], checks=[];
 const job={id:"job",revision:1,scheduleRevision:1,scope,prompt:"Check task progress",enabled:true,cron:null,capabilities:["read"]};
 const auth={require(a,s,action,caps){checks.push({action,caps});if(!allowed)throw Error("denied");},requireSource(){if(!sourceAllowed)throw new DotError("DOT_SOURCE_REVOKED");if(!allowed)throw Error("denied");},canReadMemory(){return memory;}};
 const jobs={readAuthorizedJob(){return job;},claim(j,at,policy){claims.push({at,policy});states.set("run"+claims.length,"running");return {runId:"run"+claims.length};},requestCancellation(s,id){cancels.push(id);},inspect(s,id){return states.get(id)??"unknown";}};
 const create=()=>new DotService(repo,auth,jobs,()=>clock,()=>"id"+(++sequence));
 const api=create();
 const suggestion=(extra={})=>api.propose(actor,scope,{title:"Check progress",prompt:job.prompt,source:{kind:"user",reference:"message"},capabilities:["read"],expiresAt:"2026-11-01T00:00:00.000Z",...extra});
 const approve=(s=suggestion(),extra={})=>api.approve(actor,scope,s.id,0,{jobId:job.id,schedule:{kind:"interval",anchor:clock,minutes:60},missedPolicy:"latest",notificationPolicy:"meaningful",...extra});
 return {db,repo,api,create,job,states,claims,cancels,checks,jobs,suggestion,approve,tick(v){clock=v;},deny(){allowed=false;},memoryOff(){memory=false;},sourceOff(){sourceAllowed=false;}};
}
test("suggestions never schedule automatically; approval binds exact scope, prompt and capabilities", t=>{
 const f=fixture();t.after(()=>f.db.close());const s=f.suggestion();
 assert.equal(f.repo.page("followup",scope).data.length,0);assert.equal(f.claims.length,0);
 f.job.prompt="changed";assert.throws(()=>f.approve(s),/DOT_JOB_BINDING_CHANGED/);
 f.job.prompt="Check task progress";const follow=f.approve(s);
 assert.equal(follow.jobId,"job");assert.throws(()=>f.approve(s),/Suggestion changed/);
 assert.equal(f.repo.get("suggestion",s.id,scope).state,"approved");
});
test("cross-user/org/project/runtime/thread access fails closed; memory revocation suppresses suggestions",t=>{
 const f=fixture();t.after(()=>f.db.close());const s=f.suggestion({source:{kind:"memory",reference:"receipt"}});
 assert.throws(()=>f.api.page({...actor,id:"other"},scope,"suggestion"),/FORBIDDEN/);
 assert.throws(()=>f.api.page({...actor,organizationId:"other"},scope,"suggestion"),/FORBIDDEN/);
 for(const other of [{projectId:"other"},{executionBindingId:"wsl"},{executionBindingFingerprint:"epoch-2"},{conversationId:"other"}]) assert.equal(f.api.page(actor,{...scope,...other},"suggestion").data.length,0);
 f.memoryOff();assert.equal(f.api.page(actor,scope,"suggestion").data.length,0);assert.throws(()=>f.approve(s),/MEMORY_DISABLED/);
});
test("restart reuses durable cursor and operations; unknown outcomes never launch another run",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T03:10:00.000Z");
 const first=f.api.reconcile(actor,scope,follow.id);assert.equal(first.skipped,2);assert.equal(f.claims.length,1);assert.equal(f.claims[0].policy,"existing-grants-only");
 const restarted=f.create();assert.equal(restarted.reconcile(actor,scope,follow.id).operations.length,0);assert.equal(f.claims.length,1);
 f.states.delete("run1");restarted.recover(actor,scope);assert.equal(f.repo.get("operation",first.operations[0].id,scope).state,"unknown");assert.equal(f.claims.length,1);
});
test("cancel persists intent, retries idempotent runner cancellation after restart, and waits for terminal evidence",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const op=f.api.reconcile(actor,scope,follow.id).operations[0];
 const current=f.repo.get("followup",follow.id,scope);f.api.cancel(actor,scope,follow.id,current.revision);
 assert.equal(f.repo.get("operation",op.id,scope).state,"cancel_requested");assert.deepEqual(f.cancels,["run1"]);
 f.states.set("run1","cancelled");f.create().recover(actor,scope);assert.equal(f.repo.get("operation",op.id,scope).state,"cancelled");
 f.tick("2026-10-29T05:00:00.000Z");assert.equal(f.api.reconcile(actor,scope,follow.id).operations.length,0);assert.equal(f.claims.length,1);
});
test("revoked authorization and changed job never dispatch; transaction failures retain cursor and first outcome",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");
 f.job.revision++;assert.throws(()=>f.api.reconcile(actor,scope,follow.id),/BINDING_CHANGED/);assert.equal(f.claims.length,0);assert.equal(f.repo.get("followup",follow.id,scope).cursor,follow.cursor);
 f.job.revision--;f.deny();assert.throws(()=>f.api.reconcile(actor,scope,follow.id),/denied/);assert.equal(f.claims.length,0);
});
test("notifications are internal, meaningful-only and deduplicated; operation history paginates",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const op=f.api.reconcile(actor,scope,follow.id).operations[0];
 f.states.set("run1","success");f.api.recover(actor,scope);
 assert.equal(f.api.notify(actor,scope,op.id,false),null);
 assert.ok(f.api.notify(actor,scope,op.id,true));assert.ok(f.api.notify(actor,scope,op.id,true));assert.equal(f.repo.page("notification",scope).data.length,1);
 assert.equal(f.api.page(actor,scope,"operation","",1).data.length,1);assert.throws(()=>f.api.page(actor,scope,"operation","",101));
});

test("paused followups keep their cursor; resume uses configured missed policy",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();
 const paused=f.api.setPaused(actor,scope,follow.id,0,true);f.tick("2026-10-29T03:10:00.000Z");assert.equal(f.api.reconcile(actor,scope,follow.id).operations.length,0);
 f.api.setPaused(actor,scope,follow.id,paused.revision,false);const result=f.api.reconcile(actor,scope,follow.id);assert.equal(f.claims.length,1);assert.equal(result.skipped,2);
 assert.throws(()=>f.api.setPaused(actor,scope,follow.id,paused.revision,true),/changed/);
});
test("external-message capability is never inferred or granted by suggestion approval",t=>{
 const f=fixture();t.after(()=>f.db.close());const s=f.suggestion();f.job.capabilities.push("external-message");assert.throws(()=>f.approve(s),/BINDING_CHANGED/);assert.equal(f.claims.length,0);
});
test("dismissed and expired suggestions cannot execute; notifications retain read state",t=>{
 const f=fixture();t.after(()=>f.db.close());const dismissed=f.suggestion();f.api.dismiss(actor,scope,dismissed.id,0);assert.throws(()=>f.approve(dismissed),/changed/);
 assert.throws(()=>f.suggestion({expiresAt:"2026-10-28T00:00:00.000Z"}),/EXPIRED/);
 const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const op=f.api.reconcile(actor,scope,follow.id).operations[0];f.states.set("run1","failed");f.api.recover(actor,scope);const n=f.api.notify(actor,scope,op.id,false);f.api.markRead(actor,scope,n.id,0);assert.equal(f.repo.get("notification",n.id,scope).read,true);
 assert.equal(f.api.notify(actor,scope,op.id,false).read,true);
});
test("unknown cancellation remains requested and restart cannot silently turn it into a finished cancellation",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const op=f.api.reconcile(actor,scope,follow.id).operations[0];f.states.delete("run1");
 const current=f.repo.get("followup",follow.id,scope);f.api.cancel(actor,scope,follow.id,current.revision);f.create().recover(actor,scope);assert.equal(f.repo.get("operation",op.id,scope).state,"cancel_requested");assert.equal(f.cancels.length,2);assert.ok(f.api.notify(actor,scope,op.id,false));
});
test("one live followup owns each job; a failed competing approval rolls back suggestion state",t=>{
 const f=fixture();t.after(()=>f.db.close());f.approve();const s=f.suggestion();assert.throws(()=>f.approve(s),/active follow-up/);assert.equal(f.repo.get("suggestion",s.id,scope).state,"proposed");assert.equal(f.repo.page("followup",scope).data.length,1);
});

test("SQLite close/reopen retains approved work, cursor, operation and unknown outcome without re-dispatch",t=>{
 for(const proc of readdirSync("/proc").filter(p=>Number.isInteger(Number(p)))){
  try{readdirSync(`/proc/${proc}/fd`);}catch(e){if(e.code==="ENOENT")continue;if(["EACCES","EPERM"].includes(e.code)){t.skip("Disk fixture not generated: cannot inspect every process descriptor for cleanup safety");return;}throw e;}
 }
 const root="/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/dot";
 const path=resolve(root,`restart-proof-${process.pid}.sqlite`);
 assert.equal(realpathSync(dirname(path)),realpathSync(root));
 const fd=openSync(path,"wx",0o600);closeSync(fd);
 let f;
 try {
  f=fixture(path);const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const op=f.api.reconcile(actor,scope,follow.id).operations[0];f.db.close();f=undefined;
  f=fixture(path);f.tick("2026-10-29T01:00:00.000Z");assert.equal(f.repo.get("followup",follow.id,scope).cursor,"2026-10-29T01:00:00.000Z");
  assert.equal(f.api.reconcile(actor,scope,follow.id).operations.length,0);f.api.recover(actor,scope);assert.equal(f.repo.get("operation",op.id,scope).state,"unknown");assert.equal(f.claims.length,0);
 } finally {
  f?.db.close();
  assert.equal(realpathSync(path),path);const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  // Only this test creates this exclusive, mode-0600 disposable DB; no container/mount receives it.
  for(const proc of readdirSync("/proc").filter(p=>Number.isInteger(Number(p)))){
   let descriptors;try{descriptors=readdirSync(`/proc/${proc}/fd`);}catch(e){if(e.code==="ENOENT")continue;throw e;}
   for(const descriptor of descriptors){let target;try{target=readlinkSync(`/proc/${proc}/fd/${descriptor}`);}catch(e){if(e.code==="ENOENT")continue;throw e;}assert.notEqual(target,path,"Active process still holds test DB");}
  }
  assert.ok(!readFileSync("/proc/self/mountinfo","utf8").split("\n").some(line=>line.split(" ")[4]===path));
  unlinkSync(path);console.log(`Removed ${path}: ${stat.size} bytes; regeneration: this SQLite reopen test`);
 }
});

test("catch-up drains one occurrence per tick; known quota denial retains cursor, unknown outcomes do not replay",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve(undefined,{missedPolicy:"all"});f.tick("2026-10-29T03:10:00.000Z");
 const claim=f.jobs.claim;f.jobs.claim=()=>({blocked:"Automation concurrency quota is full",retryable:true});
 const blocked=f.api.reconcile(actor,scope,follow.id);assert.equal(blocked.operations[0].state,"blocked");assert.equal(f.repo.get("followup",follow.id,scope).cursor,follow.cursor);
 f.jobs.claim=claim;const first=f.api.reconcile(actor,scope,follow.id);assert.equal(first.operations[0].scheduledFor,"2026-10-29T01:00:00.000Z");assert.equal(first.operations[0].revision,1);
 assert.equal(f.repo.get("followup",follow.id,scope).cursor,"2026-10-29T01:00:00.000Z");
 const second=f.api.reconcile(actor,scope,follow.id);assert.equal(second.operations[0].scheduledFor,"2026-10-29T02:00:00.000Z");assert.equal(f.claims.length,2);
});

test("claim and Dot operation roll back together on the same SQLite connection",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");
 f.db.exec("CREATE TABLE claim_probe(id TEXT); CREATE TRIGGER reject_dot_op BEFORE INSERT ON veyra_dot_records WHEN NEW.kind='operation' BEGIN SELECT RAISE(ABORT,'fixture operation persistence failure'); END;");
 f.jobs.claim=()=>{f.db.prepare("INSERT INTO claim_probe(id) VALUES(?)").run("run");return {runId:"run"};};
 assert.throws(()=>f.api.reconcile(actor,scope,follow.id),/fixture operation persistence failure/);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM claim_probe").get().n,0);assert.equal(f.repo.get("followup",follow.id,scope).cursor,follow.cursor);assert.equal(f.repo.page("operation",scope).data.length,0);
});

test("repeated latest-capacity rejection does not duplicate skipped history or notify unchanged busy state",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T03:10:00.000Z");
 const claim=f.jobs.claim;f.jobs.claim=()=>({blocked:"Automation concurrency quota is full",retryable:true});
 const first=f.api.reconcile(actor,scope,follow.id);assert.equal(first.skipped,2);assert.equal(f.api.notify(actor,scope,first.operations[0].id,false),null);
 assert.doesNotThrow(()=>f.api.reconcile(actor,scope,follow.id));assert.equal(f.repo.page("operation",scope).data.length,2);
 f.jobs.claim=claim;assert.equal(f.api.reconcile(actor,scope,follow.id).operations[0].state,"claimed");assert.equal(f.claims.length,1);
});

test("explicit missed-run recovery crosses a long offline window without replaying old work",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve(undefined,{missedPolicy:"all"});f.tick("2026-11-29T00:00:00.000Z");
 assert.throws(()=>f.api.reconcile(actor,scope,follow.id),/eight days/);assert.equal(f.repo.get("followup",follow.id,scope).cursor,follow.cursor);
 const next=f.api.skipMissed(actor,scope,follow.id,0);assert.equal(next.cursor,"2026-11-29T00:00:00.000Z");assert.equal(next.state,"active");assert.equal(f.claims.length,0);
 const history=f.repo.page("operation",scope).data;assert.equal(history.length,1);assert.equal(history[0].state,"skipped");assert.equal(history[0].code,`USER_SKIPPED_RANGE:${follow.cursor}`);
 assert.throws(()=>f.api.skipMissed(actor,scope,follow.id,0),/changed/);
 f.tick("2026-11-29T01:00:00.000Z");assert.equal(f.api.reconcile(actor,scope,follow.id).operations[0].scheduledFor,"2026-11-29T01:00:00.000Z");assert.equal(f.claims.length,1);
});
test("missed-run recovery preserves active runs, pause state and authorization; clock reversal changes nothing",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();f.tick("2026-10-29T01:00:00.000Z");const running=f.api.reconcile(actor,scope,follow.id).operations[0];
 const current=f.repo.get("followup",follow.id,scope);const paused=f.api.setPaused(actor,scope,follow.id,current.revision,true);
 f.tick("2026-10-29T00:30:00.000Z");assert.throws(()=>f.api.skipMissed(actor,scope,follow.id,paused.revision),/CLOCK_REVERSED/);
 f.tick("2026-11-29T00:00:00.000Z");const skipped=f.api.skipMissed(actor,scope,follow.id,paused.revision);assert.equal(skipped.state,"paused");assert.equal(f.repo.get("operation",running.id,scope).state,"claimed");assert.equal(f.cancels.length,0);
 f.deny();assert.throws(()=>f.api.skipMissed(actor,scope,follow.id,skipped.revision),/denied/);
});

test("revoked source provenance disappears from collection reads and cannot approve or dispatch",t=>{
 const f=fixture();t.after(()=>f.db.close());const pending=f.suggestion();const follow=f.approve();f.sourceOff();
 assert.equal(f.api.page(actor,scope,"suggestion").data.length,0);
 assert.throws(()=>f.api.get(actor,scope,"suggestion",pending.id),/SOURCE_REVOKED/);
 assert.throws(()=>f.approve(pending),/SOURCE_REVOKED/);
 f.tick("2026-10-29T01:00:00.000Z");assert.throws(()=>f.api.reconcile(actor,scope,follow.id),/SOURCE_REVOKED/);assert.equal(f.claims.length,0);
});

test("proactive source admission is opt-in, scoped, stable across restart and never schedules a task",t=>{
 const f=fixture();t.after(()=>f.db.close());let enabled=false,reads=0;
 const input={title:"Review task progress",prompt:"Check task progress",source:{kind:"event",reference:"eligible-source/revision-1"},capabilities:["read"],expiresAt:"2026-11-01T00:00:00.000Z"};
 const sources={isEnabled(a,s){assert.deepEqual(a,actor);assert.deepEqual(s,scope);return enabled;},readEligible(a,s,limit){reads++;assert.equal(limit,20);return [input];}};
 assert.deepEqual(collectProactiveSuggestions(f.api,actor,scope,sources),[]);assert.equal(reads,0);
 enabled=true;const first=collectProactiveSuggestions(f.api,actor,scope,sources)[0];const again=collectProactiveSuggestions(f.create(),actor,scope,sources)[0];assert.equal(first.id,again.id);assert.equal(f.repo.page("suggestion",scope).data.length,1);assert.equal(f.repo.page("followup",scope).data.length,0);assert.equal(f.claims.length,0);
 f.api.dismiss(actor,scope,first.id,0);assert.equal(collectProactiveSuggestions(f.create(),actor,scope,sources)[0].state,"dismissed");
 assert.throws(()=>f.api.proposeForSource(actor,scope,{...input,prompt:"Changed source meaning"}),/SOURCE_CONFLICT/);
 f.sourceOff();assert.throws(()=>collectProactiveSuggestions(f.api,actor,scope,sources),/SOURCE_REVOKED/);
});
test("proactive batches reject excess sources; memory read denial cannot persist a generated suggestion",t=>{
 const f=fixture();t.after(()=>f.db.close());assert.throws(()=>collectProactiveSuggestions(f.api,actor,scope,{isEnabled:()=>true,readEligible:()=>Array(21).fill({})}),/VALIDATION/);
 f.memoryOff();assert.throws(()=>f.api.proposeForSource(actor,scope,{title:"Review",prompt:"Check",source:{kind:"memory",reference:"receipt"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"}),/MEMORY_DISABLED/);assert.equal(f.repo.page("suggestion",scope).data.length,0);
});

test("proactive permission denial happens before source discovery or read",t=>{
 const f=fixture();t.after(()=>f.db.close());f.deny();let reads=0;
 assert.throws(()=>collectProactiveSuggestions(f.api,actor,scope,{isEnabled(){reads++;return true;},readEligible(){reads++;return [];}}),/denied/);assert.equal(reads,0);
});

test("scheduler progress preserves user-control revision and coalesces idle ticks",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();
 f.tick("2026-10-29T00:00:10.000Z");assert.deepEqual(f.api.reconcile(actor,scope,follow.id).operations,[]);
 assert.equal(f.repo.get("followup",follow.id,scope).cursor,follow.cursor);
 f.tick("2026-10-29T00:01:00.000Z");f.api.reconcile(actor,scope,follow.id);
 const progress=f.repo.get("followup",follow.id,scope);assert.equal(progress.cursor,"2026-10-29T00:01:00.000Z");assert.equal(progress.revision,follow.revision);
 f.tick("2026-10-29T01:00:00.000Z");f.api.reconcile(actor,scope,follow.id);assert.equal(f.repo.get("followup",follow.id,scope).revision,follow.revision);
 assert.doesNotThrow(()=>f.api.setPaused(actor,scope,follow.id,follow.revision,true));
});
test("cursor CAS rejects stale progress and user changes without overwriting pause or cursor",t=>{
 const f=fixture();t.after(()=>f.db.close());const follow=f.approve();
 f.repo.advanceFollowupCursor(follow,"2026-10-29T00:01:00.000Z");
 assert.throws(()=>f.repo.advanceFollowupCursor(follow,"2026-10-29T00:02:00.000Z"),/progress changed/);
 const fresh=f.repo.get("followup",follow.id,scope);const paused=f.api.setPaused(actor,scope,follow.id,0,true);
 assert.throws(()=>f.repo.advanceFollowupCursor(fresh,"2026-10-29T00:02:00.000Z"),/progress changed/);
 assert.equal(f.repo.get("followup",follow.id,scope).state,"paused");assert.equal(f.repo.get("followup",follow.id,scope).cursor,paused.cursor);
 assert.throws(()=>f.repo.advanceFollowupCursor(paused,"2026-10-29T00:00:00.000Z"),/backward/);
});

test("suggestions retain only declared DTO fields and preserve exact prompt bytes",t=>{
 const f=fixture();t.after(()=>f.db.close());const prompt="  Review this task\nwithout rewriting its content.  ";const value=f.suggestion({prompt,unexpected:{large:"untrusted extra payload"},source:{kind:"user",reference:"message",instructions:"untrusted extra source data"}});
 assert.equal(value.prompt,prompt);assert.equal("unexpected" in value,false);assert.deepEqual(value.source,{kind:"user",reference:"message"});const stored=f.repo.get("suggestion",value.id,scope);assert.equal("unexpected" in stored,false);assert.equal("instructions" in stored.source,false);
});
test("invalid capability sizes/types are rejected before per-capability authorization or persistence",t=>{
 const f=fixture();t.after(()=>f.db.close());const initialChecks=f.checks.length;
 for(const capabilities of [Array(33).fill("read"),[{}],[""],null,"read"]){assert.throws(()=>f.suggestion({capabilities}),/VALIDATION/);}
 assert.equal(f.checks.length,initialChecks);assert.equal(f.repo.page("suggestion",scope).data.length,0);
});
test("source-idempotent admission validates malformed replay inputs rather than treating them as a match",t=>{
 const f=fixture();t.after(()=>f.db.close());const input={title:"Review",prompt:"Check progress",source:{kind:"event",reference:"same-source/revision-1"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"};
 const first=f.api.proposeForSource(actor,scope,input);
 for(const extra of [{capabilities:undefined},{capabilities:""},{expiresAt:"bad"},{source:{kind:"event",reference:"same-source/revision-1"},title:""}])assert.throws(()=>f.api.proposeForSource(actor,scope,{...input,...extra}),/VALIDATION/);
 assert.equal(f.repo.page("suggestion",scope).data.length,1);assert.equal(f.repo.get("suggestion",first.id,scope).prompt,input.prompt);
});

test("missing nullable scope fields cannot alias explicit projectless or conversationless records",t=>{
 const f=fixture();t.after(()=>f.db.close());const projectless={...scope,projectId:null,conversationId:null};
 f.api.propose(actor,projectless,{title:"Private suggestion",prompt:"Review private work",source:{kind:"user",reference:"private-message"},capabilities:[],expiresAt:"2026-11-01T00:00:00.000Z"});
 assert.equal(f.api.page(actor,projectless,"suggestion").data.length,1);
 for(const invalid of [{...projectless,projectId:undefined},{...projectless,conversationId:undefined},{...projectless,projectId:""},{...projectless,conversationId:""}])assert.throws(()=>f.api.page(actor,invalid,"suggestion"),/FORBIDDEN/);
 assert.throws(()=>f.api.page(null,projectless,"suggestion"),/FORBIDDEN/);
});
