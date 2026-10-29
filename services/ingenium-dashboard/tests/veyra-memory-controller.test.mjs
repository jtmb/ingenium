import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryController } from '../src/app/components/memory-v2/controller.mjs';
const a = { scopeKey: 'local-binding-a', scopeHash: 'scope-a', chatId: 'chat-a', bindingHash: 'hash-a', bindingEpoch: 1 };
const b = { ...a, scopeKey: 'local-binding-b', scopeHash: 'scope-b', chatId: 'chat-b', bindingHash: 'hash-b' };
const host = { revision: 2, enabled: true, generate: false, useMemory: true, externalContext: false };
const chat = { revision: 3, useMemory: true, contribute: false };
const change = { target: 'chat', expectedRevision: 3, values: { ...chat, contribute: true } };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const entries = new Map(), requests = []; let version = 3;
  const response = (binding) => ({ ...binding, available: true, canChange: true, policy: host, chat: { ...chat, revision: version } });
  const journal = { get: (key) => entries.get(key), set: (key, value) => entries.set(key, structuredClone(value)), remove: (key, op) => { if (entries.get(key)?.operationId === op) entries.delete(key); } };
  const receipt = (record) => ({ status: 'committed', operationId: record.operationId, scopeHash: record.identity.scopeHash, operation: record.change.target === 'host' ? 'policy' : 'chat-policy', revision: record.change.expectedRevision + 1 });
  const api = { read: async (binding) => response(binding), change: async (record) => { requests.push(record); version++; return { receipt: receipt(record) }; }, operation: async () => null };
  const make = () => createMemoryController({ api, journal, newOperationId: () => 'original-operation' });
  return { entries, requests, response, journal, receipt, api, make };
}
test('controller journals before sending an exact CAS change and reloads authoritative state', async () => {
  const fixtureState = fixture(), { api, entries, receipt } = fixtureState;
  api.change = async (record) => { assert.equal(entries.get(a.scopeHash).operationId, record.operationId); return { receipt: receipt(record) }; };
  const controller = fixtureState.make(); await controller.activate(a);
  assert.equal(await controller.change(a.scopeKey, a.chatId, change), true);
  assert.equal(entries.size, 0); assert.equal(controller.getSnapshot().pending, false);
});
test('a late availability response cannot cross workspace or reconnect epochs', async () => {
  const f = fixture(), first = deferred(); f.api.read = (binding) => binding.scopeKey === a.scopeKey ? first.promise : Promise.resolve(f.response(binding));
  const controller = f.make(), loading = controller.activate(a); await controller.activate(b);
  first.resolve(f.response(a)); await loading;
  assert.equal(controller.getSnapshot().scopeKey, b.scopeKey); assert.equal(controller.getSnapshot().available, true);
  f.api.read = async () => f.response(a); await controller.activate({ ...a, bindingEpoch: 2 });
  assert.equal(controller.getSnapshot().available, false);
});
test('unknown outcomes survive controller recreation; absent receipts never replay writes', async () => {
  const f = fixture(); let calls = 0;
  f.api.change = async () => { calls++; throw new Error('transport disconnected'); };
  const first = f.make(); await first.activate(a); await first.change(a.scopeKey, a.chatId, change); first.dispose();
  const second = f.make(); await second.activate({ ...a, bindingEpoch: 2 });
  assert.equal(second.getSnapshot().unknownOperationId, 'original-operation');
  assert.equal(await second.reconcile('original-operation'), false);
  assert.equal(await second.change(a.scopeKey, a.chatId, change), false);
  assert.equal(calls, 1); assert.equal(f.entries.size, 1);
  f.api.operation = async () => f.receipt(f.entries.get(a.scopeHash));
  assert.equal(await second.reconcile('original-operation'), true);
  assert.equal(second.getSnapshot().unknownOperationId, undefined); assert.equal(f.entries.size, 0);
});
test('late mutation results preserve the current workspace and retain only original receipts', async () => {
  const f = fixture(), pending = deferred(); f.api.change = () => pending.promise;
  const controller = f.make(); await controller.activate(a);
  const writing = controller.change(a.scopeKey, a.chatId, change); await controller.activate(b);
  pending.resolve({ receipt: f.receipt(f.entries.get(a.scopeHash)) }); assert.equal(await writing, true);
  assert.equal(controller.getSnapshot().scopeKey, b.scopeKey); assert.equal(f.entries.size, 0);
});
test('definitive conflicts refresh controls without replaying the failed change', async () => {
  const f = fixture(); let calls = 0;
  f.api.change = async () => { calls++; throw Object.assign(new Error('CAS conflict'), { status: 409, code: 'VERSION_CONFLICT' }); };
  const controller = f.make(); await controller.activate(a); assert.equal(await controller.change(a.scopeKey, a.chatId, change), false);
  assert.equal(controller.getSnapshot().unknownOperationId, undefined); assert.equal(f.entries.size, 0); assert.equal(calls, 1);
});
test('journal failures and mismatched receipts fail closed', async () => {
  const f = fixture(); let calls = 0;
  f.api.change = async () => { calls++; return { receipt: { status: 'committed', operationId: 'wrong' } }; };
  const controller = f.make(); await controller.activate(a); await controller.change(a.scopeKey, a.chatId, change);
  assert.equal(controller.getSnapshot().unknownOperationId, 'original-operation'); assert.equal(calls, 1);
  const failing = fixture(); failing.journal.set = () => { throw new Error('draft store unavailable'); };
  failing.api.change = async () => assert.fail('Journal must succeed before a write');
  const blocked = failing.make(); await blocked.activate(a); assert.equal(await blocked.change(a.scopeKey, a.chatId, change), false);
  assert.equal(blocked.getSnapshot().available, false);
});

