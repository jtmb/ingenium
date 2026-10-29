import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { memoryResponse } from './http.mjs';
import { createApiMemorySession, explicitMemoryForChat } from './adapters.mjs';

const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const selected = { projectId: 'project-a', workspaceId: 'workspace-a', runtimeId: 'runtime-a' };
const ownership = { organizationId: 'org-a', projectId: 'project-a', workspaceId: 'workspace-a', ownerUserId: 'user-a', bindingHash: 'b'.repeat(64), bindingEpoch: 4, status: 'authorized' };
function fixture() {
  const db = new DatabaseSync(':memory:');
  // Exact columns consumed from the existing 098/101/109 migrations, no new authority.
  db.exec(`CREATE TABLE projects(id TEXT,organization_id TEXT,archived_at TEXT);
    CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT);
    CREATE TABLE authorized_workspaces(id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,storage_mapping_hash TEXT,security_epoch INTEGER,status TEXT);
    CREATE TABLE runtime_instances(id TEXT,workspace_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,security_epoch INTEGER,state TEXT);
    CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
    CREATE TABLE context_messages(id TEXT,project_id TEXT,conversation_id TEXT,content TEXT,content_hash TEXT,role TEXT);`);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO projects VALUES (?,?,NULL)').run('project-a','org-a');
  db.prepare('INSERT INTO organization_memberships VALUES (?,?,?)').run('org-a','user-a','active');
  db.prepare('INSERT INTO authorized_workspaces VALUES (?,?,?,?,?,?,?)').run('workspace-a','org-a','project-a','user-a',ownership.bindingHash,4,'authorized');
  db.prepare('INSERT INTO runtime_instances VALUES (?,?,?,?,?,?,?)').run('runtime-a','workspace-a','org-a','project-a','user-a',4,'IDLE');
  const content = 'The user prefers concise replies.';
  db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('conversation-a','project-a','org-a','user-a','private',JSON.stringify({ source: 'opencode-chat', sourceRuntimeId: 'runtime-a', sourceSessionId: 'chat-a' }));
  db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?)').run('message-a','project-a','conversation-a',content,sha(content),'user');
  let activeTransaction = false, currentDb = db;
  Object.defineProperty(db,'inTransaction',{ get: () => activeTransaction });
  const state = { principal: { type: 'user', id: 'user-a', scopes: ['memory:*'] }, attestation: null, allowed: true, chatAllowed: true,
    source: { active: false, excluded: false, uncertain: false, idleEligible: true }, calls: [], resolveLegacy: 0 };
  const ports = {
    core: { getDb: () => currentDb, execTransaction: (work,retries) => {
      assert.equal(retries,1); assert.equal(activeTransaction,false); state.calls.push('transaction');
      activeTransaction=true; db.exec('BEGIN');
      try { const result=work(); db.exec('COMMIT'); state.calls.push('commit'); return result; }
      catch(error) { db.exec('ROLLBACK'); state.calls.push('rollback'); throw error; }
      finally { activeTransaction=false; }
    }, checkpointAfterWrite: () => { assert.equal(activeTransaction,false); state.calls.push('checkpoint'); } },
    request: { body: { ownerUserId: 'forged-user', organizationId: 'forged-org', bindingHash: 'forged-hash' } }, selected,
    authenticate: () => ({ principal: state.principal, attestation: state.attestation }),
    resolveExistingScope: (input) => { state.resolveLegacy++; assert.equal(input.allowProjectVisibility,false); return { ...ownership }; },
    resolveExecution: ({ ownership: row,runtimeId }) => ({ ...row, mode: 'runtime', runtimeId, hostId: 'actual-host', environmentId: 'actual-env', available: true }),
    resolveChatBinding: ({ scope,execution,chatId }) => state.chatAllowed ? { ...scope, runtimeId: execution.runtimeId, chatId, available: true } : null,
    authorizeOperation: () => state.allowed,
    resolveSourceState: () => state.source,
  };
  const session=createApiMemorySession(ports);
  return { db, state, ports, session, content, replaceConnection: () => { currentDb={}; }, setTransaction: (value) => { activeTransaction=value; } };
}
const code = (expected) => (error) => error.code === expected;

