import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {ProjectCatalog} from "../lib/projects-v2/catalog.mjs";
import {ExecutionOperations} from "../lib/projects-v2/execution.mjs";
import {importLegacyCatalog, inventoryLegacyReferences, legacyDigest, migrationInventoryHash} from "../lib/projects-v2/migration.mjs";
import {resolveExecution, transitionWorktree, readTerminalWindow, terminalDimensions}
  from "../../../packages/veyra-projects/domain.mjs";

const scope = {instanceId:"instance-a", organizationId:"org-a", ownerUserId:"alice"};
const other = {...scope, ownerUserId:"bob"};
const root = {id:"root-a",canonicalRootId:"file-id-17",hostId:"pc-a",environmentId:"native",
  displayPath:"C:/Repos/alpha",isPrimary:true,repositoryIdentity:null};
const binding = {version:1,id:"binding-a",hostId:"pc-a",environmentId:"native",
  workspaceBindingId:"workspace-a",canonicalRootId:"file-id-17",directory:"C:/Repos/alpha",
  shellId:"powershell",securityEpoch:3,kind:"windows",workspaceIdentity:"workspace-inode",
  mappingHash:"a".repeat(64),ownerInstanceId:"service-a",ownerRevision:7};
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,is_global INTEGER,archived_at TEXT);");
  db.exec(readFileSync(new URL("../lib/projects-v2/schema.sql",import.meta.url),"utf8"));
  let checkpoints = 0;
  const transaction = fn => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch(error) { db.exec("ROLLBACK"); throw error; }
  };
  const checkpointAfterWrite = () => { assert.equal(db.isTransaction,false); checkpoints++; };
  const authorize = (s, action) => s.ownerUserId === "alice" && action !== "denied";
  const catalog = new ProjectCatalog({db,transaction,checkpointAfterWrite,authorize});
  return {db,transaction,checkpointAfterWrite,catalog,get checkpoints(){return checkpoints;}};
}
test("catalog: multi-root, same labels, CAS lifecycle and tenant isolation", () => {
  const f = fixture();
  try {
    const p = f.catalog.create(scope,{label:"alpha",roots:[root]},"p-a");
    f.catalog.create(scope,{label:"alpha",roots:[{...root,id:"root-b",hostId:"pc-b"}]},"p-b");
    assert.equal(f.catalog.list(scope,{limit:1}).pagination.hasMore,true);
    assert.equal(f.catalog.get(scope,"p-a").roots[0].repositoryIdentity,null);
    assert.throws(()=>f.catalog.get(other,"p-a"),e=>e.code==="FORBIDDEN");
    assert.throws(()=>f.catalog.get({...scope,organizationId:"org-b"},"p-a"),e=>e.code==="NOT_FOUND");
    const updated = f.catalog.update(scope,p.id,p.revision,{label:"renamed",pinned:true});
    assert.equal(updated.roots[0].displayPath,root.displayPath);
    assert.throws(()=>f.catalog.update(scope,p.id,p.revision,{label:"stale"}),e=>e.status===409);
    const archived=f.catalog.update(scope,p.id,updated.revision,{archived:true});
    assert.equal(f.catalog.list(scope).data.length,1);
    assert.equal(f.catalog.list(scope,{archived:true}).data[0].id,p.id);
    assert.equal(f.catalog.update(scope,p.id,archived.revision,{archived:false}).archivedAt,null);
    assert.equal(f.checkpoints,5);
    assert.throws(()=>f.catalog.create(scope,{label:"invalid",roots:[root,{...root}]}),e=>e.status===422);
  } finally { f.db.close(); }
});
test("bindings: no host fallback, stale epoch, archived projects, projectless privacy and WSL owner", () => {
  const project={id:"p-a",scope,archivedAt:null,roots:[root]};
  const admission={scope,binding,projectId:"p-a",online:true,capabilities:["terminal:open"]};
  const resolve=(b=binding,a=admission,p=project)=>resolveExecution({
    scope,project:p,binding:b,admission:a,capability:"terminal:open"});
  assert.equal(resolve().hostId,"pc-a");
  assert.throws(()=>resolve({...binding,securityEpoch:4}),e=>e.code==="STALE_EXECUTION_BINDING");
  assert.throws(()=>resolve(binding,{...admission,online:false}),e=>e.code==="HOST_UNAVAILABLE");
  assert.throws(()=>resolve(binding,{...admission,scope:other}),e=>e.code==="FORBIDDEN");
  assert.throws(()=>resolve(binding,admission,{...project,archivedAt:"yesterday"}),e=>e.code==="PROJECT_ARCHIVED");
  assert.equal(resolve(binding,{...admission,projectId:null},null).id,binding.id);
  assert.throws(()=>resolve(binding,admission,null),e=>e.code==="FORBIDDEN");
  assert.throws(()=>resolve({...binding,kind:"wsl"}),e=>e.status===422);
  const wsl={...binding,kind:"wsl",distro:"Ubuntu",user:"alice",directory:"/home/alice/repo"};
  assert.equal(resolve(wsl,{...admission,binding:wsl}).distro,"Ubuntu");
  const cluster={...binding,kind:"cluster",runtimeId:"pod-id",storageId:"pvc-id",directory:"/workspace"};
  assert.equal(resolve(cluster,{...admission,binding:cluster}).storageId,"pvc-id");
});
test("operations: lost acknowledgement remains unknown, same request never re-executes, changed request conflicts", async () => {
  const f=fixture(); let calls=0;
  try {
    const admission={scope,binding,projectId:null,online:true,capabilities:["terminal:open"]};
    const service=new ExecutionOperations({...f,resolveAdmission:async()=>admission,
      dispatch:async()=>{calls++;throw Error("ack lost");}});
    const request={operationId:"op-a",projectId:null,binding,action:"terminal.open"};
    assert.equal((await service.execute(scope,request)).state,"unknown");
    assert.equal((await service.execute(scope,request)).state,"unknown");
    assert.equal(calls,1);
    await assert.rejects(()=>service.execute(scope,{...request,args:{columns:100,rows:30}}),e=>e.code==="OPERATION_CONFLICT");
    admission.online=false;
    await assert.rejects(()=>service.execute(scope,request),e=>e.code==="HOST_UNAVAILABLE");
  } finally {f.db.close();}
});
test("operations: successful receipt survives a new service and validates terminal ownership", async () => {
  const f=fixture(); let calls=0;
  try {
    const admission={scope,binding,projectId:null,online:true,terminalId:"term-a",
      capabilities:["terminal:resize","terminal:input"]};
    const deps={...f,resolveAdmission:async()=>admission,dispatch:async()=>{calls++;return {state:"succeeded",result:{terminalId:"term-a"}};}};
    const request={operationId:"resize-a",projectId:null,binding,action:"terminal.resize",
      args:{terminalId:"term-a",columns:80,rows:24}};
    assert.equal((await new ExecutionOperations(deps).execute(scope,request)).state,"succeeded");
    assert.equal((await new ExecutionOperations(deps).execute(scope,request)).result.terminalId,"term-a");
    assert.equal(calls,1);
    await assert.rejects(()=>new ExecutionOperations(deps).execute(scope,{...request,
      operationId:"input-b",action:"terminal.input",args:{terminalId:"term-b",data:"pwd"}}),
      e=>e.code==="TERMINAL_SCOPE_MISMATCH");
  } finally {f.db.close();}
});
test("worktree archive requires verified recoverability and original operation identity", () => {
  const record={id:"w-a",state:"active",operationId:"op-a",revision:2};
  const evidence={operationId:"op-a",owned:true,inactive:true,recoveryVerified:true,recoveryRef:"snapshot-a",
    hasSubmodules:false,hasEmbeddedRepositories:false,protectedIgnoredFiles:true};
  assert.throws(()=>transitionWorktree(record,"archive_intent",{...evidence,inactive:false}),e=>e.code==="RECOVERY_REQUIRED");
  const prepared=transitionWorktree(record,"archive_intent",evidence);
  assert.throws(()=>transitionWorktree(prepared,"archived",{operationId:"op-a"}),e=>e.code==="OUTCOME_UNKNOWN");
  assert.equal(transitionWorktree(prepared,"archived",{operationId:"op-a",ownerConfirmed:true}).state,"archived");
  assert.throws(()=>transitionWorktree({...record,state:"unknown"},"active",evidence),e=>e.code==="WORKTREE_CONFLICT");
});
test("terminal replay has bounded UTF-8 output, explicit gaps and validates dimensions", () => {
  const chunks=[{sequence:4,data:"éé"},{sequence:5,data:"tail"}];
  const window=readTerminalWindow(chunks,1,4);
  assert.equal(window.gap,true); assert.equal(window.truncated,true);
  assert.equal(window.nextSequence,4); assert.deepEqual(window.chunks,[chunks[0]]);
  assert.throws(()=>terminalDimensions(0,24),e=>e.status===422);
});
test("migration copy preserves legacy IDs, encrypted bytes, permissions and FK rows without guessing scope", () => {
  const f=fixture();
  try {
    f.db.exec(`CREATE TABLE protected_settings(project_id TEXT REFERENCES projects(id),key TEXT,ciphertext BLOB);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),owner TEXT,body TEXT);
      CREATE TABLE logical_references(project_id TEXT,owner TEXT);
      INSERT INTO projects VALUES('global-id','global-default',1,NULL),('repo-id','same-name',0,NULL),
        ('unknown-id','same-name',0,'2026-01-01');
      INSERT INTO protected_settings VALUES('global-id','chat_defaults',x'0001ff80');
      INSERT INTO sessions VALUES('session-a','global-id','alice','private fixture body');
      INSERT INTO logical_references VALUES('global-id','alice');`);
    const tables=["projects","protected_settings","sessions","logical_references"];
    const before=legacyDigest(f.db,tables);
    const decisions=[
      {legacyId:"global-id",classification:"installation",evidenceRef:"global-flag"},
      {legacyId:"repo-id",classification:"workspace",scope,permissionsVerified:true,evidenceRef:"membership-copy"},
      {legacyId:"unknown-id",classification:"imported_unassigned",evidenceRef:"no-provenance"},
    ];
    const approvedInventoryHash=migrationInventoryHash(f.db);
    const migrate=()=>importLegacyCatalog({...f,instanceId:scope.instanceId,decisions,approvedInventoryHash});
    assert.equal(migrate().projects,3); migrate();
    assert.deepEqual(legacyDigest(f.db,tables),before);
    assert.equal(f.db.prepare("SELECT count(*) n FROM veyra_project_aliases").get().n,3);
    assert.equal(f.catalog.list(scope).data[0].id,"repo-id");
    const imported=f.catalog.get(scope,"repo-id");
    assert.equal(imported.roots.length,0);
    const bound=f.catalog.bindImportedRoots(scope,"repo-id",imported.revision,[root]);
    assert.equal(bound.roots[0].canonicalRootId,root.canonicalRootId);
    assert.throws(()=>f.catalog.bindImportedRoots(scope,"repo-id",bound.revision,[root]),
      e=>e.code==="ROOT_BINDING_CONFLICT");
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
    const inventory=inventoryLegacyReferences(f.db);
    assert.equal(inventory.find(r=>r.table==="logical_references").declaredForeignKey,false);
    decisions[0].evidenceRef="changed";
    assert.throws(migrate,e=>e.code==="MIGRATION_ALIAS_CONFLICT");
    assert.deepEqual(legacyDigest(f.db,tables),before);
  } finally {f.db.close();}
});
test("migration failure rolls back every catalog/alias row", () => {
  const f=fixture();
  try {
    f.db.exec("INSERT INTO projects VALUES('a','repo',0,NULL),('b','global-default',1,NULL)");
    assert.throws(()=>importLegacyCatalog({...f,instanceId:scope.instanceId,approvedInventoryHash:migrationInventoryHash(f.db),decisions:[
      {legacyId:"a",classification:"workspace",scope,permissionsVerified:true,evidenceRef:"a"},
      {legacyId:"b",classification:"workspace",scope,permissionsVerified:true,evidenceRef:"bad"}
    ]}),e=>e.code==="MIGRATION_CLASSIFICATION_CONFLICT");
    assert.equal(f.db.prepare("SELECT count(*) n FROM veyra_workspace_projects").get().n,0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM veyra_project_aliases").get().n,0);
  } finally {f.db.close();}
});

test("migration inventory rejects unreviewed source changes before any alias mutation",()=>{
  const f=fixture();
  try {
    f.db.exec("INSERT INTO projects VALUES('global-id','global-default',1,NULL)");
    const approvedInventoryHash=migrationInventoryHash(f.db);
    f.db.exec("CREATE TABLE unknown_scope(resource_id TEXT,project_id TEXT)");
    assert.throws(()=>importLegacyCatalog({...f,instanceId:scope.instanceId,approvedInventoryHash,
      decisions:[{legacyId:"global-id",classification:"installation",evidenceRef:"global"}]}),
      e=>e.code==="MIGRATION_INVENTORY_CHANGED");
    assert.equal(f.db.prepare("SELECT count(*) n FROM veyra_project_aliases").get().n,0);
  } finally {f.db.close();}
});

test("concurrent execution receipts retain pending original instead of dispatching twice",async()=>{
  const f=fixture();let resolveDispatch;let calls=0;
  try {
    const blocked=new Promise(resolve=>{resolveDispatch=resolve;});
    const admission={scope,binding,projectId:null,online:true,capabilities:["terminal:open"]};
    const service=new ExecutionOperations({...f,resolveAdmission:async()=>admission,
      dispatch:async()=>{calls++;return blocked;}});
    const request={operationId:"concurrent",projectId:null,binding,action:"terminal.open"};
    const first=service.execute(scope,request);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await service.execute(scope,request)).state,"pending");
    assert.equal(calls,1);
    resolveDispatch({state:"succeeded",result:{terminalId:"original"}});
    assert.equal((await first).result.terminalId,"original");
    await assert.rejects(()=>service.execute(scope,{...request,operationId:"injected",args:{command:"whoami"}}),
      e=>e.code==="VALIDATION_ERROR");
    await assert.rejects(()=>service.execute(scope,{...request,operationId:"injected-binding",
      binding:{...binding,upstreamUrl:"https://elsewhere.invalid"}}),e=>e.code==="VALIDATION_ERROR");
  } finally {resolveDispatch?.({state:"unknown",result:null});f.db.close();}
});

