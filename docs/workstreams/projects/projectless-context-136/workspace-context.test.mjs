// AUTHORED, UNRUN. These are SQL/store fixture controls, never runtime qualification.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,seedScope} from './context-fixture.mjs';
import * as context from './workspace-context-store.mjs';
import {installContext136,hasVerifiedContext136} from './migration-136.mjs';
import {installWorkspaceExecution137} from './migration-137.mjs';
import {fingerprint} from './migration-rebuild.mjs';
const transaction=(db,fn)=>db.transaction(fn).immediate();
function each(body){const db=fixture();try{const s=seedScope(db);body(db,s);}finally{db.close();}}
test('real legacy table declarations migrate with rowid and typed legacy fields unchanged, restart verifies both versions',()=>{
 const db=fixture({evolve:false});try{
  const before=fingerprint(db,'context_conversations');installContext136(db);
  assert.deepEqual(fingerprint(db,'context_conversations',['id','project_id','title','request_hash','idempotency_key','tags','priority','metadata','created_at','organization_id','owner_user_id','visibility']),before);
  assert.equal(hasVerifiedContext136(db),true);installWorkspaceExecution137(db);
  assert.equal(installContext136(db).installed,false);assert.equal(installWorkspaceExecution137(db).installed,false);
  assert.equal(db.prepare("SELECT rowid,project_id FROM context_conversations WHERE id='legacy'").get().rowid,41);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{db.close();}
});
test('empty real-ID source mapping has zero entries and no transcript body; same engine ID is isolated by workspace',()=>each((db,s)=>{
 const id=transaction(db,()=>context.linkOriginalEngineInTransaction(db,s,{engineSessionId:'ses-original',title:'First'})).conversation.id;
 assert.equal(context.getConversation(db,s,id).revision,0);
 assert.equal(db.prepare('SELECT entry_count FROM context_conversation_sources WHERE conversation_id=?').get(id).entry_count,0);
 assert.equal(transaction(db,()=>context.linkOriginalEngineInTransaction(db,s,{engineSessionId:'ses-original',title:'Renamed'})).conversation.id,id);
 assert.equal(context.resolveEngineMapping(db,s,id).engineSessionId,'ses-original');
 const other=seedScope(db,{workspaceId:'second',runtimeId:'00000000-0000-4000-8000-000000000002'});
 const next=transaction(db,()=>context.linkOriginalEngineInTransaction(db,other,{engineSessionId:'ses-original',title:'Second'})).conversation.id;
 assert.notEqual(next,id);assert.throws(()=>context.getConversation(db,other,id),/NOT_FOUND/);
 assert.equal(context.listConversations(db,other).length,1);
}));
test('org, actor, workspace, binding hash/epoch, original generation and revocation deny without writes',()=>each((db,s)=>{
 const id=transaction(db,()=>context.createInTransaction(db,s,{title:'Private'})).conversation.id;
 const n=db.prepare('SELECT count(*) AS n FROM context_messages').get().n;
 for(const [key,value]of Object.entries({organizationId:'elsewhere',ownerUserId:'other',workspaceId:'elsewhere',bindingHash:'f'.repeat(64),bindingEpoch:1,executionGeneration:'f'.repeat(64)}))assert.throws(()=>transaction(db,()=>context.appendInTransaction(db,{...s,[key]:value},id,{role:'user',content:'no',expectedRevision:0})));
 assert.equal(db.prepare('SELECT count(*) AS n FROM context_messages').get().n,n);
 db.prepare("UPDATE authorized_workspaces SET status='revoked',security_epoch=security_epoch+1,updated_at=? WHERE id=?").run('2026-01-02T00:00:00.000Z',s.workspaceId);
 assert.throws(()=>transaction(db,()=>context.appendInTransaction(db,s,id,{role:'user',content:'no',expectedRevision:0})),/SCOPE_UNAVAILABLE/);
}));
test('CAS, exact content/idempotency, summaries and explicit retrieval preserve isolation',()=>each((db,s)=>{
 const id=transaction(db,()=>context.createInTransaction(db,s,{title:'Manual',idempotencyKey:'manual'})).conversation.id;
 const input={role:'user',content:'exact cafe\u0301\n',expectedRevision:0,idempotencyKey:'one'};
 const first=transaction(db,()=>context.appendInTransaction(db,s,id,input));
 assert.equal(transaction(db,()=>context.appendInTransaction(db,s,id,input)).message.id,first.message.id);
 assert.throws(()=>transaction(db,()=>context.appendInTransaction(db,s,id,{...input,content:'changed'})),/IDEMPOTENCY/);
 assert.throws(()=>transaction(db,()=>context.appendInTransaction(db,s,id,{role:'assistant',content:'stale',expectedRevision:0})),/REVISION/);
 const summaries=context.listMessageSummaries(db,s,id);assert.equal(Object.hasOwn(summaries[0],'content'),false);
 assert.equal(context.retrieveMessages(db,s,id,[first.message.id]).messages[0].content,input.content);
 assert.throws(()=>db.prepare('UPDATE context_messages SET content=? WHERE id=?').run('changed',first.message.id),/immutable/);
 assert.throws(()=>transaction(db,()=>context.deleteInTransaction()),/DELETE_UNAVAILABLE/);
 assert.throws(()=>transaction(db,()=>context.forgetInTransaction()),/MEMORY_LIFECYCLE_OWNER/);
}));
test('canonical original-turn aggregate is atomic, mapping-specific and replay safe; mapped chat rejects manual append',()=>each((db,s)=>{
 const id=transaction(db,()=>context.linkOriginalEngineInTransaction(db,s,{engineSessionId:'ses-source',title:'Source'})).conversation.id;
 assert.throws(()=>transaction(db,()=>context.appendInTransaction(db,s,id,{role:'assistant',content:'injected',expectedRevision:0})),/ORIGINAL_ENGINE_TURN_OWNER/);
 const turn={engineSessionId:'ses-source',userMessageId:'usr1',assistantMessageId:'asst1',userContent:'hello',assistantContent:'world',expectedRevision:0};
 assert.throws(()=>transaction(db,()=>context.persistOriginalEngineTurnInTransaction(db,s,id,{...turn,assistantContent:''})));
 assert.equal(context.getConversation(db,s,id).revision,0);
 const result=transaction(db,()=>context.persistOriginalEngineTurnInTransaction(db,s,id,turn));assert.equal(result.revision,2);
 const sourceBefore=db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id);
 assert.equal(transaction(db,()=>context.persistOriginalEngineTurnInTransaction(db,s,id,turn)).idempotent,true);
 assert.deepEqual(db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id),sourceBefore);
 assert.equal(db.prepare('SELECT entry_count FROM context_conversation_sources WHERE conversation_id=?').get(id).entry_count,2);
 assert.equal(db.prepare('SELECT count(*) AS n FROM context_conversation_source_messages WHERE conversation_id=?').get(id).n,2);
 assert.throws(()=>transaction(db,()=>context.persistOriginalEngineTurnInTransaction(db,s,id,{...turn,engineSessionId:'other'})),/BINDING/);
}));
test('archive authorization consumes once, active mapping closes, history survives; restore branches without duplicating engine map',()=>each((db,s)=>{
 const id=transaction(db,()=>context.linkOriginalEngineInTransaction(db,s,{engineSessionId:'ses-history',title:'History'})).conversation.id;
 const turn=transaction(db,()=>context.persistOriginalEngineTurnInTransaction(db,s,id,{engineSessionId:'ses-history',userMessageId:'u',assistantMessageId:'a',userContent:'u',assistantContent:'a',expectedRevision:0}));
 const auth=transaction(db,()=>context.authorizeMaintenanceInTransaction(db,s,id,{operation:'archive_conversation',expectedRevision:2}));
 transaction(db,()=>context.archiveInTransaction(db,s,id,{archived:true,expectedRevision:2,confirmationToken:auth.confirmationToken}));
 assert.throws(()=>transaction(db,()=>context.archiveInTransaction(db,s,id,{archived:true,expectedRevision:2,confirmationToken:auth.confirmationToken})),/AUTHORIZATION/);
 assert.throws(()=>context.resolveEngineMapping(db,s,id),/ARCHIVED/);assert.equal(context.resolveEngineMapping(db,s,id,{purpose:'history'}).engineSessionId,'ses-history');
 assert.equal(context.listConversations(db,s).length,0);
 const restore=transaction(db,()=>context.authorizeMaintenanceInTransaction(db,s,id,{operation:'restore_checkpoint',checkpointId:turn.checkpoint.id,expectedRevision:2}));
 const branch=transaction(db,()=>context.restoreInTransaction(db,s,id,turn.checkpoint.id,{expectedRevision:2,confirmationToken:restore.confirmationToken,idempotencyKey:'restore-once'}));
 assert.notEqual(branch.conversation.id,id);assert.equal(branch.revision,2);
 assert.throws(()=>context.resolveEngineMapping(db,s,branch.conversation.id),/MAPPING_UNAVAILABLE/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM context_conversation_sources WHERE project_id IS NULL').get().n,1);
 assert.equal(transaction(db,()=>context.restoreInTransaction(db,s,id,turn.checkpoint.id,{expectedRevision:2,confirmationToken:restore.confirmationToken,idempotencyKey:'restore-once'})).idempotent,true);
 const unarchive=transaction(db,()=>context.authorizeMaintenanceInTransaction(db,s,id,{operation:'unarchive_conversation',expectedRevision:2}));
 transaction(db,()=>context.archiveInTransaction(db,s,id,{archived:false,expectedRevision:2,confirmationToken:unarchive.confirmationToken}));
 assert.equal(context.resolveEngineMapping(db,s,id).engineSessionId,'ses-history');
}));
test('direct ID/null-safe guards stop orphan/foreign conversation, fake Project association and share widening',()=>each((db,s)=>{
 const id=transaction(db,()=>context.createInTransaction(db,s,{title:'Private'})).conversation.id;
 assert.throws(()=>db.prepare(`INSERT INTO context_messages(id,project_id,conversation_id,sequence,role,content,content_hash,request_hash,created_at) VALUES('orphan',NULL,'absent',0,'user','x',?,?,?)`).run('a'.repeat(64),'b'.repeat(64),'2026-01-01'));
 assert.throws(()=>db.prepare(`INSERT INTO context_messages(id,project_id,conversation_id,sequence,role,content,content_hash,request_hash,created_at) VALUES('cross','project',?,0,'user','x',?,?,?)`).run(id,'a'.repeat(64),'b'.repeat(64),'2026-01-01'),/scope mismatch/);
 assert.throws(()=>db.prepare("INSERT INTO content_shares VALUES('share','context_conversation',?)").run(id),/private/);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
}));