test('API adapter derives scope from existing resolver and DB; caller owner/org/hash are ignored', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    assert.equal(scope.ownerUserId,'user-a'); assert.equal(scope.organizationId,'org-a'); assert.equal(scope.bindingHash,ownership.bindingHash);
    assert.equal(scope.hostId,'actual-host'); assert.equal(scope.bindingEpoch,4);
    assert.throws(() => createApiMemorySession({ ...f.ports, selected: { ...selected, ownerUserId: 'other' } }),code('INVALID_INPUT'));
    f.state.allowed=false; assert.throws(() => f.session.resolveScope('read','chat-a'),code('FORBIDDEN'));
  } finally { f.db.close(); }
});
test('runtime, workspace, membership, actor and chat revocation are rechecked on every call', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    for(const [sql,reset] of [
      ["UPDATE runtime_instances SET state='STOPPED'","UPDATE runtime_instances SET state='IDLE'"],
      ["UPDATE authorized_workspaces SET status='revoked'","UPDATE authorized_workspaces SET status='authorized'"],
      ["UPDATE organization_memberships SET status='revoked'","UPDATE organization_memberships SET status='active'"],
      ["UPDATE runtime_instances SET security_epoch=5","UPDATE runtime_instances SET security_epoch=4"],
    ]) { f.db.exec(sql); assert.throws(() => f.session.memory.policy(scope,'chat-a'),code('FORBIDDEN')); f.db.exec(reset); }
    f.state.chatAllowed=false; assert.throws(() => f.session.memory.policy(scope,'chat-a'),code('FORBIDDEN'));
    f.state.chatAllowed=true; f.state.principal.id='other'; assert.throws(() => f.session.memory.policy(scope,'chat-a'),code('FORBIDDEN'));
  } finally { f.db.close(); }
});
test('source lookup requires private exact chat/runtime/owner and a recomputed content hash', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    const source=f.session.readSource(scope,'chat-a','message-a'); assert.equal(source.contentHash,sha(f.content)); assert.equal(source.instructionAuthority,false);
    assert.equal(f.session.readSource(scope,'different-chat','message-a'),null);
    f.db.exec("UPDATE context_conversations SET owner_user_id='other'"); assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
    f.db.exec("UPDATE context_conversations SET owner_user_id='user-a'");
    f.db.exec("UPDATE context_messages SET content='changed'"); assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
    f.db.prepare('UPDATE context_messages SET content=?').run(f.content);
    f.state.source.excluded=true; assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
    f.state.source.excluded=false; f.state.source.uncertain=true; assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
  } finally { f.db.close(); }
});
test('service access needs attested credential/workspace/hash and existing service scope resolution', () => {
  const f=fixture();
  try {
    f.state.principal={ type:'service',id:'service-a',tokenId:'credential-a',workspaceId:'workspace-a',storageMappingHash:ownership.bindingHash,scopes:['memory:read'] };
    assert.throws(() => f.session.resolveScope('read','chat-a'),code('FORBIDDEN'));
    f.state.attestation={ credentialId:'credential-a',workspaceId:'workspace-a',storageMappingHash:ownership.bindingHash };
    assert.equal(f.session.resolveScope('read','chat-a').ownerUserId,'user-a');
    assert.throws(() => f.session.resolveScope('write-policy','chat-a'),code('FORBIDDEN'));
    f.state.attestation.credentialId='different'; assert.throws(() => f.session.resolveScope('read','chat-a'),code('FORBIDDEN'));
  } finally { f.db.close(); }
});
test('production transaction port runs once and checkpoints only after commit', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('write-policy','chat-a');
    f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'chat-policy',expectedRevision:0,useMemory:false,contribute:false});
    assert.deepEqual(f.state.calls,['transaction','commit','checkpoint']);
    assert.throws(() => f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'stale',expectedRevision:0,useMemory:true,contribute:false}),code('VERSION_CONFLICT'));
    assert.deepEqual(f.state.calls.slice(3),['transaction','rollback']);
    f.setTransaction(true);
    assert.throws(() => f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'nested',expectedRevision:1,useMemory:true,contribute:false}),code('MEMORY_ADAPTER_UNAVAILABLE'));
    f.setTransaction(false);
  } finally { f.db.close(); }
});
test('connection replacement and absent projectless/native evidence fail closed', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    const projectless=createApiMemorySession({ ...f.ports,selected:{...selected,projectId:null} });
    assert.throws(() => projectless.resolveScope('read','chat-a'),code('MEMORY_ADAPTER_UNAVAILABLE'));
    assert.equal(memoryResponse(projectless.memory,() => projectless.resolveScope('read','chat-a'),{action:'policy',method:'GET',chatId:'chat-a'}).status,503);
    const missing=createApiMemorySession({ ...f.ports,resolveExecution: () => null });
    assert.throws(() => missing.resolveScope('read','chat-a'),code('FORBIDDEN'));
    const native=createApiMemorySession({ ...f.ports,selected:{...selected,projectId:null},
      resolveProjectlessScope: () => ({...ownership,projectId:null,visibility:'private'}),
      resolveExecution: ({ownership:row,runtimeId}) => ({...row,mode:'native',runtimeId,hostId:'actual-host',environmentId:'actual-env',available:true}),
    });
    const nativeScope=native.resolveScope('read','chat-a');
    assert.equal(native.memory.policy(nativeScope,'chat-a').policy.generate,false);
    f.replaceConnection(); assert.throws(() => f.session.memory.policy(scope,'chat-a'),code('MEMORY_ADAPTER_UNAVAILABLE'));
    assert.throws(() => native.memory.policy(nativeScope,'chat-a'),code('MEMORY_ADAPTER_UNAVAILABLE'));
  } finally { f.db.close(); }
});
test('use-memory policy gates explicit saved recall without calling the loader; edits/forget stay separate', async () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a'); let loads=0;
    const loader=async () => { loads++; return { items:[{ instructionAuthority:false,contentKind:'untrusted_memory_data',memory:{ ...scope,state:'active' } }] }; };
    assert.equal((await explicitMemoryForChat({memory:f.session.memory,scope,chatId:'chat-a',loadExplicit:loader})).excluded,false);
    f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'exclude',expectedRevision:0,useMemory:false,contribute:false});
    assert.equal((await explicitMemoryForChat({memory:f.session.memory,scope,chatId:'chat-a',loadExplicit:loader})).excluded,true);
    assert.equal(loads,1);
    assert.equal(f.session.memory.operation(scope,'exclude').status,'committed');
  } finally { f.db.close(); }
});
test('explicit recall rechecks policy after async load and refuses cross-owner data', async () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    await assert.rejects(explicitMemoryForChat({memory:f.session.memory,scope,chatId:'chat-a',loadExplicit:async () => ({items:[{instructionAuthority:false,contentKind:'untrusted_memory_data',memory:{...scope,ownerUserId:'other',state:'active'}}]})}),code('SOURCE_UNAVAILABLE'));
    const result=await explicitMemoryForChat({memory:f.session.memory,scope,chatId:'chat-a',loadExplicit:async () => {
      f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'during-load',expectedRevision:0,useMemory:false,contribute:false});
      return {items:[]};
    }});
    assert.equal(result.reason,'policy-changed'); assert.equal(result.page,null);
  } finally { f.db.close(); }
});

