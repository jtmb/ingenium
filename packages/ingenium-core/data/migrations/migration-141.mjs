import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installEvolution,replaceExactly,addColumnsAndConstraints} from './migration-rebuild.mjs';
import {hasVerifiedContext136} from './migration-136.mjs';
import {workspace137Spec} from './migration-137.mjs';
import {workspace138Spec,installWorkspaceSuccessors138,verifiedWorkspaceExecutionDefinitions} from './migration-138.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const marker=db=>db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_141'").get();
const dockerHost="CHECK(length(host_id)=78 AND substr(host_id,1,14)='docker-daemon:')";
const backendHost="CHECK((length(host_id)=78 AND substr(host_id,1,14)='docker-daemon:') OR (length(host_id)=80 AND substr(host_id,1,16)='kubernetes-node:'))";
const backendColumn="\n backend_kind TEXT NOT NULL DEFAULT 'docker' CHECK(backend_kind IN ('docker','kubernetes'))";
const identityColumn="\n backend_identity_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(backend_identity_json AS BLOB))<=8192 AND json_valid(backend_identity_json) AND json_type(backend_identity_json)='object')";
const backendConstraint="\n CHECK(((backend_kind='docker' AND substr(host_id,1,14)='docker-daemon:' AND backend_identity_json='{}') OR (backend_kind='kubernetes' AND schema_version=2 AND project_id IS NULL AND substr(host_id,1,16)='kubernetes-node:' AND json_extract(backend_identity_json,'$.schemaVersion')=1 AND json_type(backend_identity_json,'$.podUid')='text' AND json_type(backend_identity_json,'$.namespaceUid')='text' AND json_extract(backend_identity_json,'$.containerId')=parent_container_id AND json_extract(backend_identity_json,'$.enforcedPodPidsLimit') BETWEEN 16 AND min(pids_limit,process_limit))) IS TRUE)";

/** Reverse only this exact evolution, so the predecessor's raw DDL receipts
 * remain authoritative. No whitespace normalization or ancestor recipe edit. */
function predecessorOriginal(sql){
 let original=replaceExactly(sql,','+backendColumn,'');
 original=replaceExactly(original,','+identityColumn,'');
 original=replaceExactly(original,','+backendConstraint,'');
 return replaceExactly(original,backendHost,dockerHost);
}
export function workspace141Spec(){
 const tailSql=readFileSync(new URL('./141_kubernetes_workspace_runtime.sql',import.meta.url),'utf8');
 return {version:141,tables:[{name:'runtime_original_provisions',evolve(sql){
  const next=addColumnsAndConstraints(replaceExactly(sql,dockerHost,backendHost),[backendColumn,identityColumn,backendConstraint].join(','));
  if(predecessorOriginal(next)!==sql)throw Error('KUBERNETES_141_DDL_INVERSE_MISMATCH');
  return next;
 }}],tailSql,recipeSha256:sha(Buffer.concat([readFileSync(new URL(import.meta.url)),readFileSync(new URL('./migration-rebuild.mjs',import.meta.url)),Buffer.from(tailSql)]))};
}
function receipt(db,version,spec){
 const rows=db.prepare(`SELECT version,recipe_sha256,schema_json FROM veyra_evolution_${version}`).all();
 if(rows.length!==1||rows[0].version!==version||rows[0].recipe_sha256!==spec.recipeSha256)throw Error(`KUBERNETES_141_PREDECESSOR_${version}_RECEIPT_MISMATCH`);
 const value=JSON.parse(rows[0].schema_json);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('KUBERNETES_141_PREDECESSOR_RECEIPT_INVALID');
 return value;
}
/** Read-only guard usable inside the original STARTING transaction. Startup
 * additionally verifies the unchanged 136/137/138 predecessor chain below. */
export function requireKubernetesWorkspace141(db){
 const row=db.prepare('SELECT version,recipe_sha256,schema_json FROM veyra_evolution_141 WHERE version=141').get();
 const count=db.prepare('SELECT count(*) AS count FROM veyra_evolution_141').get();
 if(!row||count?.count!==1||row.version!==141||row.recipe_sha256!==workspace141Spec().recipeSha256)throw Error('KUBERNETES_141_RECEIPT_MISMATCH');
 const owned=JSON.parse(row.schema_json);
 if(!owned||typeof owned!=='object'||Array.isArray(owned)||!Object.hasOwn(owned,'runtime_original_provisions')||!Object.hasOwn(owned,'kubernetes141_original_backend_binding'))throw Error('KUBERNETES_141_OBJECT_RECEIPT_REQUIRED');
 for(const [name,digest] of Object.entries(owned)){
  const actual=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name);
  if(typeof actual?.sql!=='string'||sha(actual.sql)!==digest)throw Error('KUBERNETES_141_SCHEMA_DRIFT');
 }
 return owned;
}
export function verifiedKubernetesWorkspaceDefinitions(db){
 if(!marker(db))return undefined;
 if(!hasVerifiedContext136(db))throw Error('VERIFIED_CONTEXT_136_REQUIRED');
 const original=receipt(db,137,workspace137Spec()),successors=receipt(db,138,workspace138Spec());
 if(!Object.hasOwn(original,'runtime_original_provisions')||!Object.hasOwn(original,'runtime_instances')||!Object.hasOwn(successors,'runtime_instances'))throw Error('KUBERNETES_141_PREDECESSOR_OBJECT_RECEIPT_REQUIRED');
 const current=requireKubernetesWorkspace141(db);
 for(const [name,digest] of Object.entries(original)){
  const row=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name);
  if(typeof row?.sql!=='string')throw Error('KUBERNETES_141_PREDECESSOR_OBJECT_MISSING');
  const sql=name==='runtime_original_provisions'?predecessorOriginal(row.sql):name==='runtime_instances'?replaceExactly(row.sql,'workspace_id TEXT NOT NULL,','workspace_id TEXT NOT NULL UNIQUE,'):row.sql;
  if(sha(sql)!==digest)throw Error('KUBERNETES_141_PREDECESSOR_SCHEMA_DRIFT');
 }
 for(const [name,digest] of Object.entries(successors)){
  const row=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name);
  if(typeof row?.sql!=='string'||sha(row.sql)!==digest)throw Error('KUBERNETES_141_SUCCESSOR_SCHEMA_DRIFT');
 }
 return {...original,...successors,...current};
}
export function installKubernetesWorkspace141(db){
 if(marker(db)){verifiedKubernetesWorkspaceDefinitions(db);return {installed:false,version:141};}
 installWorkspaceSuccessors138(db);
 if(!verifiedWorkspaceExecutionDefinitions(db))throw Error('VERIFIED_WORKSPACE_138_REQUIRED');
 const result=installEvolution(db,workspace141Spec());
 verifiedKubernetesWorkspaceDefinitions(db);
 return result;
}
