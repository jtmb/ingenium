/** Closed deployment capsule contract; pure validation, no database or Core imports. */
import path from 'node:path';import {ORIGINAL_STATIC_PINS} from './original-static-pins.mjs';import {createHash} from 'node:crypto';
export const MANIFEST='/usr/local/share/veyra/legacy-startup-capsule.manifest.json';
export const ORIGINAL_IMAGE='docker.io/jtmb92/ingenium@sha256:792f18c3bece144028df8b79772b4928e73c4ff2e1ef625f20ce85ca796d9e8b';
export const ORIGINAL_DB_SHA='a19aaaec4326e8fa93fe98ac95f2b31f50b261a2394bbd6ef75be36ca553df35';
export const ORIGINAL_PATHS_SHA='1fa55b2a224e6bd6959ed291a76fe3547511a299c017c9b52947c272b5ac97ae';
export const ENVIRONMENT={HOME:'/home/ingenium-api',NODE_ENV:'production',INGENIUM_DEPLOYMENT_MODE:'compatibility',INGENIUM_HOME:'/app/.ingenium',INGENIUM_CORE_DB_PATH:'/app/.ingenium/data',INGENIUM_GLOBAL_CONFIG_PATH:'/home/ingenium-opencode/.config/opencode',INGENIUM_BACKUPS_DIR:'/app/.ingenium/backups',OPENCODE_DB_PATH:'/home/ingenium-opencode/.local/share/opencode/opencode.db'};
export const PATH_ENV='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const sha=v=>createHash('sha256').update(v).digest('hex');
export function need(v,code){if(!v)throw Error(code);}
const absolute=p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p;
function validateRuntimeOwner(owner){need(absolute(owner?.root)&&absolute(owner?.dbModule)&&typeof owner.dbSha256==='string'&&/^[a-f0-9]{64}$/.test(owner.dbSha256)&&Array.isArray(owner.files)&&owner.files.length>0,'PINNED_RUNTIME_CLOSURE_REQUIRED');const names=new Set();for(const file of owner.files){need(typeof file.path==='string'&&!path.isAbsolute(file.path)&&file.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!names.has(file.path)&&/^[a-f0-9]{64}$/.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0,'INVALID_RUNTIME_CLOSURE_ENTRY');names.add(file.path);}need(owner.files.some(f=>path.resolve(owner.root,f.path)===owner.dbModule&&f.sha256===owner.dbSha256),'DB_MODULE_NOT_IN_PINNED_CLOSURE');}
export function validateManifest(m){
 need(m?.protocol==='original-pre133-startup-capsule-v1','CAPSULE_MANIFEST_REQUIRED');
 need(m.priorImage===ORIGINAL_IMAGE&&m.old?.dbSha256===ORIGINAL_DB_SHA&&m.old?.pathsSha256===ORIGINAL_PATHS_SHA,'ACTUAL_DEPLOYED_CODE_REQUIRED_NOT_GOLDEN');
 need(m.launch?.cwd==='/app/services/ingenium-api'&&m.launch?.uid===1101&&Number.isInteger(m.launch?.gid)&&m.launch.gid>=1&&Array.isArray(m.launch.groups)&&m.launch.groups.every(n=>Number.isInteger(n)&&n>=1),'VERIFIED_ORIGINAL_PROCESS_IDENTITY_REQUIRED');
 need(stable(m.launch.environment)===stable(ENVIRONMENT),'RAW_ORIGINAL_LAUNCH_ENVIRONMENT_REQUIRED');
 need(m.database?.path==='/app/.ingenium/data'&&m.database?.device==='64769'&&m.database?.inode==='524504','ORIGINAL_DATABASE_FILE_REQUIRED');
 need(absolute(m.journalRoot)&&m.journalRoot.startsWith('/app/.ingenium/')&&m.journalRoot!=='/app/.ingenium/data','APPROVED_DURABLE_JOURNAL_ROOT_REQUIRED');
 need(typeof m.custodyEvidence?.reference==='string'&&/^[a-f0-9]{64}$/.test(m.custodyEvidence.sha256??''),'ROOT_ORIGINAL_CUSTODY_EVIDENCE_REFERENCE_REQUIRED');
 // This retains an actual Root custody receipt reference; it does not itself prove/drain writers.
 validateRuntimeOwner(m.old);
 for(const pin of ORIGINAL_STATIC_PINS)need(m.old.files.some(f=>f.path.endsWith(pin.suffix)&&f.bytes===pin.bytes&&f.sha256===pin.sha256),'EXACT_ORIGINAL_JS_SQL_CLOSURE_REQUIRED');
 need(absolute(m.old.pathsModule)&&path.resolve(path.dirname(m.old.pathsModule),'..','db.js')===m.old.dbModule&&m.old.files.some(f=>path.resolve(m.old.root,f.path)===m.old.pathsModule&&f.sha256===ORIGINAL_PATHS_SHA),'ONE_ORIGINAL_DB_SINGLETON_REQUIRED');
 need(m.old.runtime?.nodeVersion==='v22.23.4'&&m.old.runtime?.modulesAbi==='127'&&m.old.runtime?.platform==='linux'&&m.old.runtime?.arch==='x64','ACTUAL_ORIGINAL_NODE_ABI_REQUIRED');
 for(const [suffix,pin]of [['/better-sqlite3/package.json','58e81504576abccfacbfd08dc9432dc3a00d0fc0454685cb7a76aaf976cf25a9'],['/zod/package.json','c2d190d9ee4e0bdb60332aaa2130a6a98d65ddb903fe1d29248b15de57832c45'],['/better-sqlite3/build/Release/better_sqlite3.node','d7d9272b12d11c1dc2bb787741b1b7c4037d336155f316ace3420410c28fda37']])need(m.old.files.some(f=>f.path.endsWith(suffix)&&f.sha256===pin),'ACTUAL_ORIGINAL_PACKAGE_NATIVE_PIN_REQUIRED');
 need(absolute(m.captureHelper?.modulePath)&&m.captureHelper.sha256==='d989679b769cabd8789581a1207d05dd96d1e82f011215695db1387ff40140aa','EXISTING_ORIGINAL_V1_CAPTURE_HELPER_REQUIRED');
 need(absolute(m.current?.dbModule)&&/^[a-f0-9]{64}$/.test(m.current.dbSha256??'')&&absolute(m.current.apiModule)&&/^[a-f0-9]{64}$/.test(m.current.apiSha256??''),'CURRENT_API_ENTRYPOINT_REQUIRED');return m;
}
/** No database probing to guess restart generation. Only the root-owned immutable journal decides. */
export function nextAction(state){
 if(state.complete||state.started){need((!state.complete||state.started)&&state.closed&&state.observed&&(!state.compatibilityStarted||state.compatibilityObserved&&state.compatibilityClosed),'BROKEN_CAPSULE_JOURNAL');return 'current-only';}
 if(state.compatibilityStarted){need(state.closed&&state.observed,'BROKEN_CAPSULE_JOURNAL');if(state.compatibilityObserved){need(state.compatibilityClosed,'COMPATIBILITY_CLOSE_UNCONFIRMED_MANUAL_RECONCILIATION');return 'resume-compatibility-captured';}need(!state.compatibilityClosed,'BROKEN_CAPSULE_JOURNAL');return 'compatibility-only';}
 need(!state.compatibilityObserved&&!state.compatibilityClosed,'BROKEN_CAPSULE_JOURNAL');if(state.observed){need(state.closed,'OLD_CLOSE_UNCONFIRMED_MANUAL_RECONCILIATION');return 'resume-captured';}need(!state.closed,'BROKEN_CAPSULE_JOURNAL');return 'capture-original';
}
export function validateCompatibility(owner){
 validateRuntimeOwner(owner);
 need(owner?.role==='prospective-compatibility132'&&owner.dbSha256==='6445fafce515995828ed69006efc55f54f1e5ff5f108b1d4e8b00a52596aa876'&&typeof owner.dbSha256==='string'&&/^[a-f0-9]{64}$/.test(owner.dbSha256)&&absolute(owner.root)&&absolute(owner.dbModule)&&absolute(owner.pathsModule)&&owner.pathsSha256===ORIGINAL_PATHS_SHA&&path.resolve(path.dirname(owner.pathsModule),'..','db.js')===owner.dbModule&&Array.isArray(owner.files),'QUALIFIED_PROSPECTIVE132_OWNER_REQUIRED');
 need(owner.files.some(f=>f.path.endsWith('/db.js')&&f.sha256===owner.dbSha256)&&owner.files.some(f=>f.path.endsWith('/paths.js')&&f.sha256===owner.pathsSha256),'COMPATIBILITY_OWNER_PINS_REQUIRED');
 const resources=owner.files.filter(f=>/\/data\/migrations\/[^/]+\.sql$/.test('/'+f.path));need(resources.some(f=>/\/122_/.test(f.path))&&resources.some(f=>/\/132_/.test(f.path))&&resources.every(f=>Number(f.path.split('/').at(-1).slice(0,3))<=132),'COMPATIBILITY_REQUIRES122_132_NO133');
 need(owner.runtime?.nodeVersion==='v22.23.4'&&owner.runtime?.modulesAbi==='127'&&owner.runtime?.platform==='linux'&&owner.runtime?.arch==='x64','COMPATIBILITY_NODE_ABI_REQUIRED');
 need(absolute(owner.qualification?.reference)&&/^[a-f0-9]{64}$/.test(owner.qualification.sha256??''),'ACTUAL132_SOURCE_QUALIFICATION_RECEIPT_REQUIRED');need(absolute(owner.runtimeQualification?.reference)&&/^[a-f0-9]{64}$/.test(owner.runtimeQualification.sha256??''),'EXACT_PRODUCTION_RUNTIME_QUALIFICATION_REQUIRED');return owner;
}

