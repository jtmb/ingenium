import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const root=new URL("../../../docs/workstreams/projects/wsl-git-custody/",import.meta.url);
const base=new URL("../../../docs/workstreams/projects/native-local-v6/",import.meta.url);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
 const db=new DatabaseSync(":memory:");db.exec(readFileSync(new URL("sources/crates/adapters/src/projects/0006.sql",base),"utf8"));
 db.prepare("INSERT INTO local_installation VALUES(1,'installation','linux_euid','fixture-uid','fixture-root',?,0,?)").run("a".repeat(64),"b".repeat(64));
 for(const id of ["owned","foreign"])db.prepare("INSERT INTO local_workspaces(id,installation_id,custodian_key,environment,creation_sha256,state,root_identity,root_path) VALUES(?,'installation',?,'{}',?,'active','fixture-file','fixture-path')").run(id,"a".repeat(64),"c".repeat(64));
 const patch=readFileSync(new URL("integration.patch",root),"utf8");
 const query=patch.match(/query_row\(r#"(SELECT EXISTS\(SELECT 1 FROM local_workspace_operations[^\n]+)"#,params!/)[1];
 function insert(id,kind,state="unknown",workspace="owned"){
  db.prepare("INSERT INTO local_workspace_operations VALUES(?,?,?, ?,?,?,NULL)").run(id,workspace,"{}","d".repeat(64),kind,state);
 }
 return {db,insert,pending:(workspace="owned",request="new")=>Boolean(db.prepare(query).get(workspace,request)[Object.keys(db.prepare(query).get(workspace,request))[0]])};
}
test("WSL Git restart admission retains canonical and legacy unknown original kinds without changing them",()=>{
 for(const kind of ["git_status","git_diff","git_branch","worktree_create",'{"kind":"git_status"}','{"kind":"git_branch"','{"kind":"worktree_create"']){
  const f=fixture();try{f.insert("original",kind);assert.equal(f.pending(),true);assert.equal(f.db.prepare("SELECT kind FROM local_workspace_operations").get().kind,kind);}finally{f.db.close();}
 }
});
test("Git original admission is scoped, excludes only its exact original and never treats other unknown work as absent",()=>{
 const f=fixture();try{
  f.insert("foreign-original","git_status","unknown","foreign");f.insert("done","git_status","committed");assert.equal(f.pending(),false);
  f.insert("original","git_diff","intent");assert.equal(f.pending("owned","original"),false);assert.equal(f.pending(),true);
  f.insert("another","worktree_create","unknown");assert.equal(f.pending("owned","original"),true);
  assert.throws(()=>f.db.exec("DELETE FROM local_workspace_operations WHERE id='another'"),/survive/);
  assert.throws(()=>f.db.exec("UPDATE local_workspace_operations SET state='denied' WHERE id='another'"),/immutable/);
 }finally{f.db.close();}
});
test("WSL owner proposal has exact frozen source preimages and canonical source hashes, with no runtime qualification claim",()=>{
 const manifest=JSON.parse(readFileSync(new URL("proposal.json",root),"utf8"));
 assert.equal(manifest.parentWorkerCommit,"8b18318e248c7e1cba953c1e68b47529aac1a276");
 assert.equal(manifest.nativeWritten,false);assert.equal(manifest.compiled,false);assert.equal(manifest.actualWindowsWSLTransportQualified,false);
 assert.equal(manifest.nativeSchemaChanged,false);assert.equal(manifest.nodeMigrationsChanged,false);
 assert.equal(sha(readFileSync(new URL("integration.patch",root))),manifest.patchSha256);
 for(const item of manifest.existingInputs)assert.equal(sha(readFileSync(new URL("sources/"+item.path,base))),item.baseSha256,item.path);
 for(const item of manifest.canonicalNewSources)assert.equal(sha(readFileSync(new URL("sources/"+item.path,root))),item.sha256,item.path);
});

test("unknown Git outcome stays unknown while only positive original Linux plus transport closure permits distinct later work",()=>{
 const f=fixture();try{
  f.insert("original","git_branch");assert.equal(f.pending(),true);
  f.db.prepare("UPDATE local_workspace_operations SET result_json=? WHERE id='original'").run(JSON.stringify({tree_empty:true,pipe_eof:true,original_transport_closed:false,outcome_unknown:true}));assert.equal(f.pending(),true);
  f.db.prepare("UPDATE local_workspace_operations SET result_json=? WHERE id='original'").run(JSON.stringify({tree_empty:true,pipe_eof:true,original_transport_closed:true,outcome_unknown:true}));assert.equal(f.pending(),false);
  assert.equal(f.db.prepare("SELECT state FROM local_workspace_operations WHERE id='original'").get().state,"unknown");
  f.insert("still-intent","git_status","intent");f.db.prepare("UPDATE local_workspace_operations SET result_json=? WHERE id='still-intent'").run(JSON.stringify({tree_empty:true,pipe_eof:true,original_transport_closed:true}));assert.equal(f.pending(),true);
 }finally{f.db.close();}
});
