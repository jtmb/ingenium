import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkArtifacts, previewWorkArtifact, workSourceDownload } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-artifacts.ts';

const file = { id: 'part-a', messageId: 'message-a', name: 'notes.md', mime: 'text/markdown' };

test('collects only native file parts with message-scoped identity and preserves source metadata', () => {
  const artifacts = collectWorkArtifacts([{ id: 'message-a', parts: [{ id: 'part-a', type: 'file', mime: 'text/plain', filename: 'notes.txt', content: 'Exact\r\noriginal', size: 15 }, { id: 'tool-a', type: 'tool', content: 'not a file' }] },
    { id: 'message-b', parts: [{ id: 'part-a', type: 'file', mime: 'image/png', url: 'data:image/png;base64,AA==' }] }]);
  assert.equal(artifacts.length, 2);
  assert.notEqual(artifacts[0].id, artifacts[1].id);
  assert.equal(artifacts[0].content, 'Exact\r\noriginal');
  assert.equal(artifacts[0].messageId, 'message-a');
  assert.equal(artifacts[0].size, 15);
  assert.equal(artifacts[1].name, 'Untitled file');
});

test('never fetches remote/local references or treats a MIME mismatch as a successful preview', () => {
  for (const url of ['https://example.test/private', '/api/files/unknown', 'file:///C:/private.txt', 'javascript:alert(1)', 'data:image/png;base64,AA==']) {
    assert.equal(previewWorkArtifact({ ...file, url }).kind, 'unavailable');
  }
  assert.equal(previewWorkArtifact({ ...file, mime: 'image/svg+xml', url: 'data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%3E' }).kind, 'text');
});

test('decodes UTF-8 text losslessly, retains exact source and rejects invalid/oversized data', () => {
  const content = '# Résumé\r\nKeep source exact.\n';
  assert.deepEqual(previewWorkArtifact({ ...file, url: `data:text/markdown;base64,${Buffer.from(content).toString('base64')}` }), { kind: 'text', text: content, markdown: true, json: false });
  assert.equal(previewWorkArtifact({ ...file, url: 'data:text/markdown,%23%20Hello%20world' }).text, '# Hello world');
  assert.equal(previewWorkArtifact({ ...file, url: 'data:text/markdown;base64,@@invalid' }).kind, 'unavailable');
  assert.equal(previewWorkArtifact({ ...file, url: 'data:text/markdown;base64,/w==' }).kind, 'unavailable');
  assert.equal(previewWorkArtifact({ ...file, content: 'x'.repeat(200001) }).kind, 'unavailable');
});

test('supports bounded raster/PDF data references and keeps unknown formats explicit', () => {
  assert.equal(previewWorkArtifact({ ...file, mime: 'image/png', url: 'data:image/png;base64,AA==' }).kind, 'image');
  assert.equal(previewWorkArtifact({ ...file, mime: 'application/pdf', url: 'data:application/pdf;base64,JVBERg==' }).kind, 'pdf');
  assert.equal(previewWorkArtifact({ ...file, mime: 'application/octet-stream', url: 'data:application/octet-stream;base64,AA==' }).kind, 'unavailable');
});

test('UTF-8 source export preserves line endings and does not replace unsupported Unicode', () => {
  const original = 'Résumé\r\nExact source\n';
  const href = workSourceDownload(original);
  assert.equal(decodeURIComponent(href.slice(href.indexOf(',') + 1)), original);
  assert.equal(workSourceDownload('\ud800'), null);
});
