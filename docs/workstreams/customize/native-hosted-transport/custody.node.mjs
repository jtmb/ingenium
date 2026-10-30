import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath,pathToFileURL} from "node:url";import {DatabaseSync} from "node:sqlite";
const root=path.dirname(fileURLToPath(import.meta.url)),checkout=path.resolve(root,"../../../.."),phase=path.resolve(checkout,"../.."),app=path.resolve(phase,"../prd-ui-fixes");
const ts=createRequire(import.meta.url)(app+"/node_modules/typescript/lib/typescript.js"),base=root+"/files/services/ingenium-api/lib";
const encode=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const transpile=p=>ts.transpileModule(fs.readFileSync(p,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const core=await import(pathToFileURL(phase+"/parallel/rust-api/docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts"));
const crypto=await import(encode(transpile(app+"/packages/ingenium-core/lib/tools/vault-crypto.ts")));
const proofUrl=encode(transpile(base+"/paired-native-proof.ts"));
const readerUrl=encode(transpile(base+"/paired-native-reader.ts").replace('"./paired-native-proof.js"',JSON.stringify(proofUrl)));
globalThis.__custodyTest={HostedRefusal:core.HostedRefusal};
const ownerCode=transpile(base+"/node-native-pairing-custody.ts")
 .replace(/import \{[^}]+\} from "ingenium-core";/,'const {HostedRefusal}=globalThis.__custodyTest;const getDb=()=>{throw Error("No real database in fixture")},execTransaction=()=>{throw Error("No real transaction in fixture")},checkpointAfterWrite=()=>{},vault={},authorization={};')
 .replace(/import \{[^}]+\} from "\.\/middleware\/auth.js";/,'const authenticateRequestWithoutActivity=()=>{throw Error("No fixture auth acceptance")};')
 .replace(/import \{[^}]+\} from "\.\/authorization-policy.js";/,'const toAuthorizationPrincipal=()=>{throw Error("No fixture auth acceptance")};')
 .replace('"./paired-native-reader.js"',JSON.stringify(readerUrl));
