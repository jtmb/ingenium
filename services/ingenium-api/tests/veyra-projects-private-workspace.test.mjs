import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {PrivateWorkspaceBoundary,privateWorkspaceFingerprint} from "../lib/projects-v2/private-workspace-policy.mjs";
import {ProjectError} from "../../../packages/veyra-projects/domain.mjs";
import {legacyDigest} from "../lib/projects-v2/migration.mjs";
import {readConfiguredNativeBaseline} from "./veyra-projects-native-source.mjs";

const workspaceId="11111111-1111-4111-8111-111111111111";
const createId="22222222-2222-4222-8222-222222222222";
const instanceId="33333333-3333-4333-8333-333333333333";
const nextInstance="44444444-4444-4444-8444-444444444444";
const operationId="55555555-5555-4555-8555-555555555555";
const terminalId="66666666-6666-4666-8666-666666666666";
const alice={ownerKey:"a".repeat(64),authorityEpoch:7};
const bob={ownerKey:"b".repeat(64),authorityEpoch:7};
const create={requestId:createId,workspaceId,environment:{kind:"windows"},serviceInstanceId:instanceId,authorityEpoch:7};
function must(value,code="CONFLICT",status=409){if(!value)throw new ProjectError(code,status);}
function modelStore(db) {
  function row(r){return r && {id:r.id,ownerKey:r.owner_key,environment:JSON.parse(r.environment),revision:r.revision,
    state:r.state,directory:r.directory,rootIdentity:r.root_identity,createHash:r.create_sha256};}
  function receipt(r){return r && {projectId:null,workspaceId:r.workspace_id,requestId:r.request_id,
    workspaceRevision:r.workspace_revision,serviceInstanceId:r.service_instance_id,authorityEpoch:r.authority_epoch,
    originalSha256:r.original_sha256,state:r.state,resultRef:r.result_ref};}
  function tx(fn){db.exec("BEGIN IMMEDIATE");try{const result=fn();db.exec("COMMIT");return result;}catch(error){db.exec("ROLLBACK");throw error;}}
  const store={
    reserveCreate(actor,original,hash){return tx(()=>{
      const previous=db.prepare("SELECT * FROM private_workspaces WHERE owner_key=? AND create_request_id=?").get(actor.ownerKey,original.requestId);
      if(previous){must(previous.create_sha256===hash && previous.id===original.workspaceId);return {fresh:false,record:row(previous)};}
      db.prepare("INSERT INTO private_workspaces(id,owner_key,environment,state,create_request_id,create_sha256,created_instance_id) VALUES(?,?,?,'pending',?,?,?)")
        .run(original.workspaceId,actor.ownerKey,JSON.stringify(original.environment),original.requestId,hash,original.serviceInstanceId);
      return {fresh:true,record:store.get(actor,original.workspaceId)};
    });},
    get(actor,id){const value=row(db.prepare("SELECT * FROM private_workspaces WHERE id=? AND owner_key=?").get(id,actor.ownerKey));must(value,"NOT_FOUND",404);return value;},
    activate(actor,id,proof){must(db.prepare("UPDATE private_workspaces SET state='active',directory=?,root_identity=?,revision=revision+1 WHERE owner_key=? AND id=? AND state='pending'")
      .run(proof.directory,proof.rootIdentity,actor.ownerKey,id).changes===1);return store.get(actor,id);},
    markUnknown(actor,id){db.prepare("UPDATE private_workspaces SET state='unknown' WHERE owner_key=? AND id=? AND state='pending'").run(actor.ownerKey,id);return store.get(actor,id);},
    reserveOperation(actor,record,original,hash){return tx(()=>{
      const previous=db.prepare("SELECT * FROM private_workspace_operations WHERE owner_key=? AND request_id=?").get(actor.ownerKey,original.requestId);
      if(previous){must(previous.original_sha256===hash && previous.workspace_id===record.id);return {fresh:false,receipt:receipt(previous)};}
      const current=store.get(actor,record.id);must(current.state==="active" && current.revision===original.expectedRevision);
      db.prepare("INSERT INTO private_workspace_operations(owner_key,request_id,workspace_id,workspace_revision,service_instance_id,authority_epoch,original_sha256,operation_kind,state) VALUES(?,?,?,?,?,?,?,?,'pending')")
        .run(actor.ownerKey,original.requestId,record.id,original.expectedRevision,original.serviceInstanceId,original.authorityEpoch,hash,original.operation.kind);
      return {fresh:true,receipt:store.readOperation(actor,record.id,original.requestId)};
    });},
    settleOperation(actor,id,state,resultRef){db.prepare("UPDATE private_workspace_operations SET state=?,result_ref=? WHERE owner_key=? AND request_id=? AND state='pending'").run(state,resultRef,actor.ownerKey,id);
      const value=receipt(db.prepare("SELECT * FROM private_workspace_operations WHERE owner_key=? AND request_id=?").get(actor.ownerKey,id));must(value,"NOT_FOUND",404);return value;},
    readOperation(actor,id,requestId){const value=receipt(db.prepare("SELECT * FROM private_workspace_operations WHERE owner_key=? AND workspace_id=? AND request_id=?").get(actor.ownerKey,id,requestId));must(value,"NOT_FOUND",404);return value;},
  };
  return store;
}
function fixture({migrate=true}={}) {
  const native=readConfiguredNativeBaseline();
  const db=new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for(const migration of native.migrations) db.exec(migration.sql);
  const draft={name:"Preserved Ω",environment:{kind:"windows"},primary_root:"C:/preserved",roots:["C:/preserved"]};
  db.prepare("INSERT INTO projects(id,name,environment,primary_root,roots,creation_request) VALUES(?,?,?,?,?,?)")
    .run("77777777-7777-4777-8777-777777777777",draft.name,JSON.stringify(draft.environment),draft.primary_root,JSON.stringify(draft.roots),JSON.stringify(draft));
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const before=legacyDigest(db,tables);
  if(migrate) {
    db.exec("BEGIN IMMEDIATE");
    db.exec(readFileSync(new URL("../../../docs/workstreams/projects/private-workspaces/0006.sql",import.meta.url),"utf8"));
    db.exec("COMMIT");
  }
  const owner=modelStore(db),counts={prepare:0,acquire:0,effects:0};
  let actor={...alice},failure=false,verify=true,root="file-identity",revoked=false;
  const lease=record=>({workspaceId:record.id??record.workspaceId,ownerKey:actor.ownerKey,
    directory:record.directory??"C:/private/"+workspaceId,rootIdentity:root,verify:async()=>verify});
  const custody={supports:env=>env.kind==="windows",async prepareOnce({original}){counts.prepare++;assert.equal(db.isTransaction,false);
    must(db.prepare("SELECT state FROM private_workspaces WHERE id=?").get(workspaceId).state==="pending");
    if(failure)throw Error("native allocation uncertain");return lease(original);},
    async acquireExisting({record}){counts.acquire++;assert.equal(db.isTransaction,false);return lease(record);}};
  const execution={supports:()=>true,async executeOnce({verifyNow,original}){assert.equal(db.isTransaction,false);await verifyNow();
    must(db.prepare("SELECT state FROM private_workspace_operations WHERE request_id=?").get(original.requestId).state==="pending");
    counts.effects++;if(failure)throw Error("owner ack lost");return {state:"succeeded",resultRef:"existing-effect-owner-receipt"};}};
  const authorize=async()=>{if(revoked)throw new ProjectError("FORBIDDEN",403);return actor;};
  const make=(serviceInstanceId=instanceId)=>new PrivateWorkspaceBoundary({owner,custody,execution,authorize,serviceInstanceId});
  return {db,owner,custody,execution,counts,make,tables,before,set actor(value){actor=value;},
    set failure(value){failure=value;},set verify(value){verify=value;},set root(value){root=value;},set revoked(value){revoked=value;}};
}
function original(revision=2){return {projectId:null,workspaceId,expectedRevision:revision,serviceInstanceId:instanceId,
  authorityEpoch:7,requestId:operationId,operation:{kind:"terminal_input",terminalId,text:"exact input\r"}};}

