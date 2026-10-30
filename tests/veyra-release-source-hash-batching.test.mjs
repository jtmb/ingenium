import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashSourceFileBatch } from '../tools/veyra-release/source-hash-batching.mjs';
import { proposeSourceHashBatching } from '../tools/veyra-release/source-hash-batching-patch.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const info = name => ({ bytes: Buffer.byteLength(name + ':content'), sha256: sha(name + ':content') });

test('empty/small Source sets use no more readers than files', async () => {
  let calls = 0;
  assert.deepEqual(await hashSourceFileBatch([], () => { calls++; }), []); assert.equal(calls, 0);
  assert.deepEqual(await hashSourceFileBatch(['one'], async name => { calls++; await delay(2); return info(name); }), [['one', info('one')]]);
  assert.equal(calls, 1);
});
test('real delayed reads overlap but never exceed eight open reader handles', async () => {
  const names = Array.from({ length: 37 }, (_, i) => `${i}`.padStart(3, '0'));
  let active = 0, peak = 0, opened = 0, closed = 0;
  const result = await hashSourceFileBatch(names, async name => {
    active++; opened++; peak = Math.max(peak, active);
    try { await delay(2 + Number(name) % 5); return info(name); }
    finally { await delay(1); active--; closed++; }
  });
  assert.equal(peak, 8); assert.equal(active, 0); assert.equal(opened, 37); assert.equal(closed, opened);
  assert.deepEqual(result, names.map(name => [name, info(name)]));
});
test('completion order cannot change original sorted file order or sequential digest', async () => {
  const names = ['z.rs', 'ä.rs', 'a.rs', 'nested/one.rs', 'Z.rs', '0.rs'].sort(), completed = [];
  const sequential = names.map(name => [name, info(name)]);
  const result = await hashSourceFileBatch(names, async name => { await delay((names.length - names.indexOf(name)) * 3); completed.push(name); return info(name); });
  assert.notDeepEqual(completed, names); assert.deepEqual(result, sequential);
  assert.equal(sha(JSON.stringify(result)), sha(JSON.stringify(sequential)));
});
test('failure stops new reads, drains every started finally-close and preserves earliest sorted failure', async () => {
  const names = Array.from({ length: 30 }, (_, i) => String(i).padStart(2, '0'));
  const low = new Error('lower sorted descriptor race'), fast = new Error('faster higher-index read failure');
  const opened = [], closed = []; let active = 0;
  await assert.rejects(hashSourceFileBatch(names, async name => {
    opened.push(name); active++;
    try {
      await delay(name === '03' ? 1 : name === '00' ? 10 : 15);
      if (name === '03') throw fast;
      if (name === '00') throw low;
      return info(name);
    } finally { await delay(2); active--; closed.push(name); }
  }), error => error === low);
  assert.equal(active, 0); assert.deepEqual(opened, names.slice(0, 8)); assert.equal(closed.length, opened.length);
});
test('synchronous read failure starts no additional reader and keeps its exact error', async () => {
  const error = new Error('linked Source refused'); let calls = 0;
  await assert.rejects(hashSourceFileBatch(['a', 'b', 'c'], () => { calls++; throw error; }), value => value === error);
  assert.equal(calls, 1);
});
test('one rejected reader does not leave later started rejections or handles unsettled', async () => {
  let active = 0, closed = 0;
  await assert.rejects(hashSourceFileBatch(['a', 'b', 'c', 'd'], async name => {
    active++;
    try { await delay(name === 'b' ? 1 : 7); throw new Error(name + ' refused'); }
    finally { await delay(1); active--; closed++; }
  }), /a refused/);
  assert.equal(active, 0); assert.equal(closed, 4);
});
test('even a falsy rejection is preserved after all readers settle', async () => {
  let rejected = false, closed = 0;
  try { await hashSourceFileBatch(['a', 'b'], async name => { try { await delay(1); if (name === 'a') throw undefined; return info(name); } finally { closed++; } }); }
  catch (error) { rejected = true; assert.equal(error, undefined); }
  assert.equal(rejected, true); assert.equal(closed, 2);
});
test('caller mutation after dispatch cannot reorder or replace captured Source names', async () => {
  const names = ['a', 'b', 'c'], original = [...names];
  const work = hashSourceFileBatch(names, async name => { await delay(2); return info(name); });
  names.reverse(); names[0] = 'replacement';
  assert.deepEqual(await work, original.map(name => [name, info(name)]));
});
test('follow-on patch admits only e5 baseline, preserving original descriptor/cache sections', async () => {
  const base = new URL('../', import.meta.url);
  const before = await readFile(new URL('tools/veyra-release/native-reviewed-cargo-check.mjs', base));
  const helper = await readFile(new URL('tools/veyra-release/source-hash-batching.mjs', base));
  const proposal = proposeSourceHashBatching(before, helper);
  assert.equal(proposal.descriptorChecksPreserved, true); assert.equal(proposal.cacheHashingPreserved, true);
  assert(proposal.after.includes('    safeRelative(name);'));
  assert(proposal.after.includes('hashFile(root, path.join(root, name), 67108864)'));
  assert(proposal.after.includes(".split('\\0').filter(Boolean).sort()"));
  assert.throws(() => proposeSourceHashBatching(Buffer.concat([before, Buffer.from(' ')]), helper), /preimage/);
});

