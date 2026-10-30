import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {stripTypeScriptTypes} from "node:module";
const sha=value=>createHash("sha256").update(value).digest("hex");
const manifest=JSON.parse(readFileSync(new URL("./managed-job-proposal.json",import.meta.url),"utf8"));
const patch=readFileSync(new URL("./managed-job-unavailable.patch",import.meta.url),"utf8");
const gate=readFileSync(new URL("./managed-job-gate.proposal.ts",import.meta.url),"utf8");
assert.equal(sha(patch),manifest.patchSha256);assert.equal(sha(gate),manifest.gateSha256);
// The additive zero-context patch is the canonical gate source, not a parallel implementation.
const added=patch.split("\n").filter(line=>line.startsWith("+")&&!line.startsWith("+++")).map(line=>line.slice(1)).join("\n").trim();assert.equal(added,gate.trim());
let sideEffects=0;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const code=stripTypeScriptTypes(gate.replaceAll("export ",""),{mode:"strip"});
const api=new Function("UUID","requestManager","executeJobRun",`${code}\nreturn {managedRuntimeJobExecutionCapability,requireManagedRuntimeJobExecution};`)(UUID,()=>{sideEffects++;throw Error("No manager operations authorized");},()=>{sideEffects++;throw Error("No control-plane fallback authorized");});
const runtime="11111111-1111-4111-8111-111111111111";
test("valid selected managed runtime explicitly reports unavailable with a frozen closed DTO",()=>{
 assert.deepEqual(api.managedRuntimeJobExecutionCapability(runtime),{schemaVersion:1,runtimeId:runtime,available:false,code:"MANAGED_JOB_OWNER_PROTOCOL_UNAVAILABLE"});assert.ok(Object.isFrozen(api.managedRuntimeJobExecutionCapability(runtime)));
});
test("managed launch guard is inspectable 503 and cannot fall through to a local runner",()=>{
 assert.throws(()=>api.requireManagedRuntimeJobExecution(runtime),error=>error.code==="MANAGED_JOB_OWNER_PROTOCOL_UNAVAILABLE"&&error.status===503);assert.equal(sideEffects,0);
});
test("caller commands, containers or forged owner objects cannot create execution authority",()=>{
 for(const value of [{runtimeId:runtime,container:"chosen",command:["sh"],ownerGrant:true},"docker://container","../../container",null,undefined,1])assert.throws(()=>api.requireManagedRuntimeJobExecution(value));assert.equal(sideEffects,0);
});
test("healthy placement, idle engine, terminal DB or PID observations do not turn unavailable into settlement",()=>{
 for(const observation of [{state:"running",health:"healthy"},{engine:"idle"},{dbStatus:"cancelled"},{execRunning:false,pid:123},{leaderExited:true},{groupEmpty:true,diagnostic:true}]){
  // No observation-taking overload exists. Additional caller arguments cannot grant an absent owner protocol.
  assert.equal(api.managedRuntimeJobExecutionCapability(runtime,observation).available,false);assert.throws(()=>api.requireManagedRuntimeJobExecution(runtime,observation),error=>error.status===503);
 }
 assert.equal(sideEffects,0);
});
test("restart without a qualified owner remains unavailable and introduces no process or receipt store",()=>{
 const again=new Function("UUID",`${code}\nreturn managedRuntimeJobExecutionCapability;`)(UUID);assert.equal(again(runtime).available,false);assert.doesNotMatch(code,/new Map|setInterval|setTimeout|spawn\(|exec\(|fetch\(/);assert.equal(sideEffects,0);
});
