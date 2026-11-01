/** Actual compiled Core/SQLite qualification, synthetic runtime metadata only.
 * No Docker, process, manager placement, Web or physical runtime qualification. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID,randomBytes}from'node:crypto';
const root=process.env.VEYRA_BROWSER_WRITER_FIXTURE;
assert.ok(root&&process.env.INGENIUM_HOME===root&&process.env.INGENIUM_CORE_DB_PATH===root+'/data.db');
const {getDb,resetDbForTest,identity,organizations,authentication,runtimes,workspaceRuntimeCredentialsV2:credentials}=await import('ingenium-core');
const db=getDb(),checks=[];
const limits={cpuMillis:1000,memoryBytes:536870912,pidsLimit:128,diskBytes:536870912,processLimit:64};
function seed({leaseTtlMs=60000}={}){
 const user=identity.createUser(randomUUID()+'@writer.invalid','Synthetic writer fixture'),org=organizations.createOrganization('Synthetic writer fixture','test-'+randomUUID());organizations.addOrganizationMember(org,user.id,'owner');const backup=identity.createUser(randomUUID()+'@writer.invalid','Other active owner');organizations.addOrganizationMember(org,backup.id,'owner');
 const w=runtimes.authorizeWorkspaceV2({schemaVersion:2,scopeKind:'workspace',projectId:null,id:'workspace-'+randomUUID(),organizationId:org,ownerUserId:user.id,storagePath:root+'/registration-only-'+randomUUID()});
 let r=runtimes.createWorkspaceRuntimeV2(w.id,limits);const until=new Date(Date.now()+600000),c=credentials.issueWorkspaceRuntimeCredentialV2(r.id,until);runtimes.bindWorkspaceRuntimeCapabilityV2(r.id,c.id);c.token='';
 r=runtimes.transitionWorkspaceRuntimeV2({id:r.id,expectedRevision:r.revision,toState:'PROVISIONING',actorType:'manager',actorId:'runtime-manager',maxActiveRuntimes:2,idleExpiresAt:until,absoluteExpiresAt:until});
 r=runtimes.claimWorkspaceRuntimeLeaseV2({id:r.id,expectedRevision:r.revision,ownerToken:randomBytes(32).toString('base64url'),ttlMs:leaseTtlMs,actorId:'runtime-manager'});
 const parent=randomBytes(32).toString('hex'),daemon='synthetic-no-real-daemon';
 const original={schemaVersion:2,scopeKind:'workspace',projectId:null,kind:'original-workspace-runtime-provision-v2',requestId:randomUUID(),requestSha256:'a'.repeat(64),runtimeId:r.id,parentContainerId:parent,daemonId:daemon,hostId:'docker-daemon:'+runtimes.provisionHash('veyra-docker-host-v1\0'+daemon),imageId:'sha256:'+'a'.repeat(64),startIdentity:randomBytes(32).toString('hex'),publicProfileSha256:'d'.repeat(64),specSha256:'e'.repeat(64),workspaceId:w.id,organizationId:org,ownerUserId:user.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,provisioningRevision:r.revision,limits,containerCreatedAt:new Date().toISOString()};
 r=runtimes.transitionWorkspaceRuntimeV2({id:r.id,expectedRevision:r.revision,toState:'STARTING',actorType:'manager',actorId:'runtime-manager',backendContainerId:parent,originalProvision:original});
 r=runtimes.recordWorkspaceRuntimeHealthV2(r.id,r.revision,parent);r=runtimes.transitionWorkspaceRuntimeV2({id:r.id,expectedRevision:r.revision,toState:'READY',actorType:'manager',actorId:'runtime-manager'});
 const session=authentication.createSession(user.id,new Date(),'Synthetic SQLite writer only',true),proof=randomBytes(32).toString('base64url');
 const input={runtimeId:r.id,workspaceId:w.id,organizationId:org,ownerUserId:user.id,authSessionId:session.session.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,audience:'web',rootDomain:'example.test',scheme:'https',launcherOrigin:'https://veyra.example.test',exchangeProof:proof};
 return {user,org,w,r,input};
}
function issue(f){return runtimes.issueWorkspaceBrowserLaunchTicketV2(f.input)}
function consume(f,ticket,patch={}){return runtimes.consumeWorkspaceBrowserLaunchTicketV2({exchangeProof:f.input.exchangeProof,audience:'web',origin:ticket.origin,host:ticket.host,launcherOrigin:f.input.launcherOrigin,...patch})}
function check(name,run,seedOptions){const f=seed(seedOptions);run(f);assert.deepEqual(db.pragma('foreign_key_check'),[]);checks.push(name);console.log(JSON.stringify({check:name,passed:true}))}
try{
 check('Schema2 issue/exchange keeps actual null Project and consumes once',f=>{
  const t=issue(f),x=consume(f,t);assert.equal(t.projectId,null);assert.equal(t.schemaVersion,2);assert.ok(x);assert.equal(x.session.projectId,null);assert.equal(x.session.schemaVersion,2);assert.equal(x.session.ownerUserId,f.user.id);assert.equal(x.session.workspaceId,f.w.id);assert.match(x.token,/^rbs_[A-Za-z0-9_-]{43}$/);assert.equal(consume(f,t),undefined);
  const row=db.prepare('SELECT * FROM runtime_browser_sessions WHERE id=?').get(x.session.id);assert.equal(row.schema_version,2);assert.equal(row.project_id,null);assert.equal(JSON.stringify(row).includes(x.token),false);assert.notEqual(row.token_hash,x.token);
 });
 check('Foreign browser session cannot issue a selected owner ticket',f=>{const other=identity.createUser(randomUUID()+'@writer.invalid','Other'),s=authentication.createSession(other.id,new Date(),'Other synthetic',true);assert.throws(()=>runtimes.issueWorkspaceBrowserLaunchTicketV2({...f.input,authSessionId:s.session.id}),/SCOPE_UNAVAILABLE/)});
 check('Browser binding substitution cannot issue a ticket',f=>{for(const patch of [{bindingHash:'f'.repeat(64)},{bindingEpoch:f.w.securityEpoch+1},{workspaceId:'other'},{organizationId:randomUUID()},{ownerUserId:randomUUID()}])assert.throws(()=>runtimes.issueWorkspaceBrowserLaunchTicketV2({...f.input,...patch}),/SCOPE_UNAVAILABLE/)});
 check('Owner security epoch revocation prevents exchange',f=>{const t=issue(f);db.prepare('UPDATE users SET security_epoch=security_epoch+1 WHERE id=?').run(f.user.id);assert.equal(consume(f,t),undefined)});
 check('Suspended membership prevents exchange',f=>{const t=issue(f);db.prepare("UPDATE organization_memberships SET status='suspended' WHERE organization_id=? AND user_id=?").run(f.org,f.user.id);assert.equal(consume(f,t),undefined)});
 check('Disabled account prevents exchange',f=>{const t=issue(f);db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);assert.equal(consume(f,t),undefined)});
 check('Wrong host/origin/audience/launcher/proof cannot burn the original ticket',f=>{const t=issue(f);for(const patch of [{host:'other.example.test'},{origin:'https://other.example.test'},{audience:'cli'},{launcherOrigin:'https://other.example.test'},{exchangeProof:randomBytes(32).toString('base64url')}])assert.equal(consume(f,t,patch),undefined);assert.ok(consume(f,t))});
 check('Generation replacement prevents exchange',f=>{const t=issue(f);db.prepare('UPDATE runtime_browser_generations SET generation=generation+1 WHERE runtime_id=?').run(f.r.id);assert.equal(consume(f,t),undefined)});
 check('Expired original runtime lease prevents exchange',f=>{const t=issue(f);assert.ok(Date.parse(t.expiresAt)>Date.now()+2000);assert.equal(consume(f,t,{now:new Date(Date.now()+2000)}),undefined)},{leaseTtlMs:1000});
 check('Expired ticket cannot be consumed',f=>{const t=runtimes.issueWorkspaceBrowserLaunchTicketV2({...f.input,ttlMs:1000});assert.equal(consume(f,t,{now:new Date(Date.now()+2000)}),undefined)});
 check('Legacy consumer cannot adopt or consume a schema2 ticket',f=>{const t=issue(f);assert.equal(runtimes.consumeRuntimeBrowserLaunchTicket({exchangeProof:f.input.exchangeProof,audience:'web',origin:t.origin,host:t.host,launcherOrigin:f.input.launcherOrigin}),undefined);assert.ok(consume(f,t))});
 check('Unready runtime cannot issue a ticket',f=>{runtimes.transitionWorkspaceRuntimeV2({id:f.r.id,expectedRevision:f.r.revision,toState:'STOPPING',actorType:'manager',actorId:'runtime-manager'});assert.throws(()=>issue(f),/SCOPE_UNAVAILABLE/)});
 console.log(JSON.stringify({passed:true,checks,actualCanonicalCore:true,actualSqlite:true,metadataOnly:true,physicalRuntimeAccepted:false}));
}finally{resetDbForTest();fs.writeFileSync(root+'/closed.json',JSON.stringify({databaseClosed:true,httpServerClosed:true,containsRealUserData:false,metadataOnly:true})+'\n',{flag:'wx'})}
