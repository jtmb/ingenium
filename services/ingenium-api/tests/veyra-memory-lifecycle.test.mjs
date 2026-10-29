import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MemoryLifecycle, scopeKey } from '../lib/memory-v2/lifecycle.mjs';

const schema = readFileSync(new URL('../lib/memory-v2/schema.sql', import.meta.url), 'utf8');
const scope = Object.freeze({ organizationId: 'org-a', ownerUserId: 'user-a', hostId: 'host-a', environmentId: 'wsl-a', projectId: 'project-a', workspaceId: 'workspace-a', bindingHash: 'authorized-binding-hash', bindingEpoch: 1, visibility: 'private' });
const ref = { id: 'turn-a', contentHash: 'a'.repeat(64) };
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); db.exec(schema);
  const source = { ...ref, active: false, excluded: false, uncertain: false, idleEligible: true, kind: 'transcript' };
  const state = { denied: false, checkpoints: 0, source };
  const adapter = { db, authorize: () => !state.denied, sources: () => state.source, checkpoint: () => { state.checkpoints++; } };
  const memory = new MemoryLifecycle(adapter);
  return { db, memory, state, adapter };
}
function enable(memory, target = scope) {
  memory.setPolicy(target, { operationId: 'policy-1', expectedRevision: 0, enabled: true, generate: true, useMemory: true, externalContext: false });
  memory.setChatPolicy(target, 'chat-a', { operationId: 'chat-1', expectedRevision: 0, useMemory: true, contribute: true });
}
function save(memory, content = 'The user prefers concise explanations.', operationId = 'save-1') {
  return memory.commitRecall(scope, { operationId, admission: memory.admit(scope, 'chat-a', operationId === 'save-1' ? [ref] : [ref, { ...ref, id: 'turn-b' }]), content, model: 'qualified-fixture-model' });
}
const code = (expected) => (error) => error.code === expected;

