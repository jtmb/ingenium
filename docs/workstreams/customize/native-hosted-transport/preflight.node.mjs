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
 const calls=[],factoryCalls=[],authority={allowed:true,checks:0};
 const api=createVerifiedNativeContextOwner(req=>{factoryCalls.push(req);return {withOriginal:async(actor,installation,id,work)=>{calls.push({actor,installation,id});return work({original,assertCurrent(){authority.checks++;if(!authority.allowed)throw new core.HostedRefusal("PAIR_CREDENTIAL_CHANGED",503);},readContext:async()=>proof});}};});
 const request={method:"POST",path:"/enrollments",principal:{type:"user",id:"user",scopes:["user:*"],session:{id:"real-session-fixture"}},body:{enrollmentRequestId:"enrollment",hostedProjectId:"hosted-project",visibility:"project"},params:{},query:{}};
 async function run(req=request){let error;await api.preflight(req,{},e=>{error=e;});if(error)throw error;}
 return {api,request,calls,factoryCalls,run,original,authority,close:()=>db.close()};
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