import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
/** Read only: exact real engine pair -> private existing Context/checkpoint IDs.
 * This never writes/corrects/transforms a transcript to make a mapping succeed.
 */
export function mapCanonicalContextPair(db,{scope,execution,chatId,user,assistant}) {
 if(scope.projectId===null)return mapWorkspacePair(db,{scope,execution,chatId,user,assistant});
 const rows=db.prepare(`SELECT m.id,m.conversation_id,m.sequence,m.role,m.content,m.content_hash,m.idempotency_key,
   json_extract(m.metadata,'$.sourceMessageId') AS engine_id
   FROM context_messages m JOIN context_conversations c ON c.project_id=m.project_id AND c.id=m.conversation_id
   WHERE m.project_id=? AND c.organization_id=? AND c.owner_user_id=? AND c.visibility='private'
    AND json_extract(c.metadata,'$.source')='opencode-chat' AND json_extract(c.metadata,'$.sourceRuntimeId')=?
    AND json_extract(c.metadata,'$.sourceSessionId')=? AND json_extract(m.metadata,'$.source')='opencode-chat'
    AND json_extract(m.metadata,'$.sourceRuntimeId')=? AND json_extract(m.metadata,'$.sourceSessionId')=?
    AND json_extract(m.metadata,'$.sourceMessageId') IN (?,?)`)
   .all(scope.projectId,scope.organizationId,scope.ownerUserId,execution.runtimeId,chatId,execution.runtimeId,chatId,user.id,assistant.id);
 if(rows.length!==2)return null;
 const u=rows.find(row=>row.engine_id===user.id),a=rows.find(row=>row.engine_id===assistant.id);
 const key=(role,id)=>`opencode-${role}:${hash(`${execution.runtimeId}\0${chatId}\0${id}`)}`;
 if(!u||!a||u.role!=='user'||a.role!=='assistant'||u.conversation_id!==a.conversation_id||u.sequence+1!==a.sequence
  ||u.content!==user.content||a.content!==assistant.content||u.content_hash!==hash(user.content)||a.content_hash!==hash(assistant.content)
  ||u.idempotency_key!==key('user',user.id)||a.idempotency_key!==key('assistant',assistant.id))return null;
 const checkpoint=db.prepare(`SELECT message_count FROM context_checkpoints WHERE project_id=? AND conversation_id=?
  AND through_message_id=? AND idempotency_key=? AND json_extract(metadata,'$.source')='opencode-chat'
  AND json_extract(metadata,'$.sourceRuntimeId')=? AND json_extract(metadata,'$.sourceSessionId')=?
  AND json_extract(metadata,'$.sourceAssistantMessageId')=?`)
  .get(scope.projectId,u.conversation_id,a.id,key('checkpoint',assistant.id),execution.runtimeId,chatId,assistant.id);
 if(!checkpoint||checkpoint.message_count!==a.sequence+1
   ||db.prepare('SELECT COUNT(*) AS count FROM context_messages WHERE project_id=? AND conversation_id=? AND sequence<=?').get(scope.projectId,u.conversation_id,a.sequence).count!==checkpoint.message_count)return null;
 return {conversationId:u.conversation_id,sourceRefs:[{id:u.id,contentHash:u.content_hash},{id:a.id,contentHash:a.content_hash}]};
}

/** Candidate mapping only, not engine proof. Persisted refs supply Context ID/hash;
 * existing source metadata and retained adjacent checkpoint locate exact members.
 */
export function resolveContextPairCandidate(db,{scope,execution,chatId,sourceRef}) {
 if(scope.projectId===null)return resolveWorkspaceContextPairCandidate(db,{scope,execution,chatId,sourceRef});
 const source=db.prepare(`SELECT m.id,m.conversation_id,m.sequence,m.role,m.content,m.content_hash
  FROM context_messages m JOIN context_conversations c ON c.project_id=m.project_id AND c.id=m.conversation_id
  WHERE m.id=? AND m.project_id=? AND c.organization_id=? AND c.owner_user_id=? AND c.visibility='private'
   AND json_extract(c.metadata,'$.source')='opencode-chat' AND json_extract(c.metadata,'$.sourceRuntimeId')=?
   AND json_extract(c.metadata,'$.sourceSessionId')=?`).get(sourceRef.id,scope.projectId,scope.organizationId,scope.ownerUserId,execution.runtimeId,chatId);
 if(!source||source.content_hash!==sourceRef.contentHash||typeof source.content!=='string'||hash(source.content)!==sourceRef.contentHash||!['user','assistant'].includes(source.role))return null;
 const first=source.role==='user'?source.sequence:source.sequence-1;
 const rows=db.prepare(`SELECT role,content,json_extract(metadata,'$.sourceMessageId') AS engine_id FROM context_messages
  WHERE project_id=? AND conversation_id=? AND sequence IN (?,?) ORDER BY sequence`).all(scope.projectId,source.conversation_id,first,first+1);
 if(rows.length!==2||rows[0].role!=='user'||rows[1].role!=='assistant'||rows.some(row=>typeof row.engine_id!=='string'||!row.engine_id))return null;
 const user={id:rows[0].engine_id,content:rows[0].content},assistant={id:rows[1].engine_id,content:rows[1].content};
 const mapping=mapCanonicalContextPair(db,{scope,execution,chatId,user,assistant});
 return mapping?{...mapping,user,assistant}:null;
}

