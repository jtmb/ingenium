/** Original pre133 owner capture. Caller initializes that exact owner first; no current-Core imports. */
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function file(p,max=4*1024*1024){for(let q=p;;q=path.dirname(q)){const s=fs.lstatSync(q,{throwIfNoEntry:false});if(s&&(s.isSymbolicLink()||s.isFile()&&s.nlink!==1))throw Error('UNOWNED_CAPTURE_PATH');if(q===path.dirname(q))break;}const s=fs.lstatSync(p,{throwIfNoEntry:false});if(!s)return {path:p,state:'absent'};if(!s.isFile()||s.size>max)throw Error('CAPTURE_LIMIT');const fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;try{const a=fs.fstatSync(fd);bytes=fs.readFileSync(fd);const b=fs.fstatSync(fd);if(a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs||bytes.length!==a.size)throw Error('CAPTURE_CHANGED');return {path:p,state:'file',sha256:sha(bytes),size:bytes.length,device:String(a.dev),inode:String(a.ino)};}finally{bytes?.fill(0);fs.closeSync(fd);}}
async function captureOwner({modulePath,expectedModuleSha256,dbModulePath,expectedDbModuleSha256}){
 if(!path.isAbsolute(modulePath)||!path.isAbsolute(dbModulePath)||file(modulePath).sha256!==expectedModuleSha256||file(dbModulePath).sha256!==expectedDbModuleSha256)throw Error('LEGACY_OWNER_SOURCE_PIN_MISMATCH');
 const legacy=await import(pathToFileURL(modulePath).href),owner=await import(pathToFileURL(dbModulePath).href);
 if(typeof legacy.getPluginsBase!=='function'||typeof legacy.getConfigPath!=='function'||'getPluginConfigPath'in legacy||typeof owner.getDb!=='function')throw Error('ACTUAL_PRE133_OWNER_REQUIRED');
 const db=owner.getDb();if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customize_commands'").get())throw Error('CAPTURE_BEFORE133_ONLY');
 const projects=db.prepare('SELECT id,path,is_global,archived_at,created_at FROM projects ORDER BY id').all();return {db,legacy,projects};
}
async function capture(options,installationEntry){
 const {db,legacy,projects}=await captureOwner(options);const active=projects.filter(p=>!p.is_global&&!p.archived_at),archived=projects.filter(p=>!p.is_global&&p.archived_at),globals=projects.filter(p=>p.is_global);
 let selector,provenance;
 if(!installationEntry){const target=projects.find(p=>p.id===options.projectId&&!p.is_global&&!p.archived_at);if(!target)throw Error('ACTUAL_LEGACY_PROJECT_REQUIRED');selector=options.projectId;}
 else{
  const actual=active[0]??archived[0];selector=actual?.id;
  // Global and non-global owners are distinct in exact1fa55. A global row is provenance,
  // never substituted into the legacy non-global locator or equated with that namespace.
  provenance={entryPoint:'installation-location-observation',selectorKind:actual?(actual.archived_at?'archived-non-global':'active-non-global'):(globals.length?'undefined-non-global-default-with-global-provenance':'undefined-non-global-default-zero-roster'),selectorId:selector??null,observedGlobalProjectIds:globals.map(p=>p.id),activeProjectTransitionAuthorized:false};
 }
 const installation=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();if(!installation?.instance_id)throw Error('ACTUAL_INSTALLATION_REQUIRED');
 const pluginBase=legacy.getPluginsBase(selector),configPath=legacy.getConfigPath(selector);if(!path.isAbsolute(pluginBase)||!path.isAbsolute(configPath))throw Error('ACTUAL_LEGACY_PATH_REQUIRED');
 const cohort=installationEntry?projects.filter(p=>!p.is_global):active;
 for(const p of cohort)if(legacy.getPluginsBase(p.id)!==pluginBase||legacy.getConfigPath(p.id)!==configPath)throw Error('LEGACY_COHORT_LOCATORS_DIFFER');
 const rows=db.prepare('SELECT p.*,q.path AS registered_project_path,q.archived_at AS project_archived_at FROM plugins p JOIN projects q ON q.id=p.project_id WHERE q.is_global=0 ORDER BY p.project_id,p.id').all();
 const claims=rows.map(r=>({id:r.id,projectId:r.project_id,name:r.name,filePath:r.file_path,enabled:Boolean(r.enabled),revision:r.revision??0,archived:r.archived_at??null,projectArchived:r.project_archived_at,projectPath:r.registered_project_path,sourceSha256:typeof r.source_content==='string'?sha(Buffer.from(r.source_content,'utf8')):null}));
 const capture={protocol:'plugin-legacy-owner-capture-v1',capturedAt:new Date().toISOString(),installationId:installation.instance_id,dbPath:db.name,source:{modulePath:options.modulePath,moduleSha256:options.expectedModuleSha256,dbModulePath:options.dbModulePath,dbModuleSha256:options.expectedDbModuleSha256},launch:{cwd:process.cwd(),dbEnvironment:process.env.INGENIUM_CORE_DB_PATH??null},projects,claims,claimsSha256:sha(stable(claims)),paths:{pluginBase,configPath},config:file(configPath),helperWritesPerformed:0,requiresAlreadyInitializedPre133Core:true};
 if(installationEntry){capture.selectorProvenance=provenance;capture.globalOwnerObservations=globals.map(p=>({projectId:p.id,archivedAt:p.archived_at,pluginBase:legacy.getPluginsBase(p.id),configPath:legacy.getConfigPath(p.id)}));capture.nonGlobalCohortProjectIds=cohort.map(p=>p.id);}
 return {capture,sha256:sha(stable(capture))};
}
/** Existing active-project API retains its original selector requirement, refusals and payload. */
export async function captureLegacyPluginPaths(options){return capture(options,false);}
/** Installation observation only: never creates a project, restores archives or grants transition authority. */
export async function captureLegacyInstallationPaths(options){return capture(options,true);}