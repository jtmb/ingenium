import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MemoryLifecycle } from '../lib/memory-v2/lifecycle.mjs';
import { runMemoryExtraction } from '../lib/memory-v2/jobs.mjs';
const scope = { organizationId: 'org', ownerUserId: 'user', hostId: 'host', environmentId: 'env', projectId: 'project', workspaceId: 'workspace', bindingHash: 'authorized-binding-hash', bindingEpoch: 1, visibility: 'private' };
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../lib/memory-v2/schema.sql', import.meta.url), 'utf8'));
  const source = { contentHash: 'a'.repeat(64), active: false, excluded: false, uncertain: false, idleEligible: true, kind: 'transcript' };
  const memory = new MemoryLifecycle({ db, authorize: () => true, sources: () => source, checkpoint: () => {} });
  memory.setPolicy(scope, { operationId: 'policy', expectedRevision: 0, enabled: true, generate: true, useMemory: true, externalContext: false });
  memory.setChatPolicy(scope, 'chat', { operationId: 'chat', expectedRevision: 0, useMemory: true, contribute: true });
  const args = { memory, scope, chatId: 'chat', operationId: 'job', sourceRefs: [{ id: 'turn', contentHash: source.contentHash }], model: 'qualified-job-model',
    leaseValid: () => true, quota: () => 'available', extract: async () => 'candidate', minimize: async () => 'Minimized private preference' };
  return { db, memory, source, args };
}
test('existing Jobs adapter commits once and reconciles instead of rerunning extraction', async () => {
  const { db, memory, args } = fixture();
  try {
    let extracts = 0;
    const run = { ...args, extract: async () => { extracts++; return 'candidate'; } };
    assert.equal((await runMemoryExtraction(run)).status, 'committed');
    assert.equal((await runMemoryExtraction(run)).status, 'reconciled');
    assert.equal(extracts, 1); assert.equal(memory.recall(scope, 'fresh').items.length, 1);
  } finally { db.close(); }
});
test('unknown quota defers learned extraction without calling a model or changing controls', async () => {
  const { db, memory, args } = fixture();
  try {
    const result = await runMemoryExtraction({ ...args, quota: () => 'unknown', extract: async () => { assert.fail('Must not call model'); } });
    assert.deepEqual(result, { status: 'deferred', reason: 'quota-unknown' });
    assert.equal(memory.operation(scope, 'job'), null);
  } finally { db.close(); }
});
test('lease loss or source exclusion during inference prevents persistence', async () => {
  const { db, memory, source, args } = fixture();
  try {
    let valid = true;
    await assert.rejects(runMemoryExtraction({ ...args, leaseValid: () => valid, extract: async () => { valid = false; return 'candidate'; } }), (error) => error.code === 'LEASE_REVOKED');
    assert.equal(memory.inspect(scope).total, 0);
    await assert.rejects(runMemoryExtraction({ ...args, extract: async () => { source.excluded = true; return 'candidate'; } }), (error) => error.code === 'SOURCE_UNAVAILABLE');
    assert.equal(memory.operation(scope, 'job'), null);
  } finally { db.close(); }
});

test('job receipt reconciliation rejects a changed model/source body', async () => {
  const { db, args } = fixture();
  try {
    await runMemoryExtraction(args);
    await assert.rejects(runMemoryExtraction({ ...args, model: 'different-model' }), (error) => error.code === 'OPERATION_CONFLICT');
    await assert.rejects(runMemoryExtraction({ ...args, sourceRefs: [{ id: 'different-turn', contentHash: 'a'.repeat(64) }] }), (error) => error.code === 'OPERATION_CONFLICT');
  } finally { db.close(); }
});

test('a new job operation for already processed input skips quota, extraction and minimization', async () => {
  const { db, memory, args } = fixture();
  try {
    const first = await runMemoryExtraction(args);
    const second = await runMemoryExtraction({ ...args, operationId: 'duplicate-delivery',
      quota: () => assert.fail('No quota consumption for completed input'),
      extract: async () => assert.fail('No duplicate model extraction'),
      minimize: async () => assert.fail('No duplicate minimization') });
    assert.deepEqual(second, { status: 'already-processed', memoryId: first.receipt.memoryId });
    assert.equal(memory.operation(scope, 'duplicate-delivery'), null);
    assert.equal(memory.inspect(scope).total, 1);
  } finally { db.close(); }
});
test('processed input lookup remains scope and capability bound', async () => {
  const { db, memory, args } = fixture();
  try {
    const admission = memory.admit(scope, 'chat', args.sourceRefs);
    assert.equal(memory.processedExtraction(scope, admission), null);
    await runMemoryExtraction(args);
    assert.ok(memory.processedExtraction(scope, admission).memoryId);
    assert.throws(() => memory.processedExtraction({ ...scope, ownerUserId: 'different-owner' }, admission), (error) => error.code === 'STALE_ADMISSION');
  } finally { db.close(); }
});
