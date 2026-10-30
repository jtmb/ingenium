import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {stripTypeScriptTypes} from "node:module";
const sha=value=>createHash("sha256").update(value).digest("hex");
const manifest=JSON.parse(readFileSync(new URL("./settlement-proposal.json",import.meta.url),"utf8"));
const original=readFileSync(new URL("../../../services/ingenium-api/lib/job-runner.ts",import.meta.url),"utf8");
const patch=readFileSync(new URL("./job-runner-settlement.patch",import.meta.url),"utf8");
assert.equal(sha(original),manifest.sourceSha256,"Proposal must be rebased if the existing runner changes");assert.equal(sha(patch),manifest.patchSha256);
function applyInMemory(source,unified){
 const lines=source.match(/.*\n|.+$/g)??[],out=[];let cursor=0;
 for(const chunk of unified.split(/^@@ /m).slice(1)){
  const [header,...body]=chunk.match(/.*\n|.+$/g)??[];const old=header.match(/^-(\d+)(?:,(\d+))?/);const start=Number(old[1])-(old[2]==="0"?0:1);out.push(...lines.slice(cursor,start));cursor=start;
  for(const line of body){if(line[0]===" "){assert.equal(lines[cursor++],line.slice(1));out.push(line.slice(1));}else if(line[0]==="-")assert.equal(lines[cursor++],line.slice(1));else if(line[0]==="+")out.push(line.slice(1));}
 }
 out.push(...lines.slice(cursor));return out.join("");
}
const proposed=applyInMemory(original,patch);
const between=(start,end)=>{const a=proposed.indexOf(start),b=proposed.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return proposed.slice(a,b);};
const helpers=between("/** Only unresolved entries","function cloneIdentity");assert.equal(sha(helpers),manifest.helperSha256);assert.equal(readFileSync(new URL("./settlement-seam.proposal.ts",import.meta.url),"utf8"),helpers);
// Execute the exact proposed export and the existing identity/group verifier in a closed fake runtime.
// This never imports the real runner, starts timers, signals processes, writes files or opens a DB.
const extracted=helpers+
 between("function matchesIdentity(","function scheduleGroupRecovery(")+
 between("function verifyOwnedGroupTeardown(","type NonceRecoverySelection")+
 between("function trackRecoveredDetachedProcess(","function markVaultRunTeardownPending(")+
 between("function signalOwnedGroup(","function signalOwnedProcess(");