export function disposition({projects,claims,identity,files,config}){
 const cohort=projects.filter(p=>!p.is_global),active=cohort.filter(p=>!p.archived_at),archived=cohort.filter(p=>p.archived_at);
 if(identity.state!=='present')return 'blocked-pre122-identity-compatibility-release-required';
 if(cohort.length===0&&claims.length===0)return 'captured-projectless-installation-location';
 if(active.length===0)return 'captured-archived-only-installation-location';
 return archived.length?'captured-archived-cohort-still-fenced':'captured-active-cohort';
}
export const allowsCurrent=d=>['captured-projectless-installation-location','captured-archived-only-installation-location','captured-active-cohort','captured-archived-cohort-still-fenced'].includes(d);

export function assertCompatibilityContinuity(before,after){need(before.ownerStage==='original121'&&after.ownerStage==='prospective132','PROSPECTIVE_OWNER_CHAIN_REQUIRED');for(const key of ['originalDatabase','projects','claims','config','files','globalOwnerObservations'])need(stable(before[key])===stable(after[key]),'COMPATIBILITY_PREIMAGE_CHANGED_'+key.toUpperCase());need(before.launch.cwd===after.launch.cwd&&stable(before.launch.rawAllowedEnvironment)===stable(after.launch.rawAllowedEnvironment)&&stable(before.paths)===stable(after.paths),'COMPATIBILITY_RAW_LOCATOR_CHANGED');need(after.identity.state==='present','GENUINE122_INSTALLATION_NOT_CREATED');}

