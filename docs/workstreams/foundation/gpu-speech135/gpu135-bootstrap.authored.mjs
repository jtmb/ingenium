// AUTHORED UNRUN. Requires Root to install exact135 sources in its owned APP.
// Extracts actual methods; no global success callback or copied guard body.
import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export async function runActual135Control({app,Database,api,base,sql,fault}){
 const ts=createRequire(app+'/package.json')('typescript');
 const path=app+'/packages/ingenium-core/lib/db.ts',source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 function take(name){const hits=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isTypeAliasDeclaration(n))?n.name?.text===name:ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&n.declarationList.declarations[0].name.getText(ast)===name);assert.equal(hits.length,1,'Actual135 declaration missing/ambiguous: '+name);return source.slice(hits[0].getStart(ast),hits[0].end);}
 const names=['GPU135_TABLES','GPU135_TRIGGERS','GPU135_INDEXES','GPU135_REFERENCE_PREREQUISITE','expectedAuthenticationSchema','normalizeSchemaSql','compareMigrationDefinitions','assertGpu135Presence','assertGpu135Schema','fenceGpu135AfterOriginalStartup'];
 const guards=names.map(take).join('\n').replaceAll('import.meta.dirname ?? __dirname','ROOT_CORE_LIB_DIR');
 const make=new Function('Database','readFileSync','resolve','createHash','ROOT_CORE_LIB_DIR','validateGpuControlData','validateGpuDescriptorData','validateGpuSpeechData','gpuDataDigest',stripTypeScriptTypes(guards,{mode:'strip'})+'\nreturn {guard:assertGpu135Schema,fence:fenceGpu135AfterOriginalStartup};');
 const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
 const runtime=make(Database,readFileSync,resolve,createHash,app+'/packages/ingenium-core/lib',api.validateGpuControlData,api.validateGpuDescriptorData,api.validateGpuSpeechData,digest);
 function prepare(){
  const f=base();try{f.db.exec(fault==='wrong-FK'?sql.replace('actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT','actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE'):sql);
  const c=f.running(),o=f.child(c);f.insert('veyra_voice_gpu_operations',o);
  function corrupt(work){
   const triggers=f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name GLOB 'gpu135_*'").all();
   f.db.pragma('foreign_keys=OFF');f.db.pragma('ignore_check_constraints=ON');
   try{for(const t of triggers)f.db.exec('DROP TRIGGER "'+t.name+'"');work();for(const t of triggers)f.db.exec(t.sql);}finally{f.db.pragma('ignore_check_constraints=OFF');f.db.pragma('foreign_keys=ON');}
  }
  switch(fault){
   case null:break;
   case 'missing-table':f.db.exec('DROP TABLE veyra_voice_gpu_operations');break;
   case 'missing-index':f.db.exec('DROP INDEX gpu135_one_live_control');break;
   case 'missing-trigger':f.db.exec('DROP TRIGGER gpu135_legacy_insert_collision');break;
   case 'weakened-trigger-body':f.db.exec("DROP TRIGGER gpu135_operation_no_delete; CREATE TRIGGER gpu135_operation_no_delete BEFORE DELETE ON veyra_voice_gpu_operations WHEN 0 BEGIN SELECT RAISE(ABORT,'weakened');END;");break;
   case 'missing-marker':corrupt(()=>f.db.exec('DELETE FROM veyra_voice_gpu_schema'));break;
   case 'wrong-marker':corrupt(()=>f.db.exec('UPDATE veyra_voice_gpu_schema SET version=2'));break;
   case 'extra-owned-trigger':f.db.exec('CREATE TRIGGER gpu135_extra AFTER INSERT ON veyra_voice_gpu_schema BEGIN SELECT 1;END;');break;
   case 'wrong-FK':break;
   case 'CHECK-row-corruption':corrupt(()=>f.db.exec("UPDATE veyra_voice_gpu_controls SET phase='running',worker_boot_id=NULL"));break;
   case 'orphan-GPU-child':corrupt(()=>f.db.prepare('UPDATE veyra_voice_gpu_operations SET control_id=?').run(randomUUID()));break;
   case 'restored-provider-mismatch':corrupt(()=>{const d=JSON.parse(c.descriptor_json);d.providerDigest='f'.repeat(64);f.db.prepare('UPDATE veyra_voice_gpu_operations SET descriptor_json=?').run(canonical(d));});break;
   case 'CPU-GPU-UUID-collision':corrupt(()=>f.db.prepare('UPDATE veyra_voice_gpu_operations SET operation_id=?').run(f.cpuId));break;
   case 'CPU-GPU-request-collision':corrupt(()=>f.db.prepare('UPDATE veyra_voice_gpu_operations SET request_id=?').run(f.cpu.request_id));break;
   case 'two-live-voice-slots':corrupt(()=>f.db.prepare('UPDATE veyra_voice_gpu_controls SET instance_id=?').run(f.cpu.instance_id));break;
   case 'retired-control-live-child':corrupt(()=>f.db.exec("UPDATE veyra_voice_gpu_controls SET phase='retired',fenced=1,fence_reason='CORRUPTED_RESTORE',resource_retired=1,cleanup_json='{}'"));break;
   default:throw Error('Unknown authored fault '+fault);
  }
  return f;
  }catch(error){if(f.db.open)f.db.close();throw error;}
 }
 const {extractActualBootstrap}=await import(pathToFileURL(app+'/packages/ingenium-core/tests/actual-bootstrap-source.mjs'));
 const b=extractActualBootstrap(app);
 const code=[b.db,b.custody,b.writeCount,b.getDb,b.close,b.reset].join('\n').replace(/^export /gm,'');
 const opened=[];
 function MemoryOriginal(){const f=prepare();opened.push(f);return f.db;}
 const owner=new Function('Database','resolveCoreDbPath','dirname','mkdirSync','createHash','runMigrations','process',stripTypeScriptTypes(code,{mode:'strip'})+'\nreturn {getDb,closeDbForMaintenance};')(MemoryOriginal,()=>'/synthetic-no-disk',()=>'/synthetic-no-directory',()=>{},createHash,db=>{runtime.guard(db);runtime.fence(db);},{env:{},getuid:()=>1000});
 try{
  if(fault){
   assert.throws(()=>owner.getDb(),undefined,'first current actual guard must refuse');
   assert.equal(opened.length,1);assert.equal(opened[0].db.open,false,'exact first original positively closed');
   assert.throws(()=>owner.getDb(),undefined,'fresh retry of same corrupted fixture shape must refuse again');
   assert.equal(opened.length,2);assert.equal(opened[1].db.open,false,'exact second original positively closed');
  }else{
   const db=owner.getDb(),f=opened[0];
   const c=db.prepare('SELECT * FROM veyra_voice_gpu_controls').get(),o=db.prepare('SELECT * FROM veyra_voice_gpu_operations').get();
   assert.equal(c.phase,'unknown');assert.equal(o.phase,'unknown');assert.equal(c.fenced,1);assert.equal(o.fenced,1);
   assert.equal(c.resource_retired,0);assert.equal(o.resource_retired,0);assert.equal(c.cleanup_json,null);assert.equal(o.cleanup_json,null);assert.equal(o.dispatch_id,null);assert.equal(o.outcome,null);
   assert.equal(db.prepare('SELECT original_json FROM veyra_voice_operations WHERE operation_id=?').get(f.cpuId).original_json,f.cpu.original_json);
   owner.closeDbForMaintenance();assert.equal(db.open,false);
  }
 }finally{for(const f of opened)if(f.db.open)f.db.close();}
}
function canonical(v){return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