test('defaults keep generation and contribution off without disabling saved-memory use', () => {
  const { db, memory } = fixture();
  try {
    const policy = memory.policy(scope, 'chat-a');
    assert.equal(policy.policy.generate, false); assert.equal(policy.chat.contribute, false);
    assert.equal(policy.policy.useMemory, true);
    assert.throws(() => memory.admit(scope, 'chat-a', [ref]), code('GENERATION_EXCLUDED'));
  } finally { db.close(); }
});
test('same-scope fresh chat retrieves bounded untrusted provenance', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); save(memory);
    const page = memory.recall(scope, 'brand-new-chat');
    assert.equal(page.items.length, 1); assert.equal(page.items[0].instructionAuthority, false);
    assert.equal(page.items[0].provenance.sources[0].id, ref.id);
    assert.equal(memory.recall(scope, 'brand-new-chat', { maxTokens: 1 }).omitted[0].reason, 'budget');
    assert.throws(() => memory.recall(scope, 'chat-a', { maxTokens: NaN }), code('INVALID_INPUT'));
  } finally { db.close(); }
});
test('all tenant, owner, host, environment, project and workspace axes isolate recall', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); save(memory);
    for (const field of ['organizationId', 'ownerUserId', 'hostId', 'environmentId', 'projectId', 'workspaceId']) {
      assert.equal(memory.recall({ ...scope, [field]: 'other' }, 'chat-a').items.length, 0, field);
    }
    assert.equal(memory.recall({ ...scope, projectId: null }, 'chat-a').items.length, 0);
    assert.throws(() => scopeKey({ ...scope, projectId: undefined }), code('INVALID_INPUT'));
    assert.throws(() => scopeKey({ ...scope, visibility: 'project' }), code('INVALID_SCOPE'));
  } finally { db.close(); }
});
test('projectless chats remain private and workspace-bound', () => {
  const { db, memory } = fixture(); const projectless = { ...scope, projectId: null };
  try {
    enable(memory, projectless);
    memory.commitRecall(projectless, { operationId: 'save', admission: memory.admit(projectless, 'chat-a', [ref]), content: 'Private preference', model: 'fixture' });
    assert.equal(memory.recall(projectless, 'new-chat').items.length, 1);
    assert.equal(memory.recall({ ...projectless, workspaceId: 'other' }, 'new-chat').items.length, 0);
  } finally { db.close(); }
});
test('denied capability gates reads, writes and operation status before data access', () => {
  const { db, memory, state } = fixture();
  try {
    enable(memory); save(memory); state.denied = true;
    assert.throws(() => memory.recall(scope, 'chat-a'), code('FORBIDDEN'));
    assert.throws(() => memory.operation(scope, 'save-1'), code('FORBIDDEN'));
    assert.throws(() => memory.previewReset(scope), code('FORBIDDEN'));
  } finally { db.close(); }
});
test('contribution and use controls act independently', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); save(memory);
    memory.setChatPolicy(scope, 'chat-a', { operationId: 'chat-2', expectedRevision: 1, useMemory: false, contribute: true });
    assert.equal(memory.recall(scope, 'chat-a').excluded, true);
    assert.ok(memory.admit(scope, 'chat-a', [ref]));
    assert.equal(memory.recall(scope, 'new-chat').items.length, 1);
    memory.setChatPolicy(scope, 'chat-a', { operationId: 'chat-3', expectedRevision: 2, useMemory: true, contribute: false });
    assert.equal(memory.recall(scope, 'chat-a').items.length, 1);
    assert.throws(() => memory.admit(scope, 'chat-a', [ref]), code('GENERATION_EXCLUDED'));
  } finally { db.close(); }
});
test('policy CAS and changed-body operation replay cannot overwrite controls', () => {
  const { db, memory } = fixture();
  try {
    enable(memory);
    assert.throws(() => memory.setChatPolicy(scope, 'chat-a', { operationId: 'stale', expectedRevision: 0, useMemory: false, contribute: false }), code('VERSION_CONFLICT'));
    assert.throws(() => memory.setChatPolicy(scope, 'chat-a', { operationId: 'chat-1', expectedRevision: 0, useMemory: false, contribute: true }), code('OPERATION_CONFLICT'));
    assert.equal(memory.policy(scope, 'chat-a').chat.revision, 1);
  } finally { db.close(); }
});
test('generation admission is invalidated by any intervening policy revision', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); const admission = memory.admit(scope, 'chat-a', [ref]);
    memory.setChatPolicy(scope, 'chat-a', { operationId: 'chat-2', expectedRevision: 1, useMemory: false, contribute: true });
    assert.throws(() => memory.commitRecall(scope, { operationId: 'stale', admission, content: 'candidate', model: 'fixture' }), code('STALE_ADMISSION'));
    assert.equal(memory.operation(scope, 'stale'), null);
  } finally { db.close(); }
});
test('active, excluded, uncertain and changed sources are refused before generation', () => {
  const { db, memory, state } = fixture();
  try {
    enable(memory);
    for (const field of ['active', 'excluded', 'uncertain']) {
      state.source[field] = true;
      assert.throws(() => memory.admit(scope, 'chat-a', [ref]), code('SOURCE_UNAVAILABLE'));
      state.source[field] = false;
    }
    state.source.contentHash = 'b'.repeat(64);
    assert.throws(() => memory.admit(scope, 'chat-a', [ref]), code('SOURCE_UNAVAILABLE'));
  } finally { db.close(); }
});
test('external/tool source generation requires explicit policy opt-in', () => {
  const { db, memory, state } = fixture();
  try {
    enable(memory); state.source.kind = 'tool';
    assert.throws(() => memory.admit(scope, 'chat-a', [ref]), code('EXTERNAL_CONTEXT_EXCLUDED'));
    memory.setPolicy(scope, { operationId: 'policy-2', expectedRevision: 1, enabled: true, generate: true, useMemory: true, externalContext: true });
    assert.equal(memory.admit(scope, 'chat-a', [ref]).sources[0].kind, 'tool');
  } finally { db.close(); }
});
test('source revocation and hash changes remove previously generated recall', () => {
  const { db, memory, state } = fixture();
  try {
    enable(memory); save(memory); state.source.excluded = true;
    assert.equal(memory.recall(scope, 'new-chat').items.length, 0);
    assert.equal(memory.recall(scope, 'new-chat').omitted[0].reason, 'source-unavailable');
    assert.equal(memory.inspect(scope).total, 0);
    state.source.excluded = false; state.source.contentHash = 'c'.repeat(64);
    assert.equal(memory.recall(scope, 'new-chat').items.length, 0);
  } finally { db.close(); }
});
test('forget erases all source derivatives and blocks a previously admitted queued job', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); const first = save(memory); save(memory, 'Second derivative', 'save-2');
    const admission = memory.admit(scope, 'chat-a', [ref]);
    const forgotten = memory.forget(scope, { operationId: 'forget-1', memoryId: first.receipt.memoryId, expectedVersion: 1 });
    assert.equal(forgotten.receipt.forgottenCount, 2);
    assert.equal(memory.recall(scope, 'new-chat').items.length, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM veyra_memory_recall WHERE content<>'' OR provenance_json<>'[]'").get().count, 0);
    assert.throws(() => memory.commitRecall(scope, { operationId: 'late', admission, content: 'Recreated', model: 'fixture' }), code('SOURCE_FORGOTTEN'));
    assert.equal(memory.forget(scope, { operationId: 'forget-1', memoryId: first.receipt.memoryId, expectedVersion: 1 }).idempotent, true);
    assert.equal(JSON.stringify(memory.operation(scope, 'forget-1')).includes('concise'), false);
  } finally { db.close(); }
});
test('reset requires matching exact scope/count preview and does not disable future extraction', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); save(memory); const preview = memory.previewReset(scope);
    save(memory, 'A newer summary', 'save-2');
    assert.throws(() => memory.reset(scope, { operationId: 'reset-stale', confirmation: preview.confirmation }), code('RESET_CHANGED'));
    const current = memory.previewReset(scope); assert.equal(current.count, 2);
    assert.equal(memory.reset(scope, { operationId: 'reset', confirmation: current.confirmation }).receipt.forgottenCount, 2);
    assert.equal(memory.policy(scope, 'chat-a').policy.generate, true);
  } finally { db.close(); }
});
test('restore applies content-free suppressions before restored summaries can serve', () => {
  const first = fixture(), restored = fixture();
  try {
    enable(first.memory); const saved = save(first.memory);
    const row = first.db.prepare('SELECT * FROM veyra_memory_recall').get();
    first.memory.forget(scope, { operationId: 'forget', memoryId: saved.receipt.memoryId, expectedVersion: 1 });
    const bundle = first.memory.exportSuppressions(scope);
    assert.equal(JSON.stringify(bundle).includes('concise'), false);
    restored.db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,?,?,?,?)').run(...['scope_key','id','content','content_hash','provenance_json','version','state','created_at','updated_at'].map((key) => row[key]));
    assert.equal(restored.memory.applySuppressions(scope, bundle).suppressedCount, 1);
    assert.equal(restored.memory.recall(scope, 'fresh').items.length, 0);
    assert.equal(restored.memory.operation(scope, 'forget').receiptId, first.memory.operation(scope, 'forget').receiptId);
    assert.throws(() => restored.memory.applySuppressions({ ...scope, hostId: 'other' }, bundle), code('INVALID_SUPPRESSION'));
  } finally { first.db.close(); restored.db.close(); }
});
test('unknown post-commit checkpoint result reconciles its original receipt', () => {
  const { db, memory, adapter } = fixture();
  try {
    enable(memory); const admission = memory.admit(scope, 'chat-a', [ref]);
    const uncertain = new MemoryLifecycle({ ...adapter, checkpoint: () => { throw new Error('fixture checkpoint failure'); } });
    const input = { operationId: 'uncertain', admission, content: 'Persisted despite checkpoint error', model: 'fixture' };
    assert.throws(() => uncertain.commitRecall(scope, input), /fixture checkpoint failure/);
    assert.equal(memory.operation(scope, 'uncertain').status, 'committed');
    assert.equal(memory.commitRecall(scope, input).idempotent, true);
    assert.equal(memory.inspect(scope).total, 1);
  } finally { db.close(); }
});
test('real file persistence survives connection close and fresh lifecycle instance', { skip: !process.env.VEYRA_MEMORY_TEST_DB }, () => {
  const path = process.env.VEYRA_MEMORY_TEST_DB;
  const first = fixture(path); enable(first.memory); save(first.memory); first.db.close();
  const db = new DatabaseSync(path);
  try {
    const memory = new MemoryLifecycle({ db, authorize: () => true, sources: () => ({ ...ref, excluded: false, uncertain: false }), checkpoint: () => {} });
    assert.equal(memory.recall(scope, 'fresh-after-reopen').items.length, 1);
    assert.equal(memory.operation(scope, 'save-1').status, 'committed');
    assert.equal(memory.policy(scope, 'chat-a').chat.contribute, true);
  } finally { db.close(); }
});

