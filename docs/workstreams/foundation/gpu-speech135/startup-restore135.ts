// Guarded splice INSIDE actual db.ts; uses its existing Database/imports and
// compareMigrationDefinitions helper. SOURCE ONLY; never executed by worker.
const GPU135_TABLES=['veyra_voice_gpu_schema','veyra_voice_gpu_controls','veyra_voice_gpu_operations'];
const GPU135_TRIGGERS=[
 'gpu135_schema_no_insert','gpu135_schema_no_update','gpu135_schema_no_delete',
 'gpu135_control_initial','gpu135_control_insert_collision','gpu135_control_update_collision',
 'gpu135_control_identity','gpu135_control_no_delete','gpu135_control_child_cleanup',
 'gpu135_operation_initial','gpu135_operation_insert_collision','gpu135_operation_update_collision',
 'gpu135_operation_identity','gpu135_operation_no_delete','gpu135_legacy_insert_collision',
];
const GPU135_INDEXES=['gpu135_one_live_control','gpu135_control_recovery','gpu135_operation_recovery'];
const GPU135_REFERENCE_PREREQUISITE=`
CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE organizations(id TEXT PRIMARY KEY);
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE runtime_instances(id TEXT PRIMARY KEY);
CREATE TABLE authorized_workspaces(id TEXT PRIMARY KEY);
CREATE TABLE veyra_voice_operations(operation_id TEXT PRIMARY KEY,scope_hash TEXT,request_id TEXT,kind TEXT,instance_id TEXT,resource_retired INTEGER);
`;
function assertGpu135Presence(database:Database.Database,allowInstall=false):void {
 const present=GPU135_TABLES.filter(name=>database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const objects=database.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'gpu135_*' OR name GLOB 'veyra_voice_gpu_*'").all() as {name:string}[];
 if(present.length===0&&allowInstall&&objects.length===0)return;
 const expected=new Set([...GPU135_TABLES,...GPU135_INDEXES,...GPU135_TRIGGERS]);
 if(present.length!==GPU135_TABLES.length||objects.some(o=>!expected.has(o.name)))throw Error('GPU135 partial/unknown owned schema');
}
/** Reference-only prerequisites are never executed against the live database.
 * This checks exact GPU DDL against current originals, not just trigger names.
 * The existing compare cache key includes the unique135 filename/object set. */
function assertGpu135Schema(database:Database.Database):void {
 assertGpu135Presence(database);
 const drift=compareMigrationDefinitions(database,['135_voice_gpu_controls.sql'],GPU135_REFERENCE_PREREQUISITE,[...GPU135_TABLES,...GPU135_INDEXES,...GPU135_TRIGGERS]);
 const marker=database.prepare('SELECT singleton,version FROM veyra_voice_gpu_schema').all() as {singleton:number;version:number}[];
 if(marker.length!==1||marker[0]?.singleton!==1||marker[0]?.version!==1)drift.push('GPU135 exact immutable schema marker');
 const keys=database.prepare('PRAGMA foreign_key_list(veyra_voice_gpu_controls)').all() as {from:string;to:string;table:string;on_delete:string}[];
 for(const [from,table] of [['actor_id','users'],['organization_id','organizations'],['project_id','projects'],['runtime_id','runtime_instances'],['workspace_id','authorized_workspaces']])
  if(!keys.some(k=>k.from===from&&k.table===table&&k.to==='id'&&k.on_delete==='RESTRICT'))drift.push('GPU135 original '+from+' FK');
 const children=database.prepare('PRAGMA foreign_key_list(veyra_voice_gpu_operations)').all() as {from:string;to:string;table:string;on_delete:string}[];
 if(children.length!==1||!children.some(k=>k.from==='control_id'&&k.table==='veyra_voice_gpu_controls'&&k.to==='control_id'&&k.on_delete==='RESTRICT'))drift.push('GPU135 child references only distinct GPU parent');
 for(const table of GPU135_TABLES){
  if(database.prepare('PRAGMA foreign_key_check('+table+')').all().length)drift.push('GPU135 '+table+' original FK content');
  const integrity=database.prepare('PRAGMA integrity_check('+table+')').all() as Record<string,string>[];
  if(integrity.length!==1||Object.values(integrity[0]??{})[0]!=='ok')drift.push('GPU135 '+table+' CHECK/type/index integrity');
 }
 // Validate restored DATA with proposed pure validators in the SAME read/guard
 // pass. This does not authorize, adopt or reconstruct any GPU capability.
 const controls=database.prepare('SELECT * FROM veyra_voice_gpu_controls ORDER BY control_id').iterate() as Iterable<Record<string,unknown>>;
 for(const r of controls){
  const original=validateGpuControlData(JSON.parse(String(r.original_json)));
  const descriptor=validateGpuDescriptorData(JSON.parse(String(r.descriptor_json)));
  if(r.kind!=='voice-gpu-supervisor'||original.operationId!==r.control_id||original.requestId!==r.request_id||original.deadlineAt!==r.deadline_at||
    gpuDataDigest(original)!==r.original_hash||gpuDataDigest(original.scope)!==r.scope_hash||
    gpuDataDigest(original.descriptor)!==gpuDataDigest(descriptor)||gpuDataDigest(original.scope)!==gpuDataDigest(JSON.parse(String(r.scope_json)))||
    original.scope.actorId!==r.actor_id||original.scope.organizationId!==r.organization_id||original.scope.projectId!==r.project_id||original.scope.runtimeId!==r.runtime_id||original.scope.executionBindingId!==r.workspace_id)
   throw Error('GPU135 restored control DATA mismatch');
  const owner=JSON.parse(String(r.owner_json)) as Record<string,unknown>;
  if(!owner||typeof owner!=='object'||Array.isArray(owner)||Object.keys(owner).sort().join()!==['instanceId','bootId','ownerId','ownerGeneration','leaseId'].sort().join()||
   owner.instanceId!==r.instance_id||owner.ownerGeneration!==r.owner_generation||!Number.isSafeInteger(owner.ownerGeneration)||Number(owner.ownerGeneration)<1||
   typeof owner.instanceId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(owner.instanceId)||
   !['bootId','ownerId'].every(k=>typeof owner[k]==='string'&&owner[k]!=='00000000-0000-0000-0000-000000000000'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(owner[k])))||
   typeof owner.leaseId!=='string'||!owner.leaseId||owner.leaseId.length>256)
   throw Error('GPU135 restored owner DATA mismatch');
 }
 const operations=database.prepare('SELECT * FROM veyra_voice_gpu_operations ORDER BY operation_id').iterate() as Iterable<Record<string,unknown>>;
 for(const r of operations){
  const original=validateGpuSpeechData(JSON.parse(String(r.original_json)));
  if(original.operationId!==r.operation_id||original.requestId!==r.request_id||original.kind!==r.kind||original.controlOperationId!==r.control_id||original.turnGeneration!==r.turn_generation||original.deadlineAt!==r.deadline_at||
    gpuDataDigest(original)!==r.original_hash||gpuDataDigest(original.scope)!==r.scope_hash||
    gpuDataDigest(original.identity)!==gpuDataDigest(JSON.parse(String(r.identity_json)))||gpuDataDigest(original.identity.descriptor)!==gpuDataDigest(JSON.parse(String(r.descriptor_json)))||
    original.identity.workerBootId!==r.worker_boot_id||original.identity.inputSha256!==r.input_sha256)
   throw Error('GPU135 restored child DATA mismatch');
 }
 // SQL predicates remain valid even if a restore was made with foreign_keys=OFF.
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_operations o LEFT JOIN veyra_voice_gpu_controls c ON c.control_id=o.control_id
 WHERE c.control_id IS NULL OR o.scope_json<>c.scope_json OR o.scope_hash<>c.scope_hash OR o.owner_json<>c.owner_json OR o.descriptor_json<>c.descriptor_json OR o.worker_boot_id IS NOT c.worker_boot_id OR o.deadline_at>c.deadline_at LIMIT 1`).get())drift.push('GPU135 restored child/provider binding');
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_controls g JOIN veyra_voice_operations c ON
 g.control_id=c.operation_id OR (g.scope_hash=c.scope_hash AND g.request_id=c.request_id) OR
 (g.resource_retired=0 AND c.kind IN ('voice-cpu-supervisor','voice-speech-stt','voice-speech-tts') AND c.resource_retired=0 AND g.instance_id=c.instance_id) LIMIT 1`).get())drift.push('GPU135 restored CPU/control collision');
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_operations g JOIN veyra_voice_operations c ON
 g.operation_id=c.operation_id OR (g.scope_hash=c.scope_hash AND g.request_id=c.request_id) LIMIT 1`).get())drift.push('GPU135 restored CPU/child collision');
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_operations o JOIN veyra_voice_gpu_controls c ON
 o.operation_id=c.control_id OR (o.scope_hash=c.scope_hash AND o.request_id=c.request_id) OR
 (o.control_id=c.control_id AND c.resource_retired=1 AND o.resource_retired=0) LIMIT 1`).get())drift.push('GPU135 restored GPU collision/cleanup');
 if(drift.length)throw Error('GPU135 schema/data drift: '+drift.join(','));
}
/** Called ONCE at existing original Core startup/restore after all guards and
 * within its existing transaction/checkpoint lifecycle. Never ledger factory.
 * Unknown allocation/effect history is retained and holds the voice slot. */
function fenceGpu135AfterOriginalStartup(database:Database.Database):void {
 database.transaction(()=>{
  database.prepare(`UPDATE veyra_voice_gpu_operations SET phase='unknown',fenced=1,fence_reason=COALESCE(fence_reason,'CORE_STARTUP_OR_RESTORE'),revision=revision+1 WHERE phase IN ('bound','running') AND fenced=0`).run();
  database.prepare(`UPDATE veyra_voice_gpu_controls SET phase='unknown',fenced=1,fence_reason=COALESCE(fence_reason,'CORE_STARTUP_OR_RESTORE'),revision=revision+1 WHERE phase IN ('reserved','running') AND fenced=0`).run();
 })();
}
