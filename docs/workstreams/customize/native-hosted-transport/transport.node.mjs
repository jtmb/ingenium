import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {connectHostedGovernance} from "./files/apps/web/src/platform/hostedGovernance.ts";
const b={authorityId:"authority",connectionId:"connection",grantId:"grant",grantRevision:1,epoch:"epoch",nativeLibraryId:"library",nativeServiceInstanceId:"native",hostedServiceInstanceId:"hosted",nativeProjectId:"project",nativeProjectRevision:3,actorId:"user",installationId:"installation",hostedProjectId:"uuid",apiProject:"actual",visibility:"project"};
const selection={libraryId:"library",serviceInstanceId:"native",connectionId:"connection",project:{id:"project",revision:3,environment:"windows",primary_root:"C:/actual"}};
const original={id:"operation",binding:b,command:{op:"archive",name:"release",target:{id:"skill",revision:3}}};
function fixture(response){
 const calls=[];let current=structuredClone(selection);
 const gateway={workbench:async(method,path,body,isCurrent)=>{calls.push({method,path,body,isCurrent});if(response)return response(method,path,body,isCurrent);if(path.endsWith("/context"))return {protocol:"node_hosted_governance_v1",binding:b,capabilities:["catalog","archive"]};if(path.endsWith("/reserve"))return original;if(path.endsWith("/pending"))return [];if(path.endsWith("/read"))return {binding:b,value:{data:[]}};return {original,outcome:"succeeded"};}};
 return {calls,gateway,change:value=>current=value,connect:()=>connectHostedGovernance(gateway,selection,()=>current)};
}
test("concrete web transport uses only fixed native connection-owner routes and no endpoint/credential",async()=>{
 const f=fixture(),t=await f.connect();await t.read({op:"catalog",kind:"skill",offset:0,limit:100},b);await t.reserve(original.command,b);await t.send(original);await t.inspect(original);await t.pending(b);
 assert.equal(f.calls.length,6);assert(f.calls.every(c=>c.method==="POST"&&c.path.startsWith("/v1/remote-control/connections/connection/hosted-governance/")));
 assert(!JSON.stringify(f.calls).match(/https:|authorization|cookie|password|csrf/));assert.deepEqual(f.calls[0].body.project,selection.project);
});
test("context is actual server binding; foreign library/project/actor metadata cannot be inferred",async()=>{
 const f=fixture(()=>({protocol:"node_hosted_governance_v1",binding:{...b,nativeProjectRevision:9},capabilities:["archive"]}));
 await assert.rejects(f.connect(),/exact native owner/);assert.equal(f.calls.length,1);
});
test("private fields in a public context are rejected",async()=>{
 const f=fixture(()=>({protocol:"node_hosted_governance_v1",binding:{...b,cookie:"private"},capabilities:[]}));
 await assert.rejects(f.connect(),/Invalid hosted owner context/);
});
test("projectless native context retains explicit actual hosted owner",async()=>{
 const s={...selection,project:null},calls=[];
 const t=await connectHostedGovernance({workbench:async(method,path,body)=>{calls.push(body);return {protocol:"node_hosted_governance_v1",binding:{...b,nativeProjectId:null,nativeProjectRevision:null},capabilities:[]};}},s,()=>s);
 assert.equal(t.binding.hostedProjectId,"uuid");assert.equal(calls[0].project,null);
});
test("changed selection before completion discards context and performs no follow-up",async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.connect();f.change({...selection,project:{...selection.project,revision:4}});resolve({protocol:"node_hosted_governance_v1",binding:b,capabilities:[]});await assert.rejects(pending,/changed/);assert.equal(f.calls.length,1);
});
test("every actual operation is fenced by original current selection",async()=>{
 const f=fixture(),t=await f.connect();f.change(null);assert.equal(t.current(),false);await assert.rejects(t.send(original),/changed/);assert.equal(f.calls.length,1);
});
test("recovery may inspect unchanged old reader original but never a foreign actor",async()=>{
 const f=fixture((method,path)=>path.endsWith("/context")?{protocol:"node_hosted_governance_v1",binding:b,capabilities:[]}: {original:{...original,binding:{...b,epoch:"old",grantRevision:0+1,nativeProjectRevision:1,apiProject:"old"}},outcome:"succeeded"});
 const t=await f.connect(),old={...original,binding:{...b,epoch:"old",grantRevision:1,nativeProjectRevision:1,apiProject:"old"}};
 assert.equal((await t.inspect(old)).original.binding.epoch,"old");await assert.rejects(t.inspect({...old,binding:{...old.binding,actorId:"foreign"}}),/Foreign/);assert.equal(f.calls.length,2);
});
test("crossed original or read envelope is rejected without retry",async()=>{
 const f=fixture((m,p)=>p.endsWith("/context")?{protocol:"node_hosted_governance_v1",binding:b,capabilities:["archive"]}:p.endsWith("/read")?{binding:{...b,actorId:"foreign"},value:{}}:{original:{...original,id:"other"},outcome:"succeeded"});
 const t=await f.connect();await assert.rejects(t.send(original),/original changed/);await assert.rejects(t.read({op:"skill",name:"x"},b),/read envelope/);assert.equal(f.calls.length,3);
});
test("dispatch exceptions propagate once with no automatic inspection or HTTP resend",async()=>{
 const f=fixture((m,p)=>{if(p.endsWith("/context"))return {protocol:"node_hosted_governance_v1",binding:b,capabilities:["archive"]};throw new Error("lost");});
 const t=await f.connect();await assert.rejects(t.send(original),/lost/);assert.equal(f.calls.length,2);
});
test("unknown capabilities and duplicate originals do not become success",async()=>{
 const f=fixture(()=>({protocol:"node_hosted_governance_v1",binding:b,capabilities:["generic_http"]}));await assert.rejects(f.connect(),/validated hosted capability/);
 const g=fixture((m,p)=>p.endsWith("/context")?{protocol:"node_hosted_governance_v1",binding:b,capabilities:[]}: [original,original]);const t=await g.connect();await assert.rejects(t.pending(b),/conflicting original index/);
});
// Execute exact SQL constants from proposed Rust, in memory; do not duplicate storage SQL in tests.
const rust=fs.readFileSync(new URL("./files/crates/adapters/src/utility_operations/hosted.rs",import.meta.url),"utf8");
function sql(name){const raw=rust.match(new RegExp("const "+name+': &str = r#"([\\s\\S]*?)"#;'));if(raw)return raw[1];const plain=rust.match(new RegExp("const "+name+': &str = "([^"]*)";'));assert(plain,name);return plain[1];}
function journal(){const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON; CREATE TABLE originals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,original TEXT NOT NULL,result TEXT,created INTEGER NOT NULL);");db.exec(sql("SCHEMA"));return db;}
function reserve(db,id="one",owner="owner",record="original"){db.prepare(sql("INSERT")).run(id,record,1);db.prepare("INSERT INTO hosted_dispatch(id,owner_key) VALUES(?,?)").run(id,owner);}
test("actual persisted SQL claim permits one dispatch across claimants and retained restart state",()=>{
 const db=journal();try{reserve(db);assert.equal(db.prepare(sql("CLAIM")).run("one","owner","original").changes,1);assert.equal(db.prepare(sql("CLAIM")).run("one","owner","original").changes,0);assert.equal(db.prepare(sql("PENDING")).all("owner").length,1);}finally{db.close();}
});
test("actual SQL rejects foreign owner and altered original before dispatch",()=>{
 const db=journal();try{reserve(db);assert.equal(db.prepare(sql("CLAIM")).run("one","foreign","original").changes,0);assert.equal(db.prepare(sql("CLAIM")).run("one","owner","altered").changes,0);assert.equal(db.prepare(sql("PENDING")).all("foreign").length,0);}finally{db.close();}
});
test("atomic unsent refusal wins or loses against dispatch, never both",()=>{
 for(const claimFirst of [false,true]){const db=journal();try{reserve(db);const claim=()=>db.prepare(sql("CLAIM")).run("one","owner","original").changes;const refuse=()=>db.prepare(sql("UNSENT_REFUSAL")).run("refused","one","original","owner").changes;const a=claimFirst?claim():refuse(),b=claimFirst?refuse():claim();assert.equal(a,1);assert.equal(b,0);assert.equal(db.prepare(sql("PENDING")).all("owner").length,claimFirst?1:0);}finally{db.close();}}
});

