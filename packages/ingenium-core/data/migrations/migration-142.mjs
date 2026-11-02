import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installKubernetesWorkspace141,verifiedKubernetesWorkspaceDefinitions} from './migration-141.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),marker='veyra_evolution_142',changed='runtime138_successor_admission';
const tail=()=>readFileSync(new URL('./142_failed_workspace_provision.sql',import.meta.url),'utf8');
const recipe=()=>sha(Buffer.concat([readFileSync(new URL(import.meta.url)),Buffer.from(tail())]));
const fail=code=>{throw Error('WORKSPACE_142_'+code);};
const evolved=sql=>{
 const old="(old.schema_version<>2 OR old.state NOT IN ('STOPPED','FAILED','REVOKED') OR NOT EXISTS(\n  SELECT 1 FROM workspace_execution_retirements proof WHERE proof.runtime_id=old.id AND proof.workspace_id=old.workspace_id)))";
 const next="(old.schema_version<>2 OR old.state NOT IN ('STOPPED','FAILED','REVOKED') OR (NOT EXISTS(\n  SELECT 1 FROM workspace_execution_retirements proof WHERE proof.runtime_id=old.id AND proof.workspace_id=old.workspace_id) AND NOT EXISTS(\n  SELECT 1 FROM workspace_failed_provision_retirements failure WHERE failure.runtime_id=old.id AND failure.workspace_id=old.workspace_id AND old.state='FAILED' AND old.backend_container_id IS NULL AND NOT EXISTS(SELECT 1 FROM runtime_original_provisions original WHERE original.runtime_id=old.id)))))";
 if(sql.split(old).length!==2)fail('PREDECESSOR_TRIGGER_LAYOUT');return sql.replace(old,next);
};
function row(db,name){return db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql;}
function predecessorProjection(db,oldSql){
 // One explicit metadata inverse, after verifying BOTH exact schemas. No data,
 // query result, receipt or writer is substituted for the preceding verifier.
 return new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{
   const statement=target.prepare(sql);
   if(sql==='SELECT sql FROM sqlite_schema WHERE name=?')return new Proxy(statement,{get(s,k){
    if(k==='get')return(...args)=>args.length===1&&args[0]===changed?{sql:oldSql}:s.get(...args);
    const value=Reflect.get(s,k,s);return typeof value==='function'?value.bind(s):value;
   }});
   return statement;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
export function verifiedFailedWorkspaceProvision142(db){
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(marker))return undefined;
 const rows=db.prepare('SELECT version,recipe_sha256,predecessor_sql,schema_json FROM '+marker).all();
 if(rows.length!==1||rows[0].version!==142||rows[0].recipe_sha256!==recipe())fail('RECIPE_RECEIPT');
 const r=rows[0],owned=JSON.parse(r.schema_json),prior=JSON.parse(db.prepare('SELECT schema_json FROM veyra_evolution_138 WHERE version=138').get()?.schema_json??'null');
 if(!prior||sha(r.predecessor_sql)!==prior[changed]||row(db,changed)!==evolved(r.predecessor_sql))fail('PREDECESSOR_INVERSE');
 if(!owned||typeof owned!=='object'||Array.isArray(owned)||Object.keys(owned).sort().join('|')!==[changed,'workspace_failed_provision_retirements','runtime142_failed_retirement_admission','runtime142_failed_retirement_no_update','runtime142_failed_retirement_no_delete','runtime142_failed_retirement_no_replace'].sort().join('|'))fail('OBJECT_RECEIPT');
 for(const[name,digest]of Object.entries(owned))if(typeof row(db,name)!=='string'||sha(row(db,name))!==digest)fail('SCHEMA_DRIFT');
 const previous=verifiedKubernetesWorkspaceDefinitions(predecessorProjection(db,r.predecessor_sql));
 if(!previous)fail('PREDECESSOR_REQUIRED');
 return {...previous,...owned};
}
export function installFailedWorkspaceProvision142(db){
 if(verifiedFailedWorkspaceProvision142(db))return {installed:false,version:142};
 installKubernetesWorkspace141(db);const prior=verifiedKubernetesWorkspaceDefinitions(db);
 const old=row(db,changed);if(typeof old!=='string'||prior?.[changed]!==sha(old))fail('PREDECESSOR_REQUIRED');
 if(db.inTransaction||db.pragma('foreign_keys',{simple:true})!==1||db.pragma('foreign_key_check').length)fail('CONNECTION_OR_FOREIGN_KEYS');
 const objects=()=>db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
 const data=()=>sha(JSON.stringify(db.prepare('SELECT * FROM runtime_instances ORDER BY id').all()));
 const before=objects(),beforeData=data();
 db.transaction(()=>{
  if(JSON.stringify(objects())!==JSON.stringify(before)||data()!==beforeData)fail('PREIMAGE_CHANGED');
  db.exec(tail());db.exec('DROP TRIGGER '+changed);db.exec(evolved(old));
  const after=objects(),owned={};
  for(const x of before)if(x.name!==changed&&!after.some(y=>y.type===x.type&&y.name===x.name&&y.sql===x.sql))fail('UNEXPECTED_SCHEMA_CHANGE');
  for(const x of after)if(x.name===changed||!before.some(y=>y.type===x.type&&y.name===x.name))owned[x.name]=sha(x.sql);
  if(data()!==beforeData||db.pragma('foreign_key_check').length||db.pragma('quick_check',{simple:true})!=='ok')fail('DATA_OR_INTEGRITY');
  db.exec('CREATE TABLE '+marker+'(version INTEGER PRIMARY KEY,recipe_sha256 TEXT NOT NULL,predecessor_sql TEXT NOT NULL,schema_json TEXT NOT NULL) STRICT');
  db.prepare('INSERT INTO '+marker+' VALUES(?,?,?,?)').run(142,recipe(),old,JSON.stringify(owned));
  db.exec("CREATE TRIGGER "+marker+"_no_update BEFORE UPDATE ON "+marker+" BEGIN SELECT RAISE(ABORT,'evolution receipt immutable'); END; CREATE TRIGGER "+marker+"_no_delete BEFORE DELETE ON "+marker+" BEGIN SELECT RAISE(ABORT,'evolution receipt immutable'); END;");
 }).immediate();
 // Predecessor evolutions require the original quiesced connection; verify
 // after the atomic DDL transaction, before bootstrap can return a handle.
 verifiedFailedWorkspaceProvision142(db);
 return {installed:true,version:142};
}