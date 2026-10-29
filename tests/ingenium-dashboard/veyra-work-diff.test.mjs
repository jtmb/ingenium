import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkChanges, parseWorkPatch, splitWorkRows } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-diff.ts';

test('retains exact legacy and native patch formats without path-based authority', () => {
  assert.deepEqual(normalizeWorkChanges([{ file: 'src/view.tsx', before: 'old\r\n', after: 'new\n', additions: 1, deletions: 1 }]), [
    { path: 'src/view.tsx', before: 'old\r\n', after: 'new\n', additions: 1, deletions: 1 },
  ]);
  assert.deepEqual(normalizeWorkChanges([{ path: 'src/view.tsx', patch: '@@ -1 +1 @@\n-old\n+new\n', additions: 1, deletions: 1 }])[0].patch, '@@ -1 +1 @@\n-old\n+new\n');
  assert.deepEqual(normalizeWorkChanges([]), []);
  for (const value of [null, {}, [null], [{ path: '', patch: '', additions: 0, deletions: 0 }], [{ path: 'x', patch: '', additions: -1, deletions: 0 }], [{ path: 'x', patch: '', additions: 0.5, deletions: 0 }], [{ path: 'x', additions: 0, deletions: 0 }]]) {
    assert.throws(() => normalizeWorkChanges(value));
  }
});

test('parses exact hunk line numbers and preserves text and missing-newline markers', () => {
  const rows = parseWorkPatch('--- a/view.ts\n+++ b/view.ts\n@@ -8,2 +8,3 @@\n context\n-old\n+new\n+extra\n\\ No newline at end of file\n');
  assert.ok(rows);
  assert.deepEqual(rows.filter((row) => row.kind === 'remove'), [{ kind: 'remove', text: 'old', oldLine: 9, newLine: null }]);
  assert.deepEqual(rows.filter((row) => row.kind === 'add').map((row) => [row.newLine, row.text]), [[9, 'new'], [10, 'extra']]);
  assert.equal(rows.at(-1).text, '\\ No newline at end of file');
});

test('handles added/deleted files and multiple hunks; never fabricates truncated or binary hunks', () => {
  assert.equal(parseWorkPatch('@@ -0,0 +1 @@\n+new\n')[1].newLine, 1);
  assert.equal(parseWorkPatch('@@ -1 +0,0 @@\n-old\n')[1].oldLine, 1);
  assert.equal(parseWorkPatch('@@ -1 +1 @@\n-old\n+new\n@@ -50 +50 @@\n-next\n+last\n').at(-1).newLine, 50);
  for (const patch of ['Binary files differ', '@@ -1,2 +1,2 @@\n-old\n+new\n', '@@ -1 +1 @@\n-old\n+new\n+extra\n', '@@ -1e3 +1 @@\n-old\n+new\n', '@@ -1 +1 @@\nold\nnew\n']) {
    assert.equal(parseWorkPatch(patch), null);
  }
});

test('split hunks align unchanged context after unequal additions/deletions and retain one-sided newline notes', () => {
  const rows = parseWorkPatch('@@ -1,2 +1,3 @@\n-old\n+new\n+extra\n context\n');
  const pairs = splitWorkRows(rows);
  assert.equal(pairs[1].before.text, 'old');
  assert.equal(pairs[1].after.text, 'new');
  assert.equal(pairs[2].before, null);
  assert.equal(pairs[2].after.text, 'extra');
  assert.equal(pairs[3].before.text, 'context');
  assert.equal(pairs[3].after.text, 'context');
  const newline = splitWorkRows(parseWorkPatch('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n'));
  assert.equal(newline[2].before.kind, 'meta');
  assert.equal(newline[2].after, null);
});
