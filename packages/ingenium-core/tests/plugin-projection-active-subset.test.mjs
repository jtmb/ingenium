/** Pure source/classification controls only. No Core/native/DB import, principal or positive namespace proof. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)),app=path.resolve(here,'../../..'),ts=createRequire(import.meta.url)(app+'/node_modules/typescript/lib/typescript.js');
const helperText=fs.readFileSync(app+'/packages/ingenium-core/lib/tools/plugin-projection-active-subset.ts','utf8'),compiled=ts.transpileModule(helperText,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const h=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64')),core=fs.readFileSync(app+'/packages/ingenium-core/lib/tools/plugin-projection-transition.ts','utf8');
const row=(id,archived_at)=>({id,path:'/synthetic/'+id,created_at:'fixture-created',is_global:0,archived_at});
const active=row('active',null),archived=row('archived','archived-token'),digest='a'.repeat(64),claim=(projectId,other={})=>({id:projectId+'-claim',projectId,filePath:'shared.ts',sourceSha256:digest,enabled:true,archived:null,...other});
function before(text,a,b){assert.ok(text.includes(a)&&text.includes(b)&&text.indexOf(a)<text.indexOf(b),a+' before '+b);}
function functionText(name){const start=core.indexOf('function '+name+'(');assert.notEqual(start,-1);const end=core.indexOf('\nfunction ',start+1);return core.slice(start,end<0?undefined:end);}
function postimage(path){const row=JSON.parse(fs.readFileSync(app+'/docs/workstreams/customize/native-hosted-transport/active-subset-source-manifest.json')).sources.find(r=>r.path===path);assert.ok(row);const actual=fs.readFileSync(app+'/'+path,'utf8');assert.equal(createHash('sha256').update(actual).digest('hex'),row.postimageSha256,'Current canonical postimage must match actual reviewed source');return actual;}

test('SQL NULL semantics: empty string, zero and nonUTF8 BLOB archive tokens never become active',()=>{
 const rows=[active,row('empty',''),row('zero',0),row('blob',Buffer.from([255,128]))],captured=JSON.parse(JSON.stringify(rows)),p=h.partitionCapturedMembers(captured,rows);assert.deepEqual(p.activeIds,['active']);assert.deepEqual(p.archiveIds,['empty','zero','blob']);assert.equal(p.memberIds.length,4);assert.equal(h.projectConfigConsumedGuard(captured[1],false),'ARCHIVED_LEGACY_RESTORE_INITIALIZATION_UNAVAILABLE');
});
test('full captured roster remains required; missing/change/duplicate and invalid global role refuse',()=>{
 assert.throws(()=>h.partitionCapturedMembers([active,archived],[active]),/ROSTER_CHANGED/);assert.throws(()=>h.partitionCapturedMembers([active],[{...active,path:'/changed'}]),/ROSTER_CHANGED/);assert.throws(()=>h.partitionCapturedMembers([active,active],[active]),/DUPLICATE_ID/);assert.throws(()=>h.partitionCapturedMembers([{...archived,is_global:''}],[archived]),/GLOBAL_STATE_UNRESOLVED/);const g={...row('global',null),is_global:1};assert.deepEqual(h.partitionCapturedMembers([active,archived,g],[active,archived,g]).memberIds,['active','archived']);
});
test('all shared claims retained: identical active copies and archive claimant need no invented owner',()=>{
 const c=[claim('active'),claim('another'),claim('archived',{sourceSha256:null})],m=h.validateActivePhysicalClaims(c,['active','another'],[{path:'/legacy/shared.ts',sha256:digest}],'/legacy',['.opencode/plugins/shared.ts']);assert.equal(m.paths.length,1);assert.deepEqual(m.paths[0].claims.map(c=>c.projectId),['active','another','archived']);assert.equal(m.paths[0].claims[2].sourceSha256,null);
});
test('enabled active physical mismatch stays unavailable; disabled copy does not remove shared archive executable',()=>{
 assert.throws(()=>h.validateActivePhysicalClaims([claim('active')],['active'],[{path:'/legacy/shared.ts',sha256:'different'}],'/legacy',['.opencode/plugins/shared.ts']),/RECONCILIATION_REQUIRED/);const c=[claim('active',{enabled:false}),claim('archived')];assert.equal(h.validateActivePhysicalClaims(c,['active'],[{path:'/legacy/shared.ts',sha256:digest}],'/legacy',['.opencode/plugins/shared.ts']).paths[0].claims.length,2);assert.throws(()=>h.validateActivePhysicalClaims([claim('active',{sourceSha256:null})],['active'],[],'/legacy',['.opencode/plugins/shared.ts']),/AUTHORITATIVE_DATABASE/);
});
test('unsafe archive paths remain opaque, are never resolved outside root or used as active refs',()=>{
 const c=[claim('active'),claim('archived',{filePath:'../../outside',sourceSha256:null})],m=h.fullClaimMultimap(c,['active'],'/legacy',['.opencode/plugins/shared.ts']);assert.equal(m.opaque.length,1);assert.equal(m.paths[0].path,'/legacy/shared.ts');assert.throws(()=>h.fullClaimMultimap(c,['archived'],'/legacy',['.opencode/plugins/shared.ts']),/UNSAFE_ACTIVE/);assert.deepEqual(h.fullRemovalReferences(c),['.opencode/plugins/shared.ts']);
});
test('removal classification covers archives and other actives without granting a source or authority',()=>{
 assert.deepEqual(h.fullRemovalReferences([claim('active'),claim('archived',{filePath:'archive.ts'}),claim('another',{filePath:'another.ts'})]),['.opencode/plugins/shared.ts','.opencode/plugins/archive.ts','.opencode/plugins/another.ts']);assert.equal(h.projectConfigConsumedGuard(active,false),'CAPTURED_PROJECT_PROJECTION_TRANSITION_REQUIRED');assert.equal(h.projectConfigConsumedGuard(active,true),null);assert.equal(h.projectConfigConsumedGuard(undefined,false),null);
});
test('typed archive codec distinguishes NULL, empty TEXT, INTEGER0/large integer and nonUTF8 BLOB',()=>{
 const columns=['null','empty','zero','large','blob'],cells=h.decodeArchiveStorage(columns,[{t0:'null',v0:null,t1:'text',v1:'',t2:'integer',v2:'0',t3:'integer',v3:'9007199254740993',t4:'blob',v4:'FF80'}])[0];assert.deepEqual(cells.map(c=>c.type),['null','text','integer','integer','blob']);assert.equal(cells[0].value,null);assert.equal(cells[1].value,'');assert.equal(cells[2].value,'0');assert.equal(cells[3].value,'9007199254740993');assert.deepEqual(Buffer.from(cells[4].value,'hex'),Buffer.from([255,128]));assert.throws(()=>h.decodeArchiveStorage(['x'],[{t0:'blob',v0:'not-hex'}]),/BYTE_ENCODING/);
});
test('fixed source/storage query cannot select credential tables or interpolate unquoted column names',()=>{
 assert.throws(()=>h.archiveStorageQuery('users',['id']),/STORAGE_SCHEMA/);const sql=h.archiveStorageQuery('configs',['id','content','odd"column']);assert.ok(sql.includes('hex(CAST("content" AS BLOB))'));assert.ok(sql.includes('"odd""column"'));assert.ok(sql.endsWith('FROM "configs" WHERE project_id=? ORDER BY id'));assert.ok(h.archiveStorageQuery('projects',['id']).includes('WHERE id=?'));
});
test('actual source composes real admin checks before archival reads; v1 remains separate',()=>{
 const build=functionText('buildTransitionPlan'),start=build.indexOf("else if(mode==='captured-active-subset')"),end=build.indexOf("need(mode==='captured-legacy-cohort'",start),v2=build.slice(start,end);before(v2,'currentActor(p,[],true)','loadLegacyCapture()');before(v2,'currentActor(p,partition.activeIds,true)','boundedArchiveStorage');assert.ok(build.includes("projects.every(r=>!r.archived_at),'ARCHIVED_COHORT_REQUIRES_OWNED_RESTORE_REVIEW'"));assert.ok(core.includes('legacyMode(inspectionScope.mode)'));assert.ok(core.includes("plan.mode==='captured-active-subset'?ACTIVE_SUBSET_PLAN"));
});
test('archive bytes stored once in private plan, preservation receipt is not a namespace or activation receipt',()=>{
 assert.ok(core.includes('archives:boundedArchiveStorage(partition.archiveIds)'));assert.ok(core.includes('archiveStorageSha256:slice.sha256,archiveSliceIndex:plan.subset.archives.indexOf(slice)'));assert.ok(!core.includes('sharedOriginalPreimageRef:input.operationId,...slice'));assert.ok(core.includes('projectionMigrated:false,activationAuthorized:false'));assert.ok(core.includes('namespaceRows=plan.targets.map(target=>'));assert.ok(core.includes('subset?.removalRefs??'));assert.ok(core.includes('subset?r.archived_at===null:!r.archived_at'));assert.ok(core.includes('subsetDependencies(plan)'));const pub=functionText('publicPlan');assert.ok(!pub.includes('sharedConfigBase64')&&!pub.includes('storage:'));
});
test('actual configs hooks propagate hold before SQL/disk and Core name+ID restoration are unavailable not faked',()=>{
 const configs=postimage('packages/ingenium-core/lib/tools/configs.ts');before(configs.slice(configs.indexOf('export function saveConfig(')),'managedPluginConfigPathIfPresent(projectId)','execTransaction(');assert.ok(configs.includes('if(error instanceof PluginProjectionTransitionRequired)throw error'));const sync=configs.slice(configs.indexOf('export function syncConfigFromDisk('));before(sync,'managedPluginConfigPathIfPresent(projectId)','try {');const projects=postimage('packages/ingenium-core/lib/tools/projects.ts');assert.ok(projects.includes('assertCapturedProjectRestoreAvailable((existing as Project).id)'));assert.ok(projects.includes('assertCapturedProjectRestoreAvailable(existing.id)'));assert.ok(core.includes('CAPTURED_LEGACY_PROJECT_RESTORE_UNAVAILABLE'));const api=postimage('services/ingenium-api/lib/routes/projects.ts');assert.ok(api.includes('res.status(409).json({error:{code:error.code'));
});
test('public request has origin selectors only; exact v2 origin map server-matches active IDs and request callbacks persist',()=>{
 const route=postimage('services/ingenium-api/lib/routes/customize-scoped-v1.ts');assert.ok(route.includes("'captured-active-subset'"));assert.ok(route.includes('z.record(uuid,configOrigin)'));assert.ok(core.includes('payloadHash(Object.keys(origin).sort())===payloadHash([...ids].sort())'));assert.ok(core.includes('currentActor(principal,plan.projects.map(p=>p.id),legacyMode(plan.mode))'));assert.ok(route.includes('authenticateRequestWithoutActivity(req)'));assert.ok(route.includes('authentication.hasRecentStepUp(p.session)'));
});
test('unsupported enabled child empty/zero archive verifier contract refuses before target effects',()=>{const s=functionText('buildTransitionPlan');before(s,"'ACTIVE_CHILD_ARCHIVE_VERIFIER_CONTRACT_UNAVAILABLE'",'return planProjectProjection(');assert.ok(s.includes("r.archived_at!==null&&(r.archived_at===''||r.archived_at===0)"));assert.ok(s.includes("subset?r.archived_at===null:!r.archived_at"));});

test('enabled active source present on disk but absent from actual shared config remains unavailable',()=>{assert.throws(()=>h.validateActivePhysicalClaims([claim('active')],['active'],[{path:'/legacy/shared.ts',sha256:digest}],'/legacy',[]),/RECONCILIATION_REQUIRED/);});

test('actual SQLite storage query preserves raw invalid-UTF8 TEXT, BLOB, NULL and exact large INTEGER without writes',()=>{
 const Database=createRequire(app+'/package.json')('better-sqlite3'),db=new Database(':memory:');
 try{
  db.exec('CREATE TABLE configs(id TEXT PRIMARY KEY,project_id TEXT,nothing_value,empty_value,zero_value,big_value,blob_value,badtext_value)');
  db.prepare('INSERT INTO configs VALUES(?,?,NULL,?,0,9007199254740993,?,CAST(? AS TEXT))').run('row','project','',Buffer.from([255,128]),Buffer.from([255,128]));
  const before=db.prepare('SELECT total_changes() AS n').get().n,columns=db.prepare('PRAGMA table_info(configs)').all().map(r=>r.name);
  const encoded=h.decodeArchiveStorage(columns,db.prepare(h.archiveStorageQuery('configs',columns)).all('project'))[0],values=new Map(encoded.map(r=>[r.name,r]));
  assert.deepEqual(values.get('nothing_value'),{name:'nothing_value',type:'null',value:null});
  assert.equal(values.get('empty_value').type,'text');assert.equal(values.get('empty_value').value,'');
  assert.equal(values.get('zero_value').type,'integer');assert.equal(values.get('zero_value').value,'0');
  assert.equal(values.get('big_value').type,'integer');assert.equal(values.get('big_value').value,'9007199254740993');
  assert.equal(values.get('blob_value').type,'blob');assert.equal(values.get('blob_value').value,'FF80');
  assert.equal(values.get('badtext_value').type,'text');assert.equal(values.get('badtext_value').value,'FF80');
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(db.prepare('SELECT hex(CAST(badtext_value AS BLOB)) AS raw FROM configs').get().raw,'FF80');
 }finally{db.close();assert.equal(db.open,false)}
});
