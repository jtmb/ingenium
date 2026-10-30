import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { contextMemorySourceState, eligibilityFingerprint, CODEX_MEMORY_IDLE_POLICY } from './source-state.mjs';
import { authorizeMemoryRequestOperation, mapRequestExecutionFailure } from './request-policy.mjs';
import { explicitMemoryForChat } from './adapters.mjs';
import { MemoryLifecycle, scopeKey } from './lifecycle.mjs';
const hash = (value) => createHash('sha256').update(value,'utf8').digest('hex');
const scope = { organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'environment',bindingHash:'b'.repeat(64),bindingEpoch:3,visibility:'private' };
const execution = { ...scope,runtimeId:'runtime',mode:'runtime',available:true,status:'authorized' };
const nowMs = Date.parse('2026-10-29T18:00:00Z');
const completed = new Date(nowMs - 6*3_600_000).toISOString();
const policy = { version:'codex-memory-source-v1',minRolloutIdleHours:6,scope,runtimeId:'runtime',admission:{chatId:'chat',conversationId:'conversation',state:'settled',revision:1,contextRevision:2} };
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  db.exec(`CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
    CREATE TABLE context_messages(id TEXT,project_id TEXT,conversation_id TEXT,sequence INTEGER,role TEXT,content TEXT,content_hash TEXT,metadata TEXT,idempotency_key TEXT,created_at TEXT);
    CREATE TABLE context_checkpoints(project_id TEXT,conversation_id TEXT,sequence INTEGER,through_message_id TEXT,message_count INTEGER,idempotency_key TEXT,metadata TEXT,created_at TEXT);
    CREATE TABLE runtime_instances(id TEXT,workspace_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,state TEXT,security_epoch INTEGER,revision INTEGER,active_connections INTEGER,active_generations INTEGER,last_authenticated_activity_at TEXT);
    CREATE TABLE runtime_activity_events(runtime_id TEXT,event_type TEXT,revision INTEGER,created_at TEXT);
    CREATE TABLE context_checkpoint_audit_events(project_id TEXT,conversation_id TEXT,event_type TEXT,archive_sequence INTEGER);`);
  const metadata = { source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'chat' };
  db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('conversation','project','org','owner','private',JSON.stringify(metadata));
  for (const [id,sequence,role,sourceMessageId,content] of [['user-message',0,'user','engine-user','Preference'],['assistant-message',1,'assistant','engine-assistant','Acknowledged']]) {
    db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,'project','conversation',sequence,role,content,hash(content),JSON.stringify({...metadata,sourceMessageId}),`opencode-${role}:${hash(`runtime\0chat\0${sourceMessageId}`)}`,completed);
  }
  db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?,?,?)').run('project','conversation',0,'assistant-message',2,`opencode-checkpoint:${hash('runtime\0chat\0engine-assistant')}`,JSON.stringify({...metadata,sourceAssistantMessageId:'engine-assistant'}),completed);
  db.prepare('INSERT INTO runtime_instances VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('runtime','workspace','org','project','owner','IDLE',3,8,0,0,completed);
  db.prepare('INSERT INTO runtime_activity_events VALUES (?,?,?,?)').run('runtime','generation_finished',7,completed);
  const key = scopeKey(scope);
  db.prepare('INSERT INTO veyra_memory_policy VALUES (?,?,?,?,?,?)').run(key,1,1,1,1,0);
  db.prepare('INSERT INTO veyra_memory_chat_policy VALUES (?,?,?,?,?)').run(key,'chat',1,1,1);
  const input = { db,scope,execution,chatId:'chat',messageId:'user-message',conversationId:'conversation',contentHash:hash('Preference'),policy,nowMs };
  return {db,input,key};
}
test('approved threshold is inclusive at6h and fails one millisecond earlier', () => {
  const {db,input}=fixture();
  try {
    assert.equal(contextMemorySourceState(input).idleEligible,true);
    assert.equal(contextMemorySourceState({...input,nowMs:nowMs-1}).idleEligible,false);
    assert.equal(CODEX_MEMORY_IDLE_POLICY.defaultHours,6);
  } finally {db.close();}
});
test('missing or wrong-owner policy cannot grant idle eligibility and does not mark complete recall uncertain', () => {
  const {db,input}=fixture();
  try {
    const absent=contextMemorySourceState({...input,policy:null});
    assert.equal(absent.idleEligible,false); assert.equal(absent.uncertain,false); assert.equal(absent.excluded,false);
    assert.equal(contextMemorySourceState({...input,policy:{...policy,scope:{...scope,ownerUserId:'other'}}}).idleEligible,false);
    for(const hours of [0,49,1.5,NaN]) assert.equal(eligibilityFingerprint({...policy,minRolloutIdleHours:hours},scope,execution),null);
    assert.ok(eligibilityFingerprint({...policy,minRolloutIdleHours:1},scope,execution));
    assert.ok(eligibilityFingerprint({...policy,minRolloutIdleHours:48},scope,execution));
  } finally {db.close();}
});
test('active runtime, absent terminal event or renewed activity defeats idle labels', () => {
  const {db,input}=fixture();
  try {
    db.exec('UPDATE runtime_instances SET active_generations=1');
    assert.equal(contextMemorySourceState(input).active,true); assert.equal(contextMemorySourceState(input).idleEligible,false);
    db.exec('UPDATE runtime_instances SET active_generations=0');
    db.exec("UPDATE runtime_activity_events SET event_type='generation_started'");
    assert.equal(contextMemorySourceState(input).idleEligible,false);
    db.exec("UPDATE runtime_activity_events SET event_type='generation_finished'");
    db.prepare('UPDATE runtime_instances SET last_authenticated_activity_at=?').run(new Date(nowMs-1000).toISOString());
    assert.equal(contextMemorySourceState(input).idleEligible,false);
  } finally {db.close();}
});
test('incomplete or wrong-runtime checkpoint evidence is uncertain, never eligible', () => {
  const {db,input}=fixture();
  try {
    db.exec('UPDATE context_checkpoints SET message_count=1');
    assert.equal(contextMemorySourceState(input).uncertain,true); assert.equal(contextMemorySourceState(input).idleEligible,false);
    db.exec('UPDATE context_checkpoints SET message_count=2');
    db.prepare('UPDATE context_checkpoints SET metadata=?').run(JSON.stringify({source:'opencode-chat',sourceRuntimeId:'other',sourceSessionId:'chat',sourceAssistantMessageId:'engine-assistant'}));
    assert.equal(contextMemorySourceState(input).uncertain,true);
  } finally {db.close();}
});
test('source hash/owner/session and suppression boundaries are checked against canonical rows', () => {
  const {db,input,key}=fixture();
  try {
    assert.equal(contextMemorySourceState({...input,contentHash:'f'.repeat(64)}),null);
    assert.equal(contextMemorySourceState({...input,chatId:'other-chat'}),null);
    db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?)').run(key,'source','user-message','receipt');
    const state=contextMemorySourceState(input); assert.equal(state.excluded,true); assert.equal(state.idleEligible,false);
    db.exec("UPDATE context_conversations SET owner_user_id='other'"); assert.equal(contextMemorySourceState(input),null);
  } finally {db.close();}
});
test('host generation and contribution opt-ins remain independent from read use', () => {
  const {db,input}=fixture();
  try {
    db.exec('UPDATE veyra_memory_chat_policy SET use_memory=0');
    assert.equal(contextMemorySourceState(input).idleEligible,true);
    db.exec('UPDATE veyra_memory_chat_policy SET contribute=0');
    const state=contextMemorySourceState(input); assert.equal(state.idleEligible,false); assert.equal(state.uncertain,false);
    db.exec('UPDATE veyra_memory_chat_policy SET contribute=1');
    db.exec('UPDATE veyra_memory_policy SET generate=0'); assert.equal(contextMemorySourceState(input).idleEligible,false);
  } finally {db.close();}
});
test('pending appended content and missing activity evidence do not become terminal proof', () => {
  const {db,input}=fixture();
  try {
    db.exec('DELETE FROM runtime_activity_events');
    const unknownActivity=contextMemorySourceState(input); assert.equal(unknownActivity.idleEligible,false); assert.equal(unknownActivity.uncertain,false);
    db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('pending','project','conversation',2,'user','pending',hash('pending'),'{}','pending',completed);
    assert.equal(contextMemorySourceState(input).uncertain,true);
  } finally {db.close();}
});
test('eligibility-policy races invalidate commit while completed-input watermark remains independent', () => {
  const {db,input}=fixture();
  try {
    let currentPolicy=policy;
    const memory=new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:input.contentHash,kind:'transcript',...contextMemorySourceState({...input,policy:currentPolicy})}),checkpoint:()=>{}});
    const refs=[{id:'user-message',contentHash:input.contentHash}];
    const admission=memory.admit(scope,'chat',refs);
    currentPolicy={...policy,minRolloutIdleHours:5};
    const current=memory.admit(scope,'chat',refs);
    assert.equal(current.inputHash,admission.inputHash); assert.notEqual(current.sources[0].eligibilityVersion,admission.sources[0].eligibilityVersion);
    assert.throws(()=>memory.commitRecall(scope,{operationId:'stale',admission,content:'Candidate',model:'fixture'}),error=>error.code==='STALE_ADMISSION');
    const saved=memory.commitRecall(scope,{operationId:'fresh',admission:current,content:'Candidate',model:'fixture'});
    currentPolicy={...policy,minRolloutIdleHours:4};
    assert.equal(memory.processedExtraction(scope,memory.admit(scope,'chat',refs)).memoryId,saved.receipt.memoryId);
  } finally {db.close();}
});
const principal={type:'user',id:'actor',tokenId:'token-a',scopes:['memory:read','memory:write']};
const authInput={permission:'read',expectedPrincipal:principal,identity:{principal},method:'GET',csrf:()=>true,decide:()=>true};
test('request authorization denies changed, revoked and elevated identities regardless of body intent',()=>{
  assert.equal(authorizeMemoryRequestOperation(authInput),true);
  assert.equal(authorizeMemoryRequestOperation({...authInput,identity:null}),false);
  assert.equal(authorizeMemoryRequestOperation({...authInput,identity:{principal:{...principal,tokenId:'different'}}}),false);
  assert.equal(authorizeMemoryRequestOperation({...authInput,identity:{principal:{...principal,scopes:['memory:read']}}}),false);
  for(const permission of ['generate','backup','restore']) assert.equal(authorizeMemoryRequestOperation({...authInput,permission,method:'POST'}),false);
});
test('write operations require an unsafe verb, current existing CSRF and an affirmative existing authorization decision',()=>{
  assert.equal(authorizeMemoryRequestOperation({...authInput,permission:'write-policy'}),false);
  assert.equal(authorizeMemoryRequestOperation({...authInput,permission:'write-policy',method:'PUT',csrf:()=>false}),false);
  assert.equal(authorizeMemoryRequestOperation({...authInput,permission:'write-policy',method:'PUT',decide:()=>false}),false);
  assert.equal(authorizeMemoryRequestOperation({...authInput,permission:'write-policy',method:'PUT'}),true);
  assert.equal(authorizeMemoryRequestOperation({...authInput,permission:'read-source',method:'POST',csrf:()=>false}),false);
});