test("archived historical global identity remains unassigned instead of becoming another installation owner",()=>{
  const f=fixture();
  try {
    f.db.exec("INSERT INTO projects VALUES('active-global','global-default',1,NULL),('historical','previous-global',1,'2026-01-01')");
    importLegacyCatalog({...f,instanceId:scope.instanceId,approvedInventoryHash:migrationInventoryHash(f.db),decisions:[
      {legacyId:"active-global",classification:"installation",evidenceRef:"active-global-flag"},
      {legacyId:"historical",classification:"imported_unassigned",evidenceRef:"historical-global-lineage"}]});
    assert.equal(f.db.prepare("SELECT legacy_project_id FROM veyra_installation_legacy_refs").get().legacy_project_id,"active-global");
    assert.equal(f.db.prepare("SELECT classification FROM veyra_project_aliases WHERE source_id='historical'").get().classification,"imported_unassigned");
    assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,2);
  } finally {f.db.close();}
});

test("legacy digest preserves storage distinctions, full NUL text and 64-bit integers",()=>{
  const f=fixture();
  try {
    f.db.exec("CREATE TABLE raw_evidence(value); INSERT INTO raw_evidence VALUES(9223372036854775807),(x'0001ff'),(NULL),(1.0000000000000002)");
    f.db.prepare("INSERT INTO raw_evidence VALUES(?)").run("prefix"+String.fromCharCode(0)+"suffix-a");
    const first=legacyDigest(f.db,["raw_evidence"]);
    f.db.prepare("UPDATE raw_evidence SET value=? WHERE typeof(value)='text'").run("prefix"+String.fromCharCode(0)+"suffix-b");
    assert.notEqual(legacyDigest(f.db,["raw_evidence"])[0].sha256,first[0].sha256);
    const second=legacyDigest(f.db,["raw_evidence"]);
    f.db.exec("UPDATE raw_evidence SET value=1.0000000000000004 WHERE typeof(value)='real'");
    assert.notEqual(legacyDigest(f.db,["raw_evidence"])[0].sha256,second[0].sha256);
    assert.equal(first[0].rows,5);
  } finally {f.db.close();}
});