// Workspace-v2 sources are a separate canonical profile. Reads remain bounded
// to one original pair/checkpoint and require the current original generation.
// A source label, restored transcript or legacy/global Project cannot qualify it.
const canonical=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
const digest=value=>hash(JSON.stringify(canonical(value)));
const object=value=>{try{const x=JSON.parse(value);return x&&typeof x==='object'&&!Array.isArray(x)?x:null;}catch{return null;}};
function workspaceSourceBinding(db,{scope,execution,chatId}){
 if(scope.projectId!==null||execution.projectId!==null||scope.visibility!=='private'||execution.runtimeId===undefined||execution.mode!=='runtime'||['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch'].some(key=>scope[key]!==execution[key]))return null;
 const rows=db.prepare(`SELECT c.*,s.id AS source_id,s.source_key,s.entry_count,s.source_session_id
  FROM context_conversations c JOIN context_conversation_sources s ON s.conversation_id=c.id AND s.project_id IS NULL
  JOIN authorized_workspaces w ON w.id=c.workspace_id AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized'
  JOIN runtime_instances r ON r.id=c.runtime_id AND r.workspace_id=w.id AND r.schema_version=2 AND r.project_id IS NULL
  JOIN runtime_original_provisions o ON o.runtime_id=r.id AND o.schema_version=2 AND o.project_id IS NULL
  WHERE c.project_id IS NULL AND c.scope_kind='workspace' AND c.visibility='private'
   AND c.organization_id=? AND c.owner_user_id=? AND c.workspace_id=? AND c.binding_hash=? AND c.binding_epoch=?
   AND c.runtime_id=? AND s.workspace_id=c.workspace_id AND s.runtime_id=c.runtime_id AND s.execution_generation=c.execution_generation AND s.source_session_id=?
   AND w.organization_id=c.organization_id AND w.owner_user_id=c.owner_user_id AND w.storage_mapping_hash=c.binding_hash AND w.security_epoch=c.binding_epoch
   AND r.organization_id=c.organization_id AND r.owner_user_id=c.owner_user_id AND r.security_epoch=c.binding_epoch AND r.state IN ('READY','IDLE')
   AND o.workspace_id=c.workspace_id AND o.organization_id=c.organization_id AND o.owner_user_id=c.owner_user_id
   AND o.binding_hash=c.binding_hash AND o.binding_epoch=c.binding_epoch AND o.start_identity=c.execution_generation
   AND o.parent_container_id=r.backend_container_id AND o.host_id=?`)
  .all(scope.organizationId,scope.ownerUserId,scope.workspaceId,scope.bindingHash,scope.bindingEpoch,execution.runtimeId,chatId,scope.hostId);
 if(rows.length!==1)return null;const c=rows[0],meta=object(c.metadata);
 const sourceKey='engine:'+digest([scope.workspaceId,execution.runtimeId,c.execution_generation,chatId]);
 if(!/^[a-f0-9]{64}$/.test(c.execution_generation)||c.source_key!==sourceKey||c.idempotency_key!==sourceKey
  ||meta?.source!=='opencode-chat'||meta.sourceRuntimeId!==execution.runtimeId||meta.sourceSessionId!==chatId
  ||!Number.isSafeInteger(c.entry_count)||c.entry_count<2
  ||db.prepare('SELECT count(*) AS n FROM context_conversation_source_messages WHERE project_id IS NULL AND source_id=? AND conversation_id=?').get(c.source_id,c.id).n!==c.entry_count
  ||db.prepare('SELECT count(*) AS n FROM context_messages WHERE project_id IS NULL AND conversation_id=?').get(c.id).n!==c.entry_count)return null;
 return c;
}
function workspaceMessage(db,c,{scope,execution,chatId},where,value){
 // where is chosen only by the fixed internal call sites below.
 const rows=db.prepare(`SELECT m.*,x.source_fingerprint,x.sequence AS source_sequence,x.role AS source_role,x.content_hash AS source_hash
  FROM context_messages m JOIN context_conversation_source_messages x ON x.message_id=m.id AND x.conversation_id=m.conversation_id AND x.project_id IS NULL
  WHERE m.project_id IS NULL AND m.conversation_id=? AND x.source_id=? AND ${where}`)
  .all(c.id,c.source_id,value);
 if(rows.length!==1)return null;const m=rows[0],meta=object(m.metadata);
 if(!['user','assistant'].includes(m.role)||typeof m.content!=='string'||hash(m.content)!==m.content_hash||m.content_hash!==m.source_hash||m.sequence!==m.source_sequence||m.role!==m.source_role
  ||meta?.source!=='opencode-chat'||meta.sourceRuntimeId!==execution.runtimeId||meta.sourceSessionId!==chatId||typeof meta.sourceMessageId!=='string'||!meta.sourceMessageId.length)return null;
 const fingerprint=digest([execution.runtimeId,c.execution_generation,chatId,meta.sourceMessageId,m.role]);
 if(m.source_fingerprint!==fingerprint||m.idempotency_key!=='engine-'+m.role+':'+fingerprint||m.tags!=='[]'||m.priority!==5
  ||m.request_hash!==digest({role:m.role,content:m.content,expectedRevision:m.sequence,tags:[],priority:5,metadata:meta}))return null;
 return {...m,engine_id:meta.sourceMessageId};
}
function workspacePair(db,c,input,assistant){
 if(!assistant||assistant.role!=='assistant')return null;
 const preceding=db.prepare(`SELECT id FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND role='user' AND sequence<? ORDER BY sequence DESC LIMIT 1`).get(c.id,assistant.sequence);
 const user=preceding?workspaceMessage(db,c,input,'m.id=?',preceding.id):null;if(!user||user.role!=='user')return null;
 const checkpoints=db.prepare(`SELECT * FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=? AND through_message_id=? AND idempotency_key=?`).all(c.id,assistant.id,'engine-checkpoint:'+digest([c.execution_generation,assistant.engine_id]));
 if(checkpoints.length!==1)return null;const cp=checkpoints[0],meta=object(cp.metadata);
 if(meta?.source!=='opencode-chat'||meta.sourceRuntimeId!==input.execution.runtimeId||meta.sourceSessionId!==input.chatId||cp.message_count!==assistant.sequence+1
  ||cp.request_hash!==digest({expectedRevision:cp.message_count,metadata:meta,ragSourceIds:[]})
  ||db.prepare('SELECT count(*) AS n FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND sequence<=?').get(c.id,assistant.sequence).n!==cp.message_count)return null;
 return {conversationId:c.id,sourceRefs:[{id:user.id,contentHash:user.content_hash},{id:assistant.id,contentHash:assistant.content_hash}],user:{id:user.engine_id,content:user.content},assistant:{id:assistant.engine_id,content:assistant.content}};
}
function mapWorkspacePair(db,input){
 const c=workspaceSourceBinding(db,input);if(!c)return null;
 const assistant=workspaceMessage(db,c,input,"json_extract(m.metadata,'$.sourceMessageId')=?",input.assistant.id);
 const pair=workspacePair(db,c,input,assistant);
 return pair&&pair.user.id===input.user.id&&pair.user.content===input.user.content&&pair.assistant.content===input.assistant.content?{conversationId:pair.conversationId,sourceRefs:pair.sourceRefs}:null;
}
function resolveWorkspaceContextPairCandidate(db,input){
 const c=workspaceSourceBinding(db,input);if(!c)return null;
 const source=workspaceMessage(db,c,input,'m.id=?',input.sourceRef.id);
 if(!source||source.content_hash!==input.sourceRef.contentHash)return null;
 const next=source.role==='user'?db.prepare(`SELECT id FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND sequence>? ORDER BY sequence LIMIT 1`).get(c.id,source.sequence):null;
 const assistant=source.role==='assistant'?source:next?workspaceMessage(db,c,input,'m.id=?',next.id):null;
 const pair=workspacePair(db,c,input,assistant);
 return pair&&pair.sourceRefs.some(ref=>ref.id===source.id&&ref.contentHash===source.content_hash)?pair:null;
}