test('missing journal evidence fails generation only; pending and unknown admissions are never eligible',()=>{
  const {db,input}=fixture();
  try {
    const absent=contextMemorySourceState({...input,policy:{...policy,admission:undefined}});
    assert.equal(absent.idleEligible,false); assert.equal(absent.uncertain,false);
    const pending=contextMemorySourceState({...input,policy:{...policy,admission:{...policy.admission,state:'pending'}}});
    assert.equal(pending.active,true); assert.equal(pending.idleEligible,false);
    const unknown=contextMemorySourceState({...input,policy:{...policy,admission:{...policy.admission,state:'unknown'}}});
    assert.equal(unknown.uncertain,true); assert.equal(unknown.idleEligible,false);
    assert.equal(contextMemorySourceState({...input,policy:{...policy,admission:{...policy.admission,contextRevision:1}}}).idleEligible,false);
  } finally {db.close();}
});
test('absence of eligibility provider preserves qualified recall, explicit-memory use and policy controls',async()=>{
  const {db,input}=fixture();
  try {
    let currentPolicy=policy;
    const memory=new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:input.contentHash,kind:'transcript',...contextMemorySourceState({...input,policy:currentPolicy})}),checkpoint:()=>{}});
    const admission=memory.admit(scope,'chat',[{id:'user-message',contentHash:input.contentHash}]);
    memory.commitRecall(scope,{operationId:'saved-qualified',admission,content:'A qualified preference',model:'fixture'});
    currentPolicy=null;
    assert.equal(memory.recall(scope,'new-chat').items.length,1);
    assert.equal((await explicitMemoryForChat({memory,scope,chatId:'chat',loadExplicit:()=>({items:[{contentKind:'untrusted_memory_data',instructionAuthority:false,memory:{...scope,state:'active'}}]})})).excluded,false);
    assert.equal(memory.setChatPolicy(scope,'chat',{operationId:'independent-control',expectedRevision:1,useMemory:false,contribute:false}).receipt.status,'committed');
  } finally {db.close();}
});
test('a journal revision race invalidates an otherwise unchanged eligible source',()=>{
  const {db,input}=fixture();
  try {
    let currentPolicy=policy;
    const memory=new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:input.contentHash,kind:'transcript',...contextMemorySourceState({...input,policy:currentPolicy})}),checkpoint:()=>{}});
    const admission=memory.admit(scope,'chat',[{id:'user-message',contentHash:input.contentHash}]);
    currentPolicy={...policy,admission:{...policy.admission,revision:2}};
    assert.throws(()=>memory.commitRecall(scope,{operationId:'journal-race',admission,content:'Candidate',model:'fixture'}),error=>error.code==='STALE_ADMISSION');
    assert.equal(memory.operation(scope,'journal-race'),null);
  } finally {db.close();}
});

