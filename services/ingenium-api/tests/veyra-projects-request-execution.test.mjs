import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequestExecutionResolvers} from "../lib/projects-v2/request-execution-owner.mjs";

const ids={org:"11111111-1111-4111-8111-111111111111",user:"22222222-2222-4222-8222-222222222222",
 project:"33333333-3333-4333-8333-333333333333",runtime:"44444444-4444-4444-8444-444444444444",
 chat:"55555555-5555-4555-8555-555555555555"};
function fixture() {
 const db=new DatabaseSync(":memory:");
 db.function("sha256",{deterministic:true},v=>createHash("sha256").update(String(v)).digest("hex"));
 const dir=new URL("../../../packages/ingenium-core/data/migrations/",import.meta.url);
 const alternate=new Set(["094_authentication_auth101_upgrade.sql","095_authorization_auth101_upgrade.sql",
 "095_authorization_auth103_upgrade.sql","104_security_audit_project_history_collision_upgrade.sql"]);
 for(const file of readdirSync(dir).filter(f=>f.endsWith(".sql") && Number(f.slice(0,3))<=121 && !alternate.has(f)).sort())
  db.exec(readFileSync(new URL(file,dir),"utf8"));
 db.exec("PRAGMA foreign_keys=ON");
 const time="2026-10-29T12:00:00.000Z", now=Date.parse(time),future=new Date(now+600000).toISOString();
 db.prepare("INSERT INTO users(id,email_normalized,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(ids.user,"request@example.test","Request",time,time);
 db.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)").run(ids.org,"Request","request",time,time);
 db.prepare("INSERT INTO organization_memberships(organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'owner','active',?,?)").run(ids.org,ids.user,time,time);
 db.prepare("INSERT INTO projects(id,name,path,is_global,organization_id,created_at,updated_at) VALUES(?,?,?,0,?,?,?)").run(ids.project,"request","/request",ids.org,time,time);
 const mapping=createHash("sha256").update("request-workspace\0/srv/request").digest("hex");
 db.prepare("INSERT INTO authorized_workspaces(id,organization_id,project_id,owner_user_id,storage_path,storage_mapping_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .run("request-workspace",ids.org,ids.project,ids.user,"/srv/request",mapping,time,time);
 db.prepare(`INSERT INTO runtime_instances(id,workspace_id,organization_id,project_id,owner_user_id,state,revision,
  cpu_millis,memory_bytes,pids_limit,disk_bytes,process_limit,backend_name,backend_container_id,security_epoch,
  idle_expires_at,absolute_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'READY',3,1000,1073741824,256,1073741824,128,?,?,0,?,?,?,?)`)
  .run(ids.runtime,"request-workspace",ids.org,ids.project,ids.user,"ingenium-runtime-request","a".repeat(64),future,future,time,time);
 const metadata=JSON.stringify({source:"opencode-chat",sourceRuntimeId:ids.runtime,sourceSessionId:"session-exact"});
 db.prepare(`INSERT INTO context_conversations(id,project_id,organization_id,owner_user_id,visibility,title,request_hash,tags,priority,metadata,created_at)
  VALUES(?,?,?,?,'private','Existing chat',?,'[]',0,?,?)`).run(ids.chat,ids.project,ids.org,ids.user,"b".repeat(64),metadata,time);
 const state={identity:{principal:{type:"user",id:ids.user,scopes:["user:*"],session:{id:"auth-original"}}},
  placement:null,placementMissing:false,projectAllowed:true,chatAllowed:true,active:true,mode:"control-plane",ticks:now};
 const ports={
 revalidateIdentity:()=>state.identity,
 deploymentMode:()=>state.mode,now:()=>state.ticks,
 getWorkspace:id=>{
  const w=db.prepare("SELECT * FROM authorized_workspaces WHERE id=?").get(id);
  return w && {id:w.id,organizationId:w.organization_id,projectId:w.project_id,ownerUserId:w.owner_user_id,
   storagePath:w.storage_path,storageMappingHash:w.storage_mapping_hash,status:w.status,securityEpoch:w.security_epoch};
 },
 getRuntime:id=>{
  const r=db.prepare("SELECT * FROM runtime_instances WHERE id=?").get(id);
  return r && {id:r.id,workspaceId:r.workspace_id,organizationId:r.organization_id,projectId:r.project_id,
   ownerUserId:r.owner_user_id,state:r.state,revision:r.revision,securityEpoch:r.security_epoch,
   backendName:r.backend_name,backendContainerId:r.backend_container_id,idleExpiresAt:r.idle_expires_at,
   absoluteExpiresAt:r.absolute_expires_at,leaseExpiresAt:r.lease_expires_at};
 },
 resolveOwnership:()=>({organizationId:ids.org,ownerUserId:ids.user,projectId:ids.project,workspaceId:"request-workspace"}),
 authorizeProject:()=>state.projectAllowed,
 resolvePlacement:facts=>state.placementMissing?null:({...facts,hostId:"registered-stable-host",environmentId:"registered-linux-environment",
   observedAt:now,expiresAt:now+30000,...state.placement}),
 getConversation:(project,id)=>db.prepare("SELECT * FROM context_conversations WHERE project_id=? AND id=?").get(project,id),
 authorizeConversation:()=>state.chatAllowed,conversationIsActive:()=>state.active,
 };
 const selected={projectId:ids.project,workspaceId:"request-workspace",runtimeId:ids.runtime};
 return {db,state,ports,selected,owner:createRequestExecutionResolvers(ports),close:()=>db.close()};
}
function digest(db) {
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
 return createHash("sha256").update(JSON.stringify(tables.map(({name})=>[
  name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all(),
 ]))).digest("hex");
}
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);
test("request execution resolves persisted exact ownership and private Context session without writes",()=>{
 const f=fixture();try{
  const before=digest(f.db);
  const execution=f.owner.resolveRequestExecution({},f.selected);
  assert.equal(execution.bindingEpoch,0);assert.equal(execution.hostId,"registered-stable-host");
  assert.equal(Object.isFrozen(execution),true);
  const chat=f.owner.resolveRequestChatBinding({},execution,ids.chat);
  assert.equal(chat.engineSessionId,"session-exact");assert.equal(chat.visibility,"private");
  assert.equal(digest(f.db),before);
  // A fresh resolver reconnects through existing rows, without an authority cache.
  assert.deepEqual(createRequestExecutionResolvers(f.ports).resolveRequestChatBinding({},execution,ids.chat),chat);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
 }finally{f.close();}
});
test("execution rejects client-supplied authority axes and projectless/global substitution",()=>{
 const f=fixture();try{
  fails(()=>f.owner.resolveRequestExecution({},{...f.selected,hostId:"forged"}),"INVALID_EXECUTION_SELECTION");
  fails(()=>f.owner.resolveRequestExecution({},{...f.selected,projectId:null}),"PROJECTLESS_EXECUTION_OWNER_UNAVAILABLE");
  f.state.mode="compatibility";
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"COMPATIBILITY_EXECUTION_OWNER_UNAVAILABLE");
 }finally{f.close();}
});
test("identity revocation, other owner and project permission denial fail closed",()=>{
 const f=fixture();try{
  f.state.identity=null;fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_IDENTITY_UNAVAILABLE");
  f.state.identity={principal:{type:"compatibility"}};fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_IDENTITY_UNAVAILABLE");
  f.state.identity={principal:{type:"user",id:"other",scopes:["user:*"]}};
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_SCOPE_UNAVAILABLE");
  f.state.identity={principal:{type:"user",id:ids.user,scopes:["user:*"]}};
  f.state.projectAllowed=false;fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_SCOPE_UNAVAILABLE");
  f.state.projectAllowed=Promise.resolve(true);fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_SCOPE_UNAVAILABLE");
 }finally{f.close();}
});
test("persisted runtime stop, workspace revocation and epoch changes invalidate retained selections",()=>{
 const f=fixture();try{
  const old=f.owner.resolveRequestExecution({},f.selected);
  f.db.prepare("UPDATE runtime_instances SET state='STOPPED', revision=revision+1 WHERE id=?").run(ids.runtime);
  fails(()=>f.owner.resolveRequestChatBinding({},old,ids.chat),"EXECUTION_RUNTIME_UNAVAILABLE");
  f.db.prepare("UPDATE runtime_instances SET state='READY', revision=revision+1 WHERE id=?").run(ids.runtime);
  f.db.prepare("UPDATE authorized_workspaces SET security_epoch=security_epoch+1 WHERE id=?").run(f.selected.workspaceId);
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_RUNTIME_UNAVAILABLE");
  f.db.prepare("UPDATE authorized_workspaces SET status='revoked' WHERE id=?").run(f.selected.workspaceId);
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_SCOPE_UNAVAILABLE");
 }finally{f.close();}
});
test("READY labels do not replace real container facts or current lifetime",()=>{
 const f=fixture();try{
  f.db.prepare("UPDATE runtime_instances SET absolute_expires_at=?, revision=revision+1 WHERE id=?").run(new Date(f.state.ticks).toISOString(),ids.runtime);
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_RUNTIME_UNAVAILABLE");
  f.db.prepare("UPDATE runtime_instances SET absolute_expires_at=?, backend_container_id=NULL, revision=revision+1 WHERE id=?")
   .run(new Date(f.state.ticks+600000).toISOString(),ids.runtime);
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_RUNTIME_UNAVAILABLE");
 }finally{f.close();}
});
test("placement requires a fresh exact backend, revision, epoch and full owner scope",()=>{
 const f=fixture();try{
  f.state.placementMissing=true;fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_PLACEMENT_UNAVAILABLE");f.state.placementMissing=false;
  for(const [key,value] of Object.entries({runtimeId:"other",workspaceId:"other",organizationId:"other",ownerUserId:"other",
   projectId:"other",bindingHash:"c".repeat(64),bindingEpoch:1,runtimeRevision:4,backendName:"other",
   backendContainerId:"d".repeat(64),hostId:"",environmentId:"",observedAt:f.state.ticks+1,
   expiresAt:f.state.ticks,})) {
   f.state.placement={[key]:value};fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_PLACEMENT_UNAVAILABLE");
  }
  f.state.placement={observedAt:f.state.ticks-30001,expiresAt:f.state.ticks+1};
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_PLACEMENT_UNAVAILABLE");
 }finally{f.close();}
});
test("retained execution facts cannot authorize a forged or moved private chat",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  fails(()=>f.owner.resolveRequestChatBinding({},{...execution,hostId:"forged"},ids.chat),"EXECUTION_BINDING_CHANGED");
  f.state.chatAllowed=false;fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");f.state.chatAllowed=true;
  for(const metadata of ["invalid",JSON.stringify({source:"opencode-chat",sourceRuntimeId:"other",sourceSessionId:"session-exact"}),
   JSON.stringify({source:"opencode-chat",sourceRuntimeId:ids.runtime,sourceSessionId:""})]) {
   const original=f.db.prepare("SELECT * FROM context_conversations WHERE id=?").get(ids.chat);
   f.ports.getConversation=()=>({...original,metadata});
   fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");
  }
 }finally{f.close();}
});
test("private owner, visibility and archive state remain required independently of project permission",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  f.state.active=false;fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");
  f.state.active=Promise.resolve(true);fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");f.state.active=true;
  const original=f.ports.getConversation(ids.project,ids.chat);
  assert.throws(()=>f.db.prepare("UPDATE context_conversations SET visibility='project' WHERE id=?").run(ids.chat),/immutable/);
  f.ports.getConversation=()=>({...original,visibility:"project"});
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");
 }finally{f.close();}
});
test("attested service scope must exactly match the existing workspace and credential",()=>{
 const f=fixture();try{
  const w=f.ports.getWorkspace(f.selected.workspaceId);
  f.state.identity={principal:{type:"service",id:"service",scopes:["projects:read"],tokenId:"credential",audience:"runtime",
   organizationId:ids.org,projectId:ids.project,projectIds:[ids.project],workspaceId:w.id,storageMappingHash:w.storageMappingHash},
   attestation:{credentialId:"credential",workspaceId:w.id,storageMappingHash:w.storageMappingHash}};
  assert.equal(f.owner.resolveRequestExecution({},f.selected).ownerUserId,ids.user);
  f.state.identity.attestation.credentialId="forged";
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_SCOPE_UNAVAILABLE");
 }finally{f.close();}
});
test("identity and runtime are rechecked after placement and chat callbacks",()=>{
 const f=fixture();try{
  const placement=f.ports.resolvePlacement;
  f.ports.resolvePlacement=facts=>{const result=placement(facts);f.state.identity=null;return result;};
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_IDENTITY_UNAVAILABLE");
 }finally{f.close();}
 const g=fixture();try{
  const execution=g.owner.resolveRequestExecution({},g.selected);
  g.ports.authorizeConversation=()=>{g.db.prepare("UPDATE runtime_instances SET state='STOPPED', revision=revision+1 WHERE id=?").run(ids.runtime);return true;};
  fails(()=>g.owner.resolveRequestChatBinding({},execution,ids.chat),"EXECUTION_RUNTIME_UNAVAILABLE");
 }finally{g.close();}
});