test("private migration preserves every v5 table/row and never creates a Project",async()=>{
  const f=fixture();try {
    assert.equal(f.db.prepare("PRAGMA user_version").get().user_version,6);
    const boundary=f.make();const saved=await boundary.create({},create);
    assert.equal(saved.projectId,null);assert.equal(saved.state,"active");
    assert.equal((await boundary.execute({},original(saved.revision))).state,"succeeded");
    assert.deepEqual(legacyDigest(f.db,f.tables),f.before);
    assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
    const columns=f.db.prepare("PRAGMA table_info(private_workspace_operations)").all().map(r=>r.name);
    for(const forbidden of ["prompt","text","transcript","request_json","account_id"])assert.equal(columns.includes(forbidden),false);
  }finally{f.db.close();}
});
test("private records/receipts reject other actors and forged owner/path/project input",async()=>{
  const f=fixture();try {
    await f.make().create({},create);
    for(const extra of [{ownerKey:bob.ownerKey},{directory:"C:/other"},{projectId:"global-default"},
      {environment:{kind:"windows",directory:"C:/nested-forgery"}}])
      await assert.rejects(()=>f.make().create({},{...create,...extra}),e=>e.code==="VALIDATION_ERROR");
    f.actor=bob;
    await assert.rejects(()=>f.make().reconnect({},workspaceId),e=>e.code==="NOT_FOUND");
    await assert.rejects(()=>f.make().execute({},original()),e=>e.code==="NOT_FOUND");
    assert.equal(f.counts.effects,0);
    assert.throws(()=>f.db.prepare("INSERT INTO private_workspace_operations(owner_key,request_id,workspace_id,workspace_revision,service_instance_id,authority_epoch,original_sha256,operation_kind,state) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(bob.ownerKey,operationId,workspaceId,2,instanceId,7,"a".repeat(64),"terminal_open","pending"),/FOREIGN KEY/);
  }finally{f.db.close();}
});
test("creation uncertainty and reconnect never repeat allocation",async()=>{
  const f=fixture();try {
    f.failure=true;const first=await f.make().create({},create);assert.equal(first.state,"unknown");
    assert.equal((await f.make().create({},create)).state,"unknown");
    const reconnected=await f.make(nextInstance).reconnect({},workspaceId);
    assert.equal(reconnected.state,"unknown");assert.equal(reconnected.serviceInstanceId,nextInstance);
    assert.equal(f.counts.prepare,1);assert.equal(f.counts.acquire,0);assert.equal(f.counts.effects,0);
  }finally{f.db.close();}
});
test("execution lost acknowledgement remains original across reconnect and rejects changed bodies",async()=>{
  const f=fixture();try {
    await f.make().create({},create);f.failure=true;
    const request=original();assert.equal((await f.make().execute({},request)).state,"unknown");
    assert.equal((await f.make().execute({},request)).state,"unknown");
    const receipt=await f.make(nextInstance).receipt({},workspaceId,operationId);
    assert.equal(receipt.state,"unknown");assert.equal(receipt.serviceInstanceId,instanceId);
    assert.equal(f.counts.effects,1);assert.equal(f.counts.acquire,1);
    await assert.rejects(()=>f.make().execute({},{...request,operation:{...request.operation,text:"different"}}),e=>e.code==="CONFLICT");
    assert.equal(f.counts.effects,1);
    assert.equal(receipt.originalSha256,privateWorkspaceFingerprint(request));
  }finally{f.db.close();}
});
test("fresh admission rejects stale instance/epoch/revision and non-null project",async()=>{
  const f=fixture();try {
    await f.make().create({},create);
    for(const [request,code] of [[{...original(),projectId:"hidden-project"},"PRIVATE_SCOPE_REQUIRED"],
      [{...original(),serviceInstanceId:nextInstance},"STALE_PRIVATE_BINDING"],
      [{...original(),authorityEpoch:6},"STALE_PRIVATE_AUTHORITY"],
      [{...original(),expectedRevision:1},"PRIVATE_WORKSPACE_UNAVAILABLE"]])
      await assert.rejects(()=>f.make().execute({},request),e=>e.code===code);
    assert.equal(f.counts.effects,0);assert.equal(f.counts.acquire,0);
  }finally{f.db.close();}
});
test("metadata and serialized path objects never become custody",async()=>{
  const f=fixture();try {
    f.custody.prepareOnce=async()=>({workspaceId,ownerKey:alice.ownerKey,directory:"C:/fake",rootIdentity:"fake"});
    assert.equal((await f.make().create({},create)).state,"unknown");
    await assert.rejects(()=>f.make().execute({},original(1)),e=>e.code==="PRIVATE_WORKSPACE_UNAVAILABLE");
    assert.equal(f.counts.effects,0);
  }finally{f.db.close();}
});
test("changed physical identity or revoked actor while acquiring prevents dispatch",async()=>{
  const f=fixture();try {
    await f.make().create({},create);f.root="other-identity";
    assert.equal((await f.make().execute({},original())).state,"unknown");assert.equal(f.counts.effects,0);
    const next={...original(),requestId:"88888888-8888-4888-8888-888888888888"};
    f.root="file-identity";
    const acquire=f.custody.acquireExisting;
    f.custody.acquireExisting=async input=>{const lease=await acquire(input);f.revoked=true;return lease;};
    assert.equal((await f.make().execute({},next)).state,"unknown");assert.equal(f.counts.effects,0);
  }finally{f.db.close();}
});
test("unsupported execution owner and missing current principal fail closed",async()=>{
  const f=fixture();try {
    await f.make().create({},create);f.execution.supports=()=>false;
    await assert.rejects(()=>f.make().execute({},original()),e=>e.code==="PRIVATE_EXECUTION_UNSUPPORTED");
    f.revoked=true;await assert.rejects(()=>f.make().reconnect({},workspaceId),e=>e.code==="FORBIDDEN");
    assert.equal(f.counts.effects,0);assert.equal(f.counts.acquire,0);
  }finally{f.db.close();}
});

test("failed native v6 migration rolls back atomically to the unchanged v5 copy",()=>{
  const f=fixture({migrate:false});try {
    f.db.exec("BEGIN IMMEDIATE");
    assert.throws(()=>f.db.exec(readFileSync(new URL("../../../docs/workstreams/projects/private-workspaces/0006.sql",import.meta.url),"utf8")+
      "; SELECT deliberate_migration_failure"),e=>e.message.includes("deliberate_migration_failure"));
    f.db.exec("ROLLBACK");
    assert.equal(f.db.prepare("PRAGMA user_version").get().user_version,5);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='private_workspaces'").get().n,0);
    assert.deepEqual(legacyDigest(f.db,f.tables),f.before);
  }finally{f.db.close();}
});
test("concurrent creation observes one pending original and allocates only once",async()=>{
  const f=fixture();let release;try {
    const gate=new Promise(resolve=>{release=resolve;});const allocate=f.custody.prepareOnce;
    f.custody.prepareOnce=async input=>{const lease=await allocate(input);await gate;return lease;};
    const boundary=f.make();const first=boundary.create({},create);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await boundary.create({},create)).state,"pending");
    assert.equal(f.counts.prepare,1);release();
    assert.equal((await first).state,"active");assert.equal(f.counts.prepare,1);
  }finally{release?.();f.db.close();}
});
test("last responsible guard blocks a retired workspace before the existing owner dispatches",async()=>{
  const f=fixture();try {
    await f.make().create({},create);
    const dispatch=f.execution.executeOnce;
    f.execution.executeOnce=async input=>{
      f.db.exec("UPDATE private_workspaces SET state='retired',revision=revision+1");
      return dispatch(input);
    };
    assert.equal((await f.make().execute({},original())).state,"unknown");
    assert.equal(f.counts.effects,0);
  }finally{f.db.close();}
});
test("private workspace ownership never implies permission for a terminal input action",async()=>{
  const f=fixture();try {
    await f.make().create({},create);const boundary=f.make();
    boundary.authorize=async(context,action)=>{
      if(action==="private-workspaces:execute:terminal_input")throw new ProjectError("FORBIDDEN",403);
      return alice;
    };
    await assert.rejects(()=>boundary.execute({},original()),e=>e.code==="FORBIDDEN");
    assert.equal(f.counts.effects,0);assert.equal(f.counts.acquire,0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM private_workspace_operations").get().n,0);
  }finally{f.db.close();}
});

test("private patch/SQL artifacts match their declared hashes and never construct a Project",()=>{
  const directory=new URL("../../../docs/workstreams/projects/private-workspaces/",import.meta.url);
  const patch=readFileSync(new URL("native-private-workspaces.patch",directory),"utf8");
  const metadata=JSON.parse(readFileSync(new URL("proposal.json",directory),"utf8"));
  assert.equal(createHash("sha256").update(patch).digest("hex"),metadata.patchSha256);
  const added={};let path=null;
  for(const line of patch.split("\n")) {
    if(line.startsWith("--- "))path=null;
    if(line.startsWith("+++ b/")) {
      const target=line.slice(6);path=metadata.sharedFiles.find(f=>f.path===target)?.baseSha256===null?target:null;
      if(path)added[path]="";
    } else if(path && line.startsWith("+")) added[path]+=line.slice(1)+"\n";
  }
  assert.equal(added["crates/adapters/src/projects/0006.sql"],readFileSync(new URL("0006.sql",directory),"utf8"));
  for(const [path,body] of Object.entries(added)) {
    assert.equal(createHash("sha256").update(body).digest("hex"),metadata.sharedFiles.find(f=>f.path===path).proposedSha256);
    for(const forbidden of ["Project {","ProjectDraft {","create_idempotent(","scratch::create","/v1/scratch"])
      assert.equal(body.includes(forbidden),false,path+" contains "+forbidden);
  }
  assert.equal(added["crates/contracts/src/private_workspaces.rs"].includes("pub enum PrivateWorkspaceEnvironment"),true);
  assert.equal(patch.includes('+            "/v1/private-workspaces"'),false);
});
