import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { updateEnv, writeProtectedEnv } from './recover-dev-dashboard-account.mjs';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('env install enforces exactly 0600 on an existing permissive inode under umask 0022', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'protected-env-'));
  const previous = process.umask(0o022);
  const staged = join(directory, '.env.tmp');
  const target = join(directory, '.env');
  let fd;
  try {
    fd = openSync(staged, 'wx', 0o600);
    chmodSync(staged, 0o670);
    writeProtectedEnv(fd, 'SYNTHETIC=value\n');
    closeSync(fd);
    fd = undefined;
    renameSync(staged, target);
    assert.equal(statSync(target).mode & 0o7777, 0o600);
    assert.equal(readFileSync(target, 'utf8'), 'SYNTHETIC=value\n');
  } finally {
    if (fd !== undefined) closeSync(fd);
    process.umask(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('env update preserves unrelated lines and replaces credentials idempotently', () => {
  const email = 'installation-owner@example.test';
  const password = randomBytes(24).toString('base64url');
  const source = '# preserved\r\nOTHER=value\r\n';
  const first = updateEnv(source, email, password);
  const second = updateEnv(first, email, password);
  if (!first.startsWith(source) || first !== second
    || !first.includes(`INGENIUM_DASHBOARD_PASSWORD=${password}\n`)
    || !first.includes(`INGENIUM_DASHBOARD_EMAIL=${email}\n`)) throw new Error('Env preservation failed');
  const replaced = updateEnv(`export INGENIUM_DASHBOARD_PASSWORD=\r\n${source}`, email, password);
  if (!replaced.startsWith(`INGENIUM_DASHBOARD_PASSWORD=${password}\r\n${source}`)) throw new Error('Replacement failed');
  const literal = 'owner$&@example.test';
  assert.ok(updateEnv('INGENIUM_DASHBOARD_EMAIL=old@example.test\n', literal, password)
    .includes(`INGENIUM_DASHBOARD_EMAIL=${literal}\n`));
});

test('env update rejects invalid generated values without reflecting them', () => {
  let rejected = false;
  try { updateEnv('', 'owner@example.test', '\n'); } catch { rejected = true; }
  if (!rejected) throw new Error('Invalid value accepted');
  assert.throws(() => updateEnv('', 'owner@example.test\nINJECTED=value', randomBytes(24).toString('base64url')));
});
