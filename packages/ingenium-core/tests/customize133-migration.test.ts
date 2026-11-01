import {test,expect}from'vitest';
import{getDb,resetDbForTest}from'../lib/db.js';
import{mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync}from'node:fs';
import{join,isAbsolute,relative}from'node:path';
import{pathToFileURL,fileURLToPath}from'node:url';
import{createHash}from'node:crypto';
test('actual pre133 compiled Core upgrades to scoped catalog without changing existing plugin/source/config bytes',async()=>{
 const parent=process.env.INGENIUM_TEST_CUSTOMIZE_MIGRATION_OUTPUT;if(!parent||!isAbsolute(parent)||realpathSync(parent)!==parent)throw Error('Original owned fixture root required');
 const root=mkdtempSync(join(parent,'migration-')),dbPath=join(root,'data/core.db'),home=join(root,'home');mkdirSync(join(root,'data'),{mode:0o700});mkdirSync(home,{mode:0o700});
 writeFileSync(join(root,'.task-owner.json'),JSON.stringify({owner:'01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',synthetic:true,scope:'Actual sequential pre133compiled/source133 Core additive migration, notauth/Native/runtime acceptance',regeneration:'vitest actual customize133-migration.test.ts with pinned pre133compiled Core and source133'}),{flag:'wx',mode:0o600});
 const names=['INGENIUM_CORE_DB_PATH','INGENIUM_HOME','INGENIUM_BACKUPS_DIR','OPENCODE_DB_PATH']as const;const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));Object.assign(process.env,{INGENIUM_CORE_DB_PATH:dbPath,INGENIUM_HOME:home,INGENIUM_BACKUPS_DIR:join(root,'backups'),OPENCODE_DB_PATH:join(root,'opencode.db')});
 let original:any,passed=false;const facts:Record<string,unknown>={synthetic:true,scope:'Actual Core migration/row+file preservation only',productionApproval:false};
 try{
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));const oldDb=await import(pathToFileURL(join(dist,'lib/db.js')).href),projects=await import(pathToFileURL(join(dist,'lib/tools/projects.js')).href),plugins=await import(pathToFileURL(join(dist,'lib/tools/plugins.js')).href),paths=await import(pathToFileURL(join(dist,'lib/tools/paths.js')).href);
  original=oldDb.getDb(dbPath);expect(original.prepare("SELECT 1 FROM sqlite_master WHERE name='customize_commands'").get()).toBeUndefined();
  const project=projects.createProject('catalog-migration-fixture');
  for(const p of[paths.getPluginsBase(project.id),paths.getConfigPath(project.id)]){const rel=relative(root,p);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Fixture projection escaped original root');}
  writeFileSync(paths.getConfigPath(project.id),JSON.stringify({model:'fixture/no-execution',plugins:[],theme:'fixture'})+'\n',{flag:'wx',mode:0o600});
  const plugin=plugins.createPlugin(project.id,'migration-fixture','migration-fixture.ts','export default async()=>({});\n');
  const before=original.prepare('SELECT * FROM plugins WHERE id=?').get(plugin.id);const config=paths.getConfigPath(project.id),source=join(paths.getPluginsBase(project.id),plugin.file_path);const configBefore=readFileSync(config),sourceBefore=readFileSync(source);facts.compiledDbSha256=createHash('sha256').update(readFileSync(join(dist,'lib/db.js'))).digest('hex');
  const protectedTables=['users','auth_sessions','job_run_mcp_credentials','native_hosted_governance_grants'];
  const fingerprint=(db:any)=>Object.fromEntries(protectedTables.map(table=>[table,createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all().map((row:unknown)=>JSON.stringify(row)).sort())).digest('hex')]));
  const authBefore=fingerprint(original);
  original.close();expect(original.open).toBe(false);original=null;resetDbForTest();
  const upgraded=getDb(dbPath);const after=upgraded.prepare('SELECT * FROM plugins WHERE id=?').get(plugin.id)as Record<string,unknown>;expect(after.revision).toBe(0);expect(after.archived_at).toBeNull();const{revision,archived_at,...preserved}=after;expect(preserved).toEqual(before);
  expect(fingerprint(upgraded)).toEqual(authBefore);facts.protectedAuthAndGrantTableHashes=authBefore;
  expect(readFileSync(config).equals(configBefore)).toBe(true);expect(readFileSync(source).equals(sourceBefore)).toBe(true);
  for(const table of['customize_commands','customize_catalog_sources','customize_installations','customize_projection_preimages','customize_native_consents'])expect(upgraded.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({n:0});
  expect(upgraded.prepare('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  facts.legacyPluginRowPreserved=true;facts.configSha256=createHash('sha256').update(configBefore).digest('hex');facts.sourceSha256=createHash('sha256').update(sourceBefore).digest('hex');facts.legacyIdentityAndCredentialsRewritten=false;passed=true;
 }finally{if(original?.open)original.close();resetDbForTest();for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}writeFileSync(join(root,'result.json'),JSON.stringify({...facts,passed,closed:true},null,2)+'\n',{flag:'wx',mode:0o600});}
},30000);