test('only the frozen Projects error instances and codes receive memory denial mappings',()=>{
  class ExecutionError extends Error { constructor(code){super(code);this.code=code;} }
  const groups={INVALID_INPUT:['INVALID_EXECUTION_SELECTION','INVALID_CHAT_BINDING'],FORBIDDEN:['EXECUTION_IDENTITY_UNAVAILABLE','EXECUTION_IDENTITY_CHANGED','EXECUTION_SCOPE_UNAVAILABLE','CHAT_BINDING_UNAVAILABLE'],MEMORY_ADAPTER_UNAVAILABLE:['EXECUTION_RUNTIME_UNAVAILABLE','EXECUTION_PLACEMENT_UNAVAILABLE','EXECUTION_BINDING_CHANGED','PROJECTLESS_EXECUTION_OWNER_UNAVAILABLE','COMPATIBILITY_EXECUTION_OWNER_UNAVAILABLE']};
  for(const [expected,codes] of Object.entries(groups)) for(const code of codes) assert.equal(mapRequestExecutionFailure(new ExecutionError(code),ExecutionError).code,expected);
  for(const error of [new ExecutionError('UNKNOWN_EXECUTION_FAILURE'),Object.assign(new Error('different owner'),{code:'CHAT_BINDING_UNAVAILABLE'})]) {
    assert.throws(()=>mapRequestExecutionFailure(error,ExecutionError),caught=>caught===error);
  }
});
test('archive keeps qualified source data readable but blocks generation and invalidates old admission after unarchive',()=>{
  const {db,input}=fixture();
  try {
    const memory=new MemoryLifecycle({db,authorize:()=>true,sources:()=>({contentHash:input.contentHash,kind:'transcript',...contextMemorySourceState(input)}),checkpoint:()=>{}});
    const refs=[{id:'user-message',contentHash:input.contentHash}];
    const admitted=memory.admit(scope,'chat',refs);
    db.prepare('INSERT INTO context_checkpoint_audit_events VALUES (?,?,?,?)').run('project','conversation','conversation_archived',0);
    const archived=contextMemorySourceState(input); assert.equal(archived.idleEligible,false); assert.equal(archived.uncertain,false); assert.equal(archived.excluded,false);
    assert.throws(()=>memory.commitRecall(scope,{operationId:'archived',admission:admitted,content:'Candidate',model:'fixture'}),error=>error.code==='SOURCE_UNAVAILABLE');
    db.prepare('INSERT INTO context_checkpoint_audit_events VALUES (?,?,?,?)').run('project','conversation','conversation_unarchived',1);
    assert.equal(contextMemorySourceState(input).idleEligible,true);
    assert.throws(()=>memory.commitRecall(scope,{operationId:'unarchived-old',admission:admitted,content:'Candidate',model:'fixture'}),error=>error.code==='STALE_ADMISSION');
  } finally {db.close();}
});
