import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MemoryLifecycle } from '../lib/memory-v2/lifecycle.mjs';
import { memoryResponse } from '../lib/memory-v2/http.mjs';
const scope = { organizationId: 'org', ownerUserId: 'user', hostId: 'host', environmentId: 'env', projectId: null, workspaceId: 'workspace', bindingHash: 'authorized-binding-hash', bindingEpoch: 1, visibility: 'private' };
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../lib/memory-v2/schema.sql', import.meta.url), 'utf8'));
  return { db, memory: new MemoryLifecycle({ db, authorize: () => true, sources: () => null, checkpoint: () => {} }) };
}
test('API facade resolves scope, returns real policy and rejects caller scope injection', () => {
  const { db, memory } = fixture();
  try {
    const request = { action: 'policy', method: 'GET', chatId: 'chat-a' };
    const ok = memoryResponse(memory, () => scope, request);
    assert.equal(ok.status, 200); assert.equal(ok.body.data.policy.generate, false);
    assert.equal(ok.body.data.bindingEpoch, scope.bindingEpoch); assert.equal(ok.body.data.bindingHash, scope.bindingHash); assert.equal(ok.body.data.chatId, request.chatId);
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.equal(memoryResponse(memory, () => null, request).status, 403);
    assert.equal(memoryResponse(memory, () => scope, { ...request, body: { ownerUserId: 'other' } }).status, 422);
    assert.equal(memoryResponse(memory, () => scope, { ...request, query: { scope: 'other' } }).status, 422);
    assert.equal(memoryResponse(memory, () => scope, { ...request, method: 'POST' }).status, 405);
    assert.equal(memoryResponse(memory, () => scope, { ...request, action: '__proto__' }).status, 404);
  } finally { db.close(); }
});
test('API facade commits CAS changes and reports conflicts with sanitized errors', () => {
  const { db, memory } = fixture();
  try {
    const request = { action: 'set-chat-policy', method: 'PUT', chatId: 'chat-a', body: { operationId: 'one', expectedRevision: 0, useMemory: false, contribute: false } };
    assert.equal(memoryResponse(memory, () => scope, request).body.data.receipt.status, 'committed');
    assert.equal(memoryResponse(memory, () => scope, request).body.data.idempotent, true);
    assert.equal(memoryResponse(memory, () => scope, { ...request, body: { ...request.body, operationId: 'two' } }).status, 409);
    const failed = memoryResponse(memory, () => { throw new Error('private database path'); }, request);
    assert.equal(failed.status, 500); assert.equal(JSON.stringify(failed).includes('private database path'), false);
  } finally { db.close(); }
});
