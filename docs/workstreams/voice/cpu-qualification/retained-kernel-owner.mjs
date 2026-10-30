/** Privileged ELF selection is the verified open descriptor, never a reopened path. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { isAbsolute } from 'node:path';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'mode', 'nlink'].every(k => a[k] === b[k]);

// Dependency injection is for the model-free source harness. Production uses
// the fixed real adapters below; mock results never qualify a runtime.
export function createRetainedOwnerRunner({ io, spawnChild, signals }) {
  return async function run(input, args, options) {
    if (!isAbsolute(input.path) || input.ownerUid !== 0 || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) fail('QUAL_ROOT_OWNER_INPUT_REQUIRED');
    let fd, child, cancel, listening = false;
    try {
      fd = io.openSync(input.path, io.constants.O_RDONLY | io.constants.O_NOFOLLOW | io.constants.O_CLOEXEC);
      const before = io.fstatSync(fd);
      if (!before.isFile() || before.uid !== 0 || before.nlink !== 1 || before.mode & 0o022 || !(before.mode & 0o111)
        || before.size < 4 || before.size > input.maxBytes) fail('QUAL_ROOT_OWNER_FD_CUSTODY');
      const digest = createHash('sha256'), buffer = Buffer.alloc(65536), magic = Buffer.alloc(4); let count = 0;
      for (;;) {
        const n = io.readSync(fd, buffer, 0, buffer.length, null); if (!n) break;
        if (count < 4) buffer.copy(magic, count, 0, Math.min(4 - count, n));
        count += n; if (count > input.maxBytes) fail('QUAL_ROOT_OWNER_FD_BOUND'); digest.update(buffer.subarray(0, n));
      }
      const after = io.fstatSync(fd), sha256 = digest.digest('hex');
      if (!same(before, after) || count !== before.size || !magic.equals(Buffer.from([127, 69, 76, 70]))
        || sha256 !== input.sha256) fail('QUAL_ROOT_OWNER_FD_CHANGED');
      const inputFact = { path: input.path, sha256, bytes: count, device: String(before.dev), inode: String(before.ino) };
      if (input.originalFact && (inputFact.device !== input.originalFact.device || inputFact.inode !== input.originalFact.inode)) fail('QUAL_ROOT_OWNER_ORIGINAL_REPLACED');
      // fd3 is explicitly inherited. /proc/self is the child at exec selection;
      // neither this pathname nor the inherited mapping reopens input.path.
      child = spawnChild('/proc/self/fd/3', args, { ...options, shell: false, stdio: ['ignore', 'pipe', 'pipe', fd] });
      let firstError, exitValue; const buffers = { stdout: [], stderr: [] }, counts = { stdout: 0, stderr: 0 };
      const exited = new Promise((yes, no) => {
        child.once('error', error => { firstError ??= error; no(error); });
        child.once('exit', (code, signal) => { exitValue = { code, signal }; yes(exitValue); });
      });
      const closed = new Promise(yes => child.once('close', yes));
      cancel = () => { firstError ??= Object.assign(new Error('QUAL_CANCELLED'), { code: 'QUAL_CANCELLED' });
        try { child.kill('SIGTERM'); } catch (error) { firstError ??= error; } };
      async function pump(name) {
        for await (const bytes of child[name]) {
          counts[name] += bytes.length;
          if (counts[name] > 262144) { firstError ??= new Error('QUAL_OUTPUT_BOUND'); cancel(); }
          else buffers[name].push(Buffer.from(bytes));
        }
      }
      const pumps = [pump('stdout'), pump('stderr')];
      pumps.forEach(p => p.catch(error => { firstError ??= error; cancel(); }));
      try { listening = true; signals.on('SIGINT', cancel); signals.on('SIGTERM', cancel); }
      catch (error) { firstError ??= error; cancel(); }
      // An async spawn error still requires the actual close and both pumps.
      // Deadline/cancel never substitutes for these positive original joins.
      const joined = await Promise.allSettled([exited, closed, ...pumps]);
      return { inputFact, joined, firstError, exitValue, buffers };
    } finally {
      try { if (listening) { signals.off('SIGINT', cancel); signals.off('SIGTERM', cancel); } }
      finally { if (fd !== undefined) io.closeSync(fd); }
    }
  };
}

export const runRetainedKernelOwner = createRetainedOwnerRunner({ io: fs, spawnChild: spawn, signals: process });
