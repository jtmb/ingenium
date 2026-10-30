import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath,pathToFileURL} from "node:url";import {DatabaseSync} from "node:sqlite";
const directory=path.dirname(fileURLToPath(import.meta.url)),phase=path.resolve(directory,"../../../../../..");
const actualPhase=path.resolve(directory,"../../../../../.."),checkout=path.resolve(directory,"../../../.."),stage=path.resolve(checkout,"../..");
const ts=createRequire(import.meta.url)(path.resolve(stage,"../prd-ui-fixes/node_modules/typescript/lib/typescript.js"));
const core=await import(pathToFileURL(path.resolve(stage,"parallel/rust-api/docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts")).href);
let db;
globalThis.__nativeProofFixture={getDb:()=>db,HostedRefusal:core.HostedRefusal,payloadHash:core.payloadHash};
const encode=code=>"data:text/javascript;base64,"+Buffer.from(code).toString("base64");
const transpile=file=>ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const base=path.join(directory,"files/services/ingenium-api/lib");
const proofUrl=encode(transpile(base+"/paired-native-proof.ts"));
const code=transpile(base+"/native-hosted-connection-owner.ts").replace(/import \{[^}]+\} from "ingenium-core";/,"const {getDb,HostedRefusal,payloadHash}=globalThis.__nativeProofFixture;").replace('"./paired-native-proof.js"',JSON.stringify(proofUrl));
const {createVerifiedNativeContextOwner}=await import(encode(code));
function fixture(){
 db=new DatabaseSync(":memory:");db.exec("CREATE TABLE veyra_installation_identity(singleton INTEGER PRIMARY KEY,instance_id TEXT); INSERT INTO veyra_installation_identity VALUES(1,'installation');");
 const original={hostedProjectId:"hosted-project",actorId:"user",installationId:"installation",enrollmentRequestId:"enrollment",authorityId:"authority",grantId:"grant",grantRevision:1,nativeOwner:{library_id:"actual-library",service_instance_id:"actual-service",project:{id:"project",revision:3,primary_root:"C:/actual"}}};
 const proof={protocol:"node_hosted_native_custodian_v1",enrollment_request_id:"enrollment",actor_id:"user",installation_id:"installation",native_authority_id:"authority",native_owner:original.nativeOwner,grant:{id:"grant",revision:1,revoked:false,scope:{permissions:["hosted_enrollment"]}}};
 const calls=[],factoryCalls=[],authority={allowed:true,checks:0,normalReads:0,recoveryReads:0,normalFails:false};
 const api=createVerifiedNativeContextOwner(req=>{factoryCalls.push(req);return {withOriginal:async(actor,installation,id,work)=>{calls.push({actor,installation,id});return work({original,assertCurrent(){authority.checks++;if(!authority.allowed)throw new core.HostedRefusal("PAIR_CREDENTIAL_CHANGED",503);},readContext:async()=>{authority.normalReads++;if(authority.normalFails)throw Error("Current Native service differs");return proof;},readRecoveryContext:async()=>{authority.recoveryReads++;return proof;}});}};});
 const request={method:"POST",path:"/enrollments",principal:{type:"user",id:"user",scopes:["user:*"],session:{id:"real-session-fixture"}},body:{enrollmentRequestId:"enrollment",hostedProjectId:"hosted-project",visibility:"project"},params:{},query:{}};
 async function run(req=request){let error;await api.preflight(req,{},e=>{error=e;});if(error)throw error;}
 return {db,api,request,calls,factoryCalls,run,original,proof,authority,close:()=>db.close()};
}
test("actual preflight accepts frozen enrollmentRequestId and retains actual paired proof for Core callback",async()=>{const f=fixture();try{await f.run();assert.deepEqual(f.calls,[{actor:"user",installation:"installation",id:"enrollment"}]);assert.equal(f.factoryCalls[0],f.request);assert.deepEqual(f.api.owner.enrollment(f.request,"enrollment","user"),{actorId:"user",nativeLibraryId:"actual-library",nativeServiceInstanceId:"actual-service",nativeProjectId:"project",nativeProjectRevision:3});}finally{f.close();}});
test("requestId alias is rejected before any private custody or Native read",async()=>{const f=fixture();try{f.request.body={requestId:"enrollment",hostedProjectId:"hosted-project",visibility:"project"};await assert.rejects(f.run(),e=>e.code==="INVALID_ENROLLMENT"&&e.status===422);assert.equal(f.calls.length,0);assert.equal(f.factoryCalls.length,0);}finally{f.close();}});
test("extra renderer identity fields and both aliases cannot enter enrollment preflight",async()=>{for(const extra of [{requestId:"other"},{actorId:"other"},{nativeLibraryId:"invented"}]){const f=fixture();try{Object.assign(f.request.body,extra);await assert.rejects(f.run(),e=>e.code==="INVALID_ENROLLMENT");assert.equal(f.calls.length,0);}finally{f.close();}}});
test("same browser actor remains required when Core consumes the preflight frame",async()=>{const f=fixture();try{await f.run();f.request.principal.id="other";assert.throws(()=>f.api.owner.enrollment(f.request,"enrollment","user"),e=>e.code==="NATIVE_ATTESTATION_UNAVAILABLE");}finally{f.close();}});
test("identity read remains available without a Native enrollment frame",async()=>{const f=fixture();try{f.request.method="GET";f.request.path="/identity";await f.run();assert.equal(f.calls.length,0);assert.equal(f.factoryCalls.length,0);}finally{f.close();}});

