import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,seedScope} from '../../../docs/workstreams/projects/projectless-context-136/context-fixture.mjs';
import * as context from '../lib/tools/workspace-context-store.mjs';
// Actual canonical store on real in-memory SQLite. Runtime rows are explicitly
// synthetic; these tests do not qualify an original manager/placement producer.
const tx=(db,work)=>db.transaction(work).immediate();
function run(work){const db=fixture();try{const scope=seedScope(db);const id=tx(db,()=>context.linkOriginalEngineInTransaction(db,scope,{engineSessionId:'engine',title:'Original'})).conversation.id;const save=input=>tx(db,()=>context.persistOriginalEngineTurnInTransaction(db,scope,id,input));work({db,scope,id,save});assert.deepEqual(db.pragma('foreign_key_check'),[])}finally{db.close()}}
const first={engineSessionId:'engine',userMessageId:'user1',assistantMessageId:'assistant1',userContent:'Hello',assistantContent:'Original response',expectedRevision:0};
test('actual original turn survives an exact replay after browser revision refresh',()=>run(({db,id,save})=>{
 const initial=save(first),before=db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id);const replay=save({...first,expectedRevision:2});
 assert.equal(replay.idempotent,true);assert.equal(replay.userMessage.id,initial.userMessage.id);assert.equal(replay.assistantMessage.id,initial.assistantMessage.id);assert.equal(replay.checkpoint.id,initial.checkpoint.id);assert.equal(replay.revision,2);assert.deepEqual(db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id),before);
}));
test('a later original assistant message can retain the same original user without duplicating it',()=>run(({db,id,save})=>{
 const initial=save(first);const later=save({...first,assistantMessageId:'assistant2',assistantContent:'Continued original response',expectedRevision:2});assert.equal(later.userMessage.id,initial.userMessage.id);assert.equal(later.revision,3);assert.equal(later.assistantMessage.sequence,2);assert.equal(db.prepare('SELECT count(*) AS n FROM context_messages WHERE conversation_id=? AND role=?').get(id,'user').n,1);assert.equal(db.prepare('SELECT entry_count FROM context_conversation_sources WHERE conversation_id=?').get(id).entry_count,3);
 assert.equal(save({...first,assistantMessageId:'assistant2',assistantContent:'Continued original response',expectedRevision:3}).idempotent,true);
}));
test('an older completed pair replays after later source turns without truncating history or creating a new checkpoint',()=>run(({db,id,save})=>{
 const initial=save(first);save({...first,userMessageId:'user2',assistantMessageId:'assistant2',userContent:'Next user',assistantContent:'Next assistant',expectedRevision:2});const before=db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id);const replay=save({...first,expectedRevision:4});assert.equal(replay.idempotent,true);assert.equal(replay.revision,4);assert.equal(replay.checkpoint.id,initial.checkpoint.id);assert.equal(db.prepare('SELECT count(*) AS n FROM context_checkpoints WHERE conversation_id=?').get(id).n,2);assert.deepEqual(db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id),before);
}));
test('any new source message still requires current revision, including a shared-user continuation',()=>run(({db,id,save})=>{
 save(first);const before=db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id);assert.throws(()=>save({...first,assistantMessageId:'assistant2',assistantContent:'New',expectedRevision:0}),/REVISION/);assert.equal(db.prepare('SELECT count(*) AS n FROM context_messages WHERE conversation_id=?').get(id).n,2);assert.deepEqual(db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id),before);
}));
for(const [name,change]of [['user bytes',{userContent:'Forged'}],['assistant bytes',{assistantContent:'Forged'}],['same engine message ID',{assistantMessageId:'user1'}],['engine identity',{engineSessionId:'foreign'}]])test('replay refuses changed '+name+' atomically',()=>run(({db,id,save})=>{
 save(first);const before=db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id);assert.throws(()=>save({...first,...change,expectedRevision:2}));assert.equal(db.prepare('SELECT count(*) AS n FROM context_messages WHERE conversation_id=?').get(id).n,2);assert.deepEqual(db.prepare('SELECT * FROM context_conversation_sources WHERE conversation_id=?').get(id),before);
}));
