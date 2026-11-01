import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installEvolution,replaceExactly} from './migration-rebuild.mjs';
import {installWorkspaceExecution137,workspace137Spec} from './migration-137.mjs';
import {hasVerifiedContext136} from './migration-136.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const marker=db=>db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_138'").get();
export function workspace138Spec(){
 const tailSql=readFileSync(new URL('./138_workspace_successor_executions.sql',import.meta.url),'utf8');
 return {version:138,tables:[{name:'runtime_instances',evolve:sql=>replaceExactly(sql,'workspace_id TEXT NOT NULL UNIQUE','workspace_id TEXT NOT NULL')}],tailSql,
 recipeSha256:sha(Buffer.concat([readFileSync(new URL(import.meta.url)),readFileSync(new URL('./migration-rebuild.mjs',import.meta.url)),Buffer.from(tailSql)]))};
}
function predecessor(db){
 if(!hasVerifiedContext136(db))throw Error('VERIFIED_CONTEXT_136_REQUIRED');
 const rows=db.prepare('SELECT version,recipe_sha256,schema_json FROM veyra_evolution_137').all(),spec=workspace137Spec();
 if(rows.length!==1||rows[0].version!==137||rows[0].recipe_sha256!==spec.recipeSha256)throw Error('WORKSPACE_137_PREDECESSOR_RECEIPT_MISMATCH');
 const receipt=JSON.parse(rows[0].schema_json);
 if(!Object.hasOwn(receipt,'runtime_instances'))throw Error('WORKSPACE_137_RUNTIME_RECEIPT_REQUIRED');
 for(const [name,digest]of Object.entries(receipt)){
  const row=db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name);if(typeof row?.sql!=='string')throw Error('WORKSPACE_137_PREDECESSOR_OBJECT_MISSING');
  const sql=name==='runtime_instances'?replaceExactly(row.sql,'workspace_id TEXT NOT NULL,','workspace_id TEXT NOT NULL UNIQUE,'):row.sql;
  if(sha(sql)!==digest)throw Error('WORKSPACE_137_PREDECESSOR_SCHEMA_DRIFT');
 }
 return receipt;
}
export function verifiedWorkspaceExecutionDefinitions(db){
 if(!marker(db))return undefined;
 const receipt=predecessor(db);installEvolution(db,workspace138Spec());
 return {...receipt,...JSON.parse(db.prepare('SELECT schema_json FROM veyra_evolution_138 WHERE version=138').get().schema_json)};
}
export function installWorkspaceSuccessors138(db){
 if(marker(db)){verifiedWorkspaceExecutionDefinitions(db);return {installed:false,version:138};}
 installWorkspaceExecution137(db);
 const result=installEvolution(db,workspace138Spec());verifiedWorkspaceExecutionDefinitions(db);return result;
}
