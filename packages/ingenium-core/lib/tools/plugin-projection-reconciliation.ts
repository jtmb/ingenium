/** Actual local projection evidence. Never interprets a Native/remote outcome. */
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {getDb} from '../db.js';
import {getPluginsBase,getPluginConfigPath,isGlobal} from './paths.js';
import * as plugins from './plugins.js';
import * as lifecycle from './plugin-lifecycle.js';
import {parsePluginConfiguration} from './plugin-config-text.js';
import {payloadHash} from './hosted-governance.js';
type Row=Record<string,any>;
function requireValue(value:unknown):asserts value{if(!value)throw new Error('Original projection preimage unavailable or changed; preserve target');}
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function locations(row:lifecycle.PluginRecord){
 const base=getPluginsBase(row.project_id),file=resolve(base,row.file_path),inside=relative(base,file),config=getPluginConfigPath(row.project_id);
 requireValue(inside!==''&&!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith('../')&&!inside.startsWith('..\\'));
 lifecycle.validateProjectionPath(file);lifecycle.validateProjectionPath(config);
 const project=getDb().prepare('SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL').get(row.project_id) as Row|undefined;requireValue(project);
 const root=lstatSync(dirname(config),{throwIfNoEntry:false});requireValue(root);requireValue(root.isDirectory()&&!root.isSymbolicLink());
 return {file,config,identity:{projectPathSha256:sha(project.path),global:isGlobal(row.project_id),sourcePathSha256:sha(file),configPathSha256:sha(config),rootDevice:String(root.dev),rootInode:String(root.ino)}};
}
function metadata(v:ReturnType<typeof fstatSync>){return {dev:String(v.dev),ino:String(v.ino),size:String(v.size),mtime:String(v.mtimeMs),ctime:String(v.ctimeMs),links:String(v.nlink)};}
function readSafe(file:string,max:number):{image:Row|null;bytes:Buffer|null}{
 lifecycle.validateProjectionPath(file);const before=lstatSync(file,{throwIfNoEntry:false});if(!before)return {image:null,bytes:null};
 requireValue(before.isFile()&&before.nlink===1&&before.size<=max);
 const descriptor=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const opened=fstatSync(descriptor);requireValue(opened.isFile()&&opened.nlink===1&&payloadHash(metadata(opened))===payloadHash(metadata(before)));
  const bytes=readFileSync(descriptor);requireValue(bytes.length<=max&&bytes.length===opened.size);
  const end=fstatSync(descriptor),actual=lstatSync(file,{throwIfNoEntry:false});requireValue(actual&&payloadHash(metadata(end))===payloadHash(metadata(opened))&&payloadHash(metadata(actual))===payloadHash(metadata(opened)));lifecycle.validateProjectionPath(file);
  return {image:{...metadata(opened),sha256:sha(bytes)},bytes};
 }finally{closeSync(descriptor);}
}
function resource(row:lifecycle.PluginRecord){return {id:row.id,projectId:row.project_id,name:row.name,filePath:row.file_path,revision:row.revision,enabled:Boolean(row.enabled),archived:row.archived_at,sourceSha256:sha(row.source_content??'')};}
export function observeProjection(row:lifecycle.PluginRecord):Row{
 const where=locations(row),source=readSafe(where.file,2*1024*1024),config=readSafe(where.config,4*1024*1024);
 try{
  const object=config.bytes?parsePluginConfiguration(config.bytes.toString('utf8')):{};
  const entries=[...(Array.isArray(object.plugins)?object.plugins:[]),...(Array.isArray(object.plugin)?object.plugin:[])];
  const rel=isGlobal(row.project_id)?'plugins/'+row.file_path:'.opencode/plugins/'+row.file_path;
  return {resource:resource(row),locations:where.identity,sourceFile:source.image,configFile:config.image,configured:entries.includes(rel)};
 }finally{source.bytes?.fill(0);config.bytes?.fill(0);}
}
/** Called under the original Core claim transaction, before any filesystem effect. */
export function captureProjectionPreimage(row:lifecycle.PluginRecord):Row{
 lifecycle.verifyProjection(row);const observed=observeProjection(row);requireValue(observed.resource.sourceSha256===resource(row).sourceSha256);return {protocol:'customize-projection-preimage-v1',...observed};
}
/** Current prestate may have partial owned effects; foreign bytes remain protected. */
export function reviewProjectionRollback(before:Row,row:lifecycle.PluginRecord):Row{
 requireValue(before.protocol==='customize-projection-preimage-v1');const current=observeProjection(row);
 requireValue(payloadHash(before.resource)===payloadHash(current.resource)&&payloadHash(before.locations)===payloadHash(current.locations));
 requireValue(!current.sourceFile||current.sourceFile.sha256===before.resource.sourceSha256);
 return current;
}
/** Explicit reconciliation only. Repair DB's unchanged prior projection, not the consumed command. */
export function restoreProjectionPreimage(before:Row,row:lifecycle.PluginRecord,expectedObservation:Row):Row{
 const current=reviewProjectionRollback(before,row);requireValue(payloadHash(current)===payloadHash(expectedObservation));
 const where=locations(row),active=Boolean(row.enabled)&&!row.archived_at;
 if(active){
  if(!current.sourceFile){plugins.ensurePluginDir(row.project_id);lifecycle.validateProjectionPath(where.file);mkdirSync(dirname(where.file),{recursive:true});lifecycle.validateProjectionPath(where.file);writeFileSync(where.file,row.source_content??'',{flag:'wx'});}
  const config=readSafe(where.config,4*1024*1024);config.bytes?.fill(0);requireValue(payloadHash(config.image)===payloadHash(current.configFile));
  plugins.addPluginToConfig(row.file_path,row.project_id);
 }else{
  if(current.sourceFile){const now=readSafe(where.file,2*1024*1024);now.bytes?.fill(0);requireValue(payloadHash(now.image)===payloadHash(current.sourceFile));unlinkSync(where.file);}
  const config=readSafe(where.config,4*1024*1024);config.bytes?.fill(0);requireValue(payloadHash(config.image)===payloadHash(current.configFile));
  plugins.removePluginFromConfig(row.file_path,row.project_id);
 }
 lifecycle.verifyProjection(row);const actual=observeProjection(row);
 requireValue(payloadHash(actual.resource)===payloadHash(before.resource)&&payloadHash(actual.locations)===payloadHash(before.locations));
 requireValue(actual.configured===active&&(!active||actual.sourceFile?.sha256===before.resource.sourceSha256)&&(!active?!actual.sourceFile:true));
 return {protocol:'customize-projection-preimage-v1',pluginId:row.id,projectId:row.project_id,revision:row.revision,sourceSha256:before.resource.sourceSha256,projectionObservationSha256:payloadHash(actual),domainTransaction:'not_committed',otherConfigFields:'preserved_current_bytes'};
}