test('async descriptor/symlink/race/EOF/close refusals keep exact original errors after all handles close', async () => {
  for (const label of ['linked Source', 'redirected ancestor', 'descriptor replacement', 'short read', 'grew during read', 'close failure']) {
    const original = new Error(label); let closed = 0;
    await assert.rejects(hashSourceFileBatch(['a', 'b', 'c'], async name => {
      try { await delay(name === 'a' ? 1 : 3); if (name === 'a') throw original; return info(name); }
      finally { closed++; }
    }), error => error === original);
    assert.equal(closed, 3);
  }
});

test('exact delivered patch reconstructs proposed module entirely in memory', async () => {
  const base = new URL('../', import.meta.url);
  const before = await readFile(new URL('tools/veyra-release/native-reviewed-cargo-check.mjs', base));
  const helper = await readFile(new URL('tools/veyra-release/source-hash-batching.mjs', base));
  const proposal = proposeSourceHashBatching(before, helper);
  const delivered = await readFile(new URL('docs/workstreams/packaging/native-source-hash-batching.patch', base), 'utf8');
  const meta = JSON.parse(await readFile(new URL('docs/workstreams/packaging/native-source-hash-batching.json', base), 'utf8'));
  assert.equal(delivered, proposal.patch); assert.equal(sha(delivered), meta.patchSha256); assert.equal(sha(proposal.after), meta.afterSha256);
  const source = before.toString().trimEnd().split('\n'), result = []; let cursor = 0;
  for (const line of delivered.trimEnd().split('\n').slice(3)) {
    const hunk = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(line);
    if (hunk) { const start = Number(hunk[1]) - (Number(hunk[2]) ? 1 : 0); result.push(...source.slice(cursor, start)); cursor = start; continue; }
    const kind = line === '' ? ' ' : line[0], value = line === '' ? '' : line.slice(1);
    if (kind === ' ' || kind === '-') { assert.equal(source[cursor++], value); if (kind === ' ') result.push(value); }
    else if (kind === '+') result.push(value);
    else assert.fail('Unexpected patch record');
  }
  result.push(...source.slice(cursor)); assert.equal(result.join('\n') + '\n', proposal.after);
});
test('patched module evaluates without capture and retains existing policy/refusal functions', async () => {
  const base = new URL('../', import.meta.url);
  const before = await readFile(new URL('tools/veyra-release/native-reviewed-cargo-check.mjs', base));
  const helper = await readFile(new URL('tools/veyra-release/source-hash-batching.mjs', base));
  const { after } = proposeSourceHashBatching(before, helper);
  const old = await import('../tools/veyra-release/native-reviewed-cargo-check.mjs');
  const changed = await import('data:text/javascript;base64,' + Buffer.from(after).toString('base64'));
  assert.deepEqual(changed.CHECK, old.CHECK);
  for (const name of ['readReviewReceipt', 'prepareCheckEnvironment', 'validateToolchain', 'validateReview', 'validateStorage', 'validateAliasIdentity', 'receiptPath', 'createCheckRunner']) assert.equal(changed[name].toString(), old[name].toString());
  assert.throws(() => changed.prepareCheckEnvironment({ RUSTFLAGS: 'custom' }), /override/);
  assert.throws(() => changed.validateStorage({ stage: { local_task_budget_bytes: 24 * 1024 ** 3 } }), /guard\/cap\/floors/);
  assert.throws(() => changed.validateToolchain([]), /toolchain/);
});