test('source metadata for another runtime or shared visibility is withheld', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('read','chat-a');
    f.db.prepare('UPDATE context_conversations SET metadata=?').run(JSON.stringify({ source:'opencode-chat',sourceRuntimeId:'other-runtime',sourceSessionId:'chat-a' }));
    assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
    f.db.prepare('UPDATE context_conversations SET metadata=?,visibility=?').run(JSON.stringify({ source:'opencode-chat',sourceRuntimeId:'runtime-a',sourceSessionId:'chat-a' }),'project');
    assert.equal(f.session.readSource(scope,'chat-a','message-a'),null);
  } finally { f.db.close(); }
});
test('post-commit checkpoint failure preserves its original receipt without transaction replay', () => {
  const f=fixture();
  try {
    f.ports.core.checkpointAfterWrite=() => { throw new Error('checkpoint fixture failure'); };
    const scope=f.session.resolveScope('write-policy','chat-a');
    assert.throws(() => f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'uncertain-adapter',expectedRevision:0,useMemory:false,contribute:false}),/checkpoint fixture failure/);
    assert.equal(f.session.memory.operation(scope,'uncertain-adapter').status,'committed');
    assert.deepEqual(f.state.calls,['transaction','commit']);
  } finally { f.db.close(); }
});
test('adapter-backed generation and forget preserve defaults, source suppressions and receipts', () => {
  const f=fixture();
  try {
    const scope=f.session.resolveScope('generate','chat-a');
    assert.equal(f.session.memory.policy(scope,'chat-a').policy.generate,false);
    f.session.memory.setPolicy(scope,{operationId:'enable',expectedRevision:0,enabled:true,generate:true,useMemory:true,externalContext:false});
    f.session.memory.setChatPolicy(scope,'chat-a',{operationId:'contribute',expectedRevision:0,useMemory:true,contribute:true});
    const admission=f.session.memory.admit(scope,'chat-a',[{id:'message-a',contentHash:sha(f.content)}]);
    const saved=f.session.memory.commitRecall(scope,{operationId:'save',admission,content:'Concise replies preferred',model:'fixture-only'});
    assert.equal(f.session.memory.recall(scope,'chat-a').items.length,1);
    f.session.memory.forget(scope,{operationId:'forget',memoryId:saved.receipt.memoryId,expectedVersion:1});
    assert.equal(f.session.memory.recall(scope,'chat-a').items.length,0);
    assert.equal(f.session.memory.operation(scope,'forget').status,'committed');
    assert.throws(() => f.session.memory.admit(scope,'chat-a',[{id:'message-a',contentHash:sha(f.content)}]),code('SOURCE_FORGOTTEN'));
  } finally { f.db.close(); }
});