test("placement callback cannot mutate persisted readiness behind returned fresh evidence",()=>{
 const f=fixture();try{
  const placement=f.ports.resolvePlacement;
  f.ports.resolvePlacement=facts=>{
   const result=placement(facts);
   f.db.prepare("UPDATE runtime_instances SET state='STOPPED',revision=revision+1 WHERE id=?").run(ids.runtime);
   return result;
  };
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_BINDING_CHANGED");
 }finally{f.close();}
});
test("Promise placement, identity epoch changes and expired lifecycle leases do not grant readiness",()=>{
 const f=fixture();try{
  const placement=f.ports.resolvePlacement;
  f.ports.resolvePlacement=facts=>Promise.resolve(placement(facts));
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_PLACEMENT_UNAVAILABLE");
  f.ports.resolvePlacement=facts=>{
   const result=placement(facts);f.state.identity.principal.session.security_epoch=1;return result;
  };
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_IDENTITY_CHANGED");
  f.ports.resolvePlacement=placement;
  f.db.prepare("UPDATE runtime_instances SET lease_owner_hash=?,lease_expires_at=?,revision=revision+1 WHERE id=?")
   .run("e".repeat(64),new Date(f.state.ticks-1).toISOString(),ids.runtime);
  fails(()=>f.owner.resolveRequestExecution({},f.selected),"EXECUTION_RUNTIME_UNAVAILABLE");
 }finally{f.close();}
});
