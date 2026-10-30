import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCompletedMemorySnapshot,readCompletedSnapshotSource} from './bounded-snapshot.mjs';
import {contextMemorySourceState} from './source-state.mjs';
import {MemoryLifecycle,scopeKey} from './lifecycle.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'env',bindingHash:'binding',bindingEpoch:1,visibility:'private'};
const execution={...scope,runtimeId:'runtime',mode:'runtime',available:true,status:'authorized'};
const now=Date.parse('2026-10-30T18:00:00Z'),completed=now-6*3_600_000;
const messages=[{id:'engine-user',role:'user',content:'  Exact é\r\npreference  '},{id:'engine-assistant',role:'assistant',content:'Acknowledged'}]
  .map(message=>({...message,revision:'message-version-1',turnId:'original-turn',terminalAssistantId:'engine-assistant',completion:'complete',completedAtMs:completed}));
const capture=()=>({scope,runtimeId:'runtime',chatId:'chat',ownerInstanceId:'original-engine',watermark:'eligible-rollout-v1',capturedAtMs:now,lastActivityAtMs:completed,externalContextUsed:false,messages:structuredClone(messages)});
function fixture() {
  const db=new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  db.exec(`CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
    CREATE TABLE context_messages(id TEXT,project_id TEXT,conversation_id TEXT,sequence INTEGER,role TEXT,content TEXT,content_hash TEXT,metadata TEXT,idempotency_key TEXT,created_at TEXT);
    CREATE TABLE context_checkpoints(project_id TEXT,conversation_id TEXT,sequence INTEGER,through_message_id TEXT,message_count INTEGER,idempotency_key TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE context_checkpoint_audit_events(project_id TEXT,conversation_id TEXT,event_type TEXT,archive_sequence INTEGER);`);
  const metadata={source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'chat'};
  db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('context','project','org','owner','private',JSON.stringify(metadata));
  for(let index=0;index<messages.length;index++) {
    const m=messages[index];db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('context-'+m.role,'project','context',index,m.role,m.content,hash(m.content),JSON.stringify({...metadata,sourceMessageId:m.id}),`opencode-${m.role}:${hash(`runtime\0chat\0${m.id}`)}`,new Date(completed).toISOString());
  }
  db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?,?,?)').run('project','context',0,'context-assistant',2,`opencode-checkpoint:${hash('runtime\0chat\0engine-assistant')}`,JSON.stringify({...metadata,sourceAssistantMessageId:'engine-assistant'}),new Date(completed).toISOString());
  const key=scopeKey(scope);db.prepare('INSERT INTO veyra_memory_policy VALUES (?,?,?,?,?,?)').run(key,1,1,1,1,0);db.prepare('INSERT INTO veyra_memory_chat_policy VALUES (?,?,?,?,?)').run(key,'chat',1,1,1);
  const current=new Map(messages.map(m=>[m.id,{...m,ownerInstanceId:'original-engine',externalContextUsed:false}]));
  const options={scope,execution,chatId:'chat',minRolloutIdleHours:6,nowMs:now,captureSnapshot:capture,readCanonicalMessage:({messageId})=>current.get(messageId)??null};
  const snapshot=createCompletedMemorySnapshot(options);
  const input={db,scope,execution,chatId:'chat',messageId:'context-user',conversationId:'context',contentHash:hash(messages[0].content),policy:{version:'codex-memory-source-v1',minRolloutIdleHours:6,scope,runtimeId:'runtime'},completedSnapshot:snapshot,nowMs:now};
  const memory=new MemoryLifecycle({db,authorize:()=>true,checkpoint:()=>{},sources:()=>({...contextMemorySourceState(input),contentHash:input.contentHash,kind:'transcript'})});
  return {db,key,current,options,snapshot,input,memory};
}
test('eligible bounded completed snapshot works without a journal or runtime-wide activity fence',()=>{
 const f=fixture();try {const state=contextMemorySourceState(f.input);assert.equal(state.idleEligible,true);assert.equal(state.uncertain,false);assert.equal(state.active,false);assert.match(state.eligibilityVersion,/^snapshot-v1:/);assert.ok(f.memory.admit(scope,'chat',[{id:'context-user',contentHash:f.input.contentHash}]));}finally{f.db.close();}
});
test('later unknown engine and incomplete Context material outside snapshot neither enters input nor invalidates exact sources',()=>{
 const f=fixture();try {
  const admission=f.memory.admit(scope,'chat',[{id:'context-user',contentHash:f.input.contentHash}]);
  f.current.set('later-unknown',{id:'later-unknown',completion:'unknown'});
  f.db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('later-user','project','context',2,'user','Partial future input',hash('Partial future input'),'{}','later',new Date(now).toISOString());
  assert.equal(contextMemorySourceState(f.input).idleEligible,true);
  assert.equal(contextMemorySourceState({...f.input,messageId:'later-user',contentHash:hash('Partial future input')}).idleEligible,false);
  assert.ok(f.memory.commitRecall(scope,{operationId:'save-old-snapshot',admission,content:'Verified preference',model:'fixture'}).receipt);
  assert.equal(f.snapshot.messageCount,2);
 }finally{f.db.close();}
});
test('selected unknown, edited or deleted canonical engine source prevents commit without sending or replay',()=>{
 for(const change of ['unknown','edit','delete','owner','revision']){const f=fixture();try {
  const admission=f.memory.admit(scope,'chat',[{id:'context-user',contentHash:f.input.contentHash}]);
  const original=f.current.get('engine-assistant');
  if(change==='delete')f.current.delete('engine-assistant');
  else f.current.set('engine-assistant',{...original,...(change==='unknown'?{completion:'unknown'}:change==='edit'?{content:'changed'}:change==='owner'?{ownerInstanceId:'replacement'}:{revision:'new-version'})});
  assert.throws(()=>f.memory.commitRecall(scope,{operationId:'blocked',admission,content:'Candidate',model:'fixture'}),error=>error.code==='SOURCE_UNAVAILABLE',change);
  assert.equal(f.memory.operation(scope,'blocked'),null);
 }finally{f.db.close();}}
});
test('capture rejects partial, unknown, too-recent, malformed, oversized and wrong-owner selected evidence',()=>{
 const f=fixture();try {
  for(const mutate of [s=>s.messages[1].completion='partial',s=>s.messages[0].completion='unknown',s=>s.lastActivityAtMs=now-1,
    s=>s.messages[1].terminalAssistantId='other',s=>s.messages[1].role='user',s=>s.scope.ownerUserId='other',
    s=>s.messages[0].content='x'.repeat(1024*1024),s=>s.messages.push(s.messages[0])]) {
    assert.throws(()=>createCompletedMemorySnapshot({...f.options,captureSnapshot:()=>{const value=structuredClone(capture());mutate(value);return value;}}),error=>error.code==='SOURCE_UNAVAILABLE');
  }
 }finally{f.db.close();}
});
test('Context-only assertions, forged snapshot objects and mismatched exact bytes never become canonical engine proof',()=>{
 const f=fixture();try {
  assert.equal(contextMemorySourceState({...f.input,completedSnapshot:{...f.snapshot}}).idleEligible,false);
  const exact=f.current.get('engine-user');f.current.set('engine-user',{...exact,content:exact.content.trim()});
  assert.equal(contextMemorySourceState(f.input).idleEligible,false);
 }finally{f.db.close();}
});
test('current contribution, host policy, scope, source deletion, checkpoint and suppressions still gate precommit',()=>{
 const mutations=[f=>f.db.exec('UPDATE veyra_memory_chat_policy SET contribute=0'),f=>f.db.exec('UPDATE veyra_memory_policy SET enabled=0'),
  f=>f.db.exec("UPDATE context_conversations SET owner_user_id='other'"),f=>f.db.exec("DELETE FROM context_messages WHERE id='context-user'"),
  f=>f.db.exec('DELETE FROM context_checkpoints'),f=>f.db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?)').run(f.key,'source','context-user','receipt')];
 for(const mutate of mutations){const f=fixture();try {const admission=f.memory.admit(scope,'chat',[{id:'context-user',contentHash:f.input.contentHash}]);mutate(f);assert.throws(()=>f.memory.commitRecall(scope,{operationId:'blocked',admission,content:'Candidate',model:'fixture'}));assert.equal(f.memory.operation(scope,'blocked'),null);}finally{f.db.close();}}
});
test('external-context snapshot requires explicit current external-context policy and threshold cannot be relaxed after capture',()=>{
 const f=fixture();try {
  const snapshot=createCompletedMemorySnapshot({...f.options,captureSnapshot:()=>({...capture(),externalContextUsed:true}),readCanonicalMessage:({messageId})=>({...f.current.get(messageId),externalContextUsed:true})});
  assert.equal(contextMemorySourceState({...f.input,completedSnapshot:snapshot}).idleEligible,false);
  f.db.exec('UPDATE veyra_memory_policy SET external_context=1');
  assert.equal(contextMemorySourceState({...f.input,completedSnapshot:snapshot}).idleEligible,true);
  assert.equal(contextMemorySourceState({...f.input,policy:{...f.input.policy,minRolloutIdleHours:1}}).idleEligible,false);
 }finally{f.db.close();}
});

test('selected source manifest is immutable and contains hashes/identities without a second transcript',()=>{
 const f=fixture();try {
  assert.deepEqual(f.snapshot.selectedSources.map(source=>source.engineMessageId),['engine-user','engine-assistant']);
  assert.equal(f.snapshot.selectedSources[0].contentHash,hash(messages[0].content));
  assert.equal(Object.hasOwn(f.snapshot.selectedSources[0],'content'),false);
  assert.throws(()=>f.snapshot.selectedSources.push({}));
  assert.throws(()=>{f.snapshot.selectedSources[0].engineMessageId='changed';});
 }finally{f.db.close();}
});

test('an assistant source cannot outlive its selected user counterpart in Context or forget suppressions',()=>{
 for(const action of ['edit-user','suppress-user']) {const f=fixture();try {
  const assistant={...f.input,messageId:'context-assistant',contentHash:hash(messages[1].content)};
  assert.equal(contextMemorySourceState(assistant).idleEligible,true);
  if(action==='edit-user')f.db.exec("UPDATE context_messages SET content='changed user' WHERE id='context-user'");
  else f.db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?)').run(f.key,'source','context-user','forget');
  assert.equal(contextMemorySourceState(assistant).idleEligible,false);
 }finally{f.db.close();}}
});
