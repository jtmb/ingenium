# Static source generator ONLY: no apply, DB, tests or builds.
from pathlib import Path
import hashlib,json,difflib
P=Path(__file__).resolve().parent
CORE=Path('/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes')
pins=[];patch=[]
def read(rel):
 raw=(CORE/rel).read_bytes();pins.append({'path':rel,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)});return raw.decode()
def one(s,a,b):
 if s.count(a)!=1:raise ValueError(('PREIMAGE_MISMATCH',a,s.count(a)))
 return s.replace(a,b)
def diff(rel,old,new):
 patch.extend(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
rel='packages/ingenium-core/lib/tools/runtime-original-provision.ts';old=read(rel)
request=r'''
/** Explicit workspace-scoped v2; v1 stays Project-required. */
export type PublicWorkspaceProvisionRequest=Omit<PublicProvisionRequest,'projectId'|'projectName'>&{schemaVersion:2;scopeKind:'workspace';projectId:null};
export type WorkspaceRuntimeOriginalProvision=Omit<RuntimeOriginalProvision,'schemaVersion'|'kind'|'projectId'>&{schemaVersion:2;scopeKind:'workspace';kind:'original-workspace-runtime-provision-v2';projectId:null};
export interface StoredWorkspaceRuntimeOriginalProvision extends WorkspaceRuntimeOriginalProvision{readonly recordedAt:string}
export function publicWorkspaceProvisionRequest(input:PublicWorkspaceProvisionRequest):PublicWorkspaceProvisionRequest{
 const keys=['schemaVersion','scopeKind','originalRequestId','runtimeId','backendName','organizationId','projectId','ownerUserId','workspaceId','storagePath','storageMappingHash','securityEpoch','revision','limits'];
 if(!input||Object.keys(input).sort().join('|')!==keys.sort().join('|')||input.schemaVersion!==2||input.scopeKind!=='workspace'||input.projectId!==null
 ||![input.originalRequestId,input.runtimeId,input.organizationId,input.ownerUserId].every(v=>typeof v==='string'&&UUID.test(v))
 ||input.backendName!=='ingenium-runtime-'+input.runtimeId.replaceAll('-','')||!text(input.workspaceId,256)
 ||!text(input.storagePath,1024)||!input.storagePath.startsWith('/')||input.storagePath.includes('/../')||input.storagePath.includes('/./')||input.storagePath.endsWith('/..')||input.storagePath.endsWith('/.')
 ||!HEX.test(input.storageMappingHash)||input.storageMappingHash!==provisionHash(input.workspaceId+'\0'+input.storagePath)||!integer(input.securityEpoch)||!integer(input.revision))return fail();
 return frozen({...input,limits:limits(input.limits)});
}
'''
a=old.index('export function originalProvisionFromNewFlow(');z=old.index('/** Validated metadata/read DTO',a)
proof=old[a:z].replace('originalProvisionFromNewFlow(', 'originalWorkspaceProvisionFromNewFlow(').replace('request:PublicProvisionRequest;', 'request:PublicWorkspaceProvisionRequest;').replace('):RuntimeOriginalProvision{', '):WorkspaceRuntimeOriginalProvision{').replace('publicProvisionRequest(input.request)', 'publicWorkspaceProvisionRequest(input.request)').replace('decodeRuntimeOriginalProvision({schemaVersion:1,kind:',"decodeWorkspaceRuntimeOriginalProvision({schemaVersion:2,scopeKind:'workspace',kind:").replace("'original-runtime-provision-v1'", "'original-workspace-runtime-provision-v2'")
proof=one(proof,"labels['com.ingenium.runtime.project']!==request.projectId", "Object.hasOwn(labels,'com.ingenium.runtime.project')||Object.hasOwn(expected,'com.ingenium.runtime.project')||labels['com.ingenium.runtime.scope']!=='workspace'||expected['com.ingenium.runtime.scope']!=='workspace'")
proof=one(proof,' const profile={'," if([spec.Env,c.Env].some(env=>!Array.isArray(env)||env.some(v=>typeof v!=='string'||/^(INGENIUM_PROJECT|INGENIUM_PROJECT_ID|INGENIUM_PROJECT_NAME)=/.test(v))))return fail();\n const profile={")
a=old.index('export function decodeRuntimeOriginalProvision(');z=old.index('export interface OriginalDb',a)
decoder=old[a:z].replace('decodeRuntimeOriginalProvision','decodeWorkspaceRuntimeOriginalProvision').replace('validateProvisionResponse','validateWorkspaceProvisionResponse').replace('PublicProvisionRequest','PublicWorkspaceProvisionRequest').replace('publicProvisionRequest(request)','publicWorkspaceProvisionRequest(request)').replace('RuntimeOriginalProvision','WorkspaceRuntimeOriginalProvision').replace('decodeWorkspaceWorkspaceRuntimeOriginalProvision','decodeWorkspaceRuntimeOriginalProvision')
decoder=one(decoder,"keys=['schemaVersion','kind'", "keys=['schemaVersion','scopeKind','kind'")
decoder=one(decoder,"v.schemaVersion!==1||v.kind!=='original-runtime-provision-v1'", "v.schemaVersion!==2||v.scopeKind!=='workspace'||v.projectId!==null||v.kind!=='original-workspace-runtime-provision-v2'")
decoder=one(decoder,'v.requestId,v.runtimeId,v.organizationId,v.projectId,v.ownerUserId','v.requestId,v.runtimeId,v.organizationId,v.ownerUserId')
a=old.index('export function readRuntimeOriginalProvision(');z=old.index('/** Invoke ONLY',a)
reader=old[a:z].replace('readRuntimeOriginalProvision','readWorkspaceRuntimeOriginalProvision').replace('StoredRuntimeOriginalProvision','StoredWorkspaceRuntimeOriginalProvision').replace('decodeRuntimeOriginalProvision({schemaVersion:1,kind:',"decodeWorkspaceRuntimeOriginalProvision({schemaVersion:2,scopeKind:'workspace',kind:").replace("'original-runtime-provision-v1'", "'original-workspace-runtime-provision-v2'")
reader=one(reader,"name='runtime_original_provisions'", "name='veyra_evolution_137'")
reader=one(reader,'WHERE runtime_id=?', 'WHERE runtime_id=? AND project_id IS NULL AND schema_version=2')
a=old.index('export function insertRuntimeOriginalProvision(')
insert=old[a:].replace('insertRuntimeOriginalProvision','insertWorkspaceRuntimeOriginalProvision').replace('db:OriginalDb,current:ProvisionRuntimeRow',"db:OriginalDb&{inTransaction:boolean},current:Omit<ProvisionRuntimeRow,'project_id'>&{project_id:null;schema_version:2}").replace('originalProvision?:RuntimeOriginalProvision','originalProvision?:WorkspaceRuntimeOriginalProvision').replace('decodeRuntimeOriginalProvision','decodeWorkspaceRuntimeOriginalProvision').replace('readRuntimeOriginalProvision','readWorkspaceRuntimeOriginalProvision')
insert=one(insert,' if(!input.originalProvision)return;', " if(!db.inTransaction||current.schema_version!==2||current.project_id!==null)return fail();\n if(input.toState!=='STARTING'){if(input.originalProvision)return fail();return;}\n if(!input.originalProvision)return fail();")
insert=one(insert,"name='runtime_original_provisions'", "name='veyra_evolution_137'")
insert=one(insert,'return; // staged rollout stays legacy/unqualified', 'return fail(); // v2 never silently drops original proof')
insert=insert.replace('project_id=?','project_id IS ?').replace('c.project_id=b.project_id','c.project_id IS b.project_id')
insert=one(insert,'p.containerCreatedAt,timestamp];','p.containerCreatedAt,timestamp,2];')
insert=one(insert,'(${originalColumns})','(${originalColumns},schema_version)')
new=one(old,"WHERE runtime_id=?'","WHERE runtime_id=? AND project_id IS NOT NULL'")+'\n'+request+proof+decoder+reader+insert
diff(rel,old,new)
rel='packages/ingenium-core/lib/tools/runtimes.ts';old=read(rel);new=old
for table in ['authorized_workspaces','runtime_instances']:
 new=new.replace('SELECT * FROM '+table+' WHERE ', 'SELECT * FROM '+table+' WHERE project_id IS NOT NULL AND ')
 new=new.replace('SELECT * FROM '+table+' ORDER BY ', 'SELECT * FROM '+table+' WHERE project_id IS NOT NULL ORDER BY ')
# Append explicit v2 lifecycle/store entry points using the actual owner algorithms.
# Their producer/auth/mapping composition stays in Root's private manager, never a DTO grant.
def section(start,end):return old[old.index(start):old.index(end,old.index(start))]
base_types="""
export type AuthorizedWorkspaceV2=Omit<AuthorizedWorkspace,'projectId'>&{schemaVersion:2;scopeKind:'workspace';projectId:null};
export type WorkspaceRuntimeInstanceV2=Omit<RuntimeInstance,'projectId'>&{schemaVersion:2;scopeKind:'workspace';projectId:null};
type AuthorizedWorkspaceRowV2=Omit<WorkspaceRow,'project_id'>&{schema_version:2;project_id:null};
type WorkspaceRuntimeRowV2=Omit<RuntimeRow,'project_id'>&{schema_version:2;project_id:null};
"""
new="import {insertWorkspaceRuntimeOriginalProvision,type WorkspaceRuntimeOriginalProvision} from './runtime-original-provision.js';\n"+new
pairs=[('function workspaceDto','function launchTicketDto'),
 ('export function authorizeWorkspace','export function getAuthorizedWorkspace'),
 ('export function getAuthorizedWorkspace','export function listAuthorizedWorkspaces'),
 ('export function revokeAuthorizedWorkspace','function assertLimits'),
 ('export function createRuntimeInstance','export function bindRuntimeCapability'),
 ('export function bindRuntimeCapability','export function getRuntimeInstance'),
 ('export function getRuntimeInstance','export function getRuntimeForWorkspace'),
 ('function appendEvent','export function transitionRuntime'),
 ('export function transitionRuntime','export function renewLocalRuntimeLifetime'),
 ('export function claimRuntimeLease','export function recordRuntimeActivity'),
 ('export function recordRuntimeActivity','export function recordRuntimeCapabilityActivity'),
 ('export function recordRuntimeHealth','export function markExpiredRuntimeOrphans')]
renames={'workspaceDto':'workspaceV2Dto','runtimeDto':'runtimeV2Dto','authorizeWorkspace':'authorizeWorkspaceV2','revokeAuthorizedWorkspace':'revokeAuthorizedWorkspaceV2','getAuthorizedWorkspace':'getAuthorizedWorkspaceV2','createRuntimeInstance':'createWorkspaceRuntimeV2','bindRuntimeCapability':'bindWorkspaceRuntimeCapabilityV2','getRuntimeInstance':'getWorkspaceRuntimeV2','appendEvent':'appendWorkspaceEventV2','transitionRuntime':'transitionWorkspaceRuntimeV2','claimRuntimeLease':'claimWorkspaceRuntimeLeaseV2','recordRuntimeActivity':'recordWorkspaceRuntimeActivityV2','recordRuntimeHealth':'recordWorkspaceRuntimeHealthV2','insertRuntimeOriginalProvision':'insertWorkspaceRuntimeOriginalProvision'}
clones=[]
for begin,end in pairs:
 part=section(begin,end)
 import re
 for a,b in renames.items():part=re.sub(r'\b'+a+r'\b',b,part)
 for a,b in {'RuntimeOriginalProvision':'WorkspaceRuntimeOriginalProvision','RuntimeInstance':'WorkspaceRuntimeInstanceV2','AuthorizedWorkspace':'AuthorizedWorkspaceV2','RuntimeRow':'WorkspaceRuntimeRowV2','WorkspaceRow':'AuthorizedWorkspaceRowV2'}.items():part=re.sub(r'\b'+a+r'\b',b,part)
 for table in ['authorized_workspaces','runtime_instances']:
  part=part.replace('SELECT * FROM '+table+' WHERE ', 'SELECT * FROM '+table+' WHERE project_id IS NULL AND schema_version=2 AND ')
 if begin=='function workspaceDto':part=part.replace('  return {','  return {schemaVersion:2,scopeKind:"workspace",')
 if begin=='export function authorizeWorkspace':
  part=one(part,'projectId: string;', 'projectId:null;schemaVersion:2;scopeKind:"workspace";')
  part=one(part,'  const id = normalizeText', '  if(input.projectId!==null||input.schemaVersion!==2||input.scopeKind!=="workspace"||input.id!==input.id.trim()||input.storagePath!==normalizeStoragePath(input.storagePath))throw new RuntimeConflictError("SCOPE_UNAVAILABLE");\n  const id = normalizeText')
  part=one(part,'created_at, updated_at)','created_at, updated_at, schema_version)')
  part=one(part,'VALUES (?, ?, ?, ?, ?, ?, ?, ?)','VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2)')
 if begin=='export function createRuntimeInstance':
  part=one(part,'backend_name, security_epoch, created_at, updated_at)','backend_name, security_epoch, created_at, updated_at, schema_version)')
  part=one(part,'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)','VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)')
 if begin=='export function bindRuntimeCapability':
  part=one(part,'SELECT expires_at FROM mcp_credentials WHERE id = ?', 'SELECT expires_at FROM mcp_credentials WHERE id = ? AND project_id IS NULL AND schema_version=2')
  part=one(part,'security_epoch, expires_at, created_at)','security_epoch, expires_at, created_at, schema_version)')
  part=one(part,'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)','VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)')
 clones.append(part)
new+='\n'+base_types+'\n'.join(clones)
diff(rel,old,new)
rel='packages/ingenium-core/lib/db.ts';old=read(rel);new=old
new="import { installContext136, hasVerifiedContext136 } from '../data/migrations/migration-136.mjs';\nimport { installWorkspaceExecution137, verifiedWorkspace137Definitions } from '../data/migrations/migration-137.mjs';\n"+new
new=one(new,'      "CHECK(entry_count >= 1)",', '      hasVerifiedContext136(db) ? "CHECK((project_id IS NOT NULL AND entry_count >= 1) OR (project_id IS NULL AND entry_count >= 0))" : "CHECK(entry_count >= 1)",')
new=one(new,'  applyVeyraDomainMigrations(db, migrationsDir);','  applyVeyraDomainMigrations(db, migrationsDir);\n  // Root appends reserved135 to the generic domain list before this hook.\n  // Each dedicated evolution toggles FK before its own BEGIN on this connection.\n  installContext136(db);\n  installWorkspaceExecution137(db);')
# Narrow restart compatibility: evolved object hashes are validated against the
# exact137 source recipe/transaction receipt; all unaffected original definitions
# are still compared. No broad inspector bypass or successful unchanged replay.
new=one(new,'  return objectNames.flatMap((name) => {', '  const evolved = files.every(file => ["100_mcp_credentials.sql","101_runtime_isolation.sql","102_runtime_browser_sessions.sql","109_runtime_workspace_supersession.sql","127_runtime_original_provisions.sql"].includes(file)) ? verifiedWorkspace137Definitions(db) : undefined;\n  return objectNames.flatMap((name) => {\n    if (evolved && Object.hasOwn(evolved,name)) return []; // exact new owned DDL already verified')
new=one(new,'if (!(MCP_CREDENTIAL_COLUMNS as readonly string[]).includes(column)) missing.push', 'if (!(MCP_CREDENTIAL_COLUMNS as readonly string[]).includes(column) && !(column === "schema_version" && verifiedWorkspace137Definitions(db))) missing.push')
new=one(new,'w.project_id = c.project_id\n        AND w.owner_user_id', 'w.project_id IS c.project_id\n        AND w.owner_user_id')
new=one(new,'r.project_id <> c.project_id OR r.owner_user_id', 'r.project_id IS NOT c.project_id OR r.owner_user_id')
diff(rel,old,new)
rel='services/ingenium-api/lib/runtime-manager-contract.ts';old=read(rel)
v2type="""
/** Explicit v2 request. No synthetic Project/name and no v1 decoder widening. */
export type WorkspaceRuntimeProvisionRequestV2=Omit<RuntimeProvisionRequest,'projectId'|'projectName'|'originalRequestId'>&{schemaVersion:2;scopeKind:'workspace';projectId:null;originalRequestId:string};
"""
a=old.index('function assertProvisionRequest');z=old.index('function assertManagerConfig',a)
validator=old[a:z].replace('assertProvisionRequest','assertWorkspaceProvisionRequestV2').replace('RuntimeProvisionRequest','WorkspaceRuntimeProvisionRequestV2')
validator=one(validator,'input.runtimeId, input.organizationId, input.projectId, input.ownerUserId','input.originalRequestId, input.runtimeId, input.organizationId, input.ownerUserId')
validator=one(validator,'  if (![input.originalRequestId', '  if (input.schemaVersion!==2||input.scopeKind!=="workspace"||input.projectId!==null)throw new Error("Invalid workspace execution version");\n  if (![input.originalRequestId')
validator=one(validator,'  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(input.projectName)\n    || input.workspaceId', '  if (Object.hasOwn(input,"projectName") || input.workspaceId')
a=old.index('export function runtimeLabels')
builder=old[a:].replace('RuntimeProvisionRequest','WorkspaceRuntimeProvisionRequestV2').replace('runtimeLabels','workspaceRuntimeLabelsV2').replace('buildRuntimeContainerSpec','buildWorkspaceRuntimeContainerSpecV2').replace('assertProvisionRequest','assertWorkspaceProvisionRequestV2')
builder=one(builder,'    "com.ingenium.runtime.project": input.projectId,','    "com.ingenium.runtime.scope": "workspace",')
builder=one(builder,'      `INGENIUM_PROJECT=${input.projectName}`,\n      `INGENIUM_PROJECT_ID=${input.projectId}`,','      "INGENIUM_EXECUTION_SCOPE=workspace",')
diff(rel,old,old+'\n'+v2type+validator+builder)
(P/'canonical.patch').write_text(''.join(patch))
extra=['packages/ingenium-core/data/migrations/'+n for n in ['063_immutable_context_conversations.sql','065_context_rag_ingestion.sql','066_context_checkpoint_governance.sql','069_context_conversation_snapshot_imports.sql','094_authentication.sql','098_content_tenancy.sql','099_automation_tenancy.sql','100_mcp_credentials.sql','101_runtime_isolation.sql','102_runtime_browser_sessions.sql','109_runtime_workspace_supersession.sql','127_runtime_original_provisions.sql']]
extra+=['packages/ingenium-core/lib/tools/context-conversations.ts','packages/ingenium-core/lib/tools/context-snapshot-import.ts','packages/ingenium-core/lib/schema.ts','services/ingenium-api/lib/projects-v2/request-execution.ts','services/ingenium-api/lib/projects-v2/request-execution-owner.mjs','services/ingenium-api/lib/request-identity.ts','services/ingenium-api/lib/routes/context.ts']
for path in extra:read(path)
(P/'source-pins.json').write_text(json.dumps({'coordinatorSource':str(CORE),'files':pins},separators=(',',':'))+'\n')
print(json.dumps({'patchBytes':(P/'canonical.patch').stat().st_size,'sourcePins':len(pins)}))