const executable=stripTypeScriptTypes(extracted.replaceAll("export ",""),{mode:"strip"});
function fixture(){
 const nonce="unique-run-nonce",leader={processId:11,processGroupId:11,sessionId:11,startTime:"100",executable:"/owned/engine",runNonce:nonce,ownerId:1000};
 const state={leader,members:[leader],readable:true,groupReads:0,signals:[],cleaned:[],pending:[],run:{id:"run",project_id:"project",job_id:"job",status:"running"}};
 const names=["ownedDetachedRuns","runProjects","forceKillTimers","terminationCompletions","resolveEscalations","teardownAttempts","runningProcesses","closePromises","groupRecoveryTimers"];
 const maps=Object.fromEntries(names.map(name=>[name,new Map()]));
 const ports={...maps,supportsOwnedProcessGroups:true,jobs:{getJobRun:()=>state.run},jobRunnerRuntime:{processInspector:{inspectProcess:()=>state.leader,inspectGroup(id){state.groupReads++;return state.readable?{processGroupId:id,members:state.members}:null;}},signalProcessGroup:(...args)=>state.signals.push(args)},hashNonce:value=>value?sha(value):null,cloneIdentity:value=>({...value}),recordTrackingEvent:(tracked,event,detail)=>tracked.events.push({event,detail,at:0}),clearGroupRecoveryTimer:id=>maps.groupRecoveryTimers.delete(id),scheduleGroupRecovery:tracked=>maps.groupRecoveryTimers.set(tracked.runId,"fake pending recovery"),finalizeVaultRunAfterVerifiedTeardown:id=>state.cleaned.push(id),markVaultRunTeardownPending:id=>state.pending.push(id)};
 const api=new Function("ports",`const {${Object.keys(ports).join(",")}}=ports;\n${executable}\nreturn {inspectOwnedJobRun,verifyOwnedGroupTeardown,trackDetachedProcess,trackRecoveredDetachedProcess,pendingDetachedRun,signalOwnedGroup};`)(ports);
 const track=(id="run",project="project",job="job")=>{api.trackDetachedProcess(project,job,id,11,nonce);return maps.ownedDetachedRuns.get(id);};
 return {state,maps,api,track,inspect:()=>api.inspectOwnedJobRun("project","run")};
}
test("whole proposed TypeScript parses and all original pending registry reads are factored",()=>{
 assert.ok(stripTypeScriptTypes(proposed,{mode:"strip"}).length>0);
 assert.equal((proposed.match(/ownedDetachedRuns\.get\(/g)??[]).length,3); // pending accessor, retirement guard, production inspector
 assert.equal((proposed.match(/ownedDetachedRuns\.has\(/g)??[]).length,0);
 assert.match(proposed,/trackDetachedProcess\(job.project_id, job.id, runId, proc.pid, runNonce\)/);
 assert.match(proposed,/if \(tracked.retiredAt !== undefined \|\| groupRecoveryTimers.has/);
});
test("missing map and cancelled DB row cannot prove settlement",()=>{
 const f=fixture();f.state.run.status="cancelled";assert.equal(f.inspect().state,"unknown");assert.equal(f.state.groupReads,0);
});
test("leader disappearance with trusted live descendants remains active",()=>{
 const f=fixture();f.track();f.state.leader=null;f.state.members=[{...f.state.members[0],processId:12,startTime:"101",executable:"/owned/child"}];assert.equal(f.maps.runningProcesses.size,0);assert.equal(f.maps.runProjects.size,0);assert.equal(f.inspect().state,"active");assert.equal(f.maps.ownedDetachedRuns.get("run").knownMembers.has(12),true);
});
test("missing captured leader remains unknown even for an apparently empty group",()=>{
 const f=fixture();f.state.leader=null;const tracked=f.track();f.state.members=[];assert.equal(f.api.verifyOwnedGroupTeardown(tracked),false);assert.equal(f.inspect().state,"unknown");assert.equal(tracked.retiredAt,undefined);
});
test("unreadable group, foreign nonce and recycled process identity remain unknown",()=>{
 for(const mutate of [f=>f.state.readable=false,f=>f.state.members=[{...f.state.leader,runNonce:"foreign"}],f=>f.state.members=[{...f.state.leader,startTime:"recycled"}],f=>f.state.members=[{...f.state.leader,ownerId:2000}]]){const f=fixture(),tracked=f.track();mutate(f);assert.equal(f.inspect().state,"unknown");assert.equal(f.api.verifyOwnedGroupTeardown(tracked),false);assert.equal(tracked.retiredAt,undefined);}
});
test("each unresolved escalation owner blocks a positive or active verdict",()=>{
 for(const name of ["forceKillTimers","terminationCompletions","resolveEscalations","teardownAttempts"]){const f=fixture();f.track();f.maps[name].set("run",{});assert.deepEqual(f.inspect(),{state:"unknown",reason:"lifecycle-pending"});assert.equal(f.state.signals.length,0);}
});
test("read-side empty group observation cannot retire ownership or clean runtime files",()=>{
 const f=fixture(),tracked=f.track();f.state.members=[];assert.equal(f.inspect().state,"unknown");assert.equal(tracked.retiredAt,undefined);assert.equal(f.state.cleaned.length,0);
});
test("positive existing verifier retirement can settle only after every lifecycle gate clears",()=>{
 for(const name of ["runningProcesses","closePromises","groupRecoveryTimers","forceKillTimers","terminationCompletions","resolveEscalations","teardownAttempts"]){
  const f=fixture(),tracked=f.track();f.state.members=[];assert.equal(f.api.verifyOwnedGroupTeardown(tracked),true);f.maps[name].set("run",{});assert.equal(f.inspect().state,"unknown");f.maps[name].delete("run");assert.deepEqual(f.inspect(),{state:"settled",reason:"owned-group-retired"});assert.equal(f.state.cleaned.length,1);assert.equal(f.api.pendingDetachedRun("run"),undefined);
 }
});
test("retirement preserves project/run/job/process identity and compacts descendant history",()=>{
 const f=fixture(),tracked=f.track();f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);assert.equal(f.maps.ownedDetachedRuns.get("run"),tracked);assert.deepEqual([tracked.projectId,tracked.runId,tracked.jobId,tracked.leader.processId,tracked.leader.startTime],["project","run","job",11,"100"]);assert.equal(tracked.runNonceHash,sha("unique-run-nonce"));assert.equal(tracked.knownMembers.size,0);assert.equal(tracked.events.length,0);assert.equal(tracked.lastObservedGroupMembers.length,0);
});
test("retired identity is not signalled or cleaned twice by a stale continuation",()=>{
 const f=fixture(),tracked=f.track();f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);const reads=f.state.groupReads;f.api.signalOwnedGroup("run","SIGKILL");assert.equal(f.api.verifyOwnedGroupTeardown(tracked),true);assert.equal(f.state.signals.length,0);assert.equal(f.state.groupReads,reads);assert.equal(f.state.cleaned.length,1);
});
test("foreign project or replaced run/job binding cannot use the receipt",()=>{
 for(const mutate of [f=>f.state.run.project_id="other",f=>f.state.run.id="other",f=>f.state.run.job_id="other",f=>f.state.run=undefined,f=>f.maps.runProjects.set("run","other")]){const f=fixture(),tracked=f.track();f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);mutate(f);assert.equal(f.inspect().state,"unknown");}
 const f=fixture();f.track();assert.equal(f.api.inspectOwnedJobRun("foreign","run").state,"unknown");
});
test("controller restart loses the receipt and stays unknown despite persisted terminal status",()=>{
 const f=fixture(),tracked=f.track();f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);assert.equal(f.inspect().state,"settled");const restarted=fixture();restarted.state.run={...f.state.run,status:"cancelled"};assert.equal(restarted.inspect().state,"unknown");
});
test("trusted existing recovery captures actual project/job before any retirement",()=>{
 const f=fixture();const tracked=f.api.trackRecoveredDetachedProcess({runId:"run",projectId:"project",jobId:"job",processNonceHash:sha("unique-run-nonce")},f.state.leader);assert.equal(tracked.projectId,"project");assert.equal(f.inspect().state,"active");f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);assert.equal(f.inspect().state,"settled");
});
test("retirement retention is bounded; eviction returns unknown and pending ownership is preserved",()=>{
 const f=fixture(),pending=f.track("pending"),protectedReceipt=f.track("protected");f.state.members=[];f.api.verifyOwnedGroupTeardown(protectedReceipt);f.maps.terminationCompletions.set("protected",{});
 for(let i=0;i<260;i++){f.state.members=[f.state.leader];const tracked=f.track("retired-"+i);f.state.members=[];f.api.verifyOwnedGroupTeardown(tracked);}
 assert.equal(f.maps.ownedDetachedRuns.has("pending"),true);assert.equal(pending.retiredAt,undefined);assert.equal(f.maps.ownedDetachedRuns.has("protected"),true);assert.equal(f.maps.ownedDetachedRuns.has("retired-0"),false);assert.equal(f.api.inspectOwnedJobRun("project","retired-0").state,"unknown");assert.ok(f.maps.ownedDetachedRuns.size<=257);
});
