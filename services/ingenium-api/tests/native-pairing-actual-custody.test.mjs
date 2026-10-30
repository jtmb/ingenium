import {test} from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import {createRequire} from "node:module";import {fileURLToPath,pathToFileURL} from "node:url";import {DatabaseSync} from "node:sqlite";
const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../.."),root=path.join(checkout,"docs/workstreams/customize/native-hosted-transport"),phase=path.resolve(checkout,"../veyra-phase-1"),app=checkout;
const ts=createRequire(import.meta.url)(app+"/node_modules/typescript/lib/typescript.js"),base=app+"/services/ingenium-api/lib";
const encode=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const transpile=p=>ts.transpileModule(fs.readFileSync(p,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const core=await import(pathToFileURL(app+"/packages/ingenium-core/lib/tools/hosted-governance.ts"));
const crypto=await import(encode(transpile(app+"/packages/ingenium-core/lib/tools/vault-crypto.ts")));
const proofUrl=encode(transpile(base+"/paired-native-proof.ts"));
const readerUrl=encode(transpile(base+"/paired-native-reader.ts").replace('"./paired-native-proof.js"',JSON.stringify(proofUrl)));
globalThis.__custodyTest={HostedRefusal:core.HostedRefusal};
const ownerCode=transpile(base+"/node-native-pairing-custody.ts")
 .replace(/import \{[^}]+\} from "ingenium-core";/,'const {HostedRefusal}=globalThis.__custodyTest;const getDb=()=>{throw Error("No real database in fixture")},execTransaction=()=>{throw Error("No real transaction in fixture")},checkpointAfterWrite=()=>{},vault={},authorization={};')
 .replace(/import \{[^}]+\} from "\.\/middleware\/auth.js";/,'const authenticateRequestWithoutActivity=()=>{throw Error("No fixture auth acceptance")};')
 .replace(/import \{[^}]+\} from "\.\/authorization-policy.js";/,'const toAuthorizationPrincipal=()=>{throw Error("No fixture auth acceptance")};')
 .replace('"./paired-native-reader.js"',JSON.stringify(readerUrl)).replace('"./paired-native-proof.js"',JSON.stringify(proofUrl));
