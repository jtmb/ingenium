import {test,expect} from 'vitest';
import {getDb,resetDbForTest} from '../lib/db.js';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

test('actual pre131 compiled Core upgrades, reopens cumulatively and refuses missing131 guard',async()=>{
 const parent=process.env.INGENIUM_TEST_CANDIDATE_MIGRATION_OUTPUT;
 if(!parent||!isAbsolute(parent)||realpathSync(parent)!==parent)throw Error('Owned candidate migration fixture root required');
 const root=mkdtempSync(join(parent,'migration-')),dbPath=join(root,'data/core.db');
 mkdirSync(join(root,'data'),{mode:0o700});mkdirSync(join(root,'home'),{mode:0o700});
 writeFileSync(join(root,'.task-owner.json'),JSON.stringify({owner:'01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',synthetic:true,scope:'Actual same-Core131 migration/reopen/drift storage only; no manager/auth/material authority',regeneration:'candidate131-migration.test.ts with pinned pre131 compiled Core and current source/locks'}),{flag:'wx',mode:0o600});
 const keys=['INGENIUM_CORE_DB_PATH','INGENIUM_HOME','INGENIUM_BACKUPS_DIR','OPENCODE_DB_PATH'] as const;
 const beforeEnv=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{INGENIUM_CORE_DB_PATH:dbPath,INGENIUM_HOME:join(root,'home'),INGENIUM_BACKUPS_DIR:join(root,'backups'),OPENCODE_DB_PATH:join(root,'opencode.db')});
 let old:any,passed=false;const facts:Record<string,unknown>={synthetic:true,productionApproval:false};
 try{
  const compiled=fileURLToPath(new URL('../dist/lib/db.js',import.meta.url));
  const legacy=await import(pathToFileURL(compiled).href);
  facts.legacyCompiledDbSha256=createHash('sha256').update(readFileSync(compiled)).digest('hex');
  old=legacy.getDb(dbPath);
  expect(old.prepare("SELECT 1 FROM sqlite_master WHERE name='managed_candidate_lifecycle_schema'").get()).toBeUndefined();
  const protectedTables=['users','auth_sessions','job_run_mcp_credentials','native_hosted_governance_grants'];
  const fingerprint=(db:any)=>Object.fromEntries(protectedTables.map(name=>[name,createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all().map((row:unknown)=>JSON.stringify(row)).sort())).digest('hex')]));
  const oldRows=fingerprint(old);old.close();old=null;resetDbForTest();
  let upgraded=getDb(dbPath);
  expect(upgraded.prepare('SELECT schema_version FROM managed_candidate_lifecycle_schema WHERE singleton=1').get()).toEqual({schema_version:1});
  expect(upgraded.prepare('SELECT count(*) AS n FROM job_run_candidate_lifecycle').get()).toEqual({n:0});
  expect(fingerprint(upgraded)).toEqual(oldRows);
  expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(upgraded.prepare('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);
  facts.protectedTableHashes=oldRows;facts.upgradePassed=true;
  resetDbForTest();upgraded=getDb(dbPath);
  expect(upgraded.prepare('SELECT schema_version FROM managed_candidate_lifecycle_schema WHERE singleton=1').get()).toEqual({schema_version:1});
  facts.cumulativeReopenPassed=true;
  // Only this closed synthetic fixture is deliberately corrupted. Real startup
  // must refuse it rather than silently recreating a missing retention guard.
  upgraded.exec('DROP TRIGGER candidate131_extension_no_replace');resetDbForTest();
  expect(()=>getDb(dbPath)).toThrow(/Candidate waiting lifecycle schema drift/);
  facts.partialGuardDriftRefused=true;passed=true;
 }finally{
  if(old?.open)old.close();resetDbForTest();
  for(const key of keys){if(beforeEnv[key]===undefined)delete process.env[key];else process.env[key]=beforeEnv[key];}
  writeFileSync(join(root,'result.json'),JSON.stringify({...facts,passed,closed:true},null,2)+'\n',{flag:'wx',mode:0o600});
 }
},30000);