import {contextProof,originalProof} from "./files/services/ingenium-api/lib/paired-native-proof.ts";
const pair={actorId:"user",installationId:"installation",enrollmentRequestId:"enrollment",authorityId:"native-authority",grantId:"native-grant",grantRevision:1,nativeOwner:{library_id:"library",service_instance_id:"native",project:{id:"project",revision:3,environment:"windows",primary_root:"C:/actual",roots:[]}}};
const proof={protocol:"node_hosted_native_custodian_v1",actor_id:"user",installation_id:"installation",enrollment_request_id:"enrollment",native_authority_id:"native-authority",native_owner:pair.nativeOwner,grant:{id:"native-grant",revision:1,revoked:false,scope:{permissions:["hosted_enrollment"]}}};
test("actual paired proof preserves full Native owner, not merely matching project metadata",()=>{assert.deepEqual(contextProof(proof,pair),pair.nativeOwner);assert.throws(()=>contextProof({...proof,native_owner:{...pair.nativeOwner,project:{...pair.nativeOwner.project,primary_root:"D:/other"}}},pair),/REFUSED/);});
test("same hosted user and installation must match actual private Native grant custodian",()=>{for(const changed of [{actor_id:"foreign"},{installation_id:"foreign"},{enrollment_request_id:"other"},{native_authority_id:"other"}])assert.throws(()=>contextProof({...proof,...changed},pair),/REFUSED/);});
test("revoked, replaced or policy-denied Native grant never supplies a verified context",()=>{for(const grant of [{...proof.grant,revoked:true},{...proof.grant,revision:2},{...proof.grant,scope:{permissions:[]}}])assert.throws(()=>contextProof({...proof,grant},pair),/REFUSED/);});
test("effect proof requires exact retained UUID hash and consumed Native dispatch claim",()=>{const p={protocol:"node_hosted_native_original_v1",context:proof,operation_id:"operation",payload_hash:"a".repeat(64),dispatch_claimed:true};assert.deepEqual(originalProof(p,pair,"operation","a".repeat(64)),pair.nativeOwner);for(const change of [{dispatch_claimed:false},{operation_id:"other"},{payload_hash:"b".repeat(64)}])assert.throws(()=>originalProof({...p,...change},pair,"operation","a".repeat(64)),/REFUSED/);});
test("renderer-like identity metadata is not a paired context or original proof",()=>{assert.throws(()=>contextProof({nativeLibraryId:"library",actorId:"user"},pair),/REFUSED/);assert.throws(()=>originalProof({binding:b,command:original.command},pair,"operation","a".repeat(64)),/REFUSED/);});
test("actual SQL retains project and profile mapping custody until terminal original receipt",()=>{const db=journal();try{const record=JSON.stringify({original:{binding:{nativeProjectId:"project",grantId:"grant",connectionId:"connection"}},private_owner:{enrollment_request_id:"enrollment"}});reserve(db,"one","owner",record);assert.equal(db.prepare(sql("PROJECT_CUSTODY")).get("project")[Object.keys(db.prepare(sql("PROJECT_CUSTODY")).get("project"))[0]],1);assert.equal(Object.values(db.prepare(sql("PROJECT_CUSTODY")).get("other"))[0],0);for(const id of ["grant","connection","enrollment"])assert.equal(Object.values(db.prepare(sql("RESOURCE_CUSTODY")).get(id,id,id))[0],1);db.prepare("UPDATE originals SET result=? WHERE id=?").run("terminal","one");assert.equal(Object.values(db.prepare(sql("PROJECT_CUSTODY")).get("project"))[0],0);}finally{db.close();}});
test("actual SQL distinguishes explicit projectless custody from a selected project",()=>{const db=journal();try{reserve(db,"one","owner",JSON.stringify({original:{binding:{nativeProjectId:null}}}));assert.equal(Object.values(db.prepare(sql("PROJECT_CUSTODY")).get(null))[0],1);assert.equal(Object.values(db.prepare(sql("PROJECT_CUSTODY")).get("project"))[0],0);}finally{db.close();}});
