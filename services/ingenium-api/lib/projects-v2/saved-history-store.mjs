/** Canonical saved-data reader, not an execution or memory-retrieval owner.
 * The fixed browser facade supplies actual identity/organization scope and the
 * SAME original Core connection. Every query is read-only in its snapshot. */
import {createHash}from'node:crypto';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status})};
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
const digest=value=>sha(JSON.stringify(canonical(value)));
function json(raw){try{const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))return value}catch{}fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE')}
function decoded(bytes,max){if(!(bytes instanceof Uint8Array))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE')}if(!value.length||value.length>max)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');return value}
function scope(db,s){
 if(!(db.inTransaction===true||db.isTransaction===true))fail('SAVED_HISTORY_SNAPSHOT_REQUIRED',503);
 if(!s||Object.keys(s).sort().join(',')!=='instanceId,organizationId,ownerUserId'||!/^[a-f0-9]{32}$/.test(s.instanceId)||!text(s.organizationId,256)||!text(s.ownerUserId,256))fail('INVALID_SAVED_HISTORY_SCOPE',422);
 if(db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get()?.instance_id!==s.instanceId)fail('SAVED_HISTORY_UNAVAILABLE',404);
}
function archived(db,id){return db.prepare(`SELECT event_type FROM context_checkpoint_audit_events WHERE project_id IS NULL AND conversation_id=? AND archive_sequence IS NOT NULL ORDER BY archive_sequence DESC LIMIT 1`).get(id)?.event_type==='conversation_archived'}
function captured(db,s,id){
 const c=db.prepare(`SELECT c.*,CAST(c.title AS BLOB) AS title_bytes FROM context_conversations c WHERE c.id=? AND c.project_id IS NULL AND c.scope_kind='workspace' AND c.visibility='private' AND c.organization_id=? AND c.owner_user_id=?`).get(id,s.organizationId,s.ownerUserId);
 if(!c)fail('SAVED_HISTORY_UNAVAILABLE',404);
 if(!hex(c.binding_hash)||!integer(c.binding_epoch)||!hex(c.execution_generation)||!text(c.workspace_id,256)||!text(c.runtime_id,256)||!Number.isFinite(Date.parse(c.created_at)))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 const sources=db.prepare(`SELECT * FROM context_conversation_sources WHERE conversation_id=? AND project_id IS NULL`).all(id);
 if(sources.length!==1)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');const source=sources[0];
 if(source.workspace_id!==c.workspace_id||source.runtime_id!==c.runtime_id||source.execution_generation!==c.execution_generation||(!text(source.source_session_id,512)||/[\/\\]/.test(source.source_session_id))||!integer(source.entry_count)||!hex(source.snapshot_hash))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 const unique=db.prepare(`SELECT count(*) n FROM context_conversation_sources WHERE project_id IS NULL AND workspace_id=? AND runtime_id=? AND execution_generation=? AND source_session_id=?`).get(c.workspace_id,c.runtime_id,c.execution_generation,source.source_session_id).n;
 const meta=json(c.metadata),mapping={source:'opencode-chat',sourceRuntimeId:c.runtime_id,sourceSessionId:source.source_session_id},key='engine:'+digest([c.workspace_id,c.runtime_id,c.execution_generation,source.source_session_id]);
 if(unique!==1||source.source_key!==key||c.idempotency_key!==key||c.request_hash!==digest(mapping)||Object.keys(mapping).some(k=>meta[k]!==mapping[k]))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 // Captured immutable provenance is checked here, never current runtime state,
 // lease, capability or filesystem availability. No live authority is returned.
 const original=db.prepare(`SELECT runtime_id FROM runtime_original_provisions WHERE runtime_id=? AND schema_version=2 AND project_id IS NULL AND workspace_id=? AND organization_id=? AND owner_user_id=? AND binding_hash=? AND binding_epoch=? AND start_identity=?`).get(c.runtime_id,c.workspace_id,c.organization_id,c.owner_user_id,c.binding_hash,c.binding_epoch,c.execution_generation);
 if(!original)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 const count=db.prepare('SELECT count(*) n FROM context_messages WHERE project_id IS NULL AND conversation_id=?').get(id).n;
 if(!integer(count)||count!==source.entry_count)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 return {c,source,revision:count,title:decoded(c.title_bytes,256),archived:archived(db,id)};
}
function record(s,{c,source,revision,title,archived}){return {version:1,kind:'saved-workspace-chat',id:c.id,scope:{...s},title,createdAt:c.created_at,revision,archived,source:{workspaceId:c.workspace_id,runtimeId:c.runtime_id,executionGeneration:c.execution_generation,engineSessionId:source.source_session_id,snapshotHash:source.snapshot_hash}}}
function references(db,{c,source,revision}){
 const h=createHash('sha256');h.update('[');let count=0;
 for(const row of db.prepare(`SELECT sequence,role,content_hash,source_fingerprint FROM context_conversation_source_messages WHERE project_id IS NULL AND source_id=? AND conversation_id=? ORDER BY sequence`).iterate(source.id,c.id)){
  if(row.sequence!==count||!['user','assistant'].includes(row.role)||!hex(row.content_hash)||!hex(row.source_fingerprint))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
  if(count)h.update(',');h.update(JSON.stringify({content_hash:row.content_hash,role:row.role,sequence:row.sequence,source_fingerprint:row.source_fingerprint}));count++;
 }
 h.update(']');if(count!==revision||h.digest('hex')!==source.snapshot_hash)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
}
export function listSavedWorkspaceHistory(db,s,{workspaceId=null,afterCreatedAt='',afterId='',limit=30,includeArchived=false}={}){
 scope(db,s);if(workspaceId!==null&&!text(workspaceId,256)||typeof afterCreatedAt!=='string'||afterCreatedAt.length>64||typeof afterId!=='string'||afterId.length>256||!Number.isSafeInteger(limit)||limit<1||limit>50||typeof includeArchived!=='boolean'||Boolean(afterCreatedAt)!==Boolean(afterId))fail('INVALID_SAVED_HISTORY_INPUT',422);
 const rows=db.prepare(`SELECT c.id FROM context_conversations c WHERE c.project_id IS NULL AND c.scope_kind='workspace' AND c.visibility='private' AND c.organization_id=? AND c.owner_user_id=? AND (? IS NULL OR c.workspace_id=?) AND (?='' OR c.created_at<? OR(c.created_at=? AND c.id<?)) AND EXISTS(SELECT 1 FROM context_conversation_sources source WHERE source.project_id IS NULL AND source.conversation_id=c.id) ${includeArchived?'':`AND COALESCE((SELECT e.event_type FROM context_checkpoint_audit_events e WHERE e.project_id IS NULL AND e.conversation_id=c.id AND e.archive_sequence IS NOT NULL ORDER BY e.archive_sequence DESC LIMIT 1),'')<>'conversation_archived'`} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`).all(s.organizationId,s.ownerUserId,workspaceId,workspaceId,afterCreatedAt,afterCreatedAt,afterCreatedAt,afterId,limit+1);
 const selected=rows.slice(0,limit),data=selected.map(row=>record(s,captured(db,s,row.id))),last=data.at(-1);
 return {data,pagination:{hasMore:rows.length>limit,afterCreatedAt:last?.createdAt??afterCreatedAt,afterId:last?.id??afterId}};
}
export function readSavedWorkspaceHistory(db,s,id,{expectedRevision,afterSequence=-1,limit=20}={}){
 scope(db,s);if(!text(id,256)||!Number.isSafeInteger(afterSequence)||afterSequence< -1||!Number.isSafeInteger(limit)||limit<1||limit>50||expectedRevision!==undefined&&!integer(expectedRevision))fail('INVALID_SAVED_HISTORY_INPUT',422);
 const saved=captured(db,s,id);references(db,saved);const {c,source,revision}=saved;
 if(expectedRevision!==undefined&&expectedRevision!==revision)fail('SAVED_HISTORY_CHANGED');
 if(afterSequence>=revision&&afterSequence!==-1)fail('INVALID_SAVED_HISTORY_INPUT',422);
 const messages=[];let bytes=0,contentBytes=0;
 const rows=db.prepare(`SELECT m.id,m.sequence,m.role,CAST(m.content AS BLOB) AS content_bytes,typeof(m.content) AS content_type,m.content_hash,m.request_hash,m.idempotency_key,m.tags,m.priority,m.metadata,m.created_at,x.sequence AS source_sequence,x.role AS source_role,x.content_hash AS source_hash,x.source_fingerprint FROM context_messages m LEFT JOIN context_conversation_source_messages x ON x.project_id IS NULL AND x.source_id=? AND x.conversation_id=m.conversation_id AND x.message_id=m.id WHERE m.project_id IS NULL AND m.conversation_id=? AND m.sequence>? ORDER BY m.sequence LIMIT ?`);
 for(const row of rows.iterate(source.id,id,afterSequence,limit+1)){
  if(messages.length===limit)break;
  const content=decoded(row.content_bytes,262144),meta=json(row.metadata),fingerprint=digest([c.runtime_id,c.execution_generation,source.source_session_id,meta.sourceMessageId,row.role]);
  if(row.content_type!=='text'||row.sequence!==afterSequence+messages.length+1||!['user','assistant'].includes(row.role)||sha(row.content_bytes)!==row.content_hash||row.source_hash!==row.content_hash||row.source_sequence!==row.sequence||row.source_role!==row.role||meta.source!=='opencode-chat'||meta.sourceRuntimeId!==c.runtime_id||meta.sourceSessionId!==source.source_session_id||!text(meta.sourceMessageId,512)||row.source_fingerprint!==fingerprint||row.idempotency_key!=='engine-'+row.role+':'+fingerprint||row.tags!=='[]'||row.priority!==5||row.request_hash!==digest({role:row.role,content,expectedRevision:row.sequence,tags:[],priority:5,metadata:meta})||!Number.isFinite(Date.parse(row.created_at)))fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
  const message={id:row.id,sequence:row.sequence,role:row.role,content,contentHash:row.content_hash,createdAt:row.created_at,sourceMessageId:meta.sourceMessageId},size=Buffer.byteLength(JSON.stringify(message));
  // Preserve a legal single message verbatim even when JSON control escapes
  // expand it; never split or normalize its original content.
  if(size>2097152)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');if(messages.length&&bytes+size>1048576)break;bytes+=size;contentBytes+=Buffer.byteLength(content);messages.push(message);
 }
 const cursor=messages.at(-1)?.sequence??afterSequence;
 if(cursor<revision-1&&!messages.length)fail('SAVED_HISTORY_INTEGRITY_UNAVAILABLE');
 return {conversation:record(s,saved),messages,pagination:{hasMore:cursor<revision-1,afterSequence:cursor},verifiedContentBytes:contentBytes,serializedMessageBytes:bytes};
}
