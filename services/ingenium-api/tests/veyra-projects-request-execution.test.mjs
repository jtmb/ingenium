import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {findRequestChatSourceIds,isRequestChatConversationActive} from "../lib/projects-v2/request-chat-source.mjs";
import {createRequestExecutionResolvers} from "../lib/projects-v2/request-execution-owner.mjs";

const ids={org:"11111111-1111-4111-8111-111111111111",user:"22222222-2222-4222-8222-222222222222",
 project:"33333333-3333-4333-8333-333333333333",runtime:"44444444-4444-4444-8444-444444444444",
 chat:"55555555-5555-4555-8555-555555555555",engine:"session-exact"};
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
 findConversations:(execution,engineSessionId)=>findRequestChatSourceIds(
  (sql,parameters)=>db.prepare(sql).all(...parameters),execution,engineSessionId,
 ).map(({id})=>db.prepare("SELECT * FROM context_conversations WHERE project_id=? AND id=?").get(execution.projectId,id)),
 authorizeConversation:()=>state.chatAllowed,
 conversationIsActive:(projectId,contextConversationId)=>state.active===true ?
  isRequestChatConversationActive((sql,parameters)=>db.prepare(sql).get(...parameters),projectId,contextConversationId) : state.active,
 };
 function insertChat({id,ownerUserId=ids.user,organizationId=ids.org,projectId=ids.project,
  runtimeId=ids.runtime,engineSessionId=ids.engine,visibility="private",metadata:rawMetadata}){
  const metadata=rawMetadata??JSON.stringify({source:"opencode-chat",sourceRuntimeId:runtimeId,sourceSessionId:engineSessionId});
  db.prepare("INSERT INTO context_conversations(id,project_id,organization_id,owner_user_id,visibility,title,request_hash,tags,priority,metadata,created_at) VALUES(?,?,?,?,?,'Other chat',?,'[]',0,?,?)")
   .run(id,projectId,organizationId,ownerUserId,visibility,"f".repeat(64),metadata,time);
 }
 function archiveChat(contextConversationId,sequence,archived) {
  const authorizationId=randomUUID();
  db.prepare("INSERT INTO context_checkpoint_maintenance_authorizations(id,project_id,operation,conversation_id,expected_revision,confirmation_hash,expires_at,consumed_at,created_at,organization_id,actor_type,actor_id) VALUES(?,?,?,?,0,?,?,?,?,?,'user',?)")
   .run(authorizationId,ids.project,archived?"archive_conversation":"unarchive_conversation",contextConversationId,
    createHash("sha256").update(authorizationId).digest("hex"),future,time,time,ids.org,ids.user);
  db.prepare("INSERT INTO context_checkpoint_audit_events(id,project_id,event_type,conversation_id,expected_revision,authorization_id,archive_sequence,created_at,organization_id,source_actor_type,source_actor_id) VALUES(?,?,?,?,0,?,?,?,?,'user',?)")
   .run(randomUUID(),ids.project,archived?"conversation_archived":"conversation_unarchived",contextConversationId,
    authorizationId,sequence,time,ids.org,ids.user);
 }
 const selected={projectId:ids.project,workspaceId:"request-workspace",runtimeId:ids.runtime};
 return {db,state,ports,selected,insertChat,archiveChat,owner:createRequestExecutionResolvers(ports),close:()=>db.close()};
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
  const chat=f.owner.resolveRequestChatBinding({},execution,ids.engine);
  assert.notEqual(ids.engine,ids.chat);
  assert.equal(chat.chatId,ids.engine);assert.equal(chat.engineSessionId,ids.engine);
  assert.equal(chat.contextConversationId,ids.chat);assert.equal(chat.visibility,"private");
  assert.equal(digest(f.db),before);
  // A fresh resolver reconnects through existing rows, without an authority cache.
  assert.deepEqual(createRequestExecutionResolvers(f.ports).resolveRequestChatBinding({},execution,ids.engine),chat);
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
  fails(()=>f.owner.resolveRequestChatBinding({},old,ids.engine),"EXECUTION_RUNTIME_UNAVAILABLE");
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
  fails(()=>f.owner.resolveRequestChatBinding({},{...execution,hostId:"forged"},ids.engine),"EXECUTION_BINDING_CHANGED");
  f.state.chatAllowed=false;fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");f.state.chatAllowed=true;
  for(const metadata of ["invalid",JSON.stringify({source:"opencode-chat",sourceRuntimeId:"other",sourceSessionId:"session-exact"}),
   JSON.stringify({source:"opencode-chat",sourceRuntimeId:ids.runtime,sourceSessionId:""})]) {
   const original=f.db.prepare("SELECT * FROM context_conversations WHERE id=?").get(ids.chat);
   f.ports.findConversations=()=>[{...original,metadata}];
   fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
  }
 }finally{f.close();}
});
test("private owner, visibility and archive state remain required independently of project permission",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  f.state.active=false;fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
  f.state.active=Promise.resolve(true);fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");f.state.active=true;
  const original=f.db.prepare("SELECT * FROM context_conversations WHERE project_id=? AND id=?").get(ids.project,ids.chat);
  assert.throws(()=>f.db.prepare("UPDATE context_conversations SET visibility='project' WHERE id=?").run(ids.chat),/immutable/);
  f.ports.findConversations=()=>[{...original,visibility:"project"}];
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
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
  fails(()=>g.owner.resolveRequestChatBinding({},execution,ids.engine),"EXECUTION_RUNTIME_UNAVAILABLE");
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


test("placement evidence is detached before later identity callbacks can mutate a retained response",()=>{
 const f=fixture();try{
  let retained;let calls=0;
  const placement=f.ports.resolvePlacement,identity=f.ports.revalidateIdentity;
  f.ports.resolvePlacement=facts=>(retained=placement(facts));
  f.ports.revalidateIdentity=()=>{
   if(++calls===2 && retained)retained.hostId="changed-after-validation";
   return identity();
  };
  assert.equal(f.owner.resolveRequestExecution({},f.selected).hostId,"registered-stable-host");
 }finally{f.close();}
});


test("engine lookup denies a canonical row ID, missing session and multiple matching registrations",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.chat),"CHAT_BINDING_UNAVAILABLE");
  fails(()=>f.owner.resolveRequestChatBinding({},execution,"missing-session"),"CHAT_BINDING_UNAVAILABLE");
  f.insertChat({id:"66666666-6666-4666-8666-666666666666"});
  f.insertChat({id:"77777777-7777-4777-8777-777777777777"});
  const before=digest(f.db);
  const candidates=f.ports.findConversations(execution,ids.engine);
  assert.equal(candidates.length,2,"uniqueness lookup remains bounded rather than collecting every duplicate");
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
  assert.equal(digest(f.db),before);
 }finally{f.close();}
});
test("canonical source lookup excludes cross-owner, runtime, project and nonprivate registrations",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  const otherUser="88888888-8888-4888-8888-888888888888";
  const otherProject="99999999-9999-4999-8999-999999999999";
  const time=new Date(f.state.ticks).toISOString();
  f.db.prepare("INSERT INTO users(id,email_normalized,display_name,created_at,updated_at) VALUES(?,?,'Other',?,?)")
   .run(otherUser,"other-request@example.test",time,time);
  f.db.prepare("INSERT INTO organization_memberships(organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'member','active',?,?)")
   .run(ids.org,otherUser,time,time);
  f.db.prepare("INSERT INTO projects(id,name,path,is_global,organization_id,created_at,updated_at) VALUES(?,'other-request','/other-request',0,?,?,?)")
   .run(otherProject,ids.org,time,time);
  f.insertChat({id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",ownerUserId:otherUser,engineSessionId:"other-scope"});
  f.insertChat({id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",runtimeId:"other-runtime",engineSessionId:"other-scope"});
  f.insertChat({id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",projectId:otherProject,engineSessionId:"other-scope"});
  f.insertChat({id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",visibility:"project",engineSessionId:"other-scope"});
  assert.deepEqual(f.ports.findConversations(execution,"other-scope"),[]);
  assert.deepEqual(findRequestChatSourceIds((sql,parameters)=>f.db.prepare(sql).all(...parameters),
   {...execution,organizationId:"other-organization"},ids.engine),[]);
  fails(()=>f.owner.resolveRequestChatBinding({},execution,"other-scope"),"CHAT_BINDING_UNAVAILABLE");
  // An unrelated registration with the same engine ID never changes which private row is authorized.
  f.insertChat({id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",ownerUserId:otherUser});
  const binding=f.owner.resolveRequestChatBinding({},execution,ids.engine);
  assert.equal(binding.contextConversationId,ids.chat);
  const foreign= f.db.prepare("SELECT * FROM context_conversations WHERE id=?").get("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  f.ports.findConversations=()=>[foreign];
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
 }finally{f.close();}
});
test("persisted Context archive state uses the distinct canonical ID and never chooses another active duplicate",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  f.archiveChat(ids.chat,0,true);
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
  f.archiveChat(ids.chat,1,false);
  assert.equal(f.owner.resolveRequestChatBinding({},execution,ids.engine).contextConversationId,ids.chat);
  f.insertChat({id:"ffffffff-ffff-4fff-8fff-ffffffffffff"});
  f.archiveChat(ids.chat,2,true);
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
 }finally{f.close();}
});
test("a duplicate canonical registration inserted during authorization cannot pass the final source recheck",()=>{
 const f=fixture();try{
  const execution=f.owner.resolveRequestExecution({},f.selected);
  f.ports.authorizeConversation=()=>{
   f.insertChat({id:"66666666-6666-4666-8666-666666666666"});return true;
  };
  fails(()=>f.owner.resolveRequestChatBinding({},execution,ids.engine),"CHAT_BINDING_UNAVAILABLE");
 }finally{f.close();}
});