test('settling an earlier chat write releases its journal lock in the current chat of the same scope', async () => {
  const f = fixture(), pending = deferred(); f.api.change = () => pending.promise;
  const controller = f.make(); await controller.activate(a);
  const writing = controller.change(a.scopeKey, a.chatId, change);
  const anotherChat = { ...a, chatId: 'second-chat' }; await controller.activate(anotherChat);
  assert.equal(controller.getSnapshot().unknownOperationId, 'original-operation');
  pending.resolve({ receipt: f.receipt(f.entries.get(a.scopeHash)) }); await writing;
  assert.equal(controller.getSnapshot().chatId, anotherChat.chatId);
  assert.equal(controller.getSnapshot().unknownOperationId, undefined);
  assert.equal(controller.getSnapshot().available, true);
});

test('proxy timeouts and unclassified HTTP failures preserve unknown mutation identity', async () => {
  for (const error of [{ status: 408 }, { status: 409 }, { status: 502, code: 'UPSTREAM_ERROR' }]) {
    const f = fixture(); f.api.change = async () => { throw error; };
    const controller = f.make(); await controller.activate(a); await controller.change(a.scopeKey, a.chatId, change);
    assert.equal(controller.getSnapshot().unknownOperationId, 'original-operation');
    assert.equal(f.entries.size, 1);
  }
});

test('an asynchronous durable journal must finish before the API write is sent', async () => {
  const f = fixture(), durable = deferred(), wrote = deferred(); let calls = 0;
  f.journal.set = async (key, record) => { wrote.resolve(); await durable.promise; f.entries.set(key, structuredClone(record)); };
  f.api.change = async (record) => { calls++; assert.equal(f.entries.get(a.scopeHash).operationId, record.operationId); return { receipt: f.receipt(record) }; };
  const controller = f.make(); await controller.activate(a);
  const writing = controller.change(a.scopeKey, a.chatId, change); await wrote.promise;
  assert.equal(calls, 0); assert.equal(controller.getSnapshot().pending, true);
  assert.equal(await controller.change(a.scopeKey, a.chatId, change), false);
  durable.resolve(); assert.equal(await writing, true); assert.equal(calls, 1);
});
