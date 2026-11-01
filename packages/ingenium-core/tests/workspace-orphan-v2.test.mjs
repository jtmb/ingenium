/** Canonical SQLite recovery regression. Metadata only; no backend is started or stopped. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root=process.env.VEYRA_BROWSER_WRITER_FIXTURE;
assert.ok(root&&process.env.INGENIUM_HOME===root&&process.env.INGENIUM_CORE_DB_PATH===root+'/data.db');
const {getDb,resetDbForTest,identity,organizations,projects,runtimes}=await import('ingenium-core');
let db=getDb();const checks=[];
const limits={cpuMillis:1000,memoryBytes:536870912,pidsLimit:128,diskBytes:536870912,processLimit:64};
const user=identity.createUser(randomUUID()+'@orphan.invalid','Synthetic recovery'),org=organizations.createOrganization('Synthetic recovery','test-'+randomUUID());organizations.addOrganizationMember(org,user.id,'owner');
const now=new Date(),expiredAt=new Date(now.getTime()-2000);
function workspace({state='PROVISIONING',lease='expired'}={}){
 const w=runtimes.authorizeWorkspaceV2({schemaVersion:2,scopeKind:'workspace',projectId:null,id:'workspace-'+randomUUID(),organizationId:org,ownerUserId:user.id,storagePath:root+'/registration-only-'+randomUUID()});
 let r=runtimes.createWorkspaceRuntimeV2(w.id,limits);
 if(state!=='ABSENT')r=runtimes.transitionWorkspaceRuntimeV2({id:r.id,expectedRevision:r.revision,toState:'PROVISIONING',actorType:'manager',actorId:'synthetic-recovery'});
 if(lease!=='none')r=runtimes.claimWorkspaceRuntimeLeaseV2({id:r.id,expectedRevision:r.revision,ownerToken:'x'.repeat(32),ttlMs:1000,actorId:'synthetic-recovery',now:lease==='expired'?expiredAt:new Date(now.getTime()+60000)});
 if(state==='STOPPING')r=runtimes.transitionWorkspaceRuntimeV2({id:r.id,expectedRevision:r.revision,toState:'STOPPING',actorType:'manager',actorId:'synthetic-recovery'});
 return r;
}
function check(name,run){run();assert.deepEqual(db.pragma('foreign_key_check'),[]);checks.push(name);console.log(JSON.stringify({name,passed:true}));}
try{
 const expired=workspace(),stopping=workspace({state:'STOPPING'}),future=workspace({lease:'future'}),noLease=workspace({lease:'none'}),absent=workspace({state:'ABSENT'});
 const project=projects.createProject('recovery-'+randomUUID(),false,org),w=runtimes.authorizeWorkspace({id:'legacy-'+randomUUID(),organizationId:org,projectId:project.id,ownerUserId:user.id,storagePath:root+'/legacy-registration-'+randomUUID()});
 let legacy=runtimes.createRuntimeInstance(w.id,limits);legacy=runtimes.transitionRuntime({id:legacy.id,expectedRevision:legacy.revision,toState:'PROVISIONING',actorType:'manager',actorId:'synthetic-recovery'});legacy=runtimes.claimRuntimeLease({id:legacy.id,expectedRevision:legacy.revision,ownerToken:'l'.repeat(32),ttlMs:1000,actorId:'synthetic-recovery',now:expiredAt});
 check('Legacy sweep handles its expired runtime without touching expired schema2 rows',()=>{
  assert.deepEqual(runtimes.markExpiredRuntimeOrphans(now).map(x=>x.id),[legacy.id]);
  for(const r of[expired,stopping,future,noLease,absent])assert.deepEqual(runtimes.getWorkspaceRuntimeV2(r.id),r);
 });
 check('Workspace sweep fails only expired in-flight metadata and clears the control lease',()=>{
  const rows=runtimes.markExpiredWorkspaceRuntimeOrphansV2(now);assert.deepEqual(rows.map(r=>r.id).sort(),[expired.id,stopping.id].sort());
  for(const original of[expired,stopping]){const r=rows.find(x=>x.id===original.id);assert.equal(r.schemaVersion,2);assert.equal(r.projectId,null);assert.equal(r.state,'FAILED');assert.equal(r.revision,original.revision+1);assert.equal(r.leaseExpiresAt,null);assert.equal(r.backendContainerId,original.backendContainerId);assert.equal(r.workspaceId,original.workspaceId);assert.equal(r.ownerUserId,original.ownerUserId);assert.equal(db.prepare('SELECT lease_owner_hash FROM runtime_instances WHERE id=?').get(r.id).lease_owner_hash,null);assert.deepEqual(db.prepare("SELECT event_type,from_state,to_state,revision FROM runtime_activity_events WHERE runtime_id=? AND event_type='orphaned'").all(r.id),[{event_type:'orphaned',from_state:original.state,to_state:'FAILED',revision:r.revision}]);}
 });
 check('Future, unleased and ABSENT metadata remains byte-for-byte unchanged',()=>{for(const r of[future,noLease,absent])assert.deepEqual(runtimes.getWorkspaceRuntimeV2(r.id),r)});
 check('Repeated sweeps are idempotent and do not append duplicate events',()=>{const n=db.prepare('SELECT count(*) n FROM runtime_activity_events').get().n;assert.deepEqual(runtimes.markExpiredRuntimeOrphans(now),[]);assert.deepEqual(runtimes.markExpiredWorkspaceRuntimeOrphansV2(now),[]);assert.equal(db.prepare('SELECT count(*) n FROM runtime_activity_events').get().n,n)});
 check('Invalid reconciliation clock is rejected before any metadata changes',()=>{const n=db.prepare('SELECT total_changes() AS n').get().n;assert.throws(()=>runtimes.markExpiredWorkspaceRuntimeOrphansV2(new Date('invalid')),RangeError);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,n)});
 check('Failed metadata and its original scope persist after a fresh database open',()=>{resetDbForTest();db=getDb();for(const r of[expired,stopping]){const saved=runtimes.getWorkspaceRuntimeV2(r.id);assert.equal(saved.state,'FAILED');assert.equal(saved.projectId,null);assert.equal(saved.workspaceId,r.workspaceId);assert.equal(saved.revision,r.revision+1)}});
 console.log(JSON.stringify({passed:true,checks,actualCanonicalCore:true,actualSqlite:true,metadataOnly:true,physicalRuntimeAccepted:false}));
}finally{resetDbForTest();fs.writeFileSync(root+'/closed.json',JSON.stringify({databaseClosed:true,httpServerClosed:true,containsRealUserData:false,metadataOnly:true})+'\n',{flag:'wx'})}