const {createNodeNativePairingOwner}=await import(encode(ownerCode));
const migration=fs.readFileSync(app+"/packages/ingenium-core/data/migrations/096_resource_ownership.sql","utf8");
const table=migration.match(/CREATE TABLE provider_connections \([\s\S]*?\n\);/)[0];
const triggers=[...migration.matchAll(/CREATE TRIGGER provider_connections_[\s\S]*?END;/g)].map(m=>m[0]);
function fixture(){
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON; CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT,is_global INTEGER); CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT); CREATE TABLE vault_items(id TEXT PRIMARY KEY,project_id TEXT,organization_id TEXT,owner_kind TEXT,owner_user_id TEXT,type TEXT,version INTEGER,access_policy TEXT,encrypted BLOB); CREATE TABLE veyra_installation_identity(singleton INTEGER PRIMARY KEY,instance_id TEXT); CREATE TABLE provider_model_policies(id TEXT); CREATE TABLE resource_grants(id TEXT); CREATE TABLE settings(id TEXT);");
 db.exec(table);for(const t of triggers)db.exec(t);
 db.exec("INSERT INTO organizations VALUES('org'); INSERT INTO users VALUES('user'),('other'); INSERT INTO projects VALUES('project','org',0); INSERT INTO organization_memberships VALUES('org','user','active'); INSERT INTO veyra_installation_identity VALUES(1,'installation');");
 const state={actor:"user",sealed:false,redeems:0,verifies:0,contexts:0,originals:0,failProof:false,afterRetain:undefined,beforeRetain:undefined};
 const key=Buffer.alloc(32,19),prep={schemaVersion:1,stage:"preparation",enrollmentRequestId:"enrollment",endpoint:"https://actual-native.example",certificatePem:"synthetic-public-certificate",certificateSha256:"a".repeat(64),pairingCode:"b".repeat(64),expectedAuthorityId:"authority"};
 db.prepare("INSERT INTO vault_items VALUES('item','project','org','user','user','native-pairing-credential',0,'{}',?)").run(crypto.encryptSecret(JSON.stringify(prep),key));
 const original={actorId:"user",installationId:"installation",enrollmentRequestId:"enrollment",hostedProjectId:"project",authorityId:"authority",grantId:"actual-grant",grantRevision:1,nativeOwner:{library_id:"actual-library",service_instance_id:"actual-service",project:{id:"native-project",revision:3,archived:false}}};
 const redeemed={schemaVersion:1,stage:"redeemed",enrollmentRequestId:"enrollment",actorId:"user",installationId:"installation",hostedProjectId:"project",endpoint:prep.endpoint,certificatePem:prep.certificatePem,certificateSha256:prep.certificateSha256,token:"c".repeat(64),authorityId:"authority",serviceInstanceId:"actual-service",grantId:"actual-grant"};
 const credential={endpoint:prep.endpoint,certificatePem:prep.certificatePem,certificateSha256:prep.certificateSha256,token:redeemed.token,original};
 const backend={
 db:()=>db,transaction:work=>{db.exec("BEGIN IMMEDIATE");try{const result=work();db.exec("COMMIT");return result;}catch(e){db.exec("ROLLBACK");throw e;}},checkpoint(){},
 principal(){return {type:"user",id:state.actor,scopes:["user:*"],session:{id:"fixture-browser-session"}};},
 project(p,id){return id==="project"&&!!db.prepare("SELECT 1 FROM organization_memberships WHERE user_id=? AND organization_id='org' AND status='active'").get(p.id);},
 owned(p,row){return row.owner_kind==="user"&&row.owner_user_id===p.id&&row.organization_id==="org";},
 vault:{isSealed:()=>state.sealed,decryptItem(project,id){assert.equal(project,"project");const row=db.prepare("SELECT encrypted FROM vault_items WHERE id=?").get(id);return crypto.decryptSecret(Buffer.from(row.encrypted),key).toString("utf8");},
 updateItem(project,id,value){assert.equal(project,"project");if(state.sealed)return;db.prepare("UPDATE vault_items SET encrypted=?,version=version+1 WHERE id=?").run(crypto.encryptSecret(value,key),id);}},
 async redeem(actual,actor,installation,project,retain){state.redeems++;assert.deepEqual(actual,prep);assert.equal(actor,"user");assert.equal(installation,"installation");assert.equal(project,"project");state.beforeRetain?.();retain(redeemed);state.afterRetain?.();if(state.failProof)throw Error("Native context unavailable");return credential;},
 async verify(value){state.verifies++;assert.deepEqual(value,redeemed);if(state.failProof)throw Error("Native context unavailable");return credential;},
 reader(value){assert.deepEqual(value,credential);return {original:value.original,async readContext(){state.contexts++;return {actual:"paired Native read fixture"};},async readOriginal(){state.originals++;return {actual:"paired Native original fixture"};}}}
 };
 const owner=createNodeNativePairingOwner({},backend),input={enrollmentRequestId:"enrollment",hostedProjectId:"project",preparationItemId:"item"};
 return {db,state,owner,input,backend,credential,secret:()=>JSON.parse(backend.vault.decryptItem("project","item")),row:()=>db.prepare("SELECT * FROM provider_connections").get(),close(){db.close();key.fill(0);}};
}
test("real 096 connection SQL + actual vault AES-GCM: pair once, retain only encrypted same-item credential",async()=>{const f=fixture();try{
 const result=await f.owner.pair(f.input);assert.equal(result.state,"paired");assert.equal(f.state.redeems,1);assert.equal(f.row().credential_item_id,"item");assert.equal(f.secret().stage,"paired");assert.equal(f.secret().credential.original.nativeOwner.library_id,"actual-library");
 assert.equal(f.db.prepare("SELECT count(*) n FROM vault_items").get().n,1);assert.equal(Buffer.from(f.db.prepare("SELECT encrypted FROM vault_items").get().encrypted).includes(Buffer.from("c".repeat(64))),false);
 assert.equal(f.row().config_json.includes("c".repeat(64)),false);assert.equal(JSON.stringify(result).includes("certificate"),false);
 assert.deepEqual(await f.owner.pair(f.input),result);assert.equal(f.state.redeems,1);
 for(const t of ["provider_model_policies","resource_grants","settings"])assert.equal(f.db.prepare("SELECT count(*) n FROM "+t).get().n,0);
}finally{f.close();}});
test("closed pairing body rejects aliases and asserted identity before dispatch",async()=>{for(const input of [{requestId:"enrollment",preparationItemId:"item"},{enrollmentRequestId:"enrollment",preparationItemId:"item",actorId:"other"}]){const f=fixture();try{await assert.rejects(f.owner.pair(input),e=>e.code==="INVALID_PAIRING");assert.equal(f.state.redeems,0);}finally{f.close();}}});
test("sealed vault, wrong same-browser actor, lost membership and mismatched owner refuse before pair",async()=>{for(const mutate of [f=>f.state.sealed=true,f=>f.state.actor="other",f=>f.db.exec("UPDATE organization_memberships SET status='disabled'"),f=>f.db.exec("UPDATE vault_items SET owner_user_id='other'")]){const f=fixture();try{mutate(f);await assert.rejects(f.owner.pair(f.input));assert.equal(f.state.redeems,0);assert.equal(f.row(),undefined);}finally{f.close();}}});
test("received cookie retained before failed context; recovery only verifies GET and never pairs again",async()=>{const f=fixture();try{
 f.state.failProof=true;assert.equal((await f.owner.pair(f.input)).state,"unknown");assert.equal(f.secret().stage,"redeemed");assert.equal(f.state.redeems,1);
 f.state.failProof=false;assert.equal((await f.owner.recover("enrollment")).state,"paired");assert.equal(f.state.verifies,1);assert.equal(f.state.redeems,1);
}finally{f.close();}});
test("credential version race before retention stays unknown and cannot replay code",async()=>{const f=fixture();try{
 f.state.beforeRetain=()=>f.db.exec("UPDATE vault_items SET version=version+1");assert.equal((await f.owner.pair(f.input)).state,"unknown");
 assert.equal(f.secret().stage,"preparation");assert.equal((await f.owner.pair(f.input)).state,"unknown");assert.equal(f.state.redeems,1);
 await assert.rejects(f.owner.recover("enrollment"),e=>e.code==="PAIR_CREDENTIAL_CHANGED");
}finally{f.close();}});
test("sealed after real redemption retains original claim without fallback or retry",async()=>{const f=fixture();try{
 f.state.beforeRetain=()=>f.state.sealed=true;assert.equal((await f.owner.pair(f.input)).state,"unknown");assert.equal(f.state.redeems,1);
 f.state.sealed=false;await f.owner.pair(f.input);assert.equal(f.state.redeems,1);assert.equal(f.secret().stage,"preparation");
}finally{f.close();}});
test("withOriginal supplies retained private reader and synchronous Core-time authority guard",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);let retained;
 await f.owner.custody.withOriginal("user","installation","enrollment",async reader=>{retained=reader;reader.assertCurrent();assert.equal(reader.original.hostedProjectId,"project");await reader.readContext();});
 assert.equal(f.state.contexts,1);f.db.exec("UPDATE provider_connections SET enabled=0,revision=revision+1");
 assert.throws(()=>retained.assertCurrent(),e=>e.code==="PAIR_CREDENTIAL_CHANGED");
 await assert.rejects(f.owner.custody.withOriginal("user","installation","enrollment",async()=>{}));
}finally{f.close();}});
test("changed preparation reference and changed actor cannot adopt existing custody",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);await assert.rejects(f.owner.pair({...f.input,preparationItemId:"different"}),e=>e.code==="PAIRING_REUSE_CONFLICT");
 f.state.actor="other";await assert.rejects(f.owner.custody.withOriginal("user","installation","enrollment",async()=>{}));assert.equal(f.state.redeems,1);
}finally{f.close();}});
test("actual 096 SQL trigger rejects secret-bearing connection config",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);assert.throws(()=>f.db.prepare("UPDATE provider_connections SET config_json=?").run('{"token":"forbidden"}'),/must not contain credentials/);
}finally{f.close();}});
test("actual generic vault guard SQL denies reserved reveal/edit/rotate/delete even to resource owner",()=>{const f=fixture();try{
 const source=fs.readFileSync(root+"/files/services/ingenium-api/lib/routes/vault.ts","utf8");
 const fn=source.match(/function ownedVaultItem\([\s\S]*?\n\}/)[0];
 const compiled=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const owned=new Function("core","dbPath","authorizeVaultResource",compiled+";return ownedVaultItem;")({getDb:()=>f.db},()=>":memory:",()=>true);
 assert.equal(owned({},"project","item"),undefined);assert.equal(owned({},"project","item","write"),undefined);
 f.db.exec("UPDATE vault_items SET type='ordinary-user-secret'");assert.equal(owned({},"project","item").id,"item");
}finally{f.close();}});
test("actual generic vault preparation creation rejects paired/redeemed credentials and absent browser session",async()=>{const {decodePreparation}=await import(readerUrl);
 const source=fs.readFileSync(root+"/files/services/ingenium-api/lib/routes/vault.ts","utf8");
 const start=source.indexOf('  if (type === "native-pairing-credential") {'),end=source.indexOf('  const id = vault!.createItem',start),guard=source.slice(start,end);
 assert.ok(start>=0&&end>start);const run=new Function("req","res","ownership","type","value","decodePreparation",guard+'return "accepted-preparation";');
 for(const [principal,stage] of [[{type:"user",session:{}},"paired"],[{type:"user",session:{}},"redeemed"],[{type:"user"},"preparation"],[{type:"service",session:{}},"preparation"]]){
  let status;const res={status(n){status=n;return this;},json(){}};run({principal},res,{ownerKind:"user"},"native-pairing-credential",JSON.stringify({schemaVersion:1,stage}),decodePreparation);assert.equal(status,422);
 }
});
test("actual child-MCP resolution never decrypts a private Native pairing item",()=>{const source=fs.readFileSync(root+"/files/services/ingenium-api/lib/routes/mcp-servers.ts","utf8"),fn=source.match(/function trustedRuntimeDefinitions\([\s\S]*?\n\}/)[0];
 const code=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let decrypts=0;const run=new Function("childMcpServers","vault",code+";return trustedRuntimeDefinitions;")({listEffectiveChildMcpRuntimeServers:()=>[{name:"child",owner_project_id:"project",environment:{SECRET:{vault_item_id:"item"}}}]},{getItemMetadata:()=>({type:"native-pairing-credential"}),decryptItem(){decrypts++;throw Error("private credential escaped");}});
 const result=run("project");assert.deepEqual(result.data,[]);assert.deepEqual(result.unavailable,[{name:"child",diagnostic:"unavailable"}]);assert.equal(decrypts,0);
});
test("requested hosted project must match actual owned vault row before irreversible Native pair",async()=>{const f=fixture();try{
 await assert.rejects(f.owner.pair({...f.input,hostedProjectId:"foreign"}),e=>e.code==="PAIRING_PROJECT_CHANGED");assert.equal(f.state.redeems,0);assert.equal(f.row(),undefined);
}finally{f.close();}});