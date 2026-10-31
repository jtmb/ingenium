/** DATA ONLY. Trusted caller binds closed classifications and parsed config to raw bytes.
 * No authority/SQL/files/namespace. Preservation is NON-EXECUTABLE, never plugin-directory storage. */
import {createHash} from 'node:crypto';
export type SourceStorage={kind:'utf8-text';text:string;bytesBase64:string}|{kind:'null'}|{kind:'blob'|'invalid-utf8-text';bytesBase64:string}|{kind:'integer'|'real';sqlText:string};
export type DisabledPluginRow={id:string;projectId:string;filePath:unknown;enabled:unknown;source:SourceStorage};
export type DisabledSnapshot={domain:'closed-disabled-initialization-snapshot-v1';projectId:string;rows:readonly DisabledPluginRow[];config:{bytesBase64:string;parsed:Record<string,unknown>};removalReferences:readonly string[]};
export class DisabledPlanRefusal extends Error{constructor(public code:string){super(code);}}
function need(v:unknown,code:string):asserts v{if(!v)throw new DisabledPlanRefusal(code);}
function bytes(v:unknown):Buffer{need(typeof v==='string'&&v.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v),'INVALID_STORAGE_BASE64');const b=Buffer.from(v,'base64');need(b.toString('base64')===v,'INVALID_STORAGE_BASE64');return b;}
function safe(v:unknown):v is string{return typeof v==='string'&&/^[a-zA-Z0-9_./-]+$/.test(v)&&v.split('/').every(p=>p!==''&&p!=='.'&&p!=='..');}
function source(s:SourceStorage):boolean{need(s&&typeof s==='object','SOURCE_CLASSIFICATION_REQUIRED');switch(s.kind){
 case 'utf8-text':{need(typeof s.text==='string','SOURCE_CLASSIFICATION_REQUIRED');const b=bytes(s.bytesBase64);let decoded:string;try{decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{throw new DisabledPlanRefusal('UTF8_CLASSIFICATION_MISMATCH');}need(decoded===s.text&&Buffer.from(s.text,'utf8').equals(b),'UTF8_CLASSIFICATION_MISMATCH');return true;}
 case 'blob':case 'invalid-utf8-text':bytes(s.bytesBase64);return false;
 case 'null':return false;
 case 'integer':case 'real':need(typeof s.sqlText==='string'&&s.sqlText.length>0,'SOURCE_CLASSIFICATION_REQUIRED');return false;
 default:throw new DisabledPlanRefusal('SOURCE_CLASSIFICATION_REQUIRED');}}
export function planDisabledInitialization(input:DisabledSnapshot){
 need(input.domain==='closed-disabled-initialization-snapshot-v1'&&typeof input.projectId==='string'&&input.projectId.length>0&&Array.isArray(input.rows)&&Array.isArray(input.removalReferences),'CLOSED_SNAPSHOT_REQUIRED');
 need(input.config&&input.config.parsed&&typeof input.config.parsed==='object'&&!Array.isArray(input.config.parsed),'EXPLICIT_SELECTED_CONFIG_REQUIRED');const raw=bytes(input.config.bytesBase64);
 const ids=new Set<string>(),counts=new Map<unknown,number>();for(const row of input.rows){need(typeof row.id==='string'&&row.id.length>0&&!ids.has(row.id),'DUPLICATE_OR_INVALID_PLUGIN_ID');ids.add(row.id);need(row.projectId===input.projectId,'PLUGIN_PROJECT_MISMATCH');need(row.enabled===0||row.enabled===1,'INVALID_PLUGIN_ENABLED_FLAG');const key=typeof row.filePath==='string'?row.filePath.toLowerCase():row.filePath;counts.set(key,(counts.get(key)??0)+1);}
 const preservable:DisabledPluginRow[]=[],opaque:{row:DisabledPluginRow;reason:string}[]=[];for(const row of input.rows){const stringSource=source(row.source);const reason=!safe(row.filePath)?'unsafe-path':counts.get(typeof row.filePath==='string'?row.filePath.toLowerCase():row.filePath)!==1?'duplicate-target-path':!stringSource?'opaque-source-storage':null;if(reason)opaque.push({row,reason});else preservable.push(row);}
 const removalReferences:string[]=[],opaqueRemovalReferences:string[]=[];for(const ref of input.removalReferences){need(typeof ref==='string','INVALID_REMOVAL_REFERENCE');(ref.startsWith('.opencode/plugins/')&&safe(ref.slice('.opencode/plugins/'.length))?removalReferences:opaqueRemovalReferences).push(ref);}
 return {metadataOnly:true as const,executionAuthorized:false as const,requiresConfigReconciliation:true as const,projectId:input.projectId,rowsToDisable:input.rows.filter(r=>r.enabled===1).map(r=>({id:r.id,expectedEnabled:1 as const,enabled:0 as const})),preservableNonExecutable:preservable,opaqueRetained:opaque,selectedConfig:{bytesBase64:input.config.bytesBase64,sha256:createHash('sha256').update(raw).digest('hex'),parsed:input.config.parsed},removalReferences,opaqueRemovalReferences};
}
