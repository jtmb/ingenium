import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {readConfiguredNativeBaseline} from "./veyra-projects-native-source.mjs";
import {legacyDigest} from "../lib/projects-v2/migration.mjs";
const proposal=new URL("../../../docs/workstreams/projects/native-local-v6/",import.meta.url);
const sql=readFileSync(new URL("sources/crates/adapters/src/projects/0006.sql",proposal),"utf8");
const sha=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const installation="11111111-1111-4111-8111-111111111111",workspace="22222222-2222-4222-8222-222222222222",operation="33333333-3333-4333-8333-333333333333";
const observed={scheme:"windows_sid",subject:"S-1-5-21-123-456-789-1001",physical:"volume-actual:file-actual",installation};
const key=actor=>sha([actor.scheme,actor.subject,actor.physical]);
function fixture(){
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");
 for(const migration of readConfiguredNativeBaseline().migrations)db.exec(migration.sql);
 const draft={name:"Preserved Ω",environment:{kind:"windows"},primary_root:"C:/original root",roots:["C:/original root","C:/second"]};
 db.prepare("INSERT INTO projects(id,name,environment,primary_root,roots,creation_request) VALUES(?,?,?,?,?,?)")
  .run("77777777-7777-4777-8777-777777777777",draft.name,JSON.stringify(draft.environment),draft.primary_root,JSON.stringify(draft.roots),JSON.stringify(draft));
 db.exec("CREATE TABLE prior_unique_evidence(id INTEGER PRIMARY KEY,value BLOB,special TEXT)");
 db.prepare("INSERT INTO prior_unique_evidence VALUES(1,?,?)").run(Buffer.from([0,255,13,10,128]),"Ω\u0000 preserve");
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const before=legacyDigest(db,tables);
 function migrate(actor=observed,recheck=()=>actor){
  db.exec("BEGIN IMMEDIATE");
  try{
   const version=db.prepare("PRAGMA user_version").get().user_version;
   if(version===5){
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'local_%'").get().n,0);
    db.exec(sql);
    db.prepare("INSERT INTO local_installation VALUES(1,?,?,?,?,?,0,?)")
     .run(actor.installation,actor.scheme,actor.subject,actor.physical,key(actor),sha(before));
    db.prepare("INSERT INTO local_migration_receipts VALUES(6,?,?,?)").run(actor.installation,key(actor),sha(before));
   }else assert.equal(version,6);
   const row=db.prepare("SELECT * FROM local_installation WHERE singleton=1").get();
   assert.equal(row.installation_id,actor.installation);assert.equal(row.custodian_scheme,actor.scheme);
   assert.equal(row.custodian_subject,actor.subject);assert.equal(row.state_identity,actor.physical);
   assert.equal(row.custodian_key,key(actor));assert.deepEqual(recheck(),actor);
   assert.deepEqual(legacyDigest(db,tables),before);
   db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
 }
 function reserve(id=workspace,environment={kind:"windows"},digest=sha([id,environment])){
  const prior=db.prepare("SELECT environment,creation_sha256 FROM local_workspaces WHERE id=?").get(id);
  if(prior){assert.equal(prior.environment,JSON.stringify(environment));assert.equal(prior.creation_sha256,digest);return false;}
  db.prepare("INSERT INTO local_workspaces(id,installation_id,custodian_key,environment,creation_sha256,state) VALUES(?,?,?,?,?,'reserved')")
   .run(id,installation,key(observed),JSON.stringify(environment),digest);return true;
 }
 function active(){
  reserve();
  db.prepare("UPDATE local_workspaces SET state='active',root_identity='actual-child-file',root_path='C:/state/private-child' WHERE id=?").run(workspace);
 }
 const owner={installation_id:installation,custodian_key:key(observed),workspace_id:workspace,revision:0,service_instance_id:"actual-service-original",environment:{kind:"windows"}};
 function op(original={request_id:operation,owner,operation:{kind:"terminal_input",terminal_id:"actual-terminal",text:"exact\r\n"}}){
  const previous=db.prepare("SELECT * FROM local_workspace_operations WHERE id=?").get(original.request_id);
  if(previous){assert.equal(previous.request_sha256,sha(original));assert.equal(previous.owner_json,JSON.stringify(original.owner));return false;}
  db.prepare("INSERT INTO local_workspace_operations VALUES(?,?,?,?,?,'intent',NULL)")
   .run(original.request_id,workspace,JSON.stringify(original.owner),sha(original),original.operation.kind);return true;
 }
 return {db,before,tables,migrate,reserve,active,op,owner,close:()=>db.close()};
}
test("native v6 SQL adds real local custodian metadata without rewriting any legacy field or Project",()=>{
 const f=fixture();try{
  f.migrate();f.active();assert.deepEqual(legacyDigest(f.db,f.tables),f.before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM projects").get().n,1);
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version,6);
  assert.equal(f.db.prepare("SELECT count(*) n FROM local_migration_receipts").get().n,1);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
 }finally{f.close();}
});
test("same actual custodian restart is idempotent and never creates a second identity/receipt",()=>{
 const f=fixture();try{f.migrate();const before=f.db.prepare("SELECT * FROM local_installation").all();f.migrate();
  assert.deepEqual(f.db.prepare("SELECT * FROM local_installation").all(),before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM local_migration_receipts").get().n,1);
 }finally{f.close();}
});
test("different OS subject, physical state root, library or OS scheme cannot reassign an installation",()=>{
 const f=fixture();try{
  f.migrate();const before=f.db.prepare("SELECT * FROM local_installation").all();
  for(const patch of [{subject:"S-1-5-21-other"},{physical:"different-volume:file"},{installation:"different-library"},{scheme:"linux_euid",subject:"machine:1000"}])
   assert.throws(()=>f.migrate({...observed,...patch}));
  assert.deepEqual(f.db.prepare("SELECT * FROM local_installation").all(),before);
  assert.deepEqual(legacyDigest(f.db,f.tables),f.before);
 }finally{f.close();}
});
test("custody change at final migration check rolls back the complete v6 schema and receipt atomically",()=>{
 const f=fixture();try{
  assert.throws(()=>f.migrate(observed,()=>({...observed,physical:"changed-during-migration"})));
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version,5);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'local_%'").get().n,0);
  assert.deepEqual(legacyDigest(f.db,f.tables),f.before);f.migrate();
 }finally{f.close();}
});
test("partial unowned local schema is refused instead of adopted",()=>{
 const f=fixture();try{
  f.db.exec("CREATE TABLE local_unowned(original BLOB)");
  assert.throws(()=>f.migrate());
  assert.equal(f.db.prepare("PRAGMA user_version").get().user_version,5);
  assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE name='local_unowned'").get());
 }finally{f.close();}
});
test("reserved or unknown private creation cannot allocate again or adopt an existing name",()=>{
 const f=fixture();try{
  f.migrate();let allocations=0;if(f.reserve())allocations++;
  assert.equal(f.reserve(),false);
  f.db.prepare("UPDATE local_workspaces SET state='unknown' WHERE id=?").run(workspace);
  if(f.reserve())allocations++;
  assert.equal(allocations,1);
  assert.throws(()=>f.db.prepare("UPDATE local_workspaces SET state='active',root_identity='new',root_path='new' WHERE id=?").run(workspace),/immutable/);
  assert.throws(()=>f.reserve(workspace,{kind:"wsl",distro:"Ubuntu",user:"explicit"}));
 }finally{f.close();}
});
test("persisted effect fence leaves lost acknowledgement unknown and cannot resend terminal input",()=>{
 const f=fixture();try{
  f.migrate();f.active();let effects=0;
  assert.equal(f.op(),true);
  assert.equal(f.db.prepare("UPDATE local_workspace_operations SET state='unknown' WHERE id=? AND state='intent'").run(operation).changes,1);
  effects++;assert.equal(f.op(),false);assert.equal(effects,1);
  assert.equal(f.db.prepare("SELECT state FROM local_workspace_operations WHERE id=?").get(operation).state,"unknown");
  assert.throws(()=>f.op({request_id:operation,owner:f.owner,operation:{kind:"terminal_input",terminal_id:"actual-terminal",text:"changed"}}));
  assert.throws(()=>f.op({request_id:operation,owner:{...f.owner,service_instance_id:"different-service"},operation:{kind:"terminal_input",terminal_id:"actual-terminal",text:"exact\r\n"}}));
 }finally{f.close();}
});
test("completed originals, root evidence, installation and migration receipts remain immutable",()=>{
 const f=fixture();try{
  f.migrate();f.active();f.op();
  f.db.prepare("UPDATE local_workspace_operations SET state='unknown' WHERE id=?").run(operation);
  f.db.prepare("UPDATE local_workspace_operations SET state='committed',result_json=? WHERE id=?").run(JSON.stringify({terminal_id:"actual-terminal"}),operation);
  for(const statement of [
   "DELETE FROM local_installation","UPDATE local_installation SET custodian_subject='forged'",
   "DELETE FROM local_migration_receipts","UPDATE local_migration_receipts SET custodian_key='forged'",
   "DELETE FROM local_workspaces","UPDATE local_workspaces SET root_identity='replaced'",
   "DELETE FROM local_workspace_operations","UPDATE local_workspace_operations SET result_json='{}'",
  ])assert.throws(()=>f.db.exec(statement),/immutable|reassignment|survive|retain/);
 }finally{f.close();}
});
test("local registry has no copied account credentials, transcript or invented org/user owner columns",()=>{
 const f=fixture();try{
  f.migrate();
  for(const table of ["local_installation","local_workspaces","local_workspace_operations"]){
   const columns=f.db.prepare("PRAGMA table_info("+table+")").all().map(r=>r.name);
   for(const forbidden of ["organization_id","owner_user_id","account_id","credential","token","prompt","text","transcript","project_id"])
    assert.equal(columns.includes(forbidden),false,table+"."+forbidden);
  }
 }finally{f.close();}
});
test("proposal uses concrete native custody/execution owners and leaves remote pairing allowlist unchanged",()=>{
 const manifest=JSON.parse(readFileSync(new URL("proposal.json",proposal),"utf8"));
 assert.equal(manifest.nativeTree,"a04ab38bd0e0c7b96f40689733cad3f2332b9a0b");
 const remote=manifest.existingInputs.find(v=>v.path==="apps/service/src/routes/remote_control/proxy.rs");
 assert.equal(remote.changed,false);
 const patch=readFileSync(new URL("integration.patch",proposal),"utf8");
 assert.equal(patch.includes("--- a/apps/service/src/routes/remote_control/proxy.rs"),false);
 assert.ok(patch.includes("LocalRequest::from_existing_admission"));assert.ok(patch.includes("state.local_workspaces.finish_until"));
 const source=path=>readFileSync(new URL("sources/"+path,proposal),"utf8");
 assert.ok(source("crates/adapters/src/local_custody/windows.rs").includes("owner_sid()"));
 assert.ok(source("crates/adapters/src/local_custody/linux.rs").includes("geteuid()"));
 assert.ok(source("crates/adapters/src/interactive_terminal/local_workspaces.rs").includes("NativeTerminal::spawn"));
 assert.ok(source("crates/adapters/src/opencode/desktop_runtime/local_workspaces.rs").includes("create_bound_session_for_agent"));
 assert.ok(source("crates/adapters/src/local_git_launch.rs").includes("OwnedProcessJob::spawn_scoped"));
 for(const file of manifest.canonicalNewSources){
  const bytes=readFileSync(new URL("sources/"+file.path,proposal));
  assert.equal(sha(bytes.toString()),file.sha256);
  if(file.path.endsWith(".rs"))for(const forbidden of ["ProjectDraft {","ProjectCreateRequest {","Project {","getGlobalProject("])
   assert.equal(bytes.toString().includes(forbidden),false,file.path+" "+forbidden);
 }
});
