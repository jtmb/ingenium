import {test} from "node:test";
import assert from "node:assert/strict";
import {createManagedJobContainerOwner} from "./managed-job-owner.proposal.mjs";
const id=n=>`${String(n).padStart(8,"0")}-1111-4111-8111-111111111111`;
const hash=n=>String(n).repeat(64),clone=x=>structuredClone(x);
function fixture(){
 const a={runId:id(1),jobId:id(2),attemptId:id(3),runtimeId:id(4),projectId:id(5),organizationId:id(6),ownerUserId:id(7),workspaceId:"workspace",bindingHash:hash(1),bindingEpoch:1,runtimeRevision:3,provisioningRevision:2,jobRevision:4,scheduleRevision:5,grantRevision:6,profileId:"existing-protected-profile",profileHash:hash(2),promptHash:hash(3),specHash:hash(4),daemonId:"original-daemon",imageId:"sha256:"+hash(5),parentContainerId:hash(6),containerId:null,phase:"prepared",revision:0,cancelRequested:false};
 const parent={Id:a.parentContainerId,Name:"/ingenium-runtime-"+a.runtimeId.replaceAll("-",""),Image:a.imageId,State:{Running:true,Health:{Status:"healthy"}},Config:{Labels:{"com.ingenium.managed":"runtime-manager","com.ingenium.runtime.id":a.runtimeId,"com.ingenium.runtime.organization":a.organizationId,"com.ingenium.runtime.owner":a.ownerUserId,"com.ingenium.runtime.project":a.projectId,"com.ingenium.runtime.workspace":a.workspaceId,"com.ingenium.runtime.storage":a.bindingHash,"com.ingenium.runtime.security-epoch":"1","com.ingenium.runtime.revision":"2"}}};
 const state={a,parent,child:null,requests:[],effects:[],writes:[],handoffs:[],daemonId:a.daemonId,createUnknown:false,startUnknown:false,grant:true,waitError:false,waitWrongExit:false,replaceAfterWait:false,revokeAfterStart:false,missingAfterCreate:false,persistCreatedFails:false,claimDenied:false,coreTransaction:false};
 const core={async admit(runId,action){assert.equal(state.coreTransaction,false);if(runId!==a.runId||action==="launch"&&!state.grant)throw Object.assign(Error("revoked"),{code:"GRANT_REVOKED"});return clone(state.a);},async claimEffect(prior,kind){state.writes.push(kind+"_intent");if(state.claimDenied)return false;const allowed=kind==="create"?a.phase==="prepared":a.phase==="created";if(!allowed)return false;a.phase=kind+"_intent";a.revision++;return true;},async recordCreated(prior,containerId){if(state.persistCreatedFails)throw Error("lost acknowledgement");a.containerId=containerId;a.phase="created";a.revision++;state.writes.push("created");return clone(a);},async recordStarted(){a.phase="running";a.revision++;state.writes.push("started");},async recordUnknown(prior,phase){a.phase=phase+"_unknown";a.revision++;state.writes.push(a.phase);},async recordRemoved(){state.writes.push("removed");},async recordRetired(prior,proof){assert.equal(proof.containerId,a.containerId);state.writes.push("retired");a.phase="retired";}};
 const docker=async(method,path,body)=>{
  assert.equal(state.coreTransaction,false);state.requests.push({method,path});
  if(path==="/info")return {status:200,data:{ID:state.daemonId}};
  if(path.includes("/containers/ingenium-runtime-"))return {status:200,data:clone(state.parent)};
  if(path.startsWith("/containers/create?")){assert.equal(a.phase,"create_intent");state.effects.push("create");if(state.createUnknown)throw Error("timeout");const containerId=hash(7);state.child={Id:containerId,Name:"/"+decodeURIComponent(path.split("name=")[1]),Image:body.Image,Config:{Labels:clone(body.Labels)},State:{Running:false,Status:"created",ExitCode:0}};return {status:201,data:{Id:containerId}};}
  assert.ok(!path.includes(a.parentContainerId),"No parent container effect allowed");
  if(path.endsWith("/json"))return {status:state.child&&!state.missingAfterCreate?200:404,data:clone(state.child)};
  if(path.endsWith("/start")){assert.equal(a.phase,"start_intent");state.effects.push("start");if(state.startUnknown)throw Error("timeout");state.child.State={Running:true,Status:"running",ExitCode:0};if(state.revokeAfterStart)state.grant=false;return {status:204};}
  if(path.endsWith("/stop?t=5")){assert.equal(a.cancelRequested,true);state.effects.push("stop");state.child.State={Running:false,Status:"exited",ExitCode:137};return {status:204};}
  if(path.endsWith("/wait?condition=not-running")){state.effects.push("wait");if(state.waitError)return {status:200,data:{StatusCode:0,Error:{Message:"unconfirmed"}}};const exit=state.child.State.ExitCode;if(state.replaceAfterWait)state.child.Id=hash(8);return {status:200,data:{StatusCode:state.waitWrongExit?exit+1:exit}};}
  if(method==="DELETE"&&path.endsWith("?v=false")){state.effects.push("remove");state.child=null;return {status:204};}
  throw Error("Unexpected Docker path "+path);
 };
 const ports={core,docker,async buildRuntimeSpec(){return {capability:"ing_abcdefghijkl_"+"x".repeat(43),spec:{Image:a.imageId,WorkingDir:"/workspace",User:"1000:1000",Env:[],HostConfig:{AutoRemove:false,NetworkMode:"original-private-network",Binds:["/original/canonical/workspace:/workspace:rw,rprivate"]}}};},async handoff(containerId,admitted){assert.equal(containerId,a.containerId);assert.equal(admitted.runId,a.runId);state.handoffs.push(containerId);}};
 const owner=createManagedJobContainerOwner(ports),launch=()=>owner.launch({runId:a.runId,runtimeId:a.runtimeId});return {state,ports,owner,launch};
}
test("isolated original run creates once, persists receipt before start, and hands off only after authorization",async()=>{
 const f=fixture();assert.equal((await f.launch()).state,"active");assert.deepEqual(f.state.effects,["create","start"]);assert.deepEqual(f.state.writes,["create_intent","created","start_intent","started"]);assert.equal(f.state.handoffs.length,1);assert.notEqual(f.state.a.containerId,f.state.a.parentContainerId);assert.equal((await f.launch()).state,"unknown");assert.equal(f.state.effects.length,2);
});
test("caller container, command, owner or extra parameters are rejected before effects",async()=>{
 for(const extra of [{containerId:hash(8)},{command:["sh"]},{ownerGrant:true},{prompt:"inject"}]){const f=fixture();await assert.rejects(f.owner.launch({runId:f.state.a.runId,runtimeId:f.state.a.runtimeId,...extra}));assert.equal(f.state.effects.length,0);}
});
test("original runtime/workspace/epoch/image/daemon drift denies before create",async()=>{
 for(const mutate of [f=>f.state.parent.Id=hash(8),f=>f.state.parent.Image="sha256:"+hash(8),f=>f.state.parent.Config.Labels["com.ingenium.runtime.storage"]=hash(8),f=>f.state.parent.Config.Labels["com.ingenium.runtime.security-epoch"]="2",f=>f.state.daemonId="different",f=>f.state.parent.State.Health.Status="unhealthy"]){const f=fixture();mutate(f);await assert.rejects(f.launch());assert.equal(f.state.effects.length,0);}
});
test("grant denial and Core effect CAS denial never start a container",async()=>{
 const f=fixture();f.state.grant=false;await assert.rejects(f.launch());assert.equal(f.state.effects.length,0);const g=fixture();g.state.claimDenied=true;assert.equal((await g.launch()).state,"unknown");assert.equal(g.state.effects.length,0);
});
test("ambiguous create is never recreated or replayed",async()=>{
 const f=fixture();f.state.createUnknown=true;assert.equal((await f.launch()).code,"MANAGED_JOB_CREATE_UNKNOWN");await f.launch();assert.deepEqual(f.state.effects,["create"]);assert.equal(f.state.a.containerId,null);
});
test("created receipt acknowledgement loss never starts or replaces the original",async()=>{
 const f=fixture();f.state.persistCreatedFails=true;assert.equal((await f.launch()).code,"MANAGED_JOB_CREATE_PERSISTENCE_UNKNOWN");await f.launch();assert.deepEqual(f.state.effects,["create"]);assert.ok(f.state.child);
});
test("missing original created container blocks start",async()=>{
 const f=fixture();f.state.missingAfterCreate=true;assert.equal((await f.launch()).code,"MANAGED_JOB_ORIGINAL_CONTAINER_MISSING");assert.deepEqual(f.state.effects,["create"]);assert.equal(f.state.handoffs.length,0);
});
test("ambiguous start retains original identity and cannot replay handoff or create",async()=>{
 const f=fixture();f.state.startUnknown=true;assert.equal((await f.launch()).code,"MANAGED_JOB_START_UNKNOWN");await f.launch();assert.deepEqual(f.state.effects,["create","start"]);assert.equal(f.state.handoffs.length,0);assert.ok(f.state.a.containerId);
});
test("revocation between start and credential handoff denies job execution",async()=>{
 const f=fixture();f.state.revokeAfterStart=true;assert.equal((await f.launch()).state,"unknown");assert.equal(f.state.handoffs.length,0);assert.ok(f.state.a.containerId);
});
test("active container and leader/idle observations cannot imply positive settlement",async()=>{
 const f=fixture();await f.launch();f.state.child.diagnostic={leaderExited:true,engineIdle:true};assert.equal((await f.owner.inspect(f.state.a.runId)).state,"active");assert.equal(f.state.effects.includes("wait"),false);
});
test("cancel intent is required; cancellation joins only the original owned container",async()=>{
 const f=fixture();await f.launch();assert.equal((await f.owner.cancel(f.state.a.runId)).code,"MANAGED_JOB_CANCEL_INTENT_REQUIRED");f.state.a.cancelRequested=true;const result=await f.owner.cancel(f.state.a.runId);assert.equal(result.state,"settled");assert.deepEqual(f.state.effects,["create","start","stop","wait"]);assert.equal(result.proof.containerId,f.state.a.containerId);assert.equal(f.state.writes.at(-1),"retired");assert.notEqual(result.proof.containerId,f.state.a.parentContainerId);
});
test("missing container is unknown despite a terminal Core phase",async()=>{
 const f=fixture();await f.launch();f.state.a.phase="retired";f.state.child=null;assert.equal((await f.owner.inspect(f.state.a.runId)).state,"unknown");assert.equal(f.state.effects.includes("wait"),false);
});
test("wait error, exit mismatch and identity replacement after join preserve unknown",async()=>{
 for(const key of ["waitError","waitWrongExit","replaceAfterWait"]){const f=fixture();await f.launch();f.state.child.State={Running:false,Status:"exited",ExitCode:0};f.state[key]=true;assert.equal((await f.owner.inspect(f.state.a.runId)).state,"unknown");assert.equal(f.state.writes.includes("retired"),false);}
});
test("restart without persisted original identity cannot infer completion or launch replay",async()=>{
 const f=fixture();await f.launch();f.state.a.containerId=null;f.state.a.phase="start_unknown";const restarted=createManagedJobContainerOwner(f.ports);assert.equal((await restarted.inspect(f.state.a.runId)).state,"unknown");assert.equal((await restarted.launch({runId:f.state.a.runId,runtimeId:f.state.a.runtimeId})).state,"unknown");assert.deepEqual(f.state.effects,["create","start"]);
});
test("restart may settle only by a fresh original-daemon wait join, never a cached terminal receipt",async()=>{
 const f=fixture();await f.launch();f.state.child.State={Running:false,Status:"exited",ExitCode:0};f.state.a.phase="retired";const restarted=createManagedJobContainerOwner(f.ports);assert.equal((await restarted.inspect(f.state.a.runId)).state,"settled");assert.equal(f.state.effects.at(-1),"wait");f.state.daemonId="replacement";assert.equal((await restarted.inspect(f.state.a.runId)).state,"unknown");
});
test("asynchronous owner effects occur outside SQLite transactions",async()=>{
 const f=fixture();await f.launch();f.state.a.cancelRequested=true;assert.equal((await f.owner.cancel(f.state.a.runId)).state,"settled");assert.equal(f.state.coreTransaction,false);
});

test("cleanup requires consumed outcome and fresh whole-container retirement, removes only original without volumes",async()=>{
 const f=fixture();await f.launch();assert.equal((await f.owner.cleanup(f.state.a.runId)).code,"MANAGED_JOB_OUTCOME_NOT_CONSUMED");assert.equal(f.state.effects.includes("remove"),false);f.state.a.outcomeConsumed=true;f.state.child.State={Running:false,Status:"exited",ExitCode:0};assert.equal((await f.owner.cleanup(f.state.a.runId)).state,"removed");assert.equal(f.state.effects.at(-1),"remove");assert.equal(f.state.writes.at(-1),"removed");assert.ok(f.state.requests.some(r=>r.method==="DELETE"&&r.path.endsWith("?v=false")));assert.equal((await f.owner.inspect(f.state.a.runId)).state,"unknown");
});