export function validateCompatibilitySourceReceipt(result){need(result.passed===true&&result.actualOriginal121AndCompat132Code===true&&result.actualOriginalSqlBytes===true&&result.actualCaptureHelper===true&&result.actualClosedConnections===true&&Array.isArray(result.stages)&&result.stages.length>=6&&result.stages.every(s=>s.closed&&s.passed),'ACTUAL132_SOURCE_QUALIFICATION_REQUIRED');for(const pin of ['9c05fd0324bcbe3d53d142ebed2ff37bbdfe7d13a553d3154b8651d0b1bd8fb9','f38050fcce3b93cbe5ce390f792159d5ae2cbe5555cd4ce6b05b84877c807ec1','01a715509159ebe6d3c02a08d77463b2f81931f1ca3dfab2cc11a41fab9a8171','d989679b769cabd8789581a1207d05dd96d1e82f011215695db1387ff40140aa'])need(result.sourcePins?.some(p=>p.sha256===pin),'COMPATIBILITY_SOURCE_RECIPE_PIN_CHANGED');need(result.stages.filter(s=>s.stage==='132').every(s=>s.originalTablesPreserved>=175),'COMPATIBILITY_SOURCE_PRESERVATION_NOT_ESTABLISHED');need(['active-archived','empty','archived-only'].every(name=>result.stages.some(c=>c.stage==='132'&&c.scenario===name&&c.passed&&c.closed&&/^[a-f0-9]{64}$/.test(c.installationCaptureHash??'')&&c.distinctGlobalOwnerObserved===true&&c.selectorProvenance?.entryPoint==='installation-location-observation'&&c.selectorProvenance.activeProjectTransitionAuthorized===false)),'QUALIFIED_INSTALLATION_CAPTURE_EVIDENCE_REQUIRED');for(const name of ['empty','archived-only'])need(result.stages.some(c=>c.stage==='132'&&c.scenario===name&&c.captureHash===null&&c.expectedCaptureRefusal==='ACTUAL_LEGACY_PROJECT_REQUIRED'),'ORIGINAL_ACTIVE_ENTRY_REFUSAL_MUST_SURVIVE');}