test("Core synchronous consumption rechecks real custody authority after async preflight",async()=>{const f=fixture();try{
 await f.run();f.authority.allowed=false;assert.throws(()=>f.api.owner.enrollment(f.request,"enrollment","user"),e=>e.code==="PAIR_CREDENTIAL_CHANGED");assert.equal(f.authority.checks,1);
}finally{f.close();}});
test("paired hosted project must equal frozen requested hosted project",async()=>{const f=fixture();try{
 f.original.hostedProjectId="different";await assert.rejects(f.run(),e=>e.code==="NATIVE_ATTESTATION_REFUSED");
}finally{f.close();}});
function recoveryStore(f){
 f.db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('user'); CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,archived_at TEXT); INSERT INTO projects VALUES('hosted-project','actual-namespace',NULL); CREATE UNIQUE INDEX fixture_installation ON veyra_installation_identity(instance_id);");
 f.db.exec(fs.readFileSync(path.resolve(stage,"../prd-ui-fixes/packages/ingenium-core/data/migrations/125_native_hosted_governance.sql"),"utf8"));
 f.db.prepare("INSERT INTO native_hosted_governance_grants(id,enrollment_request_id,enrollment_hash,connection_id,owner_user_id,installation_id,native_library_id,native_service_instance_id,native_project_id,native_project_revision,hosted_project_id,visibility,revision,epoch,created_at) VALUES('node-grant','enrollment',?,'connection','user','installation','actual-library','actual-service','project',3,'hosted-project','project',1,'old-epoch','now')").run("a".repeat(64));
 f.request.method="GET";f.request.path="/operations/original";f.request.query={grantId:"node-grant"};f.request.body={};f.authority.normalFails=true;
 const calls={reads:0,writes:0};
 const owner=core.createHostedGovernance({db:()=>f.db,transaction:fn=>fn(),checkpoint(){},actor:()=>({id:"user",sessionId:"fixture-session",securityEpoch:1}),allow:id=>id==="hosted-project",systemAllowed:()=>false,
 verifyEnrollment:id=>f.api.owner.enrollment(f.request,id,"user"),verifyNativeOwner:(g,recovery)=>f.api.owner.current(f.request,g,recovery,"user"),locks:()=>[],isSafeSkillName:()=>true,isValidSkillFileTree:()=>true,
 read(){calls.reads++;throw Error("Historical proof reached a domain read");},execute(){calls.writes++;throw Error("Historical proof reached a domain write");}});
 return {owner,calls};
}
test("actual frozen Core receipt recovery accepts historical private proof without current service/binding promotion",async()=>{const f=fixture();try{
 const {owner,calls}=recoveryStore(f);f.db.prepare("INSERT INTO native_hosted_governance_effects(operation_id,grant_id,actor_id,project_id,payload_hash,binding_hash,command_kind,state,value_ref_json,created_at,updated_at) VALUES('original','node-grant','user','hosted-project',?,?,'archive','succeeded',?,'now','now')").run("b".repeat(64),"c".repeat(64),JSON.stringify({kind:"skill",id:"actual-skill",projectId:"hosted-project",revision:4}));
 await f.run();assert.equal(f.authority.normalReads,0);assert.equal(f.authority.recoveryReads,1);
 const receipt=owner.inspect("original","node-grant");assert.equal(receipt.outcome,"succeeded");assert.equal(receipt.payloadHash,"b".repeat(64));
 assert.throws(()=>owner.binding("node-grant"),e=>e.code==="RECOVERY_PROOF_NOT_AUTHORITY");
 await assert.rejects(owner.read("node-grant",{op:"catalog",kind:"skill",offset:0,limit:100}),e=>e.code==="RECOVERY_PROOF_NOT_AUTHORITY");
 assert.throws(()=>f.api.owner.enrollment(f.request,"enrollment","user"));
 assert.deepEqual(calls,{reads:0,writes:0});
}finally{f.close();}});
test("historical recovery keeps an absent or executing canonical receipt unknown and never executes it",async()=>{const f=fixture();try{
 const {owner,calls}=recoveryStore(f);f.db.prepare("INSERT INTO native_hosted_governance_effects(operation_id,grant_id,actor_id,project_id,payload_hash,binding_hash,command_kind,state,created_at,updated_at) VALUES('original','node-grant','user','hosted-project',?,?,'archive','executing','now','now')").run("d".repeat(64),"e".repeat(64));
 await f.run();assert.equal(owner.inspect("original","node-grant").outcome,"unknown");assert.equal(owner.inspect("absent","node-grant").payloadHash,null);assert.equal(f.db.prepare("SELECT state FROM native_hosted_governance_effects").get().state,"executing");assert.deepEqual(calls,{reads:0,writes:0});
 f.request.method="POST";assert.throws(()=>f.api.owner.current(f.request,f.db.prepare("SELECT * FROM native_hosted_governance_grants").get(),true,"user"),e=>e.code==="RECOVERY_PROOF_NOT_AUTHORITY");
}finally{f.close();}});
test("historical private context still refuses revoked Native proof and changed real custody",async()=>{const f=fixture();try{
 recoveryStore(f);f.proof.grant.revoked=true;await assert.rejects(f.run(),e=>e.code==="NATIVE_ATTESTATION_UNAVAILABLE");f.proof.grant.revoked=false;await f.run();f.authority.allowed=false;assert.throws(()=>f.api.owner.current(f.request,f.db.prepare("SELECT * FROM native_hosted_governance_grants").get(),true,"user"),e=>e.code==="PAIR_CREDENTIAL_CHANGED");
}finally{f.close();}});