const {createNodeNativePairingOwner}=await import(encode(ownerCode));
const migration=fs.readFileSync(app+"/packages/ingenium-core/data/migrations/096_resource_ownership.sql","utf8");
const table=migration.match(/CREATE TABLE provider_connections \([\s\S]*?\n\);/)[0];
const triggers=[...migration.matchAll(/CREATE TRIGGER provider_connections_[\s\S]*?END;/g)].map(m=>m[0]);
function fixture(){
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON; CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT,is_global INTEGER); CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT); CREATE TABLE vault_items(id TEXT PRIMARY KEY,project_id TEXT,organization_id TEXT,owner_kind TEXT,owner_user_id TEXT,type TEXT,version INTEGER,access_policy TEXT,encrypted BLOB); CREATE TABLE veyra_installation_identity(singleton INTEGER PRIMARY KEY,instance_id TEXT); CREATE TABLE provider_model_policies(id TEXT); CREATE TABLE resource_grants(id TEXT); CREATE TABLE settings(id TEXT);");
 db.exec(table);for(const t of triggers)db.exec(t);
 db.exec("CREATE UNIQUE INDEX fixture_installation ON veyra_installation_identity(instance_id)");db.exec(fs.readFileSync(app+"/packages/ingenium-core/data/migrations/125_native_hosted_governance.sql","utf8"));
 db.exec("INSERT INTO organizations VALUES('org'); INSERT INTO users VALUES('user'),('other'); INSERT INTO projects VALUES('project','org',0); INSERT INTO organization_memberships VALUES('org','user','active'); INSERT INTO veyra_installation_identity VALUES(1,'installation');");
 const request={method:"POST",path:"/effects"};const state={archived:false,request,retirementProof:undefined,retirementHook:undefined,actor:"user",sealed:false,redeems:0,verifies:0,contexts:0,originals:0,failProof:false,afterRetain:undefined,beforeRetain:undefined};
 const key=Buffer.alloc(32,19),prep={schemaVersion:1,stage:"preparation",enrollmentRequestId:"enrollment",endpoint:"https://actual-native.example",certificatePem:"synthetic-public-certificate",certificateSha256:"a".repeat(64),pairingCode:"b".repeat(64),expectedAuthorityId:"authority"};
 db.prepare("INSERT INTO vault_items VALUES('item','project','org','user','user','native-pairing-credential',0,'{}',?)").run(crypto.encryptSecret(JSON.stringify(prep),key));
 const original={actorId:"user",installationId:"installation",enrollmentRequestId:"enrollment",hostedProjectId:"project",authorityId:"authority",grantId:"actual-grant",grantRevision:1,nativeOwner:{library_id:"actual-library",service_instance_id:"actual-service",project:{id:"native-project",revision:3,archived:false}}};
 const redeemed={schemaVersion:1,stage:"redeemed",enrollmentRequestId:"enrollment",actorId:"user",installationId:"installation",hostedProjectId:"project",endpoint:prep.endpoint,certificatePem:prep.certificatePem,certificateSha256:prep.certificateSha256,token:"c".repeat(64),authorityId:"authority",serviceInstanceId:"actual-service",grantId:"actual-grant"};
 const credential={endpoint:prep.endpoint,certificatePem:prep.certificatePem,certificateSha256:prep.certificateSha256,token:redeemed.token,original};
 const backend={
 db:()=>db,transaction:work=>{db.exec("BEGIN IMMEDIATE");try{const result=work();db.exec("COMMIT");return result;}catch(e){db.exec("ROLLBACK");throw e;}},checkpoint(){},
 principal(){return {type:"user",id:state.actor,scopes:["user:*"],session:{id:"fixture-browser-session"}};},
 project(p,id){return !state.archived&&id==="project"&&!!db.prepare("SELECT 1 FROM organization_memberships WHERE user_id=? AND organization_id='org' AND status='active'").get(p.id);},
 retirementProject(p,id){return id==="project"&&!!db.prepare("SELECT 1 FROM organization_memberships WHERE user_id=? AND organization_id='org' AND status='active'").get(p.id);},
 owned(p,row){return row.owner_kind==="user"&&row.owner_user_id===p.id&&row.organization_id==="org";},
 vault:{isSealed:()=>state.sealed,decryptItem(project,id){assert.equal(project,"project");const row=db.prepare("SELECT encrypted FROM vault_items WHERE id=?").get(id);return crypto.decryptSecret(Buffer.from(row.encrypted),key).toString("utf8");},
 deleteItem(project,id){assert.equal(project,"project");db.prepare("UPDATE vault_items SET access_policy=? WHERE id=?").run('{"mode":"deleted"}',id);},
 updateItem(project,id,value){assert.equal(project,"project");if(state.sealed)return;db.prepare("UPDATE vault_items SET encrypted=?,version=version+1 WHERE id=?").run(crypto.encryptSecret(value,key),id);}},
 async redeem(actual,actor,installation,project,retain){state.redeems++;assert.deepEqual(actual,prep);assert.equal(actor,"user");assert.equal(installation,"installation");assert.equal(project,"project");state.beforeRetain?.();retain(redeemed);state.afterRetain?.();if(state.failProof)throw Error("Native context unavailable");return credential;},
 async verify(value){state.verifies++;assert.deepEqual(value,redeemed);if(state.failProof)throw Error("Native context unavailable");return credential;},
 reader(value){assert.deepEqual(value,credential);return {original:value.original,async readRetirement(){state.retirementHook?.();if(state.retirementProof instanceof Error)throw state.retirementProof;return state.retirementProof??{protocol:"node_hosted_retirement_v1",enrollment_request_id:"enrollment",actor_id:"user",installation_id:"installation",native_authority_id:"authority",native_owner:original.nativeOwner,grant:{id:"actual-grant",revision:2,revoked:true},live_pairings:0,live_grants:0,pending_effects:0};},async readContext(){state.contexts++;return {actual:"paired Native read fixture"};},async readOriginal(){state.originals++;return {actual:"paired Native original fixture"};}}}
 };
 const owner=createNodeNativePairingOwner(request,backend),input={enrollmentRequestId:"enrollment",hostedProjectId:"project",preparationItemId:"item"};
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
 const source=fs.readFileSync(app+"/services/ingenium-api/lib/routes/vault.ts","utf8");
 const fn=source.match(/function ownedVaultItem\([\s\S]*?\n\}/)[0];
 const compiled=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const owned=new Function("core","dbPath","authorizeVaultResource",compiled+";return ownedVaultItem;")({getDb:()=>f.db},()=>":memory:",()=>true);
 assert.equal(owned({},"project","item"),undefined);assert.equal(owned({},"project","item","write"),undefined);
 f.db.exec("UPDATE vault_items SET type='ordinary-user-secret'");assert.equal(owned({},"project","item").id,"item");
}finally{f.close();}});
test("actual generic vault preparation creation rejects paired/redeemed credentials and absent browser session",async()=>{const {decodePreparation}=await import(readerUrl);
 const source=fs.readFileSync(app+"/services/ingenium-api/lib/routes/vault.ts","utf8");
 const start=source.indexOf('  if (type === "native-pairing-credential") {'),end=source.indexOf('  const id = vault!.createItem',start),guard=source.slice(start,end);
 assert.ok(start>=0&&end>start);const run=new Function("req","res","ownership","type","value","decodePreparation",guard+'return "accepted-preparation";');
 for(const [principal,stage] of [[{type:"user",session:{}},"paired"],[{type:"user",session:{}},"redeemed"],[{type:"user"},"preparation"],[{type:"service",session:{}},"preparation"]]){
  let status;const res={status(n){status=n;return this;},json(){}};run({principal},res,{ownerKind:"user"},"native-pairing-credential",JSON.stringify({schemaVersion:1,stage}),decodePreparation);assert.equal(status,422);
 }
});
test("actual child-MCP resolution never decrypts a private Native pairing item",()=>{const source=fs.readFileSync(app+"/services/ingenium-api/lib/routes/mcp-servers.ts","utf8"),fn=source.match(/function trustedRuntimeDefinitions\([\s\S]*?\n\}/)[0];
 const code=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let decrypts=0;const run=new Function("childMcpServers","vault",code+";return trustedRuntimeDefinitions;")({listEffectiveChildMcpRuntimeServers:()=>[{name:"child",owner_project_id:"project",environment:{SECRET:{vault_item_id:"item"}}}]},{getItemMetadata:()=>({type:"native-pairing-credential"}),decryptItem(){decrypts++;throw Error("private credential escaped");}});
 const result=run("project");assert.deepEqual(result.data,[]);assert.deepEqual(result.unavailable,[{name:"child",diagnostic:"unavailable"}]);assert.equal(decrypts,0);
});
test("requested hosted project must match actual owned vault row before irreversible Native pair",async()=>{const f=fixture();try{
 await assert.rejects(f.owner.pair({...f.input,hostedProjectId:"foreign"}),e=>e.code==="PAIRING_PROJECT_CHANGED");assert.equal(f.state.redeems,0);assert.equal(f.row(),undefined);
}finally{f.close();}});
function grant(f){
 f.db.prepare("INSERT INTO native_hosted_governance_grants(id,enrollment_request_id,enrollment_hash,connection_id,owner_user_id,installation_id,native_library_id,native_service_instance_id,native_project_id,native_project_revision,hosted_project_id,visibility,revision,epoch,created_at) VALUES('node-grant','enrollment',?,'connection','user','installation','actual-library','actual-service','native-project',3,'project','project',1,'epoch','now')").run("d".repeat(64));
}
test("quiescence stops new use while preserving actual same-owner read-only receipt recovery",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});assert.equal(q.state,"quiescing");assert.equal(q.pendingEffects,0);
 await assert.rejects(f.owner.custody.withOriginal("user","installation","enrollment",async()=>{}),e=>e.code==="NATIVE_ATTESTATION_UNAVAILABLE");
 f.state.request.method="GET";f.state.request.path="/operations/original";await f.owner.custody.withOriginal("user","installation","enrollment",async reader=>{reader.assertCurrent();await reader.readContext();});assert.equal(f.state.contexts,1);
 await assert.rejects(f.owner.retire("enrollment",{expectedRevision:q.revision-1}),e=>e.code==="PAIRING_CAS_CONFLICT");
}finally{f.close();}});
test("actual Native revocation proof + zero real125 effects logically retire existing rows without erasing originals/ciphertext",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision}),before=Buffer.from(f.db.prepare("SELECT encrypted FROM vault_items").get().encrypted);
 const r=await f.owner.retire("enrollment",{expectedRevision:q.revision});assert.equal(r.state,"retired");assert.equal(r.physicalErasure,false);assert.equal(f.row().enabled,0);assert.equal(f.row().credential_item_id,null);
 assert.ok(f.db.prepare("SELECT revoked_at FROM native_hosted_governance_grants").get().revoked_at);assert.equal(f.db.prepare("SELECT access_policy FROM vault_items").get().access_policy,'{"mode":"deleted"}');assert.deepEqual(Buffer.from(f.db.prepare("SELECT encrypted FROM vault_items").get().encrypted),before);
 assert.equal(f.owner.status("enrollment").state,"retired");
}finally{f.close();}});
test("an executing actual125 effect prevents retirement; unknown absence is never written into terminal history",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);f.db.prepare("INSERT INTO native_hosted_governance_effects(operation_id,grant_id,actor_id,project_id,payload_hash,binding_hash,command_kind,state,created_at,updated_at) VALUES('unknown','node-grant','user','project',?,?,'archive','executing','now','now')").run("e".repeat(64),"f".repeat(64));
 const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});assert.equal(q.pendingEffects,1);
 await assert.rejects(f.owner.retire("enrollment",{expectedRevision:q.revision}),e=>e.code==="HOSTED_EFFECTS_UNRESOLVED");assert.equal(f.db.prepare("SELECT state FROM native_hosted_governance_effects").get().state,"executing");assert.equal(f.row().config_json.includes('"retirement":'),false);
}finally{f.close();}});
test("live/mismatched Native grants, active pairings, Native pending originals or failed proof do not authorize retirement",async()=>{for(const mutate of [p=>p.grant.revoked=false,p=>p.grant.id="foreign",p=>p.grant.revision=1,p=>p.live_pairings=1,p=>p.live_grants=1,p=>p.pending_effects=1,p=>p.native_owner.project.revision=9]){
 const f=fixture();try{await f.owner.pair(f.input);grant(f);const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});
 f.state.retirementProof={protocol:"node_hosted_retirement_v1",enrollment_request_id:"enrollment",actor_id:"user",installation_id:"installation",native_authority_id:"authority",native_owner:structuredClone(f.credential.original.nativeOwner),grant:{id:"actual-grant",revision:2,revoked:true},live_pairings:0,live_grants:0,pending_effects:0};mutate(f.state.retirementProof);
 await assert.rejects(f.owner.retire("enrollment",{expectedRevision:q.revision}));assert.equal(f.owner.status("enrollment").state,"quiescing");assert.equal(f.db.prepare("SELECT revoked_at FROM native_hosted_governance_grants").get().revoked_at,null);assert.notEqual(f.row().credential_item_id,null);
 }finally{f.close();}
}});
test("owner/version race during Native retirement proof cannot retire changed custody",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});f.state.retirementHook=()=>f.db.exec("UPDATE vault_items SET version=version+1");
 await assert.rejects(f.owner.retire("enrollment",{expectedRevision:q.revision}),e=>e.code==="PAIRING_CAS_CONFLICT");assert.equal(f.owner.status("enrollment").state,"quiescing");
}finally{f.close();}});
test("actual Rust admin SQL preserves non-null unknown receipts and releases only matching completed retirement",()=>{
 const source=fs.readFileSync(path.join(phase,"windows-source")+"/crates/adapters/src/utility_operations/hosted.rs","utf8"),sql=source.match(/const ADMIN_UNRESOLVED:&str=r#"([\s\S]*?)"#;/)[1],db=new DatabaseSync(":memory:");
 try{db.exec("CREATE TABLE originals(id TEXT PRIMARY KEY,kind TEXT,original TEXT,result TEXT,created INTEGER)");const owner={library_id:"library",service_instance_id:"service",project:{id:"native",revision:2,primary_root:"C:/exact"}},account={account:{id:"account"}};
 const original={protocol:"node_hosted_pairing_v1",command:{account:{enrollment_request_id:"enrollment",native_owner:owner,account_review:account}}};
 db.prepare("INSERT INTO originals VALUES('source','remote_admin',?,?,0)").run(JSON.stringify(original),JSON.stringify({state:"unconfirmed"}));
 const held=()=>db.prepare("SELECT EXISTS(SELECT 1 "+sql+") AS held").get().held;assert.equal(held(),1);
 const resolution={protocol:"node_hosted_retirement_command_v1",private_owner:{enrollment_request_id:"enrollment",account_review:account,native_owner:structuredClone(owner)}},result={state:"completed",value:{node:{state:"retired",enrollmentRequestId:"enrollment"}}};
 resolution.private_owner.native_owner.project.primary_root="C:/foreign";db.prepare("INSERT INTO originals VALUES('resolution','remote_admin',?,?,1)").run(JSON.stringify(resolution),JSON.stringify(result));assert.equal(held(),1);
 resolution.private_owner.native_owner=owner;db.prepare("UPDATE originals SET original=? WHERE id='resolution'").run(JSON.stringify(resolution));assert.equal(held(),0);assert.equal(JSON.parse(db.prepare("SELECT result FROM originals WHERE id='source'").get().result).state,"unconfirmed");
 }finally{db.close();}
});
test("actual Core lifecycle query holds active project/grant/unknown owner and clears after proven logical retirement",async()=>{const f=fixture();try{
 const source=transpile(app+"/packages/ingenium-core/lib/tools/node-native-lifecycle.ts"),{assertNativeGovernanceLifecycleClear:clear}=await import(encode(source));
 clear(f.db,"project");await f.owner.pair(f.input);grant(f);assert.throws(()=>clear(f.db,"project"),/CUSTODY/);clear(f.db,"foreign");
 const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});assert.throws(()=>clear(f.db),/CUSTODY/);await f.owner.retire("enrollment",{expectedRevision:q.revision});clear(f.db,"project");clear(f.db);
}finally{f.close();}});test("failed Native retirement read retains quiesced authority and encrypted credential",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});f.state.retirementProof=Error("TLS proof unavailable");
 await assert.rejects(f.owner.retire("enrollment",{expectedRevision:q.revision}));assert.equal(f.owner.status("enrollment").state,"quiescing");assert.equal(f.row().credential_item_id,"item");
}finally{f.close();}});
test("quiescing during one-use redemption cannot reactivate custody or resend code",async()=>{const f=fixture();try{
 f.state.beforeRetain=()=>f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});const r=await f.owner.pair(f.input);assert.equal(r.state,"quiescing");assert.equal(f.state.redeems,1);await f.owner.pair(f.input);assert.equal(f.state.redeems,1);assert.equal(f.secret().stage,"preparation");
}finally{f.close();}});test("unpaired local reconciliation clears only exact local custody and preserves unknown remote sign-in outcome",()=>{
 const source=fs.readFileSync(path.join(phase,"windows-source")+"/crates/adapters/src/utility_operations/hosted.rs","utf8"),sql=source.match(/const ADMIN_UNRESOLVED:&str=r#"([\s\S]*?)"#;/)[1],db=new DatabaseSync(":memory:");
 try{db.exec("CREATE TABLE originals(id TEXT PRIMARY KEY,kind TEXT,original TEXT,result TEXT,created INTEGER)");const original={protocol:"node_hosted_account_v1",command:{enrollment_request_id:"enrollment",native_owner:{library_id:"library",service_instance_id:"old-service",project:null},account_review:{account:{id:"account"}}}};
 db.prepare("INSERT INTO originals VALUES('source','remote_admin',?,?,0)").run(JSON.stringify(original),JSON.stringify({state:"unconfirmed"}));const held=()=>db.prepare("SELECT EXISTS(SELECT 1 "+sql+") held").get().held;assert.equal(held(),1);
 const receipt={state:"completed",local_native_custody_released:true,remote_sign_in_outcome:"unconfirmed"},wrong={protocol:"node_hosted_local_account_reconciliation_v1",source_operation_id:"source",source_original:{...original,changed:true}};
 db.prepare("INSERT INTO originals VALUES('local','remote_admin',?,?,1)").run(JSON.stringify(wrong),JSON.stringify(receipt));assert.equal(held(),1);
 db.prepare("UPDATE originals SET original=? WHERE id='local'").run(JSON.stringify({...wrong,source_original:original}));assert.equal(held(),0);assert.equal(JSON.parse(db.prepare("SELECT result FROM originals WHERE id='source'").get().result).state,"unconfirmed");
 }finally{db.close();}
});test("historical private retirement works for archived project without restoring domain-effect authority",async()=>{const f=fixture();try{
 await f.owner.pair(f.input);grant(f);f.state.archived=true;
 await assert.rejects(f.owner.custody.withOriginal("user","installation","enrollment",async()=>{}));
 const q=f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});assert.equal(q.state,"quiescing");
 assert.equal((await f.owner.retire("enrollment",{expectedRevision:q.revision})).state,"retired");
}finally{f.close();}});test("project recovery restore requires actual quiescence and preserves executing receipt custody",async()=>{const f=fixture();try{
 const {assertNativeGovernanceRecoveryRestore:restore}=await import(encode(transpile(app+"/packages/ingenium-core/lib/tools/node-native-lifecycle.ts")));
 await f.owner.pair(f.input);grant(f);assert.throws(()=>restore(f.db,"project"),/QUIESCENCE/);
 f.db.prepare("INSERT INTO native_hosted_governance_effects(operation_id,grant_id,actor_id,project_id,payload_hash,binding_hash,command_kind,state,created_at,updated_at) VALUES('unknown','node-grant','user','project',?,?,'archive','executing','now','now')").run("e".repeat(64),"f".repeat(64));
 f.owner.quiesce("enrollment",{expectedRevision:f.row().revision});restore(f.db,"project");assert.equal(f.db.prepare("SELECT state FROM native_hosted_governance_effects").get().state,"executing");
}finally{f.close();}});