test('input watermark prevents extraction duplication under a different operation id', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); save(memory);
    assert.throws(() => memory.commitRecall(scope, { operationId: 'different-job', admission: memory.admit(scope, 'chat-a', [ref]), content: 'A duplicate extraction', model: 'fixture' }), code('INPUT_ALREADY_PROCESSED'));
    assert.equal(memory.inspect(scope).total, 1);
  } finally { db.close(); }
});
test('idle eligibility is authoritative and rechecked at commit', () => {
  const { db, memory, state } = fixture();
  try {
    enable(memory); const admission = memory.admit(scope, 'chat-a', [ref]); state.source.idleEligible = false;
    assert.throws(() => memory.commitRecall(scope, { operationId: 'active-again', admission, content: 'candidate', model: 'fixture' }), code('SOURCE_UNAVAILABLE'));
  } finally { db.close(); }
});

test('source ordering cannot bypass the extraction watermark and duplicate ids are refused', () => {
  const { db, memory } = fixture();
  try {
    enable(memory);
    const refs = [ref, { ...ref, id: 'turn-b' }];
    const admission = memory.admit(scope, 'chat-a', refs);
    memory.commitRecall(scope, { operationId: 'ordered', admission, content: 'candidate', model: 'fixture' });
    assert.throws(() => memory.commitRecall(scope, { operationId: 'reordered', admission: memory.admit(scope, 'chat-a', [...refs].reverse()), content: 'candidate', model: 'fixture' }), code('INPUT_ALREADY_PROCESSED'));
    assert.throws(() => memory.admit(scope, 'chat-a', [ref, ref]), code('INVALID_INPUT'));
  } finally { db.close(); }
});

test('receipts, suppression tombstones and input watermarks cannot be silently deleted', () => {
  const { db, memory } = fixture();
  try {
    enable(memory); const saved = save(memory);
    memory.forget(scope, { operationId: 'forget', memoryId: saved.receipt.memoryId, expectedVersion: 1 });
    for (const table of ['veyra_memory_receipt','veyra_memory_suppression','veyra_memory_extraction']) {
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/);
    }
  } finally { db.close(); }
});


test('stale binding epochs fail authorization while a current reconnect retains durable memory', () => {
  const { db, memory, adapter } = fixture();
  try {
    enable(memory); save(memory);
    const current = new MemoryLifecycle({ ...adapter, authorize: (candidate) => candidate.bindingEpoch === 2 && candidate.bindingHash === scope.bindingHash });
    assert.throws(() => current.recall(scope, 'fresh'), code('FORBIDDEN'));
    assert.equal(current.recall({ ...scope, bindingEpoch: 2 }, 'fresh').items.length, 1);
  } finally { db.close(); }
});
