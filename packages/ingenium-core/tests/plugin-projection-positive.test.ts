import {test,expect} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync,chmodSync,existsSync} from 'node:fs';
import {join,isAbsolute,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {getDb,resetDbForTest} from '../lib/db.js';
import * as auth from '../lib/tools/authentication.js';
import * as projects from '../lib/tools/projects.js';
import * as paths from '../lib/tools/paths.js';
import * as plugins from '../lib/tools/plugins.js';
import * as configs from '../lib/tools/configs.js';
import {createPositivePluginProjectionOwner,committedPluginProjectionPaths} from '../lib/tools/plugin-projection-transition.js';
import type {AuthorizationPrincipal} from '../lib/tools/authorization.js';

const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const envNames=['INGENIUM_CORE_DB_PATH','INGENIUM_HOME','INGENIUM_BACKUPS_DIR','OPENCODE_DB_PATH','INGENIUM_AUTH_ENCRYPTION_KEY_FILE','INGENIUM_PLUGIN_LEGACY_CAPTURE_FILE','INGENIUM_PLUGIN_LEGACY_CAPTURE_SHA256'] as const;
for(const scenario of ['legacy-present','legacy-absent','legacy-partial-repair','fresh'] as const){
 test(`actual Core positive namespace: ${scenario}`,async()=>{
  const parent=process.env.INGENIUM_TEST_CUSTOMIZE_MIGRATION_OUTPUT;
  if(!parent||!isAbsolute(parent)||realpathSync(parent)!==parent)throw Error('Original owned fixture root required');
  const root=mkdtempSync(join(parent,'positive-')),dbPath=join(root,'data/core.db'),home=join(root,'home');
  mkdirSync(join(root,'data'),{mode:0o700});mkdirSync(home,{mode:0o700});
  writeFileSync(join(root,'.task-owner.json'),JSON.stringify({owner:'01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',synthetic:true,scope:'Actual Core old-process capture, upgrade, authorization, namespace write/readback/reopen; no HTTP, Native, plugin execution or release acceptance',regeneration:'plugin-projection-positive.test.ts with retained pre133 compiled Core'}),{flag:'wx',mode:0o600});
  const old=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
  const key=join(root,'auth-key');writeFileSync(key,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
  Object.assign(process.env,{INGENIUM_CORE_DB_PATH:dbPath,INGENIUM_HOME:home,INGENIUM_BACKUPS_DIR:join(root,'backups'),OPENCODE_DB_PATH:join(root,'opencode.db'),INGENIUM_AUTH_ENCRYPTION_KEY_FILE:key});
  delete process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_FILE;delete process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_SHA256;
  let original:any,projectRoot:string|undefined,passed=false;const facts:Record<string,unknown>={scenario,synthetic:true,productionApproval:false};
  try{
   const dist=fileURLToPath(new URL('../dist/',import.meta.url));
   const load=(name:string)=>import(pathToFileURL(join(dist,`lib/${name}.js`)).href);
   const originalDb=await load('db'),originalProjects=await load('tools/projects'),originalPlugins=await load('tools/plugins'),originalPaths=await load('tools/paths'),originalBootstrap=await load('tools/bootstrap'),originalAuth=await load('tools/authentication');
   originalDb.resetDbForTest();original=originalDb.getDb(dbPath);expect(original.prepare("SELECT 1 FROM sqlite_master WHERE name='customize_commands'").get()).toBeUndefined();
   const password=randomBytes(24).toString('base64url');
   await originalBootstrap.claimBootstrap({email:'projection-owner@example.test',displayName:'Projection Owner',password});
   const signedIn=await originalAuth.authenticateLocal('projection-owner@example.test',password);
   const login=originalAuth.createSession(signedIn.id,new Date(),'isolated Core migration fixture',true);
   const oldProject=originalProjects.createProject('legacy-projection');projectRoot=oldProject.path;
   const legacyConfig=originalPaths.getConfigPath(oldProject.id),legacyBase=originalPaths.getPluginsBase(oldProject.id);
   for(const p of[legacyConfig,legacyBase,projectRoot!]){const r=relative(root,p);if(r.startsWith('..')||isAbsolute(r))throw Error('Fixture projection escaped declared leaf');}
   let plugin:any;
   if(scenario==='legacy-present'||scenario==='legacy-partial-repair'){
    plugin=originalPlugins.createPlugin(oldProject.id,'preserved-source','preserved-source.ts','export default async()=>({});\r\n');
    writeFileSync(legacyConfig,'\uFEFF{\r\n // retained comment\r\n "model":"fixture/no-execution", "opaque":{"keep":true},\r\n "plugins":[".opencode/plugins/preserved-source.ts"]\r\n}\r\n',{mode:0o600});
   }
   const legacyConfigBytes=existsSync(legacyConfig)?readFileSync(legacyConfig):null;
   const legacySource=plugin?join(legacyBase,plugin.file_path):null;
   const legacySourceBytes=legacySource?readFileSync(legacySource):null;
   const helperPath=fileURLToPath(new URL('../../../docs/workstreams/customize/native-hosted-transport/capture-legacy-plugin-owner.mjs',import.meta.url));
   const helper=await import(pathToFileURL(helperPath).href);
   const capture=await helper.captureLegacyPluginPaths({modulePath:join(dist,'lib/tools/paths.js'),expectedModuleSha256:sha(readFileSync(join(dist,'lib/tools/paths.js'))),dbModulePath:join(dist,'lib/db.js'),expectedDbModuleSha256:sha(readFileSync(join(dist,'lib/db.js'))),projectId:oldProject.id});
   const captureFile=join(root,'pre133-capture.json'),captureBytes=JSON.stringify(capture.capture)+'\n';
   writeFileSync(captureFile,captureBytes,{flag:'wx',mode:0o600});
   facts.pre133CaptureSha256=sha(captureBytes);facts.captureWhileActualOldCoreOpen=original.open===true;
   const tables=['users','auth_sessions','password_credentials','installation_admins','job_run_mcp_credentials','native_hosted_governance_grants'];
   const fingerprint=(db:any)=>Object.fromEntries(tables.map(t=>[t,sha(JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all().map((v:unknown)=>JSON.stringify(v)).sort()))]));
   const before=fingerprint(original);original.close();original=null;resetDbForTest();
   process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_FILE=captureFile;process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_SHA256=sha(captureBytes);
   const db=getDb(dbPath);expect(fingerprint(db)).toEqual(before);
   const session=auth.resolveSession(login.token);expect(session?.user_id).toBe(signedIn.id);expect(auth.verifySessionCsrf(session!,login.csrfToken)).toBe(true);expect(auth.hasRecentStepUp(session!)).toBe(true);
   const principal:AuthorizationPrincipal={type:'browser-user',id:session!.user_id,scopes:['user:*']};
   const owner=createPositivePluginProjectionOwner(principal);
   expect(()=>committedPluginProjectionPaths(oldProject.id)).toThrow();
   let target=oldProject;
   if(scenario==='fresh')target=projects.createProject('fresh-projection',false,oldProject.organization_id,principal);
   if(scenario==='legacy-partial-repair'){
    mkdirSync(join(projectRoot!,'.opencode/plugins'),{recursive:true,mode:0o700});chmodSync(projectRoot!,0o555);
   }
   const mode=scenario==='fresh'?'fresh-project':'captured-legacy-cohort',origin=scenario==='legacy-absent'||scenario==='fresh'?'new-empty':'reviewed-legacy-raw';
   const review=owner.review(mode,target.id,origin),request={operationId:randomUUID(),mode,projectId:target.id,configOrigin:origin,reviewSha256:review.reviewSha256};
   let receipt=owner.apply(request);
   if(scenario==='legacy-partial-repair'){
    expect(receipt.outcome).toBe('unknown');expect(readFileSync(join(projectRoot!,'.opencode/plugins',plugin.file_path))).toEqual(legacySourceBytes);expect(existsSync(join(projectRoot!,'opencode.json'))).toBe(false);
    expect(()=>committedPluginProjectionPaths(target.id)).toThrow();expect(configs.getConfig(target.id,'project')).toBeUndefined();
    const source=owner.inspect(request.operationId);expect(source.outcome).toBe('unknown');
    const row=db.prepare('SELECT payload_sha256 FROM customize_commands WHERE id=?').get(request.operationId) as {payload_sha256:string};
    chmodSync(projectRoot!,0o700);
    receipt=owner.reconcile({operationId:randomUUID(),sourceOperationId:request.operationId,sourcePayloadSha256:row.payload_sha256});
    facts.actualPartialSourceThenConfigPermissionFailure=true;
   }
   expect(receipt.outcome).toBe('succeeded');const committed=committedPluginProjectionPaths(target.id);
   expect(committed.pluginBase).toBe(join(target.path,'.opencode/plugins'));expect(committed.configPath).toBe(join(target.path,'opencode.json'));
   const config=configs.readConfigProjection(target.id,'project');expect(config?.content).toBe(configs.getConfig(target.id,'project')?.content);
   expect(config?.sha256).toBe(sha(readFileSync(committed.configPath)));
   if(legacySourceBytes&&scenario!=='fresh')expect(readFileSync(join(committed.pluginBase,plugin.file_path))).toEqual(legacySourceBytes);
   if(legacyConfigBytes){expect(readFileSync(legacyConfig)).toEqual(legacyConfigBytes);if(scenario!=='fresh'){expect(config?.content).toContain('// retained comment');expect(config?.content).toContain('"opaque":{"keep":true}');}}
   else expect(existsSync(legacyConfig)).toBe(false);
   if(legacySource)expect(readFileSync(legacySource)).toEqual(legacySourceBytes);
   expect(fingerprint(db)).toEqual(before);expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   const count=db.prepare('SELECT count(*) AS n FROM customize_commands').get();
   expect(()=>owner.apply({...request,reviewSha256:'0'.repeat(64)})).toThrow('ORIGINAL_REUSE_CONFLICT');
   expect(db.prepare('SELECT count(*) AS n FROM customize_commands').get()).toEqual(count);
   resetDbForTest();getDb(dbPath);expect(committedPluginProjectionPaths(target.id)).toEqual(committed);expect(configs.readConfigProjection(target.id,'project')?.sha256).toBe(config?.sha256);
   facts.protectedTableHashes=before;facts.committedNamespaceSha256=sha(JSON.stringify(committed));facts.legacyBytesRetained=true;facts.reopenPassed=true;passed=true;
  }finally{
   if(projectRoot)chmodSync(projectRoot,0o700);if(original?.open)original.close();resetDbForTest();
   for(const name of envNames){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
   writeFileSync(join(root,'result.json'),JSON.stringify({...facts,passed,closed:true},null,2)+'\n',{flag:'wx',mode:0o600});
  }
 },60000);
}
