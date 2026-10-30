/** Original Plugins projection and soft lifecycle owner; no credential access. */
import {getDb,execTransaction} from '../db.js';
import * as plugins from './plugins.js';
import type {Plugin} from '../schema.js';
import {getPluginsBase,getPluginConfigPath,isGlobal} from './paths.js';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
let commandId:string|undefined;
export const pluginProjectionStrict=()=>commandId!==undefined;
export function withPluginCommand<T>(id:string,work:()=>T):T{
 if(commandId||work.constructor.name==='AsyncFunction')throw new Error('Exclusive original plugin command required');
 commandId=id;
 try{const value=work();if(value&&typeof(value as {then?:unknown}).then==='function')throw new Error('Async plugin projection forbidden');return value;}
 finally{commandId=undefined;}
}
export function assertPluginCommandClear(projectId:string):void{
 if(getDb().prepare("SELECT 1 FROM customize_commands WHERE project_id=? AND kind='plugin' AND result_json IS NULL AND id<>? LIMIT 1").get(projectId,commandId??''))throw new Error('Unresolved original plugin command');
}
export type PluginRecord=Plugin&{revision:number;archived_at:string|null};
export function record(projectId:string,name:string):PluginRecord|undefined{return getDb().prepare('SELECT * FROM plugins WHERE project_id=? AND name=?').get(projectId,name) as PluginRecord|undefined;}
export function archived(projectId:string):PluginRecord[]{return getDb().prepare('SELECT * FROM plugins WHERE project_id=? AND archived_at IS NOT NULL ORDER BY name,id').all(projectId) as PluginRecord[];}
export function archive(projectId:string,name:string):PluginRecord|undefined{
 assertPluginCommandClear(projectId);return execTransaction(()=>{
  const row=record(projectId,name);if(!row||row.archived_at)return undefined;
  plugins.disablePlugin(projectId,name);
  getDb().prepare('UPDATE plugins SET archived_at=?,enabled=0,updated_at=? WHERE id=? AND archived_at IS NULL').run(new Date().toISOString(),new Date().toISOString(),row.id);
  return record(projectId,name);
 });
}
export function restore(projectId:string,name:string):PluginRecord|undefined{
 assertPluginCommandClear(projectId);return execTransaction(()=>{
  const row=record(projectId,name);if(!row?.archived_at)return undefined;
  getDb().prepare('UPDATE plugins SET archived_at=NULL,enabled=0,updated_at=? WHERE id=? AND archived_at IS NOT NULL').run(new Date().toISOString(),row.id);
  return record(projectId,name);
 });
}
function noRedirect(file:string):void{
 for(let p=file;;p=dirname(p)){
  const v=lstatSync(p,{throwIfNoEntry:false});if(v&&(v.isSymbolicLink()||(v.isFile()&&v.nlink!==1)))throw new Error('Unowned plugin projection path');
  if(p===dirname(p))break;
 }
}
/** Called by the original writer before source/config effects, not after damage. */
export function validateProjectionPath(file:string):void{noRedirect(file);}
/** Actual original projection readback. Caller cannot supply a success flag. */
export function verifyProjection(row:PluginRecord):void{
 const file=resolve(getPluginsBase(row.project_id),row.file_path),configPath=getPluginConfigPath(row.project_id);
 noRedirect(file);noRedirect(configPath);
 const active=Boolean(row.enabled)&&!row.archived_at;
 if(active){
  if(!existsSync(file)||!lstatSync(file).isFile()||lstatSync(file).nlink!==1||createHash('sha256').update(readFileSync(file)).digest('hex')!==createHash('sha256').update(row.source_content??'').digest('hex'))throw new Error('Plugin source projection differs');
 }else if(existsSync(file))throw new Error('Inactive plugin projection remains');
 const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{};
 if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Invalid plugin configuration projection');
 const rel=isGlobal(row.project_id)?'plugins/'+row.file_path:'.opencode/plugins/'+row.file_path;
 const entries=[...(Array.isArray(config.plugins)?config.plugins:[]),...(Array.isArray(config.plugin)?config.plugin:[])];
 if(entries.includes(rel)!==active)throw new Error('Plugin configuration projection differs');
}