test("unknown original reconciles through a read-only owner receipt without replaying effects",async()=>{
  const f=fixture();let effects=0;let reads=0;
  try {
    const admission={scope,binding,projectId:null,online:true,capabilities:["terminal:open"]};
    const service=new ExecutionOperations({...f,resolveAdmission:async()=>admission,
      dispatch:async()=>{effects++;throw Error("lost ack");},
      readOperation:async request=>{reads++;assert.equal(request.operationId,"original");
        return {state:"succeeded",result:{terminalId:"retained-original"}};}});
    const request={operationId:"original",projectId:null,binding,action:"terminal.open"};
    assert.equal((await service.execute(scope,request)).state,"unknown");
    assert.equal((await service.reconcile(scope,request)).result.terminalId,"retained-original");
    assert.equal((await service.execute(scope,request)).state,"succeeded");
    assert.equal(effects,1);assert.equal(reads,1);
    await assert.rejects(()=>service.reconcile(scope,{...request,operationId:"missing"}),e=>e.code==="NOT_FOUND");
  } finally {f.db.close();}
});

test("execution snapshots scope and request before asynchronous admission",async()=>{
  const f=fixture();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const originalScope=structuredClone(scope);
  const callerScope=structuredClone(scope);
  const originalBinding=structuredClone(binding);
  let dispatched;
  try {
    const service=new ExecutionOperations({...f,
      resolveAdmission:async()=>{await gate;return {scope:originalScope,binding:originalBinding,
        projectId:null,online:true,capabilities:["terminal:input"],terminalId:"term"};},
      dispatch:async request=>{dispatched=request;return {state:"succeeded",result:{terminalId:"term"}};}});
    const request={operationId:"snapshot",projectId:null,binding:structuredClone(binding),
      action:"terminal.input",args:{terminalId:"term",data:"original"}};
    const running=service.execute(callerScope,request);
    callerScope.ownerUserId="someone-else";
    request.binding.directory="C:/another-directory";
    request.args.data="changed-after-admission";
    release();
    assert.equal((await running).state,"succeeded");
    assert.equal(dispatched.scope.ownerUserId,originalScope.ownerUserId);
    assert.equal(dispatched.args.data,"original");
    assert.equal(dispatched.binding.directory,originalBinding.directory);
  } finally {release?.();f.db.close();}
});
