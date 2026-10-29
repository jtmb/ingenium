import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResponses } from '../../veyra-api/compatibility/response-parity.mjs';

const bytes = (text) => new TextEncoder().encode(text);
const response = (status, body, headers = {}) => ({
  status, body: bytes(body),
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});

test('preserves existing collection envelope and opaque UTF-8 bytes', () => {
  const expected = response(200, '{"data":[{"id":"project-a","name":"café","organization_id":"org-a","is_global":0}]}');
  assert.deepEqual(compareResponses(expected, { ...expected, body: expected.body.slice() }),
    { compatible: true, mismatches: [] });
});

test('preserves auth, hidden-resource, rate-limit and upstream-failure contracts', () => {
  for (const status of [401, 403, 404, 422, 429, 500, 503]) {
    const expected = response(status, '{"error":{"code":"SYNTHETIC","message":"Safe error","details":null,"requestId":"fixture"}}',
      { 'www-authenticate': 'Bearer realm="ingenium"', 'retry-after': '20' });
    assert.equal(compareResponses(expected, expected).compatible, true);
    const changed = { ...expected, status: 200 };
    assert.deepEqual(compareResponses(expected, changed).mismatches, ['status']);
  }
});

test('detects byte/encoding/envelope changes even when parsed JSON might look equivalent', () => {
  const before = response(200, '{"data":[]}');
  const after = response(200, '{ "data": [] }');
  assert.deepEqual(compareResponses(before, after).mismatches, ['body']);
});

test('detects challenge/rate-limit removal and cacheable authenticated responses', () => {
  const expected = response(401, '{}', { 'www-authenticate': 'Bearer realm="ingenium"', 'retry-after': '30' });
  const actual = response(401, '{}', { 'cache-control': 'public' });
  assert.deepEqual(compareResponses(expected, actual).mismatches,
    ['header:www-authenticate', 'header:retry-after', 'cache-control']);
});

test('mismatch evidence contains only field names, never response or credential material', () => {
  const result = compareResponses(response(200, 'sensitive-before'), response(403, 'sensitive-after'));
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
  assert.deepEqual(result, { compatible: false, mismatches: ['status', 'body'] });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.mismatches));
});

test('refuses decoded objects and invalid status instead of claiming compatibility', () => {
  assert.throws(() => compareResponses(response(200, '{}'), { status: 200, body: {} }), /original bytes/);
  assert.throws(() => compareResponses(response(200, '{}'), response(0, '{}')), /HTTP status/);
});

test('preserves encoded response metadata alongside original byte payloads', () => {
  const expected = response(200, 'synthetic-encoded-bytes', { 'content-encoding': 'gzip', vary: 'Accept-Encoding' });
  assert.equal(compareResponses(expected, expected).compatible, true);
  const actual = response(200, 'synthetic-encoded-bytes');
  assert.deepEqual(compareResponses(expected, actual).mismatches, ['header:content-encoding', 'header:vary']);
});
