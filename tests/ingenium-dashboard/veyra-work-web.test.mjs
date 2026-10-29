import test from 'node:test';
import assert from 'node:assert/strict';
import { workWebSessionUrl } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-web.ts';

test('pinned Web route targets exact session on the authorized gateway origin', () => {
  const root = 'https://web-workspace.example.test/';
  const href = workWebSessionUrl(root, 'ses_original_123');
  const parsed = new URL(href);
  const [, route, key, sessionRoute, id] = parsed.pathname.split('/');
  assert.equal(parsed.origin, new URL(root).origin);
  assert.equal(route, 'server');
  assert.equal(sessionRoute, 'session');
  assert.equal(id, 'ses_original_123');
  assert.equal(Buffer.from(key, 'base64url').toString('utf8'), new URL(root).origin);
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
});

test('development, LAN and isolated gateways retain their exact public origin and port', () => {
  for (const origin of ['http://opencode.localhost:3000', 'https://opencode.example.test', 'https://workspace-123.example.test:8443']) {
    const url = new URL(workWebSessionUrl(`${origin}/`, 'ses-a'));
    const key = url.pathname.split('/')[2];
    assert.equal(url.origin, origin);
    assert.equal(Buffer.from(key, 'base64url').toString('utf8'), origin);
  }
});

test('rejects launch tickets, credentials, path changes and unqualified protocols', () => {
  for (const root of ['javascript:alert(1)', 'file:///workspace', 'https://user:secret@example.test/', 'https://example.test/__ingenium/exchange', 'https://example.test/?ticket=secret', 'https://example.test/#session']) {
    assert.throws(() => workWebSessionUrl(root, 'ses-a'));
  }
  for (const id of ['', '../other', 'ses/a', 'ses?query', 'ses#fragment', 'ses%2fother', 'a'.repeat(257)]) {
    assert.throws(() => workWebSessionUrl('https://example.test/', id));
  }
  assert.throws(() => workWebSessionUrl('https://example.test/', 'ses-a', 'unknown-version'));
});
