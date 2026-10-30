/** Model-free harness only. No process is spawned, no privileged action occurs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRetainedOwnerRunner } from './retained-kernel-owner.mjs';

const original = Buffer.from([127, 69, 76, 70, 1, 2, 3, 4]);
const replacement = Buffer.from([127, 69, 76, 70, 9, 8, 7, 6]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ mode = 0o100500, uid = 0, nlink = 1, changed = false, spawnThrow = false } = {}) {
  let pathnameBytes = original, closes = 0, spawned = 0, kills = 0, next = 40;
  const descriptors = new Map(), signals = new EventEmitter(), child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = signal => { assert.equal(signal, 'SIGTERM'); kills++; return true; };
  const input = { path: '/mutable/task/kernel-owner', ownerUid: 0, sha256: sha(original), maxBytes: 4096,
    originalFact: { device: '8', inode: '42' } };
  const io = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0x20000, O_CLOEXEC: 0x80000 },
    openSync(path, flags) { assert.equal(path, input.path); assert.ok(flags & this.constants.O_NOFOLLOW); const fd = next++; descriptors.set(fd, { bytes: pathnameBytes, offset: 0, stats: 0 }); return fd; },
    fstatSync(fd) { const d = descriptors.get(fd); assert.ok(d); d.stats++; return { isFile: () => true,
      dev: 8, ino: changed && d.stats > 1 ? 43 : 42, size: d.bytes.length, mtimeMs: 1, ctimeMs: 2, uid, mode, nlink }; },
    readSync(fd, bytes, offset, count) { const d = descriptors.get(fd); assert.ok(d); const n = Math.min(count, d.bytes.length - d.offset);
      d.bytes.copy(bytes, offset, d.offset, d.offset + n); d.offset += n; return n; },
    closeSync(fd) { assert.ok(descriptors.delete(fd), 'descriptor closed exactly once'); closes++; },
  };
  const run = createRetainedOwnerRunner({ io, signals, spawnChild(path, args, options) {
    spawned++; assert.equal(path, '/proc/self/fd/3'); assert.deepEqual(args, ['fixed']);
    assert.equal(options.shell, false); assert.deepEqual(options.stdio.slice(0, 3), ['ignore', 'pipe', 'pipe']);
    // Rename/replacement of the source path cannot change the inherited object.
    pathnameBytes = replacement; const selected = descriptors.get(options.stdio[3]); assert.ok(selected);
    assert.equal(sha(selected.bytes), sha(original)); assert.notEqual(sha(pathnameBytes), sha(selected.bytes));
    if (spawnThrow) throw new Error('fixture synchronous spawn refusal'); return child;
  } });
  return { run: () => run(input, ['fixed'], { cwd: '/owned/run' }), child, signals,
    counts: () => ({ open: descriptors.size, closes, spawned, kills }),
    end: () => { child.stdout.end(); child.stderr.end(); }, input };
}

test('swapped pathname selects original inherited fd; retain through exit, pumps and actual close', async () => {
  const f = fixture(), pending = f.run(); assert.equal(f.counts().open, 1);
  f.child.emit('exit', 0, null); f.end(); await tick(); assert.equal(f.counts().open, 1);
  f.child.emit('close', 0, null); const result = await pending;
  assert.equal(result.inputFact.sha256, sha(original)); assert.ok(result.joined.every(p => p.status === 'fulfilled'));
  assert.deepEqual(f.counts(), { open: 0, closes: 1, spawned: 1, kills: 0 });
  assert.equal(f.signals.listenerCount('SIGTERM'), 0); assert.equal(f.signals.listenerCount('SIGINT'), 0);
});

test('synchronous spawn refusal closes original descriptor without a child', async () => {
  const f = fixture({ spawnThrow: true }); await assert.rejects(f.run(), /synchronous spawn refusal/);
  assert.deepEqual(f.counts(), { open: 0, closes: 1, spawned: 1, kills: 0 });
});

test('asynchronous spawn error retains fd until actual close and pipe joins', async () => {
  const f = fixture(), pending = f.run(); f.child.emit('error', new Error('fixture async spawn refusal'));
  f.end(); await tick(); assert.equal(f.counts().open, 1);
  f.child.emit('close', -1, null); const result = await pending;
  assert.equal(result.joined[0].status, 'rejected'); assert.equal(result.joined[1].status, 'fulfilled');
  assert.equal(f.counts().open, 0); assert.equal(f.counts().closes, 1);
});

test('cancellation signals original owner and retains fd until positive joins', async () => {
  const f = fixture(), pending = f.run(); f.signals.emit('SIGTERM');
  assert.equal(f.counts().kills, 1); assert.equal(f.counts().open, 1);
  f.child.emit('exit', null, 'SIGTERM'); await tick(); assert.equal(f.counts().open, 1);
  f.end(); f.child.emit('close', null, 'SIGTERM'); const result = await pending;
  assert.equal(result.exitValue.signal, 'SIGTERM'); assert.equal(result.firstError.code, 'QUAL_CANCELLED'); assert.equal(f.counts().open, 0);
});

test('pipe failure cancels but cannot replace original close/exit joins', async () => {
  const f = fixture(), pending = f.run(); f.child.stdout.destroy(new Error('fixture pipe fault'));
  await tick(); assert.ok(f.counts().kills > 0); assert.equal(f.counts().open, 1);
  f.child.stderr.end(); f.child.emit('exit', 1, null); f.child.emit('close', 1, null);
  const result = await pending; assert.ok(result.firstError); assert.equal(result.joined[2].status, 'rejected'); assert.equal(f.counts().open, 0);
});

test('descriptor custody, content changes and original identity refuse before spawn without leaks', async () => {
  for (const options of [{ uid: 1000 }, { mode: 0o100522 }, { nlink: 2 }, { changed: true }]) {
    const f = fixture(options); await assert.rejects(f.run(), /QUAL_ROOT_OWNER_FD_/);
    assert.deepEqual(f.counts(), { open: 0, closes: 1, spawned: 0, kills: 0 });
  }
  for (const mutate of [f => { f.input.sha256 = sha(replacement); }, f => { f.input.originalFact.inode = '900'; }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run(), /QUAL_ROOT_OWNER_/);
    assert.deepEqual(f.counts(), { open: 0, closes: 1, spawned: 0, kills: 0 });
  }
});

test('repeated spawn failures leak neither descriptors nor cancellation listeners', async () => {
  for (let i = 0; i < 32; i++) {
    const f = fixture({ spawnThrow: true }); await assert.rejects(f.run());
    assert.equal(f.counts().open, 0); assert.equal(f.counts().closes, 1);
    assert.equal(f.signals.listenerCount('SIGINT') + f.signals.listenerCount('SIGTERM'), 0);
  }
});
