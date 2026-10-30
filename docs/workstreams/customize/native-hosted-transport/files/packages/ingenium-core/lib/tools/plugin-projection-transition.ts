/** Actual Core-owned, explicit project projection initialization/legacy transition.
 * Legacy inputs remain byte-identical; immutable originals precede filesystem effects.
 * Core consumer readback does not assert managed-job/plugin execution acceptance.
 */
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,isAbsolute,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {getDb,execTransaction,checkpointAfterWrite} from '../db.js';
import {randomUUID} from 'node:crypto';
import {planProjectProjection,materializeProjectProjection,readbackProjectProjection,readProjectionBytes,byteSha,assertDistinctProjectionTargets,projectionPathsOverlap,type TargetPlan,type SourceInput} from './plugin-projection-materialize.js';
import * as configOwner from './configs.js';
import * as pluginOwner from './plugin-lifecycle.js';
import {assertNativeGovernanceLifecycleClear} from './node-native-lifecycle.js';
import * as authorization from './authorization.js';
import {payloadHash} from './hosted-governance.js';
import {parsePluginConfiguration} from './plugin-config-text.js';
type Row=Record<string,any>;
let namespacePreview:{projectId:string;paths:{pluginBase:string;configPath:string}}|undefined;
function withNamespacePreview<T>(projectId:string,plan:TargetPlan,work:()=>T):T{need(!namespacePreview,'EXCLUSIVE_NAMESPACE_OWNER_REQUIRED');namespacePreview={projectId,paths:{pluginBase:plan.pluginBase,configPath:plan.configPath}};try{const result=work();need(!result||typeof(result as {then?:unknown}).then!=='function','SYNCHRONOUS_NAMESPACE_OWNER_REQUIRED');return result;}finally{namespacePreview=undefined;}}
export const PLUGIN_NAMESPACE_PROTOCOL='plugin-projection-namespace-v1';
export class PluginProjectionTransitionRequired extends Error{constructor(public code='PLUGIN_PROJECTION_TRANSITION_REQUIRED'){super(code);}}
const need=(v:unknown,code='PLUGIN_PROJECTION_TRANSITION_REQUIRED'):void=>{if(!v)throw new PluginProjectionTransitionRequired(code);};
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function meta(v:ReturnType<typeof fstatSync>){return {device:String(v.dev),inode:String(v.ino),size:String(v.size),links:String(v.nlink),mode:String(v.mode),mtime:String(v.mtimeMs),ctime:String(v.ctimeMs)};}
function noLinks(path:string):void{for(let p=path;;p=dirname(p)){const v=lstatSync(p,{throwIfNoEntry:false});if(v)need(!v.isSymbolicLink()&&(!v.isFile()||v.nlink===1),'UNOWNED_PROJECTION_PATH');if(p===dirname(p))break;}}
function image(path:string,max:number):{metadata:Row;bytes:Buffer|null}{
 noLinks(path);const before=lstatSync(path,{throwIfNoEntry:false});if(!before)return {metadata:{path,state:'observed-absent'},bytes:null};
 need(before!.isFile()&&before!.nlink===1&&before!.size<=max,'UNREADABLE_PROJECTION_PREIMAGE');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{const first=fstatSync(fd);need(payloadHash(meta(first))===payloadHash(meta(before!)),'PROJECTION_PREIMAGE_CHANGED');const bytes=readFileSync(fd);const last=fstatSync(fd),after=lstatSync(path,{throwIfNoEntry:false});need(after&&bytes.length===first.size&&bytes.length<=max&&payloadHash(meta(first))===payloadHash(meta(last))&&payloadHash(meta(first))===payloadHash(meta(after!)),'PROJECTION_PREIMAGE_CHANGED');noLinks(path);return {metadata:{path,state:'observed-file',...meta(first),sha256:sha(bytes)},bytes};}finally{closeSync(fd);}
}
function directory(path:string):Row{noLinks(path);const v=lstatSync(path,{throwIfNoEntry:false});if(!v)return {path,state:'observed-absent'};need(v.isDirectory()&&!v.isSymbolicLink(),'UNOWNED_PROJECTION_DIRECTORY');return {path,state:'observed-directory',...meta(v)};}
function listFiles(base:string):Row[]{
 const result:Row[]=[];let total=0;const root=directory(base);if(root.state==='observed-absent')return result;
 function walk(path:string,depth:number){const beforeDirectory=directory(path);need(depth<=16&&result.length<=512,'PROJECTION_REVIEW_LIMIT');for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name);noLinks(file);need(!entry.isSymbolicLink(),'UNOWNED_PROJECTION_PATH');if(entry.isDirectory()){walk(file,depth+1);continue;}need(entry.isFile(),'UNOWNED_PROJECTION_PATH');const observed=image(file,2*1024*1024);try{total+=observed.bytes?.length??0;need(total<=16*1024*1024&&result.length<512,'PROJECTION_REVIEW_LIMIT');result.push(observed.metadata);}finally{observed.bytes?.fill(0);}}need(payloadHash(beforeDirectory)===payloadHash(directory(path)),'PROJECTION_DIRECTORY_CHANGED');}
 walk(base,0);return result;
}
function safeRelative(value:unknown):value is string{return typeof value==='string'&&/^[a-zA-Z0-9_\-./]+$/.test(value)&&value.split('/').every(p=>!!p&&p!=='.'&&p!=='..');}
function configObservation(path:string,owned:Set<string>):Row{
 const observed=image(path,4*1024*1024);try{
  if(!observed.bytes)return {...observed.metadata,ownedEntries:[],opaqueEntryHashes:[]};
  const text=observed.bytes.toString('utf8');need(Buffer.from(text,'utf8').equals(observed.bytes),'CONFIG_UTF8_NOT_LOSSLESS');const parsed=parsePluginConfiguration(text);
  need(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'INVALID_PLUGIN_CONFIG_PREIMAGE');
  for(const field of ['plugin','plugins'])need(parsed[field]===undefined||Array.isArray(parsed[field])&&parsed[field].every((v:unknown)=>typeof v==='string'),'AMBIGUOUS_PLUGIN_CONFIG_FIELD');
  const entries=[...(Array.isArray(parsed.plugins)?parsed.plugins:[]),...(Array.isArray(parsed.plugin)?parsed.plugin:[])] as string[];
  return {...observed.metadata,ownedEntries:entries.filter(e=>owned.has(e)),opaqueEntryHashes:entries.filter(e=>!owned.has(e)).map(sha),duplicateEntries:entries.length-new Set(entries).size};
 }finally{observed.bytes?.fill(0);}
}
function activeProject(projectId:string):Row{const row=getDb().prepare('SELECT * FROM projects WHERE id=? AND archived_at IS NULL').get(projectId) as Row|undefined;need(row,'ACTIVE_PROJECT_REQUIRED');return row!;}
/** Existing non-plugin config consumers retain their declared legacy owner until a transition exists.
 * A pending/failed transition never falls back. Plugin writers always require committed ownership. */
