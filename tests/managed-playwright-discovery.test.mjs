import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryNames, selectBrowserTool, browserCall, toolResultMetadata } from './managed-playwright-live.mjs';

test('child error diagnostics expose only bounded metadata, never content', () => {
  const result = { isError: true, content: [{ type: 'text', text: 'secret-child-diagnostic'.repeat(10000) }] };
  const metadata = toolResultMetadata(result);
  assert.deepEqual(Object.keys(metadata), ['isError', 'bytes', 'sha256']);
  assert.equal(metadata.isError, true);
  assert.equal(metadata.bytes, Buffer.byteLength(JSON.stringify(result.content)));
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.ok(JSON.stringify(metadata).length < 128);
  assert.ok(!JSON.stringify(metadata).includes('secret-child-diagnostic'));
});

test('discovery projects canonical_name, while MCP selection uses namespaced name', () => {
  const operations = ['navigate', 'snapshot', 'close'];
  const data = operations.map(operation => ({
    source_name: `browser_${operation}`,
    canonical_name: `ingenium_playwright_browser_${operation}`,
    input_schema: '{"type":"object","properties":{}}',
  }));
  assert.deepEqual(discoveryNames({ data }), operations.map(operation => `ingenium_playwright_browser_${operation}`));
  assert.throws(() => discoveryNames({ data: [{ name: 'browser_navigate' }] }), /DISCOVERY_NAME_INVALID/);
  const tools = [{ name: 'other_browser_navigate' }, ...operations.map(operation => ({ name: `playwright_browser_${operation}` }))];
  for (const operation of operations) assert.equal(selectBrowserTool(tools, operation), `playwright_browser_${operation}`);
  assert.equal(selectBrowserTool([{ name: 'other_browser_navigate' }], 'navigate'), undefined);
  assert.deepEqual(browserCall('playwright_browser_navigate', { url: 'http://127.0.0.1:3000/' }), {
    name: 'playwright_browser_navigate',
    arguments: { project: 'ingenium', arguments: { url: 'http://127.0.0.1:3000/' } },
  });
});
