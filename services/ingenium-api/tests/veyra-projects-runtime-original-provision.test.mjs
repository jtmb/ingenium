import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,realpathSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {resolve,join} from "node:path";
import {legacyDigest} from "../lib/projects-v2/migration.mjs";
const root=new URL("../../../docs/workstreams/projects/runtime-original-provision/",import.meta.url);
const producer=await import(new URL("sources/packages/ingenium-core/lib/tools/runtime-original-provision.ts",root));
const proposal=JSON.parse(readFileSync(new URL("proposal.json",root),"utf8"));
const inputs=JSON.parse(readFileSync(new URL("inputs.json",root),"utf8"));
const source=process.env.VEYRA_PROJECTS_PROVISION_SOURCE_ROOT;
assert.ok(source,"explicit VEYRA_PROJECTS_PROVISION_SOURCE_ROOT is required; no current-label/source fallback");
assert.equal(realpathSync(source),resolve(source));
for(const rel of ["services/ingenium-api/lib/runtime-manager-contract.ts","packages/veyra-operations/core126-image-contract.mjs"]){
 const entry=[...inputs.inputs,...inputs.consumer].find(v=>v.path===rel);
 const exactHashes=[entry.sha256,...proposal.existingInputs.filter(v=>v.path===rel).map(v=>v.proposedSha256)];
 assert.ok(exactHashes.includes(createHash("sha256").update(readFileSync(join(source,rel))).digest("hex")),"source drift beyond recorded base/proposal: "+rel);
}
const {buildRuntimeContainerSpec}=await import(pathToFileURL(join(source,"services/ingenium-api/lib/runtime-manager-contract.ts")));
const {publicContainer}=await import(pathToFileURL(join(source,"packages/veyra-operations/core126-image-contract.mjs")));
const ids={runtime:"44444444-4444-4444-8444-444444444444",org:"11111111-1111-4111-8111-111111111111",user:"22222222-2222-4222-8222-222222222222",project:"33333333-3333-4333-8333-333333333333",request:"55555555-5555-4555-8555-555555555555",principal:"66666666-6666-4666-8666-666666666666",credential:"77777777-7777-4777-8777-777777777777",binding:"88888888-8888-4888-8888-888888888888"};
const time="2026-10-30T12:00:00.000Z",future="2100-01-01T00:00:00.000Z";
function material(){
 const request={originalRequestId:ids.request,runtimeId:ids.runtime,backendName:"ingenium-runtime-"+ids.runtime.replaceAll("-",""),organizationId:ids.org,projectId:ids.project,projectName:"fixture",ownerUserId:ids.user,workspaceId:"fixture-workspace",storagePath:"/srv/fixture",storageMappingHash:producer.provisionHash("fixture-workspace\0/srv/fixture"),securityEpoch:0,revision:2,capability:"ing_abcdefghijkl_"+"a".repeat(43),capabilityExpiresAt:future,limits:{cpuMillis:1000,memoryBytes:1073741824,pidsLimit:256,diskBytes:2147483648,processLimit:128}};
 const imageId="sha256:"+"f".repeat(64),spec=buildRuntimeContainerSpec(request,{id:request.workspaceId,hostPath:request.storagePath,validationPath:"/fixture-map"},{image:imageId,network:"fixture-network",apiUrl:"http://core-api/api/v1"});
 const raw={Id:"a".repeat(64),Name:"/"+request.backendName,Image:imageId,Created:"2026-10-30T11:59:58.000000000Z",RestartCount:0,
 Config:{Image:imageId,User:spec.User,WorkingDir:spec.WorkingDir,Entrypoint:["/app/scripts/runtime-entrypoint.sh"],Cmd:null,Labels:{...spec.Labels,"org.opencontainers.image.revision":"1".repeat(40)},Env:["SECRET=must-not-store"]},
 HostConfig:{...spec.HostConfig,Privileged:false,CapAdd:null,Devices:[],DeviceRequests:null,PidMode:"",IpcMode:"private",UsernsMode:""},
 Mounts:[{Type:"bind",Source:request.storagePath,Destination:"/workspace",RW:true,Propagation:"rprivate"}],AppArmorProfile:"docker-default",
 NetworkSettings:{Networks:{"fixture-network":{NetworkID:"c".repeat(64)}}},State:{Running:true,Status:"running",Pid:12345,StartedAt:"2026-10-30T11:59:59.000000000Z",Health:{Status:"starting"}}};
 const flow={request,spec,daemonBefore:{ID:"fixture-daemon-original"},daemonAfter:{ID:"fixture-daemon-original"},imageId,createdId:raw.Id,createStatus:201,startStatus:204,attachJoined:true,container:raw};
 return {request,spec,raw,flow,original:producer.originalProvisionFromNewFlow(flow)};
}
function database(){
 const db=new DatabaseSync(":memory:");db.function("sha256",{deterministic:true},v=>createHash("sha256").update(String(v)).digest("hex"));
 const directory=join(source,"packages/ingenium-core/data/migrations"),alternates=new Set(["094_authentication_auth101_upgrade.sql","095_authorization_auth101_upgrade.sql","095_authorization_auth103_upgrade.sql","104_security_audit_project_history_collision_upgrade.sql"]);
 const migrations=readdirSync(directory).filter(v=>v.endsWith(".sql")&&Number(v.slice(0,3))<=126&&!alternates.has(v)).sort();assert.equal(migrations.length,126);
 for(const file of migrations)db.exec(readFileSync(join(directory,file),"utf8"));db.exec("PRAGMA foreign_keys=ON");
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(v=>v.name),before=legacyDigest(db,tables);
 db.exec("BEGIN IMMEDIATE;\n"+readFileSync(new URL("DDL127.sql",root),"utf8")+"\nCOMMIT;");assert.deepEqual(legacyDigest(db,tables),before);
 const m=material(),q=m.request;
 db.prepare("INSERT INTO users(id,email_normalized,display_name,created_at,updated_at) VALUES(?,'original@invalid','Original',?,?)").run(ids.user,time,time);
 db.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,'Original','original',?,?)").run(ids.org,time,time);
 db.prepare("INSERT INTO organization_memberships(organization_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'owner','active',?,?)").run(ids.org,ids.user,time,time);
 db.prepare("INSERT INTO projects(id,name,path,is_global,organization_id,created_at,updated_at) VALUES(?,'original','/original',0,?,?,?)").run(ids.project,ids.org,time,time);
 db.prepare("INSERT INTO authorized_workspaces(id,organization_id,project_id,owner_user_id,storage_path,storage_mapping_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(q.workspaceId,ids.org,ids.project,ids.user,q.storagePath,q.storageMappingHash,time,time);
 db.prepare("INSERT INTO runtime_instances(id,workspace_id,organization_id,project_id,owner_user_id,state,revision,cpu_millis,memory_bytes,pids_limit,disk_bytes,process_limit,backend_name,backend_container_id,security_epoch,lease_owner_hash,lease_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'PROVISIONING',2,1000,1073741824,256,2147483648,128,?,NULL,0,?,?,?,?)").run(ids.runtime,q.workspaceId,ids.org,ids.project,ids.user,q.backendName,"d".repeat(64),future,time,time);
 db.prepare("INSERT INTO service_principals(id,organization_id,name,status,created_at,updated_at) VALUES(?,?,'original runtime','active',?,?)").run(ids.principal,ids.org,time,time);
 db.prepare("INSERT INTO mcp_credentials(id,service_principal_id,kind,audience,name,token_prefix,token_hash,scopes_json,organization_id,project_id,project_grants_json,workspace_id,launcher_worktree,security_epoch,expires_at,created_by_user_id,created_at) VALUES(?,?,'runtime','runtime','original runtime','fixtureprefix',?,'[\"runtime:activity\"]',?,?,'[]',?,?,0,?,?,?)").run(ids.credential,ids.principal,"e".repeat(64),ids.org,ids.project,q.workspaceId,q.storagePath,future,ids.user,time);
 db.prepare("INSERT INTO runtime_capability_bindings(id,runtime_id,mcp_credential_id,organization_id,project_id,owner_user_id,workspace_id,security_epoch,expires_at,created_at) VALUES(?,?,?,?,?,?,?,0,?,?)").run(ids.binding,ids.runtime,ids.credential,ids.org,ids.project,ids.user,q.workspaceId,future,time);
 const current=()=>db.prepare("SELECT * FROM runtime_instances WHERE id=?").get(ids.runtime);
 const transition=(original=m.original,after=()=>{})=>{
  db.exec("BEGIN IMMEDIATE");try{
   const row=current();producer.insertRuntimeOriginalProvision(db,row,{toState:"STARTING",actorType:"manager",actorId:"runtime-manager",backendContainerId:original.parentContainerId,originalProvision:original},time);
   assert.equal(db.prepare("UPDATE runtime_instances SET state='STARTING',revision=revision+1,backend_container_id=? WHERE id=? AND revision=?").run(original.parentContainerId,row.id,row.revision).changes,1);
   after();db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
 };
 return {db,...m,current,transition,close:()=>db.close()};
}
test("new original probe matches the existing consumer hash/start identity without fabricating healthy status or persisting Env",()=>{
 const m=material();assert.throws(()=>publicContainer(m.raw));
 const healthy=structuredClone(m.raw);healthy.State.Health.Status="healthy";const observed=publicContainer(healthy);
 assert.equal(m.original.publicProfileSha256,observed.publicProfileSha256);assert.equal(m.original.startIdentity,observed.startIdentity);assert.equal(m.original.imageId,observed.imageId);
 assert.equal(m.raw.State.Health.Status,"starting");assert.equal(Object.isFrozen(m.original),true);assert.ok(!JSON.stringify(m.original).includes("SECRET"));assert.ok(!JSON.stringify(m.original).includes("capability"));
 const altered=structuredClone(m.flow);altered.spec.Env=["SECRET=different"];altered.container.Config.Env=["SECRET=different"];
 assert.equal(producer.originalProvisionFromNewFlow(altered).publicProfileSha256,m.original.publicProfileSha256);assert.equal(producer.originalProvisionFromNewFlow(altered).specSha256,m.original.specSha256);
});
test("original birth requires exact201/204/attach/id/daemon/raw scope/resource/start facts",()=>{
 const mutations=[f=>f.createStatus=200,f=>f.startStatus=304,f=>f.attachJoined=false,f=>f.createdId="b".repeat(64),f=>f.daemonAfter.ID="changed",f=>f.container.RestartCount=1,f=>f.container.State.Pid=0,f=>f.container.State.Health.Status="unhealthy",f=>f.container.Image="sha256:"+"c".repeat(64),f=>f.container.HostConfig.Memory++,f=>f.container.HostConfig.Privileged=true,f=>f.container.HostConfig.ReadonlyRootfs=false,f=>f.container.Mounts[0].Source="/other",f=>f.container.Config.Labels["com.ingenium.runtime.owner"]=ids.project,f=>delete f.container.Mounts,f=>delete f.container.Config.Entrypoint];
 for(const mutate of mutations){const flow=structuredClone(material().flow);mutate(flow);assert.throws(()=>producer.originalProvisionFromNewFlow(flow));}
});
test("authenticated response metadata binds exact nonce/revision/mapping/scope and rejects extra secret fields",()=>{
 const m=material();assert.deepEqual(producer.validateProvisionResponse(m.original,m.request,m.raw.Id),m.original);
 for(const patch of [{originalRequestId:ids.user},{revision:3},{projectName:"changed"},{limits:{...m.request.limits,memoryBytes:2147483648}}])assert.throws(()=>producer.validateProvisionResponse(m.original,{...m.request,...patch},m.raw.Id));
 assert.throws(()=>producer.decodeRuntimeOriginalProvision({...m.original,Env:["secret"]}));assert.throws(()=>producer.decodeRuntimeOriginalProvision({...m.original,qualified:true}));
});
test("same Core transaction inserts original with STARTING and rolls both back after a later failure",()=>{
 const f=database();try{
  assert.throws(()=>f.transition(f.original,()=>{throw Error("fixture later owner failure");}));assert.equal(f.current().state,"PROVISIONING");assert.equal(producer.readRuntimeOriginalProvision(f.db,ids.runtime),undefined);
  f.transition();assert.equal(f.current().state,"STARTING");const original=producer.readRuntimeOriginalProvision(f.db,ids.runtime);assert.equal(original.parentContainerId,f.raw.Id);assert.equal(original.provisioningRevision,2);assert.equal(original.recordedAt,time);assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(),[]);
  assert.throws(()=>f.db.exec("UPDATE runtime_original_provisions SET image_id='sha256:"+"0".repeat(64)+"'"),/immutable/);assert.throws(()=>f.db.exec("DELETE FROM runtime_original_provisions"),/survive/);
 }finally{f.close();}
});
test("missing current scope/capability/lease or changed revision cannot record an original",()=>{
 for(const mutate of [f=>f.db.prepare("UPDATE runtime_capability_bindings SET revoked_at=?").run(time),f=>f.db.prepare("UPDATE authorized_workspaces SET status='revoked'").run(),f=>f.db.prepare("UPDATE runtime_instances SET revision=revision+1 WHERE id=?").run(ids.runtime),f=>f.db.prepare("UPDATE runtime_instances SET lease_expires_at=?,revision=revision+1 WHERE id=?").run(time,ids.runtime)]){
  const f=database();try{mutate(f);const row=f.current();assert.throws(()=>f.transition());assert.deepEqual(f.current(),row);assert.equal(producer.readRuntimeOriginalProvision(f.db,ids.runtime),undefined);}finally{f.close();}
 }
});
test("replacement container keeps legacy lifecycle while the initial original remains unchanged and cannot qualify the replacement",()=>{
 const f=database();try{
  f.transition();const initial=producer.readRuntimeOriginalProvision(f.db,ids.runtime);
  f.db.prepare("UPDATE runtime_instances SET state='STOPPED',revision=revision+1 WHERE id=?").run(ids.runtime);f.db.prepare("UPDATE runtime_instances SET state='PROVISIONING',backend_container_id=NULL,revision=revision+1 WHERE id=?").run(ids.runtime);
  const next=structuredClone(f.flow);next.request.originalRequestId=ids.binding;next.request.revision=f.current().revision;next.spec.Labels["com.ingenium.runtime.revision"]=String(next.request.revision);next.container.Config.Labels["com.ingenium.runtime.revision"]=String(next.request.revision);next.createdId="b".repeat(64);next.container.Id=next.createdId;
  f.transition(producer.originalProvisionFromNewFlow(next));assert.equal(f.current().backend_container_id,next.createdId);assert.deepEqual(producer.readRuntimeOriginalProvision(f.db,ids.runtime),initial);assert.notEqual(initial.parentContainerId,f.current().backend_container_id);
 }finally{f.close();}
});
test("schema127 missing during staged rollout stays legacy and cannot mint an original from a current runtime",()=>{
 const db=new DatabaseSync(":memory:");try{
  assert.equal(producer.readRuntimeOriginalProvision(db,ids.runtime),undefined);producer.insertRuntimeOriginalProvision(db,{}, {originalProvision:material().original},time);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),[]);
 }finally{db.close();}
});