export function managedPluginConfigPathIfPresent(projectId:string):string|null{
 if(namespacePreview?.projectId===projectId)return namespacePreview.paths.configPath;
 const row=getDb().prepare("SELECT 1 FROM customize_commands WHERE project_id=? AND resource_key=? LIMIT 1").get(projectId,PLUGIN_NAMESPACE_PROTOCOL);
 return row?committedPluginProjectionPaths(projectId).configPath:null;
}
/** Return new paths only after the actual Core migration and runtime owners committed immutable witnesses.
 * Generic public Customize commands cannot create either private protocol.
 */
export function committedPluginProjectionPaths(projectId:string):{pluginBase:string;configPath:string}{
 if(namespacePreview?.projectId===projectId)return {...namespacePreview.paths};
 const project=activeProject(projectId);need(project.is_global===0&&typeof project.path==='string'&&isAbsolute(project.path),'REGISTERED_PROJECT_PATH_REQUIRED');
 const pluginBase=resolve(project.path,'.opencode','plugins'),configPath=resolve(project.path,'opencode.json'),root=directory(project.path);
 need(root.state==='observed-directory','REGISTERED_PROJECT_PATH_REQUIRED');
 const rows=getDb().prepare("SELECT c.*,p.snapshot_json,p.snapshot_sha256 FROM customize_commands c JOIN customize_projection_preimages p ON p.command_id=c.id WHERE c.project_id=? AND c.kind='plugin' AND c.resource_key=? AND c.result_json IS NOT NULL ORDER BY c.created_at,c.id").all(projectId,PLUGIN_NAMESPACE_PROTOCOL) as Row[];
 need(rows.length===1);
 const row=rows[0]!,original=JSON.parse(row.original_json),snapshot=JSON.parse(row.snapshot_json),receipt=JSON.parse(row.result_json);
 need(payloadHash(original)===row.payload_sha256&&payloadHash(snapshot)===row.snapshot_sha256&&original.protocol==='plugin-projection-transition-v1'&&original.projectId===projectId&&original.actorId===row.actor_id&&original.installationId===row.installation_id&&snapshot.protocol==='plugin-projection-transition-commit-v1'&&snapshot.projectId===projectId);
 need(receipt.outcome==='succeeded'&&receipt.operationId===row.id&&receipt.payloadSha256===row.payload_sha256&&receipt.value?.protocol===PLUGIN_NAMESPACE_PROTOCOL&&receipt.value?.witnessSha256===row.snapshot_sha256);
 need(snapshot.target?.pluginBase===pluginBase&&snapshot.target?.configPath===configPath&&snapshot.target?.projectPath===project.path&&snapshot.target?.rootDevice===root.device&&snapshot.target?.rootInode===root.inode,'PROJECT_PROJECTION_LOCATION_CHANGED');
 const installation=getDb().prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as Row|undefined;need(installation&&row.installation_id===installation!.instance_id,'PROJECTION_INSTALLATION_CHANGED');
 // A filesystem projection receipt alone cannot assert that a real runtime consumed the new location.
 need(typeof snapshot.legacyOwnerOriginalId==='string'&&typeof snapshot.runtimeOriginalId==='string','PLUGIN_LOCATION_OWNER_WITNESSES_REQUIRED');
 const legacy=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND installation_id=? AND resource_key IN (?,?)').get(snapshot.legacyOwnerOriginalId,row.installation_id,'plugin-projection-legacy-owner-v1','plugin-projection-fresh-project-owner-v1') as Row|undefined;
 need(legacy&&legacy!.result_json,'LEGACY_LOCATION_OWNER_WITNESS_REQUIRED');
 const legacyOriginal=JSON.parse(legacy!.original_json),legacyReceipt=JSON.parse(legacy!.result_json);
 need(payloadHash(legacyOriginal)===legacy!.payload_sha256&&((legacyOriginal.protocol==='plugin-projection-legacy-owner-v1'&&legacy!.resource_key===legacyOriginal.protocol&&Array.isArray(legacyOriginal.cohortProjectIds)&&legacyOriginal.cohortProjectIds.includes(projectId))||(legacyOriginal.protocol==='plugin-projection-fresh-project-owner-v1'&&legacy!.resource_key===legacyOriginal.protocol&&legacy!.project_id===projectId&&legacyOriginal.projectId===projectId&&typeof legacyOriginal.projectCreationOwnerOriginalId==='string'))&&legacyReceipt.operationId===legacy!.id&&legacyReceipt.payloadSha256===legacy!.payload_sha256&&legacyReceipt.outcome==='succeeded'&&typeof snapshot.legacyManifestSha256==='string'&&/^[a-f0-9]{64}$/.test(snapshot.legacyManifestSha256)&&legacyReceipt.value?.manifestSha256===snapshot.legacyManifestSha256,'LEGACY_LOCATION_OWNER_WITNESS_REQUIRED');
 if(legacyOriginal.protocol==='plugin-projection-fresh-project-owner-v1'){
  const creation=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND project_id=? AND installation_id=? AND resource_key=?').get(legacyOriginal.projectCreationOwnerOriginalId,projectId,row.installation_id,'project-create-original-v1') as Row|undefined;
  need(creation&&creation!.result_json,'GENUINE_PROJECT_CREATION_OWNER_REQUIRED');
  const createdOriginal=JSON.parse(creation!.original_json),createdReceipt=JSON.parse(creation!.result_json);
  need(payloadHash(createdOriginal)===creation!.payload_sha256&&createdOriginal.protocol==='project-create-original-v1'&&createdOriginal.projectId===projectId&&createdOriginal.projectPath===project.path&&createdReceipt.operationId===creation!.id&&createdReceipt.payloadSha256===creation!.payload_sha256&&createdReceipt.outcome==='succeeded','GENUINE_PROJECT_CREATION_OWNER_REQUIRED');
 }
 const runtime=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND project_id=? AND installation_id=? AND resource_key=?').get(snapshot.runtimeOriginalId,projectId,row.installation_id,'plugin-projection-runtime-readback-v1') as Row|undefined;
 need(runtime&&runtime!.result_json,'PLUGIN_RUNTIME_LOCATION_WITNESS_REQUIRED');
 const runtimeOriginal=JSON.parse(runtime!.original_json),runtimeReceipt=JSON.parse(runtime!.result_json);
 need(payloadHash(runtimeOriginal)===runtime!.payload_sha256&&runtimeOriginal.protocol==='plugin-projection-runtime-readback-v1'&&runtimeOriginal.projectId===projectId&&runtimeOriginal.namespaceOperationId===row.id&&runtimeOriginal.pluginBase===pluginBase&&runtimeOriginal.configPath===configPath&&runtimeReceipt.operationId===runtime!.id&&runtimeReceipt.payloadSha256===runtime!.payload_sha256&&runtimeReceipt.outcome==='succeeded','PLUGIN_RUNTIME_LOCATION_WITNESS_REQUIRED');
 return {pluginBase,configPath};
}
/** Private cohort observation only. No raw config/source bytes or credentials are returned. */
export function createPluginProjectionTransitionObserver(principal:authorization.AuthorizationPrincipal){
 need(principal.type==='browser-user'&&getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(principal.id),'ACTUAL_BROWSER_SESSION_REQUIRED');
 need(authorization.requireInstallationPermission(principal,'plugins','admin').allowed,'INSTALLATION_ADMIN_REQUIRED');
 return {observe(projectId:string):Row{
  need(principal.type==='browser-user'&&getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(principal.id),'ACTUAL_BROWSER_SESSION_REQUIRED');
  need(authorization.requireInstallationPermission(principal,'plugins','admin').allowed,'INSTALLATION_ADMIN_REQUIRED');
  need(authorization.requireProjectPermission(principal,projectId,'plugins','admin').allowed,'PROJECT_ADMIN_REQUIRED');const project=activeProject(projectId);need(project.is_global===0,'EXISTING_GLOBAL_OWNER_UNCHANGED');
  const currentExpression=resolve(process.env.INGENIUM_CORE_DB_PATH??'./data','..','..'),legacyBase=resolve(currentExpression,'.opencode','plugins'),legacyConfig=resolve(currentExpression,'opencode.json');
  const cohort=getDb().prepare('SELECT p.*,q.path AS registered_project_path,q.archived_at AS project_archived_at FROM plugins p JOIN projects q ON q.id=p.project_id WHERE q.is_global=0 ORDER BY p.project_id,p.id').all() as Row[];
  need(cohort.length<=1024,'PROJECTION_REVIEW_LIMIT');const blockers:string[]=[];
  const claims=cohort.map(r=>({id:r.id,projectId:r.project_id,name:r.name,filePath:r.file_path,revision:r.revision,enabled:Boolean(r.enabled),archived:r.archived_at,projectArchived:r.project_archived_at,projectPath:r.registered_project_path,sourceSha256:typeof r.source_content==='string'?sha(Buffer.from(r.source_content,'utf8')):null}));
  const safe=claims.filter(r=>safeRelative(r.filePath));if(safe.length!==claims.length)blockers.push('UNSAFE_OR_NONCANONICAL_LEGACY_PATH_REQUIRES_EXPLICIT_REVIEW');
  const owned=new Set(safe.map(r=>'.opencode/plugins/'+r.filePath)),files=listFiles(legacyBase),config=configObservation(legacyConfig,owned);
  const resolvedClaims=new Map<string,typeof claims>();for(const claim of safe){const path=resolve(legacyBase,claim.filePath);const rows=resolvedClaims.get(path)??[];rows.push(claim);resolvedClaims.set(path,rows);}
  for(const [file,rows]of resolvedClaims){if(rows.length!==1)blockers.push('SHARED_LEGACY_PATH_HAS_MULTIPLE_PROJECT_CLAIMS');for(const row of rows){const physical=files.find(v=>v.path===file),configured=config.ownedEntries.includes('.opencode/plugins/'+row.filePath);if(row.sourceSha256===null)blockers.push('DATABASE_SOURCE_MISSING_DO_NOT_IMPORT_OR_NORMALIZE');if(row.enabled&&!row.archived&&(!physical||physical.sha256!==row.sourceSha256||!configured))blockers.push('ACTIVE_DATABASE_AND_LEGACY_FILE_CONFIG_DISAGREE');if(!row.enabled&&physical)blockers.push('INACTIVE_ROW_STILL_HAS_SHARED_EXECUTABLE_PROJECTION');}}
  const registered=typeof project.path==='string'&&isAbsolute(project.path),targetBase=registered?resolve(project.path,'.opencode','plugins'):null,targetConfig=registered?resolve(project.path,'opencode.json'):null;
  if(!registered)blockers.push('REGISTERED_PROJECT_PATH_REQUIRED');
  const targetRoot=registered?directory(project.path):null,targetFiles=targetBase?listFiles(targetBase):[],targetConfiguration=targetConfig?configObservation(targetConfig,owned):null;
  if(targetRoot?.state!=='observed-directory')blockers.push('REGISTERED_PROJECT_ROOT_NOT_OBSERVED');
  if(targetBase===legacyBase||targetConfig===legacyConfig)blockers.push('LEGACY_AND_TARGET_NAMESPACES_ALIAS');
  if(targetFiles.length||targetConfiguration?.state==='observed-file')blockers.push('TARGET_PREIMAGES_REQUIRE_EXPLICIT_FOREIGN_OR_OWNED_CLASSIFICATION');
  const allProjects=getDb().prepare('SELECT id,path FROM projects WHERE is_global=0').all() as Row[];for(const p of allProjects){if(p.id!==projectId&&p.path===project.path)blockers.push('MULTIPLE_PROJECTS_SHARE_REGISTERED_TARGET_PATH');}
  // The present process expression is only a candidate; it cannot prove a historical launch cwd/env.
  blockers.push('HISTORICAL_LEGACY_LOCATOR_REQUIRES_ACTUAL_OWNER_WITNESS','REAL_RUNTIME_CONSUMER_READBACK_REQUIRED');
  const observed={protocol:'plugin-projection-transition-review-v1',projectId,projectPath:project.path,currentProcessLegacyCandidate:{cwd:process.cwd(),expressionInput:process.env.INGENIUM_CORE_DB_PATH??'./data',base:currentExpression,pluginBase:legacyBase,configPath:legacyConfig,historicalProvenance:'not_established'},cohort:claims,legacy:{directory:directory(legacyBase),files,config},target:{pluginBase:targetBase,configPath:targetConfig,root:targetRoot,files:targetFiles,config:targetConfiguration},blockers:[...new Set(blockers)].sort(),writesPerformed:0};
  return {review:observed,reviewSha256:payloadHash(observed),readyForCommit:false,originals:'remain_at_their_observed_locations',namespaceSwitch:'not_performed'};
 }};
}
const creationKey='project-create-original-v1';
function installationId():string{const r=getDb().prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get() as Row|undefined;need(r?.instance_id,'INSTALLATION_REQUIRED');return r!.instance_id;}
function currentActor(p:authorization.AuthorizationPrincipal,projects:string[],installationAdmin:boolean){
 need(p.type==='browser-user'&&getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(p.id),'ACTUAL_BROWSER_SESSION_REQUIRED');
 if(installationAdmin)need(authorization.requireInstallationPermission(p,'plugins','admin').allowed,'INSTALLATION_ADMIN_REQUIRED');
 for(const id of projects)need(authorization.requireProjectPermission(p,id,'plugins','admin').allowed,'PROJECT_ADMIN_REQUIRED');
}
function claim(original:Row,key:string,projectId:string|null,snapshot?:Row):string{
 need(getDb().inTransaction,'CORE_TRANSACTION_REQUIRED');const digest=payloadHash(original);
 getDb().prepare('INSERT INTO customize_commands(id,installation_id,actor_id,project_id,kind,resource_key,original_json,payload_sha256,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,NULL,?)').run(original.id,original.installationId,original.actorId,projectId,'plugin',key,JSON.stringify(original),digest,new Date().toISOString());
 if(snapshot)getDb().prepare('INSERT INTO customize_projection_preimages(command_id,snapshot_json,snapshot_sha256) VALUES(?,?,?)').run(original.id,JSON.stringify(snapshot),payloadHash(snapshot));return digest;
}
function finish(id:string,value:Row){const row=getDb().prepare('SELECT * FROM customize_commands WHERE id=?').get(id) as Row|undefined;need(row&&!row.result_json,'FIRST_RECEIPT_REQUIRED');const receipt={operationId:id,payloadSha256:row!.payload_sha256,outcome:'succeeded',value};need(getDb().prepare('UPDATE customize_commands SET result_json=? WHERE id=? AND result_json IS NULL').run(JSON.stringify(receipt),id).changes===1,'FIRST_RECEIPT_CONFLICT');return receipt;}
/** Called only from the genuine new-id branch of Core.projects.createProject, in that transaction. */
export function recordProjectCreationInCurrentTransaction(principal:authorization.AuthorizationPrincipal,projectId:string):void{
 need(getDb().inTransaction,'GENUINE_PROJECT_CREATION_TRANSACTION_REQUIRED');const p=activeProject(projectId);if(p.is_global)return;need((principal.type==='browser-user'||principal.type==='user-token')&&getDb().prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(principal.id),'ACTUAL_USER_CREATION_REQUIRED');need(authorization.requireOrganizationPermission(principal,p.organization_id,'projects','admin').allowed,'ACTUAL_PROJECT_CREATION_AUTHORITY_REQUIRED');
 need(!getDb().prepare('SELECT 1 FROM customize_commands WHERE project_id=? AND resource_key=?').get(projectId,creationKey),'PROJECT_CREATION_ALREADY_RECORDED');
 const paths={pluginBase:resolve(p.path,'.opencode','plugins'),configPath:resolve(p.path,'opencode.json')};
 const original={protocol:creationKey,id:randomUUID(),actorId:principal.id,installationId:installationId(),projectId,projectPath:p.path,projectCreatedAt:p.created_at,root:directory(p.path),targetFiles:listFiles(paths.pluginBase),targetConfig:configObservation(paths.configPath,new Set())};
 claim(original,creationKey,projectId);finish(original.id,{projectId,projectPath:p.path,creationRecordedAtOriginalOwner:true});
}
type TransitionMode='fresh-project'|'captured-legacy-cohort';
type ConfigOrigin='new-empty'|'database-project'|'reviewed-legacy-raw';
type TransitionPlan={protocol:string;mode:TransitionMode;installationId:string;projects:Row[];targets:TargetPlan[];claims:Row[];claimsSha256:string;legacy:Row|null;legacyManifestSha256:string;captureSha256:string|null;configOrigin:ConfigOrigin;creationOriginalId:string|null;configPreimages:{projectId:string;rowSha256:string}[]};
function commonClaims(projectIds?:string[]):Row[]{const rows=getDb().prepare('SELECT p.*,q.path AS registered_project_path,q.archived_at AS project_archived_at FROM plugins p JOIN projects q ON q.id=p.project_id WHERE q.is_global=0 ORDER BY p.project_id,p.id').all() as Row[];return rows.filter(r=>!projectIds||projectIds.includes(r.project_id)).map(r=>({id:r.id,projectId:r.project_id,name:r.name,filePath:r.file_path,enabled:Boolean(r.enabled),revision:r.revision??0,archived:r.archived_at??null,projectArchived:r.project_archived_at,projectPath:r.registered_project_path,sourceSha256:typeof r.source_content==='string'?byteSha(Buffer.from(r.source_content,'utf8')):null}));}
function loadLegacyCapture():{capture:Row;fileSha256:string}{
 const path=process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_FILE,expected=process.env.INGENIUM_PLUGIN_LEGACY_CAPTURE_SHA256;need(path&&isAbsolute(path!)&&expected&&/^[a-f0-9]{64}$/.test(expected!),'ACTUAL_PRE133_CAPTURE_REQUIRED');
 const bytes=readProjectionBytes(path!,4*1024*1024);try{need(bytes&&byteSha(bytes!)===expected,'LEGACY_CAPTURE_PIN_MISMATCH');const c=JSON.parse(bytes!.toString('utf8'));need(c.protocol==='plugin-legacy-owner-capture-v1'&&c.installationId===installationId()&&resolve(c.dbPath)===resolve(getDb().name)&&Array.isArray(c.projects)&&Array.isArray(c.claims)&&payloadHash(c.claims)===c.claimsSha256,'LEGACY_CAPTURE_OWNER_MISMATCH');return {capture:c,fileSha256:expected!};}finally{bytes?.fill(0);}
}
function legacyImage(capture:Row):Row{
 need(capture.paths&&isAbsolute(capture.paths.pluginBase)&&isAbsolute(capture.paths.configPath),'LEGACY_CAPTURE_LOCATOR_REQUIRED');
 const claims=capture.claims as Row[],refs=new Set(claims.map(r=>'.opencode/plugins/'+r.filePath));
 const observed={pluginBase:capture.paths.pluginBase,configPath:capture.paths.configPath,directory:directory(capture.paths.pluginBase),files:listFiles(capture.paths.pluginBase),config:configObservation(capture.paths.configPath,refs)};
 need(observed.config.state===capture.config.state.replace('absent','observed-absent').replace(/^file$/,'observed-file')&&(capture.config.state!=='file'||observed.config.sha256===capture.config.sha256),'LEGACY_CONFIG_CHANGED_SINCE_CAPTURE');
 return observed;
}
function sourceRows(ids:string[]):Row[]{return (getDb().prepare('SELECT * FROM plugins ORDER BY project_id,id').all() as Row[]).filter(r=>ids.includes(r.project_id));}
function buildTransitionPlan(p:authorization.AuthorizationPrincipal,mode:TransitionMode,projectId:string,origin:ConfigOrigin):TransitionPlan{
 let projects:Row[],legacy:Row|null=null,captureSha256:string|null=null,creationOriginalId:string|null=null;
 if(mode==='fresh-project'){
  projects=[activeProject(projectId)];currentActor(p,[projectId],false);need(origin==='new-empty','FRESH_PROJECT_REQUIRES_EMPTY_ORIGINAL');
  const row=getDb().prepare('SELECT * FROM customize_commands WHERE project_id=? AND resource_key=? AND result_json IS NOT NULL').get(projectId,creationKey) as Row|undefined;need(row,'GENUINE_PROJECT_CREATION_OWNER_REQUIRED');const original=JSON.parse(row!.original_json),receipt=JSON.parse(row!.result_json);
  need(payloadHash(original)===row!.payload_sha256&&original.protocol===creationKey&&original.projectId===projectId&&original.projectPath===projects[0]!.path&&original.projectCreatedAt===projects[0]!.created_at&&receipt.outcome==='succeeded'&&original.targetFiles.length===0&&original.targetConfig.state==='observed-absent','GENUINE_FRESH_PROJECT_REQUIRED');creationOriginalId=row!.id;
 }else{
  need(mode==='captured-legacy-cohort','INVALID_TRANSITION_MODE');const loaded=loadLegacyCapture(),capture=loaded.capture;captureSha256=loaded.fileSha256;
  const ids=(capture.projects as Row[]).filter(r=>!r.is_global).map(r=>r.id);need(ids.includes(projectId),'PROJECT_NOT_IN_ACTUAL_LEGACY_CAPTURE');
  projects=(getDb().prepare('SELECT * FROM projects WHERE is_global=0 ORDER BY id').all() as Row[]).filter(r=>ids.includes(r.id));currentActor(p,projects.map(r=>r.id),true);
  need(projects.length===ids.length&&projects.every(r=>!r.archived_at),'ARCHIVED_COHORT_REQUIRES_OWNED_RESTORE_REVIEW');
  need(projects.every(r=>{const old=(capture.projects as Row[]).find(c=>c.id===r.id);return old&&old.path===r.path&&old.created_at===r.created_at&&old.is_global===r.is_global&&old.archived_at===r.archived_at;}),'CAPTURED_PROJECT_ROSTER_CHANGED');
  need(payloadHash(commonClaims(ids))===capture.claimsSha256,'LEGACY_DATABASE_CLAIMS_CHANGED');legacy=legacyImage(capture);
  const physical=new Map<string,Row>();for(const r of capture.claims){need(safeRelative(r.filePath),'UNSAFE_LEGACY_PLUGIN_PATH');const path=resolve(legacy.pluginBase,r.filePath);need(!physical.has(path),'SHARED_LEGACY_PATH_COLLISION');physical.set(path,r);const image=legacy.files.find((f:Row)=>f.path===path);need(typeof r.sourceSha256==='string','AUTHORITATIVE_DATABASE_SOURCE_REQUIRED');if(r.enabled)need(image&&image.sha256===r.sourceSha256,'LEGACY_SOURCE_BYTES_DISAGREE');}
  for(const file of legacy.files)need(physical.has(file.path),'UNCLASSIFIED_LEGACY_EXECUTABLE_REQUIRES_REVIEW');
 }
 need(projects.length>0&&projects.every(r=>!r.is_global),'EXPLICIT_NON_GLOBAL_COHORT_REQUIRED');const ids=projects.map(r=>r.id),claims=commonClaims(ids),rows=sourceRows(ids);
 if(mode==='fresh-project')need(rows.length===0,'FRESH_PROJECT_ALREADY_HAS_LEGACY_CLAIMS');
 for(const id of ids){need(!getDb().prepare('SELECT 1 FROM customize_commands WHERE project_id=? AND resource_key=?').get(id,PLUGIN_NAMESPACE_PROTOCOL),'NAMESPACE_ALREADY_HAS_ORIGINAL');assertNativeGovernanceLifecycleClear(getDb(),id);need(!getDb().prepare("SELECT 1 FROM job_runs WHERE project_id=? AND status IN ('queued','running') LIMIT 1").get(id),'ACTIVE_PROJECT_JOBS_REQUIRE_ORIGINAL_DRAIN');}
 const configPreimages=projects.map(p=>({projectId:p.id,rowSha256:payloadHash(getDb().prepare("SELECT * FROM configs WHERE project_id=? AND type='project'").get(p.id)??null)}));
 const refs=claims.map(r=>'.opencode/plugins/'+r.filePath),targets=projects.map(project=>{
  const dbConfig=getDb().prepare("SELECT * FROM configs WHERE project_id=? AND type='project'").get(project.id) as Row|undefined;let seed:Buffer;
  if(origin==='new-empty'){need(!dbConfig&&(!legacy||legacy.config.state==='observed-absent'),'EXISTING_CONFIG_REQUIRES_EXPLICIT_ORIGIN');seed=Buffer.from('{}\n');}
  else if(origin==='database-project'){need(dbConfig&&typeof dbConfig!.content==='string','AUTHORITATIVE_PROJECT_CONFIG_REQUIRED');seed=Buffer.from(dbConfig!.content,'utf8');}
  else{need(origin==='reviewed-legacy-raw'&&legacy?.config.state==='observed-file'&&!dbConfig,'EXPLICIT_LEGACY_CONFIG_ORIGIN_REQUIRED');seed=readProjectionBytes(legacy!.configPath)!;need(seed&&byteSha(seed)===legacy!.config.sha256,'LEGACY_CONFIG_CHANGED');}
  try{const input:SourceInput[]=rows.filter(r=>r.project_id===project.id).map(r=>{need(typeof r.source_content==='string','AUTHORITATIVE_DATABASE_SOURCE_REQUIRED');return {id:r.id,filePath:r.file_path,source:r.source_content,enabled:Boolean(r.enabled)&&!r.archived_at};});return planProjectProjection(project.id,project.path,input,seed,refs);}finally{seed.fill(0);}
 });
 assertDistinctProjectionTargets(targets);
 const allProjects=getDb().prepare('SELECT id,path FROM projects WHERE is_global=0').all() as Row[];
 for(const other of allProjects.filter(r=>!ids.includes(r.id)))for(const t of targets){need(typeof other.path==='string'&&isAbsolute(other.path),'OTHER_PROJECT_PATH_REQUIRES_REVIEW');const path=resolve(other.path);need(!projectionPathsOverlap(path,t.projectPath),'COHORT_TARGET_NAMESPACE_COLLISION');}
 const manifest={captureSha256,legacy,claims};return {protocol:'plugin-projection-positive-plan-v1',mode,installationId:installationId(),projects:projects.map(r=>({id:r.id,path:r.path,createdAt:r.created_at})),targets,claims,claimsSha256:payloadHash(claims),legacy,legacyManifestSha256:payloadHash(manifest),captureSha256,configOrigin:origin,creationOriginalId,configPreimages};
}
function publicPlan(plan:TransitionPlan){return {protocol:plan.protocol,mode:plan.mode,projectIds:plan.projects.map(p=>p.id),configOrigin:plan.configOrigin,legacyCaptureSha256:plan.captureSha256,legacyManifestSha256:plan.legacyManifestSha256,targets:plan.targets.map(t=>({projectId:t.projectId,pluginBase:t.pluginBase,configPath:t.configPath,configSha256:t.configSha256,files:t.files})),originals:'retained_at_original_paths',runtimeReadback:'Core_resolver_config_and_projection_consumer_only',jobOrPluginExecutionAcceptance:false};}
function dependenciesCurrent(plan:TransitionPlan,configsApplied=false){for(const c of plan.configPreimages){const actual=getDb().prepare("SELECT * FROM configs WHERE project_id=? AND type='project'").get(c.projectId) as Row|undefined;if(configsApplied){const target=plan.targets.find(t=>t.projectId===c.projectId)!;need(actual&&byteSha(Buffer.from(actual.content,'utf8'))===target.configSha256,'CORE_CONFIG_ROW_READBACK_MISMATCH');}else need(payloadHash(actual??null)===c.rowSha256,'CORE_CONFIG_PREIMAGE_CHANGED');}need(plan.installationId===installationId()&&payloadHash(commonClaims(plan.projects.map(p=>p.id)))===plan.claimsSha256,'TRANSITION_SOURCE_OR_INSTALLATION_CHANGED');for(const p of plan.projects){const now=activeProject(p.id);need(now.path===p.path&&now.created_at===p.createdAt,'TRANSITION_PROJECT_CHANGED');}if(plan.captureSha256){const loaded=loadLegacyCapture();need(loaded.fileSha256===plan.captureSha256&&payloadHash(legacyImage(loaded.capture))===payloadHash(plan.legacy),'LEGACY_PREIMAGES_CHANGED');}}
function transitionFailure(e:unknown):string{return e instanceof Error&&/^[A-Z][A-Z0-9_]{1,120}$/.test(e.message)?e.message:'PRIVATE_OWNER_FAILURE_INSPECT_ORIGINAL';}
export function createPositivePluginProjectionOwner(principal:authorization.AuthorizationPrincipal,assertRequestCurrent:()=>void=()=>{}){
 /** Follow the immutable source plan; repair requests deliberately contain no projectId. */
 function inspectionPlan(row:Row):TransitionPlan{
  const original=JSON.parse(row.original_json);need(payloadHash(original)===row.payload_sha256&&original.actorId===principal.id&&original.installationId===installationId(),'ORIGINAL_HASH_CHANGED');let source=row;
  if(row.resource_key==='plugin-projection-explicit-repair-v1'){
   need(original.protocol===row.resource_key&&typeof original.request?.sourceOperationId==='string','WRONG_ORIGINAL_PROTOCOL');source=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND actor_id=? AND installation_id=?').get(original.request.sourceOperationId,principal.id,installationId()) as Row;need(source&&source.payload_sha256===original.request.sourcePayloadSha256,'SOURCE_ORIGINAL_OWNER_CHANGED');
  }
  need(source.resource_key==='plugin-projection-cohort-transition-v1','WRONG_ORIGINAL_PROTOCOL');const sourceOriginal=JSON.parse(source.original_json);need(sourceOriginal.protocol===source.resource_key&&sourceOriginal.actorId===principal.id&&sourceOriginal.installationId===installationId()&&payloadHash(sourceOriginal)===source.payload_sha256,'SOURCE_ORIGINAL_OWNER_CHANGED');
  const preimage=getDb().prepare('SELECT snapshot_json,snapshot_sha256 FROM customize_projection_preimages WHERE command_id=?').get(source.id) as Row|undefined;need(preimage,'ORIGINAL_PLAN_REQUIRED');const snapshot=JSON.parse(preimage!.snapshot_json);need(payloadHash(snapshot)===preimage!.snapshot_sha256&&snapshot.protocol==='plugin-projection-private-plan-v1','ORIGINAL_PLAN_CORRUPT');const plan=snapshot.plan as TransitionPlan;
  need(plan.protocol==='plugin-projection-positive-plan-v1'&&plan.installationId===installationId()&&['fresh-project','captured-legacy-cohort'].includes(plan.mode)&&Array.isArray(plan.projects)&&plan.projects.length>0&&plan.projects.every(p=>typeof p.id==='string')&&sourceOriginal.request?.mode===plan.mode&&plan.projects.some(p=>p.id===sourceOriginal.request?.projectId),'ORIGINAL_PLAN_CORRUPT');return plan;
 }
 function inspect(id:string){assertRequestCurrent();const row=getDb().prepare('SELECT * FROM customize_commands WHERE id=? AND actor_id=? AND installation_id=?').get(id,principal.id,installationId()) as Row|undefined;need(row,'ORIGINAL_NOT_FOUND');const plan=inspectionPlan(row!);currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');return {operationId:id,payloadSha256:row!.payload_sha256,...(row!.result_json?JSON.parse(row!.result_json):{outcome:'unknown',code:'TRANSITION_ORIGINAL_REQUIRES_RECONCILIATION'})};}

 function execute(plan:TransitionPlan,sourceId:string,namespaceRows:Row[],repair:boolean,repairId?:string){
  assertRequestCurrent();dependenciesCurrent(plan);currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');
  const sources=new Map(sourceRows(plan.projects.map(p=>p.id)).map(r=>[r.id,r.source_content] as [string,string]));
  return execTransaction(()=>{
   assertRequestCurrent();dependenciesCurrent(plan);currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');
   for(const project of plan.projects){assertNativeGovernanceLifecycleClear(getDb(),project.id,namespaceRows.map(r=>r.id));need(!getDb().prepare("SELECT 1 FROM job_runs WHERE project_id=? AND status IN ('queued','running') LIMIT 1").get(project.id),'ACTIVE_PROJECT_JOBS_REQUIRE_ORIGINAL_DRAIN');}
   for(const target of plan.targets){assertRequestCurrent();const namespace=namespaceRows.find(r=>r.projectId===target.projectId)!;
    materializeProjectProjection(target,sources,repair?'explicit-repair':'first');
    withNamespacePreview(target.projectId,target,()=>{
     configOwner.saveConfigInCurrentTransaction(target.projectId,'project',Buffer.from(target.configBase64,'base64').toString('utf8'));
     const consumed=configOwner.readConfigProjection(target.projectId,'project');need(consumed&&consumed.path===target.configPath&&consumed.sha256===target.configSha256,'ACTUAL_CORE_CONFIG_CONSUMER_READBACK_REQUIRED');
     for(const row of sourceRows([target.projectId]))pluginOwner.verifyProjection(row as pluginOwner.PluginRecord);
     const observed=readbackProjectProjection(target);
     const runtime={protocol:'plugin-projection-runtime-readback-v1',id:namespace.runtimeId,actorId:principal.id,installationId:plan.installationId,projectId:target.projectId,namespaceOperationId:namespace.id,pluginBase:target.pluginBase,configPath:target.configPath};
     claim(runtime,runtime.protocol,target.projectId);finish(runtime.id,{consumer:'actual_Core_paths_configs_and_plugin_projection',...observed,jobOrPluginExecutionAcceptance:false});
    });
    finish(namespace.id,{protocol:PLUGIN_NAMESPACE_PROTOCOL,witnessSha256:namespace.snapshotSha256,projectId:target.projectId,...(repairId?{reconciledBy:repairId}:{})});
   }
   assertRequestCurrent();currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');dependenciesCurrent(plan,true);const value={protocol:'plugin-projection-cohort-completed-v1',projectIds:plan.projects.map(p=>p.id),legacyManifestSha256:plan.legacyManifestSha256,legacyOriginals:'unchanged_and_retained',jobOrPluginExecutionAcceptance:false,...(repairId?{reconciledBy:repairId}:{})};
   finish(sourceId,value);if(repairId)finish(repairId,value);return value;
  },1,'immediate');
 }
 return {
  review(mode:TransitionMode,projectId:string,configOrigin:ConfigOrigin){assertRequestCurrent();const plan=buildTransitionPlan(principal,mode,projectId,configOrigin);return {review:publicPlan(plan),reviewSha256:payloadHash(plan)};},
  inspect,
  apply(input:{operationId:string;mode:TransitionMode;projectId:string;configOrigin:ConfigOrigin;reviewSha256:string}){
   assertRequestCurrent();need(/^[0-9a-f-]{36}$/.test(input.operationId),'ORIGINAL_ID_REQUIRED');const old=getDb().prepare('SELECT * FROM customize_commands WHERE id=?').get(input.operationId) as Row|undefined;
   if(old){need(old.actor_id===principal.id&&JSON.parse(old.original_json).request&&payloadHash(JSON.parse(old.original_json).request)===payloadHash(input),'ORIGINAL_REUSE_CONFLICT');return inspect(input.operationId);}
   const plan=buildTransitionPlan(principal,input.mode,input.projectId,input.configOrigin);need(payloadHash(plan)===input.reviewSha256,'TRANSITION_REVIEW_CHANGED');
   const original={protocol:'plugin-projection-cohort-transition-v1',id:input.operationId,actorId:principal.id,installationId:plan.installationId,request:input};let namespaceRows:Row[]=[];
   execTransaction(()=>{
    assertRequestCurrent();currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');dependenciesCurrent(plan);claim(original,original.protocol,null,{protocol:'plugin-projection-private-plan-v1',plan});
    const ownerProtocol=plan.mode==='fresh-project'?'plugin-projection-fresh-project-owner-v1':'plugin-projection-legacy-owner-v1';
    const owner={protocol:ownerProtocol,id:randomUUID(),actorId:principal.id,installationId:plan.installationId,...(plan.mode==='fresh-project'?{projectId:input.projectId,projectCreationOwnerOriginalId:plan.creationOriginalId}:{cohortProjectIds:plan.projects.map(p=>p.id)}),captureSha256:plan.captureSha256,manifestSha256:plan.legacyManifestSha256};claim(owner,ownerProtocol,plan.mode==='fresh-project'?input.projectId:null);finish(owner.id,{manifestSha256:plan.legacyManifestSha256,observation:'actual_capture_and_unchanged_preimages'});
    namespaceRows=plan.targets.map(target=>{const id=randomUUID(),runtimeId=randomUUID(),snapshot={protocol:'plugin-projection-transition-commit-v1',projectId:target.projectId,target:{projectPath:target.projectPath,pluginBase:target.pluginBase,configPath:target.configPath,rootDevice:target.rootDevice,rootInode:target.rootInode},legacyOwnerOriginalId:owner.id,legacyManifestSha256:plan.legacyManifestSha256,runtimeOriginalId:runtimeId};const event={protocol:'plugin-projection-transition-v1',id,actorId:principal.id,installationId:plan.installationId,projectId:target.projectId,cohortOperationId:input.operationId};claim(event,PLUGIN_NAMESPACE_PROTOCOL,target.projectId,snapshot);return {id,projectId:target.projectId,runtimeId,snapshotSha256:payloadHash(snapshot)};});
   },1,'immediate');checkpointAfterWrite();
   try{execute(plan,input.operationId,namespaceRows,false);checkpointAfterWrite();return inspect(input.operationId);}catch(e){checkpointAfterWrite();return {operationId:input.operationId,outcome:'unknown',code:'TRANSITION_ORIGINAL_REQUIRES_RECONCILIATION',reason:transitionFailure(e)};}
  },
  reconcile(input:{operationId:string;sourceOperationId:string;sourcePayloadSha256:string}){
   assertRequestCurrent();need(input.operationId!==input.sourceOperationId,'NEW_RECONCILIATION_ORIGINAL_REQUIRED');const source=getDb().prepare('SELECT c.*,p.snapshot_json,p.snapshot_sha256 FROM customize_commands c JOIN customize_projection_preimages p ON p.command_id=c.id WHERE c.id=? AND c.actor_id=? AND c.installation_id=?').get(input.sourceOperationId,principal.id,installationId()) as Row|undefined;need(source,'ORIGINAL_NOT_FOUND');
   need(source!.payload_sha256===input.sourcePayloadSha256,'ORIGINAL_HASH_CHANGED');const inspectionScope=inspectionPlan(source!);currentActor(principal,inspectionScope.projects.map(p=>p.id),inspectionScope.mode==='captured-legacy-cohort');if(source!.result_json)return inspect(source!.id);const snapshot=JSON.parse(source!.snapshot_json);need(payloadHash(snapshot)===source!.snapshot_sha256&&snapshot.protocol==='plugin-projection-private-plan-v1','ORIGINAL_PLAN_CORRUPT');const plan=snapshot.plan as TransitionPlan;dependenciesCurrent(plan);currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');
   const existing=getDb().prepare('SELECT * FROM customize_commands WHERE id=?').get(input.operationId) as Row|undefined;if(existing){need(existing.actor_id===principal.id&&JSON.parse(existing.original_json).protocol==='plugin-projection-explicit-repair-v1'&&payloadHash(JSON.parse(existing.original_json).request)===payloadHash(input),'ORIGINAL_REUSE_CONFLICT');return inspect(input.operationId);}
   const original={protocol:'plugin-projection-explicit-repair-v1',id:input.operationId,actorId:principal.id,installationId:plan.installationId,request:input};execTransaction(()=>{assertRequestCurrent();currentActor(principal,plan.projects.map(p=>p.id),plan.mode==='captured-legacy-cohort');dependenciesCurrent(plan);claim(original,original.protocol,null);},1,'immediate');checkpointAfterWrite();
   const namespaces=(getDb().prepare('SELECT c.*,p.snapshot_json,p.snapshot_sha256 FROM customize_commands c JOIN customize_projection_preimages p ON p.command_id=c.id WHERE c.resource_key=? AND c.result_json IS NULL').all(PLUGIN_NAMESPACE_PROTOCOL) as Row[]).filter(r=>JSON.parse(r.original_json).cohortOperationId===source!.id).map(r=>{const p=JSON.parse(r.snapshot_json);need(payloadHash(p)===r.snapshot_sha256,'NAMESPACE_PREIMAGE_CORRUPT');return {id:r.id,projectId:r.project_id,runtimeId:p.runtimeOriginalId,snapshotSha256:r.snapshot_sha256};});need(namespaces.length===plan.projects.length,'ORIGINAL_NAMESPACE_SET_CHANGED');
   try{execute(plan,source!.id,namespaces,true,input.operationId);checkpointAfterWrite();return inspect(input.operationId);}catch(e){checkpointAfterWrite();return {operationId:input.operationId,outcome:'unknown',code:'TRANSITION_REPAIR_REQUIRES_ORIGINAL_OWNER',reason:transitionFailure(e)};}
  }
 };
}