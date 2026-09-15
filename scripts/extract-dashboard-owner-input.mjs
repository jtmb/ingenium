#!/usr/bin/env node
// Run from the worktree; --emit-fd N sends JSON only to an inherited fd >= 3, never stdout.
import { randomUUID } from 'node:crypto';
import { closeSync, constants as C, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

function owned(stat) {
  if (stat.uid !== process.geteuid()) throw new Error();
}

function directory(path, mode) {
  const stat = lstatSync(path);
  owned(stat);
  if (!stat.isDirectory() || realpathSync(path) !== path || (stat.mode & 0o022)
    || (mode !== undefined && (stat.mode & 0o7777) !== mode)) throw new Error();
}

function extract() {
  const args = process.argv.slice(2);
  const emit = args.length === 2 && args[0] === '--emit-fd';
  const output = emit ? Number(args[1]) : undefined;
  if (args.length && (!emit || !Number.isSafeInteger(output) || output < 3 || String(output) !== args[1])) throw new Error();
  const root = resolve('.');
  directory(root);
  const input = openSync(resolve(root, '.env'), C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
  let values;
  try {
    const stat = fstatSync(input);
    owned(stat);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error();
    values = parseEnv(readFileSync(input, 'utf8'));
  } finally { closeSync(input); }
  const email = values.INGENIUM_DASHBOARD_EMAIL;
  const password = values.INGENIUM_DASHBOARD_PASSWORD;
  if (typeof email !== 'string' || !email.trim() || email.length < 3 || email.length > 320
    || typeof password !== 'string' || !password.trim() || password.length < 6 || password.length > 1024) throw new Error();
  const payload = JSON.stringify({ email, password });
  if (emit) {
    const stat = fstatSync(output);
    owned(stat);
    if (stat.isFile()) fchmodSync(output, 0o600);
    writeFileSync(output, payload);
    if (stat.isFile()) fchmodSync(output, 0o600);
    return;
  }
  directory(resolve(root, '.opencode'));
  const parent = resolve(root, '.opencode/coordination-owner-input');
  try { mkdirSync(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  directory(parent, 0o700);
  const dir = openSync(parent, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW);
  let temporary;
  try {
    const stat = fstatSync(dir);
    owned(stat);
    if ((stat.mode & 0o7777) !== 0o700) throw new Error();
    // Pin writes to the checked directory even if its pathname is replaced.
    const pinned = `/proc/self/fd/${dir}`;
    const target = `${pinned}/owner.json`;
    const checkTarget = () => {
      try {
        const existing = lstatSync(target);
        owned(existing);
        if (!existing.isFile() || existing.nlink !== 1 || (existing.mode & 0o7777) !== 0o600) throw new Error();
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    checkTarget();
    temporary = `${pinned}/.owner.${randomUUID()}.tmp`;
    const fd = openSync(temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600);
    try {
      owned(fstatSync(fd));
      fchmodSync(fd, 0o600);
      writeFileSync(fd, payload);
      fchmodSync(fd, 0o600);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    checkTarget();
    renameSync(temporary, target);
    temporary = undefined;
    fsyncSync(dir);
  } finally {
    try { if (temporary) unlinkSync(temporary); } finally { closeSync(dir); }
  }
  process.stdout.write('owner input prepared (0600)\n');
}

try { extract(); } catch {
  process.stderr.write('owner input: failed (protected_input)\n');
  process.exitCode = 1;
}
