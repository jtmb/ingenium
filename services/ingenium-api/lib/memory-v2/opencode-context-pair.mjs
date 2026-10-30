import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
/** Read only: exact real engine pair -> private existing Context/checkpoint IDs.
 * This never writes/corrects/transforms a transcript to make a mapping succeed.
 */
export function mapCanonicalContextPair(db,{scope,execution,chatId,user,assistant}) {
 if(scope.projectId===null)return null;
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
 if(scope.projectId===null)return null;
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
