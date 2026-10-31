/** Pure v2 partition/classification/storage-query construction. No DB, principal or positive proof ports. */
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export type SubsetRow=Record<string,any>;
export const ARCHIVE_PRESERVATION='plugin-projection-archive-preservation-v1';
export const ACTIVE_SUBSET_PLAN='plugin-projection-active-subset-plan-v2';
export class ActiveSubsetRefusal extends Error{readonly status=409;constructor(public code:string){super(code);}}
export function subsetNeed(v:unknown,code:string):asserts v{if(!v)throw new ActiveSubsetRefusal(code);}
export const subsetHash=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)).digest('hex');
export function partitionCapturedMembers(captured:SubsetRow[],current:SubsetRow[]){
 subsetNeed(captured.every(p=>p.is_global===0||p.is_global===1),'CAPTURED_PROJECT_GLOBAL_STATE_UNRESOLVED');const cohort=captured.filter(p=>p.is_global===0);subsetNeed(new Set(cohort.map(p=>p.id)).size===cohort.length,'CAPTURED_COHORT_DUPLICATE_ID');const rows=cohort.map(old=>{const matches=current.filter(p=>p.id===old.id);subsetNeed(matches.length===1,'CAPTURED_PROJECT_ROSTER_CHANGED');const row=matches[0]!;for(const key of ['id','path','created_at','is_global','archived_at'])subsetNeed(subsetHash(row[key])===subsetHash(old[key]),'CAPTURED_PROJECT_ROSTER_CHANGED');return row;});
 return {memberIds:rows.map(p=>p.id),activeIds:rows.filter(p=>p.archived_at===null).map(p=>p.id),archiveIds:rows.filter(p=>p.archived_at!==null).map(p=>p.id),rows};
}
export function safeSubsetRelative(v:unknown):v is string{return typeof v==='string'&&/^[a-zA-Z0-9_\-./]+$/.test(v)&&v.split('/').every(p=>!!p&&p!=='.'&&p!=='..');}
/** Multiplicity is retained, never resolved by order/name/enabled flags. Archive invalid paths stay opaque. */
export function fullClaimMultimap(claims:SubsetRow[],activeIds:readonly string[],base:string){
 const paths=new Map<string,SubsetRow[]>(),opaque:SubsetRow[]=[];for(const claim of claims){if(!safeSubsetRelative(claim.filePath)){subsetNeed(!activeIds.includes(claim.projectId),'UNSAFE_ACTIVE_PLUGIN_PATH');opaque.push(claim);continue;}const key=resolve(base,claim.filePath),rows=paths.get(key)??[];rows.push(claim);paths.set(key,rows);}
 return {paths:[...paths].sort(([a],[b])=>a.localeCompare(b)).map(([path,claims])=>({path,claims})),opaque};
}
export function validateActivePhysicalClaims(claims:SubsetRow[],activeIds:readonly string[],files:SubsetRow[],base:string,configuredRefs:readonly string[]){
 const multimap=fullClaimMultimap(claims,activeIds,base);for(const claim of claims.filter(c=>activeIds.includes(c.projectId))){subsetNeed(typeof claim.sourceSha256==='string','AUTHORITATIVE_DATABASE_SOURCE_REQUIRED');if(claim.enabled&&claim.archived===null){const actual=files.find(f=>f.path===resolve(base,claim.filePath));subsetNeed(actual&&actual.sha256===claim.sourceSha256&&configuredRefs.includes('.opencode/plugins/'+claim.filePath),'ACTIVE_LEGACY_PROJECTION_RECONCILIATION_REQUIRED');}}
 return multimap;
}
export const fullRemovalReferences=(claims:SubsetRow[]):string[]=>[...new Set(claims.filter(c=>safeSubsetRelative(c.filePath)).map(c=>'.opencode/plugins/'+c.filePath))];
export function projectConfigConsumedGuard(member:SubsetRow|undefined,hasNamespace:boolean):string|null{if(!member||hasNamespace)return null;return member.archived_at!==null?'ARCHIVED_LEGACY_RESTORE_INITIALIZATION_UNAVAILABLE':'CAPTURED_PROJECT_PROJECTION_TRANSITION_REQUIRED';}
/** Fixed existing tables only. TEXT/BLOB are original SQLite bytes; integers/REAL retain typed lossless values. */
export function archiveStorageQuery(table:'projects'|'plugins'|'configs',columns:readonly string[]):string{
 subsetNeed(['projects','plugins','configs'].includes(table)&&columns.length>0&&columns.length<=128,'ARCHIVE_STORAGE_SCHEMA_REQUIRED');const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';const expressions=columns.flatMap((name,i)=>{const col=quote(name);return [`typeof(${col}) AS t${i}`,`CASE typeof(${col}) WHEN 'null' THEN NULL WHEN 'integer' THEN CAST(${col} AS TEXT) WHEN 'real' THEN printf('%!.26g',${col}) ELSE hex(CAST(${col} AS BLOB)) END AS v${i}`];});return `SELECT ${expressions.join(',')} FROM ${quote(table)} WHERE ${table==='projects'?'id':'project_id'}=? ORDER BY id`;
}
export function decodeArchiveStorage(columns:readonly string[],rows:SubsetRow[]){return rows.map(row=>columns.map((name,i)=>{const type=row['t'+i],value=row['v'+i];subsetNeed(['null','integer','real','text','blob'].includes(type)&&((type==='null'&&value===null)||(type!=='null'&&typeof value==='string')),'INVALID_TYPED_ARCHIVE_STORAGE');if(type==='text'||type==='blob')subsetNeed(/^(?:[A-F0-9]{2})*$/.test(value),'INVALID_ARCHIVE_BYTE_ENCODING');return {name,type,value};}));}