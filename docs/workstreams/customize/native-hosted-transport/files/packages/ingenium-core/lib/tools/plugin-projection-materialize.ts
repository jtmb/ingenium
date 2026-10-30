/** Local byte-preserving materialization only. No authority, receipt, account or runtime is synthesized. */
import {constants,lstatSync,openSync,closeSync,fstatSync,readFileSync,writeFileSync,fsyncSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {parsePluginConfiguration,editPluginConfiguration} from './plugin-config-text.js';
export type SourceInput={id:string;filePath:string;source:string;enabled:boolean};
export type TargetPlan={projectId:string;projectPath:string;rootDevice:string;rootInode:string;pluginBase:string;configPath:string;configSha256:string;configBase64:string;files:{id:string;filePath:string;path:string;sha256:string;enabled:boolean}[]};
export const byteSha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
function requireValue(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
export function noProjectionLinks(path:string):void{for(let p=path;;p=dirname(p)){const s=lstatSync(p,{throwIfNoEntry:false});if(s)requireValue(!s.isSymbolicLink()&&(!s.isFile()||s.nlink===1),'UNOWNED_PROJECTION_PATH');if(p===dirname(p))break;}}
export function readProjectionBytes(path:string,max=4*1024*1024):Buffer|null{
 noProjectionLinks(path);const before=lstatSync(path,{throwIfNoEntry:false});if(!before)return null;requireValue(before.isFile()&&before.nlink===1&&before.size<=max,'UNOWNED_PROJECTION_FILE');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));let bytes:Buffer|undefined;
 try{const a=fstatSync(fd);requireValue(a.dev===before.dev&&a.ino===before.ino&&a.size===before.size&&a.mtimeMs===before.mtimeMs&&a.ctimeMs===before.ctimeMs&&a.nlink===1,'PROJECTION_CHANGED');bytes=readFileSync(fd);const b=fstatSync(fd),c=lstatSync(path,{throwIfNoEntry:false});requireValue(c&&bytes.length===a.size&&b.dev===a.dev&&b.ino===a.ino&&b.size===a.size&&b.mtimeMs===a.mtimeMs&&b.ctimeMs===a.ctimeMs&&c.dev===a.dev&&c.ino===a.ino&&c.mtimeMs===a.mtimeMs&&c.ctimeMs===a.ctimeMs,'PROJECTION_CHANGED');noProjectionLinks(path);return bytes;}catch(e){bytes?.fill(0);throw e;}finally{closeSync(fd);}
}
export function exactUtf8(bytes:Buffer):string{const text=bytes.toString('utf8');requireValue(Buffer.from(text,'utf8').equals(bytes),'CONFIG_UTF8_NOT_LOSSLESS');return text;}
export function safePluginRelative(value:string):boolean{return /^[a-zA-Z0-9_\-./]+$/.test(value)&&value.split('/').every(p=>!!p&&p!=='.'&&p!=='..');}
function under(root:string,path:string){const r=relative(root,path);requireValue(r!==''&&!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\'),'PROJECTION_PATH_ESCAPES');}
export function inventoryProjectionFiles(base:string):string[]{
 noProjectionLinks(base);const root=lstatSync(base,{throwIfNoEntry:false});if(!root)return [];requireValue(root.isDirectory(),'UNOWNED_PROJECTION_DIRECTORY');const files:string[]=[];
 function visit(path:string,depth:number){requireValue(depth<=16&&files.length<=512,'PROJECTION_REVIEW_LIMIT');const before=lstatSync(path);for(const e of readdirSync(path,{withFileTypes:true})){const p=resolve(path,e.name);under(base,p);noProjectionLinks(p);if(e.isDirectory())visit(p,depth+1);else{requireValue(e.isFile(),'UNOWNED_PROJECTION_FILE');files.push(p);requireValue(files.length<=512,'PROJECTION_REVIEW_LIMIT');}}const after=lstatSync(path);requireValue(before.dev===after.dev&&before.ino===after.ino&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'PROJECTION_DIRECTORY_CHANGED');}
 visit(base,0);return files.sort();
}
export function planProjectProjection(projectId:string,projectPath:string,sources:SourceInput[],seed:Buffer,allLegacyReferences:readonly string[]):TargetPlan{
 requireValue(isAbsolute(projectPath),'REGISTERED_PROJECT_PATH_REQUIRED');noProjectionLinks(projectPath);const root=lstatSync(projectPath);requireValue(root.isDirectory(),'REGISTERED_PROJECT_PATH_REQUIRED');
 const pluginBase=resolve(projectPath,'.opencode','plugins'),configPath=resolve(projectPath,'opencode.json');
 requireValue(inventoryProjectionFiles(pluginBase).length===0&&readProjectionBytes(configPath)===null,'FOREIGN_TARGET_PREIMAGE_REQUIRES_OWNER');
 let content=exactUtf8(seed);const parsed=parsePluginConfiguration(content);requireValue(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'INVALID_CONFIG_PREIMAGE');
 for(const field of ['plugins','plugin'])requireValue(parsed[field]===undefined||Array.isArray(parsed[field]),'AMBIGUOUS_PLUGIN_CONFIG_FIELD');
 const entries=[...(Array.isArray(parsed.plugins)?parsed.plugins:[]),...(Array.isArray(parsed.plugin)?parsed.plugin:[])];requireValue(entries.every(v=>typeof v==='string'&&allLegacyReferences.includes(v)),'UNCLASSIFIED_PLUGIN_REFERENCE');
 for(const ref of allLegacyReferences)content=editPluginConfiguration(content,ref,false);
 const seen=new Set<string>();const files=sources.map(s=>{requireValue(safePluginRelative(s.filePath),'UNSAFE_PLUGIN_PATH');const path=resolve(pluginBase,s.filePath);under(pluginBase,path);requireValue(!seen.has(path),'PROJECT_PLUGIN_PATH_COLLISION');seen.add(path);if(s.enabled)content=editPluginConfiguration(content,'.opencode/plugins/'+s.filePath,true);return {id:s.id,filePath:s.filePath,path,sha256:byteSha(Buffer.from(s.source,'utf8')),enabled:s.enabled};});
 const bytes=Buffer.from(content,'utf8');return {projectId,projectPath,rootDevice:String(root.dev),rootInode:String(root.ino),pluginBase,configPath,configSha256:byteSha(bytes),configBase64:bytes.toString('base64'),files};
}
function ensureDirectory(path:string,root:string){if(path!==root)under(root,path);noProjectionLinks(path);const old=lstatSync(path,{throwIfNoEntry:false});if(old){requireValue(old.isDirectory(),'UNOWNED_PROJECTION_DIRECTORY');return;}ensureDirectory(dirname(path),root);mkdirSync(path,{mode:0o700});noProjectionLinks(path);requireValue(lstatSync(path).isDirectory(),'PROJECTION_DIRECTORY_UNAVAILABLE');}
function createOnly(path:string,bytes:Buffer,root:string,repair:boolean){
 under(root,path);noProjectionLinks(path);const before=readProjectionBytes(path,Math.max(bytes.length,4*1024*1024));if(before){try{requireValue(repair&&before.equals(bytes),'FOREIGN_OR_CHANGED_TARGET');return;}finally{before.fill(0);}}
 ensureDirectory(dirname(path),root);noProjectionLinks(path);const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
 try{requireValue(fstatSync(fd).nlink===1,'UNOWNED_PROJECTION_FILE');writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 const actual=readProjectionBytes(path,Math.max(bytes.length,4*1024*1024));try{requireValue(actual?.equals(bytes),'PROJECTION_READBACK_MISMATCH');}finally{actual?.fill(0);}
}
export function materializeProjectProjection(plan:TargetPlan,sources:ReadonlyMap<string,string>,mode:'first'|'explicit-repair'):void{
 noProjectionLinks(plan.projectPath);const root=lstatSync(plan.projectPath);requireValue(root.isDirectory()&&String(root.dev)===plan.rootDevice&&String(root.ino)===plan.rootInode,'PROJECT_ROOT_CHANGED');
 const expected=new Set(plan.files.filter(f=>f.enabled).map(f=>f.path));for(const path of inventoryProjectionFiles(plan.pluginBase))requireValue(expected.has(path),'FOREIGN_TARGET_ENTRY');
 for(const file of plan.files){const source=sources.get(file.id);requireValue(typeof source==='string'&&byteSha(Buffer.from(source,'utf8'))===file.sha256,'AUTHORITATIVE_SOURCE_CHANGED');if(file.enabled){const bytes=Buffer.from(source,'utf8');try{createOnly(file.path,bytes,plan.projectPath,mode==='explicit-repair');}finally{bytes.fill(0);}}else requireValue(readProjectionBytes(file.path)===null,'INACTIVE_TARGET_EXECUTABLE');}
 const bytes=Buffer.from(plan.configBase64,'base64');try{requireValue(byteSha(bytes)===plan.configSha256,'CONFIG_PLAN_CORRUPT');createOnly(plan.configPath,bytes,plan.projectPath,mode==='explicit-repair');}finally{bytes.fill(0);}
}
export function readbackProjectProjection(plan:TargetPlan):{projectId:string;configSha256:string;files:{id:string;sha256:string;enabled:boolean}[]}{
 const config=readProjectionBytes(plan.configPath);try{requireValue(config&&byteSha(config)===plan.configSha256,'CONFIG_READBACK_MISMATCH');const parsed=parsePluginConfiguration(exactUtf8(config));const entries=[...(Array.isArray(parsed.plugins)?parsed.plugins:[]),...(Array.isArray(parsed.plugin)?parsed.plugin:[])];
  for(const file of plan.files){const bytes=readProjectionBytes(file.path,2*1024*1024);try{requireValue(file.enabled?!!bytes&&byteSha(bytes)===file.sha256:bytes===null,'SOURCE_READBACK_MISMATCH');requireValue(entries.includes('.opencode/plugins/'+file.filePath)===file.enabled,'CONFIG_MEMBERSHIP_MISMATCH');}finally{bytes?.fill(0);}}
  return {projectId:plan.projectId,configSha256:plan.configSha256,files:plan.files.map(f=>({id:f.id,sha256:f.sha256,enabled:f.enabled}))};
 }finally{config?.fill(0);}
}
/** A cohort must never write two logical owners into one physical namespace. */
export function assertDistinctProjectionTargets(plans:readonly TargetPlan[]):void{
 for(let i=0;i<plans.length;i++)for(let j=0;j<i;j++){const a=plans[i]!,b=plans[j]!;const overlap=projectionPathsOverlap;requireValue(a.projectId!==b.projectId&&!(a.rootDevice===b.rootDevice&&a.rootInode===b.rootInode)&&!overlap(a.projectPath,b.projectPath)&&!overlap(a.pluginBase,b.pluginBase)&&a.configPath!==b.configPath,'COHORT_TARGET_NAMESPACE_COLLISION');}
}

export function projectionPathsOverlap(x:string,y:string):boolean{const inside=(a:string,b:string)=>{const r=relative(a,b);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\'));};return inside(x,y)||inside(y,x);}
