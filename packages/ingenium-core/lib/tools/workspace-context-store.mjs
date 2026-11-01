/** Internal canonical Context transaction primitives. NOT a request/placement owner.
 * API exports require the original request identity + execution owner on every operation.
 * Original engine creation owner alone calls linkOriginalEngineInTransaction using its
 * retained successful engine response, NEVER a browser/link DTO or metadata lookup.
 */
import {createHash,randomUUID,randomBytes} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=v=>createHash('sha256').update(v).digest('hex');
function canonical(value) {
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 fail('INVALID_WORKSPACE_CONTEXT_INPUT');
}
const hash=v=>sha(JSON.stringify(canonical(v)));
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('INVALID_WORKSPACE_CONTEXT_INPUT');};
function metadata(v={}) {
 canonical(v);if(!v||Array.isArray(v)||typeof v!=='object'||Buffer.byteLength(JSON.stringify(v))>16384)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return v;
}
const stamp=()=>new Date().toISOString();
function tx(db){if(!db.inTransaction)fail('ORIGINAL_CONTEXT_TRANSACTION_REQUIRED');}
export function assertWorkspaceStoreScope(db,s,{activeExecution=true}={}) {
 if(!s||s.projectId!==null||!text(s.organizationId,256)||!text(s.ownerUserId,256)||!text(s.workspaceId,256)||!text(s.runtimeId,256)||!hex(s.bindingHash)||!integer(s.bindingEpoch)||!hex(s.executionGeneration))fail('WORKSPACE_CONTEXT_SCOPE_UNAVAILABLE');
 const found=db.prepare(`SELECT r.revision,r.backend_container_id FROM authorized_workspaces w
 JOIN runtime_instances r ON r.workspace_id=w.id
 JOIN runtime_original_provisions o ON o.runtime_id=r.id
 JOIN organization_memberships m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id
 WHERE w.id=? AND w.project_id IS NULL AND w.schema_version=2 AND w.status='authorized'
 AND w.organization_id=? AND w.owner_user_id=? AND w.storage_mapping_hash=? AND w.security_epoch=?
 AND r.id=? AND r.project_id IS NULL AND r.schema_version=2 AND r.organization_id=w.organization_id
 AND r.owner_user_id=w.owner_user_id AND r.security_epoch=w.security_epoch
 AND o.schema_version=2 AND o.project_id IS NULL AND o.workspace_id=w.id AND o.organization_id=w.organization_id
 AND o.owner_user_id=w.owner_user_id AND o.binding_hash=w.storage_mapping_hash AND o.binding_epoch=w.security_epoch
 AND o.parent_container_id=r.backend_container_id AND o.start_identity=? AND m.status='active'
 ${activeExecution?"AND r.state IN ('READY','IDLE')":''}`).get(s.workspaceId,s.organizationId,s.ownerUserId,s.bindingHash,s.bindingEpoch,s.runtimeId,s.executionGeneration);
 if(!found)fail('WORKSPACE_CONTEXT_SCOPE_UNAVAILABLE');return found;
}
function conversation(db,s,id,{active=false,currentGeneration=false}={}) {
 const c=db.prepare(`SELECT * FROM context_conversations WHERE id=? AND project_id IS NULL AND scope_kind='workspace'
 AND organization_id=? AND owner_user_id=? AND workspace_id=? AND visibility='private'`).get(id,s.organizationId,s.ownerUserId,s.workspaceId);
 if(!c)fail('WORKSPACE_CONTEXT_NOT_FOUND');
 if(currentGeneration&&(c.runtime_id!==s.runtimeId||c.binding_hash!==s.bindingHash||c.binding_epoch!==s.bindingEpoch||c.execution_generation!==s.executionGeneration))fail('WORKSPACE_CONTEXT_GENERATION_CHANGED');
 if(active&&isArchived(db,id))fail('WORKSPACE_CONTEXT_ARCHIVED');return c;
}
export function isArchived(db,id) {return db.prepare(`SELECT event_type FROM context_checkpoint_audit_events WHERE project_id IS NULL AND conversation_id=? AND archive_sequence IS NOT NULL ORDER BY archive_sequence DESC LIMIT 1`).get(id)?.event_type==='conversation_archived';}
function revision(db,id){return db.prepare('SELECT count(*) AS n FROM context_messages WHERE project_id IS NULL AND conversation_id=?').get(id).n;}
function cas(actual,expected){if(!integer(expected)||actual!==expected)fail('WORKSPACE_CONTEXT_REVISION_CONFLICT');}
function idem(db,table,id,key,requestHash){
 if(key!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(key))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 if(key===undefined)return;
 const row=db.prepare(`SELECT * FROM ${table} WHERE project_id IS NULL AND conversation_id=? AND idempotency_key=?`).get(id,key);
 if(row&&row.request_hash!==requestHash)fail('WORKSPACE_CONTEXT_IDEMPOTENCY_CONFLICT');return row;
}
function insertConversation(db,s,{title,tags=[],priority=5,metadata:meta={},idempotencyKey},requestHash) {
 if(!text(title,256)||!Array.isArray(tags)||tags.some(t=>!text(t,128))||Buffer.byteLength(JSON.stringify(tags))>4096||!Number.isInteger(priority)||priority<0||priority>10)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 metadata(meta);if(idempotencyKey!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const prior=idempotencyKey===undefined?null:db.prepare('SELECT * FROM context_conversations WHERE project_id IS NULL AND workspace_id=? AND idempotency_key=?').get(s.workspaceId,idempotencyKey);
 if(prior){if(prior.request_hash!==requestHash)fail('WORKSPACE_CONTEXT_IDEMPOTENCY_CONFLICT');conversation(db,s,prior.id);return {conversation:prior,idempotent:true};}
 const id=randomUUID();db.prepare(`INSERT INTO context_conversations(id,project_id,organization_id,owner_user_id,visibility,title,request_hash,idempotency_key,tags,priority,metadata,created_at,scope_kind,workspace_id,runtime_id,binding_hash,binding_epoch,execution_generation)
 VALUES(?,NULL,?,?,'private',?,?,?,?,?,?,?,'workspace',?,?,?,?,?)`).run(id,s.organizationId,s.ownerUserId,title,requestHash,idempotencyKey??null,JSON.stringify(tags),priority,JSON.stringify(meta),stamp(),s.workspaceId,s.runtimeId,s.bindingHash,s.bindingEpoch,s.executionGeneration);
 return {conversation:conversation(db,s,id),idempotent:false};
}
export function createInTransaction(db,s,input) {
 tx(db);assertWorkspaceStoreScope(db,s);exact(input,['title','tags','priority','metadata','idempotencyKey']);
 const m=metadata(input.metadata);if(['source','sourceRuntimeId','sourceSessionId','restoredFrom','kind'].some(k=>Object.hasOwn(m,k)))fail('RESERVED_CONTEXT_METADATA');
 return insertConversation(db,s,input,hash(input));
}
/** Internal original-response consumer, not installed on /chat-sessions/link.
 * Retained engine IDs are exact bytes. No placeholder message/count or inferred label.
 */
export function linkOriginalEngineInTransaction(db,s,{engineSessionId,title}) {
 tx(db);assertWorkspaceStoreScope(db,s);
 if(!text(engineSessionId,512)||/[\/\\\u0000-\u001f\u007f]/.test(engineSessionId))fail('INVALID_ORIGINAL_ENGINE_SESSION');
 const existing=db.prepare(`SELECT conversation_id FROM context_conversation_sources WHERE project_id IS NULL AND workspace_id=? AND runtime_id=? AND execution_generation=? AND source_session_id=?`).get(s.workspaceId,s.runtimeId,s.executionGeneration,engineSessionId);
 if(existing)return {conversation:conversation(db,s,existing.conversation_id,{currentGeneration:true}),idempotent:true};
 const mapping={source:'opencode-chat',sourceRuntimeId:s.runtimeId,sourceSessionId:engineSessionId};
 const key='engine:'+hash([s.workspaceId,s.runtimeId,s.executionGeneration,engineSessionId]);
 const result=insertConversation(db,s,{title,tags:['chat','opencode'],metadata:mapping,idempotencyKey:key},hash(mapping));
 const sourceId=randomUUID();
 db.prepare(`INSERT INTO context_conversation_sources(id,project_id,source_key,source_session_id,conversation_id,snapshot_hash,entry_count,created_at,updated_at,workspace_id,runtime_id,execution_generation)
 VALUES(?,NULL,?,?,?,?,0,?,?,?,?,?)`).run(sourceId,key,engineSessionId,result.conversation.id,hash([]),stamp(),stamp(),s.workspaceId,s.runtimeId,s.executionGeneration);
 return result;
}
export function resolveEngineMapping(db,s,id,{purpose='active'}={}) {
 if(!['active','history'].includes(purpose))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const c=conversation(db,s,id,{active:purpose==='active',currentGeneration:purpose==='active'});
 const mapping=db.prepare(`SELECT * FROM context_conversation_sources WHERE project_id IS NULL AND conversation_id=? AND workspace_id=?`).get(c.id,s.workspaceId);
 if(!mapping||mapping.runtime_id!==c.runtime_id||mapping.execution_generation!==c.execution_generation||!mapping.source_session_id)fail('WORKSPACE_ENGINE_MAPPING_UNAVAILABLE');
 return {contextConversationId:c.id,engineSessionId:mapping.source_session_id,runtimeId:mapping.runtime_id,executionGeneration:mapping.execution_generation,purpose};
}
export function getConversation(db,s,id){const c=conversation(db,s,id);return {...c,revision:revision(db,id),archived:isArchived(db,id)};}
export function listConversations(db,s,{afterCreatedAt='',afterId='',limit=50,includeArchived=false}={}) {
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||typeof afterCreatedAt!=='string'||typeof afterId!=='string'||typeof includeArchived!=='boolean')fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return db.prepare(`SELECT c.*,(SELECT count(*) FROM context_messages m WHERE m.project_id IS NULL AND m.conversation_id=c.id) AS revision
 FROM context_conversations c WHERE c.project_id IS NULL AND c.scope_kind='workspace' AND c.organization_id=? AND c.owner_user_id=? AND c.workspace_id=? AND c.visibility='private'
 AND (?='' OR c.created_at>? OR (c.created_at=? AND c.id>?))
 ${includeArchived?'':`AND COALESCE((SELECT e.event_type FROM context_checkpoint_audit_events e WHERE e.project_id IS NULL AND e.conversation_id=c.id AND e.archive_sequence IS NOT NULL ORDER BY e.archive_sequence DESC LIMIT 1),'')<>'conversation_archived'`}
 ORDER BY c.created_at,c.id LIMIT ?`).all(s.organizationId,s.ownerUserId,s.workspaceId,afterCreatedAt,afterCreatedAt,afterCreatedAt,afterId,limit);
}
export function listMessageSummaries(db,s,id,{afterSequence=-1,limit=50}={}) {
 conversation(db,s,id);if(!Number.isSafeInteger(afterSequence)||afterSequence< -1||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return db.prepare(`SELECT id,project_id,conversation_id,sequence,role,content_hash,tags,priority,metadata,created_at FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?`).all(id,afterSequence,limit);
}
export function retrieveMessages(db,s,id,ids) {
 conversation(db,s,id);if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(v=>!text(v,256)))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const result=db.prepare(`SELECT * FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND id IN (${ids.map(()=>'?').join(',')})`).all(id,...ids);
 const found=new Map(result.map(x=>[x.id,x]));return {messages:ids.flatMap(i=>found.has(i)?[found.get(i)]:[]),missingIds:[...new Set(ids)].filter(i=>!found.has(i))};
}
function appendMessageInTransaction(db,s,id,input,originalEngine=false) {
 tx(db);assertWorkspaceStoreScope(db,s);conversation(db,s,id,{active:true,currentGeneration:true});
 if(!originalEngine&&db.prepare('SELECT 1 FROM context_conversation_sources WHERE project_id IS NULL AND conversation_id=?').get(id))fail('ORIGINAL_ENGINE_TURN_OWNER_REQUIRED');
 exact(input,['role','content','expectedRevision','idempotencyKey','tags','priority','metadata']);
 const {role,content,expectedRevision,idempotencyKey,tags=[],priority=5}=input,meta=metadata(input.metadata);
 if(!['user','assistant','system','tool'].includes(role)||!text(content,262144)||!Array.isArray(tags)||tags.some(t=>!text(t,128))||Buffer.byteLength(JSON.stringify(tags))>4096||!Number.isInteger(priority)||priority<0||priority>10)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const requestHash=hash({role,content,expectedRevision,tags,priority,metadata:meta});
 const prior=idem(db,'context_messages',id,idempotencyKey,requestHash);if(prior)return {message:prior,revision:revision(db,id),idempotent:true};
 const n=revision(db,id);cas(n,expectedRevision);const messageId=randomUUID();
 db.prepare(`INSERT INTO context_messages(id,project_id,conversation_id,sequence,role,content,content_hash,request_hash,idempotency_key,tags,priority,metadata,created_at) VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,?)`).run(messageId,id,n,role,content,sha(content),requestHash,idempotencyKey??null,JSON.stringify(tags),priority,JSON.stringify(meta),stamp());
 return {message:db.prepare('SELECT * FROM context_messages WHERE id=? AND project_id IS NULL').get(messageId),revision:n+1,idempotent:false};
}
function stateHash(messages){return sha(JSON.stringify(messages.map(m=>({sequence:m.sequence,role:m.role,content_hash:m.content_hash,tags:m.tags,priority:m.priority,metadata:m.metadata}))));}
export function checkpointInTransaction(db,s,id,input) {
 tx(db);assertWorkspaceStoreScope(db,s);conversation(db,s,id,{active:true,currentGeneration:true});
 exact(input,['expectedRevision','idempotencyKey','metadata','ragSourceIds']);
 if(input.ragSourceIds!==undefined&&(!Array.isArray(input.ragSourceIds)||input.ragSourceIds.length))fail('WORKSPACE_RAG_OWNER_UNAVAILABLE');
 const meta=metadata(input.metadata),requestHash=hash({expectedRevision:input.expectedRevision,metadata:meta,ragSourceIds:[]});
 const prior=idem(db,'context_checkpoints',id,input.idempotencyKey,requestHash);if(prior)return {checkpoint:prior,revision:revision(db,id),idempotent:true};
 const n=revision(db,id);cas(n,input.expectedRevision);if(n===0)fail('WORKSPACE_CONTEXT_NO_MESSAGES');
 const messages=db.prepare('SELECT * FROM context_messages WHERE project_id IS NULL AND conversation_id=? ORDER BY sequence').all(id);
 if(messages.some((m,i)=>m.sequence!==i||sha(m.content)!==m.content_hash))fail('WORKSPACE_CHECKPOINT_INTEGRITY');
 const seq=db.prepare('SELECT count(*) AS n FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=?').get(id).n,cpId=randomUUID();
 db.prepare(`INSERT INTO context_checkpoints(id,project_id,conversation_id,sequence,through_message_id,message_count,state_hash,request_hash,idempotency_key,metadata,created_at) VALUES(?,NULL,?,?,?,?,?,?,?,?,?)`).run(cpId,id,seq,messages.at(-1).id,n,stateHash(messages),requestHash,input.idempotencyKey??null,JSON.stringify(meta),stamp());
 return {checkpoint:db.prepare('SELECT * FROM context_checkpoints WHERE project_id IS NULL AND id=?').get(cpId),revision:n,idempotent:false};
}
export function listCheckpoints(db,s,id,{beforeSequence=Number.MAX_SAFE_INTEGER,limit=50}={}) {
 conversation(db,s,id);if(!integer(beforeSequence)||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return db.prepare('SELECT * FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?').all(id,beforeSequence,limit);
}
export function authorizeMaintenanceInTransaction(db,s,id,input) {
 tx(db);assertWorkspaceStoreScope(db,s);conversation(db,s,id);
 exact(input,['operation','checkpointId','expectedRevision']);
 if(!['archive_conversation','unarchive_conversation','restore_checkpoint'].includes(input.operation))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const cp=input.checkpointId??null;if((input.operation==='restore_checkpoint')!==(cp!==null))fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 cas(revision(db,id),input.expectedRevision);
 if(cp&&!db.prepare('SELECT 1 FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=? AND id=?').get(id,cp))fail('WORKSPACE_CHECKPOINT_NOT_FOUND');
 const token=randomBytes(32).toString('base64url'),authId=randomUUID(),createdAt=stamp(),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
 db.prepare(`INSERT INTO context_checkpoint_maintenance_authorizations(id,project_id,operation,conversation_id,checkpoint_id,expected_revision,confirmation_hash,expires_at,created_at,organization_id,actor_type,actor_id) VALUES(?,NULL,?,?,?,?,?,?,?,?, 'user',?)`).run(authId,input.operation,id,cp,input.expectedRevision,sha(token),expiresAt,createdAt,s.organizationId,s.ownerUserId);
 return {operation:input.operation,conversationId:id,checkpointId:cp,expectedRevision:input.expectedRevision,confirmationToken:token,expiresAt};
}
function consume(db,s,id,operation,cp,expected,token) {
 if(!text(token,256))fail('WORKSPACE_MAINTENANCE_AUTHORIZATION_INVALID');
 const auth=db.prepare(`SELECT * FROM context_checkpoint_maintenance_authorizations WHERE project_id IS NULL AND conversation_id=? AND operation=? AND checkpoint_id IS ? AND expected_revision=? AND confirmation_hash=? AND organization_id=? AND actor_type='user' AND actor_id=? AND consumed_at IS NULL AND expires_at>?`).get(id,operation,cp,expected,sha(token),s.organizationId,s.ownerUserId,stamp());
 if(!auth)fail('WORKSPACE_MAINTENANCE_AUTHORIZATION_INVALID');
 if(db.prepare('UPDATE context_checkpoint_maintenance_authorizations SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(stamp(),auth.id).changes!==1)fail('WORKSPACE_MAINTENANCE_AUTHORIZATION_INVALID');return auth;
}
function audit(db,s,id,event,auth,{cp=null,target=null,state=null,sequence=null}={}) {
 const eventId=randomUUID();db.prepare(`INSERT INTO context_checkpoint_audit_events(id,project_id,event_type,conversation_id,checkpoint_id,target_conversation_id,expected_revision,checkpoint_state_hash,authorization_id,archive_sequence,created_at,organization_id,source_actor_type,source_actor_id) VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?,'user',?)`).run(eventId,event,id,cp,target,auth.expected_revision,state,auth.id,sequence,stamp(),s.organizationId,s.ownerUserId);
 return db.prepare('SELECT * FROM context_checkpoint_audit_events WHERE id=? AND project_id IS NULL').get(eventId);
}
export function archiveInTransaction(db,s,id,input) {
 tx(db);assertWorkspaceStoreScope(db,s);conversation(db,s,id);
 exact(input,['archived','expectedRevision','confirmationToken']);if(typeof input.archived!=='boolean')fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 cas(revision(db,id),input.expectedRevision);const auth=consume(db,s,id,input.archived?'archive_conversation':'unarchive_conversation',null,input.expectedRevision,input.confirmationToken);
 const seq=db.prepare('SELECT COALESCE(MAX(archive_sequence),-1)+1 AS n FROM context_checkpoint_audit_events WHERE project_id IS NULL AND conversation_id=?').get(id).n;
 return {archived:input.archived,event:audit(db,s,id,input.archived?'conversation_archived':'conversation_unarchived',auth,{sequence:seq})};
}
export function restoreInTransaction(db,s,id,checkpointId,input) {
 tx(db);assertWorkspaceStoreScope(db,s);const original=conversation(db,s,id);
 exact(input,['title','metadata','expectedRevision','confirmationToken','idempotencyKey']);
 const requestHash=hash({source:id,checkpointId,expectedRevision:input.expectedRevision,title:input.title??null,metadata:input.metadata??{}});
 const prior=input.idempotencyKey===undefined?null:db.prepare('SELECT * FROM context_conversations WHERE project_id IS NULL AND workspace_id=? AND idempotency_key=?').get(s.workspaceId,input.idempotencyKey);
 if(prior){if(prior.request_hash!==requestHash)fail('WORKSPACE_CONTEXT_IDEMPOTENCY_CONFLICT');conversation(db,s,prior.id);return {conversation:prior,idempotent:true};}
 cas(revision(db,id),input.expectedRevision);
 const cp=db.prepare('SELECT * FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=? AND id=?').get(id,checkpointId);if(!cp)fail('WORKSPACE_CHECKPOINT_NOT_FOUND');
 const messages=db.prepare('SELECT * FROM context_messages WHERE project_id IS NULL AND conversation_id=? AND sequence<? ORDER BY sequence').all(id,cp.message_count);
 if(messages.length!==cp.message_count||messages.at(-1)?.id!==cp.through_message_id||messages.some((m,i)=>m.sequence!==i||sha(m.content)!==m.content_hash)||stateHash(messages)!==cp.state_hash)fail('WORKSPACE_CHECKPOINT_INTEGRITY');
 const auth=consume(db,s,id,'restore_checkpoint',checkpointId,input.expectedRevision,input.confirmationToken);
 const meta=metadata({...metadata(input.metadata),restoredFrom:{conversationId:id,checkpointId,stateHash:cp.state_hash,revision:cp.message_count}});
 // A new canonical branch has NO inherited source_session_id/engine mapping.
 const result=insertConversation(db,s,{title:input.title??('Restored '+original.title).slice(0,256),tags:JSON.parse(original.tags),priority:original.priority,metadata:meta,idempotencyKey:input.idempotencyKey},requestHash);
 for(const m of messages)db.prepare(`INSERT INTO context_messages(id,project_id,conversation_id,sequence,role,content,content_hash,request_hash,tags,priority,metadata,created_at) VALUES(?,NULL,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),result.conversation.id,m.sequence,m.role,m.content,m.content_hash,hash({restore:checkpointId,sourceMessageId:m.id}),m.tags,m.priority,m.metadata,stamp());
 const checkpoint=checkpointInTransaction(db,s,result.conversation.id,{expectedRevision:messages.length,metadata:{restoredFromCheckpointId:checkpointId}});
 audit(db,s,id,'checkpoint_restored_as_new',auth,{cp:checkpointId,target:result.conversation.id,state:cp.state_hash});
 return {...result,checkpoint:checkpoint.checkpoint,revision:messages.length};
}
export function deleteInTransaction(){fail('IMMUTABLE_CONTEXT_DELETE_UNAVAILABLE');}
export function forgetInTransaction(){fail('MEMORY_LIFECYCLE_OWNER_REQUIRED');}

export const appendInTransaction=(db,s,id,input)=>appendMessageInTransaction(db,s,id,input,false);
/** Only the original retained engine-response owner may invoke this aggregate.
 * Never wire it to a browser body or accept metadata/labels as successful proof.
 */
export function persistOriginalEngineTurnInTransaction(db,s,id,input) {
 tx(db);assertWorkspaceStoreScope(db,s);conversation(db,s,id,{active:true,currentGeneration:true});
 exact(input,['engineSessionId','userMessageId','assistantMessageId','userContent','assistantContent','expectedRevision']);
 const mapping=resolveEngineMapping(db,s,id),source=db.prepare('SELECT * FROM context_conversation_sources WHERE project_id IS NULL AND conversation_id=?').get(id);
 if(mapping.engineSessionId!==input.engineSessionId||![input.userMessageId,input.assistantMessageId].every(x=>text(x,512)))fail('ORIGINAL_ENGINE_TURN_BINDING_UNAVAILABLE');
 if(!integer(input.expectedRevision)||input.userMessageId===input.assistantMessageId)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 const originalMessages=[['user',input.userMessageId,input.userContent],['assistant',input.assistantMessageId,input.assistantContent]].map(([role,messageId,content])=>{
  const fingerprint=hash([s.runtimeId,s.executionGeneration,input.engineSessionId,messageId,role]);
  const prior=db.prepare('SELECT * FROM context_conversation_source_messages WHERE project_id IS NULL AND source_id=? AND source_fingerprint=?').get(source.id,fingerprint);
  const message=prior?db.prepare('SELECT * FROM context_messages WHERE id=? AND project_id IS NULL AND conversation_id=?').get(prior.message_id,id):null;
  if(prior&&(!message||message.role!==role||message.sequence!==prior.sequence||message.content_hash!==prior.content_hash||message.content!==content||sha(message.content)!==prior.content_hash))fail('ORIGINAL_ENGINE_TURN_REPLAY_CONFLICT');
  return {role,messageId,content,fingerprint,prior,message};
 });
 // A saved original message keeps its original sequence and request hash.
 // Reopening history may supply a newer revision; an identical full replay is
 // read-only. Any new source message still requires the caller's current CAS.
 if(originalMessages.some(row=>!row.prior))cas(revision(db,id),input.expectedRevision);
 if(!originalMessages[0].prior&&originalMessages[1].prior)fail('ORIGINAL_ENGINE_TURN_REPLAY_CONFLICT');
 const result=[];
 for(const {role,messageId,content,fingerprint,prior,message} of originalMessages) {
  const expectedRevision=message?message.sequence:revision(db,id);
  const appended=appendMessageInTransaction(db,s,id,{role,content,expectedRevision,idempotencyKey:'engine-'+role+':'+fingerprint,metadata:{source:'opencode-chat',sourceRuntimeId:s.runtimeId,sourceSessionId:input.engineSessionId,sourceMessageId:messageId}},true);
  if(prior) {if(prior.message_id!==appended.message.id||prior.sequence!==appended.message.sequence||prior.content_hash!==appended.message.content_hash)fail('ORIGINAL_ENGINE_TURN_REPLAY_CONFLICT');}
  else db.prepare(`INSERT INTO context_conversation_source_messages(project_id,source_id,conversation_id,message_id,sequence,role,content_hash,source_fingerprint,created_at) VALUES(NULL,?,?,?,?,?,?,?,?)`).run(source.id,id,appended.message.id,appended.message.sequence,role,appended.message.content_hash,fingerprint,stamp());
  result.push(appended);
 }
 if(result[0].message.sequence>=result[1].message.sequence)fail('ORIGINAL_ENGINE_TURN_REPLAY_CONFLICT');
 const checkpointKey='engine-checkpoint:'+hash([s.executionGeneration,input.assistantMessageId]);
 const priorCheckpoint=db.prepare('SELECT * FROM context_checkpoints WHERE project_id IS NULL AND conversation_id=? AND idempotency_key=?').get(id,checkpointKey);
 if(priorCheckpoint&&(priorCheckpoint.through_message_id!==result[1].message.id||priorCheckpoint.message_count!==result[1].message.sequence+1))fail('ORIGINAL_ENGINE_TURN_REPLAY_CONFLICT');
 const checkpoints=checkpointInTransaction(db,s,id,{expectedRevision:priorCheckpoint?priorCheckpoint.message_count:revision(db,id),idempotencyKey:checkpointKey,metadata:{source:'opencode-chat',sourceRuntimeId:s.runtimeId,sourceSessionId:input.engineSessionId}});
 const entries=db.prepare('SELECT sequence,role,content_hash,source_fingerprint FROM context_conversation_source_messages WHERE project_id IS NULL AND source_id=? ORDER BY sequence').all(source.id);
 if(entries.length!==revision(db,id))fail('ORIGINAL_ENGINE_SOURCE_COVERAGE_CONFLICT');
 const snapshotHash=hash(entries);
 if(source.entry_count!==entries.length||source.snapshot_hash!==snapshotHash)db.prepare('UPDATE context_conversation_sources SET entry_count=?,snapshot_hash=?,updated_at=? WHERE id=? AND project_id IS NULL').run(entries.length,snapshotHash,stamp(),source.id);
 return {conversation:getConversation(db,s,id),userMessage:result[0].message,assistantMessage:result[1].message,checkpoint:checkpoints.checkpoint,revision:checkpoints.revision,idempotent:result.every(x=>x.idempotent)&&checkpoints.idempotent};
}

/** sanitizedQuery comes from the existing Core sanitizeFts5Query owner in the request adapter. */
export function searchMessageSummaries(db,s,id,sanitizedQuery,limit=50) {
 conversation(db,s,id);if(!text(sanitizedQuery,2048)||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_WORKSPACE_CONTEXT_INPUT');
 return db.prepare(`SELECT m.id,m.project_id,m.conversation_id,m.sequence,m.role,m.content_hash,m.tags,m.priority,m.metadata,m.created_at,bm25(context_messages_fts) AS rank
 FROM context_messages_fts JOIN context_messages m ON m.rowid=context_messages_fts.rowid
 WHERE context_messages_fts MATCH ? AND m.project_id IS NULL AND m.conversation_id=?
 ORDER BY rank,m.sequence DESC,m.id DESC LIMIT ?`).all(sanitizedQuery,id,limit);
}
