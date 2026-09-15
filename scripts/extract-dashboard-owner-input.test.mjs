import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./extract-dashboard-owner-input.mjs', import.meta.url));
const email = 'owner@example.invalid';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'owner-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.opencode'), { mode: 0o700 });
  const password = randomBytes(24).toString('base64url');
  const env = (address = email, secret = password) => writeFileSync(join(root, '.env'),
    `INGENIUM_DASHBOARD_EMAIL="${address}"\nINGENIUM_DASHBOARD_PASSWORD="${secret}"\nUNRELATED=ignored\n`, { mode: 0o600 });
  env();
  const run = (args = []) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    assert.ok(!result.error);
    assert.ok(!result.stdout.includes(password) && !result.stderr.includes(password), 'secret output forbidden');
    return result;
  };
  return { root, password, env, run, parent: join(root, '.opencode/coordination-owner-input'), target: join(root, '.opencode/coordination-owner-input/owner.json') };
}

test('file success: exact keys, modes, replacement and no secret output', t => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) {
    const result = f.run();
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'owner input prepared (0600)\n');
    assert.equal(result.stderr, '');
    assert.equal(statSync(f.parent).mode & 0o7777, 0o700);
    assert.equal(statSync(f.target).mode & 0o7777, 0o600);
    assert.ok(JSON.stringify(JSON.parse(readFileSync(f.target, 'utf8'))) === JSON.stringify({ email, password: f.password }));
  }
});

test('inherited fd success without stdout or filesystem output', t => {
  const f = fixture(t);
  const result = f.run(['--emit-fd', '3']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.ok(result.output[3] === JSON.stringify({ email, password: f.password }));
  assert.equal(existsSync(f.parent), false);
});

test('inherited regular file is made exactly 0600 under umask 0022', t => {
  const f = fixture(t);
  const target = join(f.root, 'inherited.json');
  const previous = process.umask(0o022);
  const fd = openSync(target, 'wx', 0o666);
  try {
    chmodSync(target, 0o670);
    const result = spawnSync(process.execPath, [script, '--emit-fd', '3'], {
      cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd],
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.equal(statSync(target).mode & 0o7777, 0o600);
    assert.ok(JSON.parse(readFileSync(target, 'utf8')).password === f.password);
  } finally {
    closeSync(fd);
    process.umask(previous);
  }
});

for (const emit of [false, true]) {
  test(`missing, blank and length rejection (${emit ? 'fd' : 'file'})`, t => {
    const f = fixture(t);
    for (const [address, secret] of [['', f.password], ['   ', f.password], ['ab', f.password], ['a'.repeat(321), f.password], [email, ''], [email, '      '], [email, randomBytes(2).toString('hex')], [email, randomBytes(600).toString('hex')], [email, f.password]]) {
      f.env(address, secret);
      if (secret === f.password && address === email) writeFileSync(join(f.root, '.env'), 'UNRELATED=ignored\n');
      const result = f.run(emit ? ['--emit-fd', '3'] : []);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'owner input: failed (protected_input)\n');
      assert.ok(!secret.trim() || !result.stderr.includes(secret));
      assert.equal(result.output[3], '');
      assert.equal(existsSync(f.target), false);
    }
  });
}

test('reject non-0700 parent', t => {
  const f = fixture(t);
  mkdirSync(f.parent, { mode: 0o700 });
  chmodSync(f.parent, 0o750);
  assert.equal(f.run().status, 1);
  assert.equal(existsSync(f.target), false);
});

for (const location of ['env', 'parent', 'target', 'opencode']) {
  test(`reject ${location} symlink`, t => {
    const f = fixture(t);
    const outside = join(f.root, 'outside');
    if (location === 'env') {
      writeFileSync(outside, readFileSync(join(f.root, '.env')));
      rmSync(join(f.root, '.env'));
      symlinkSync(outside, join(f.root, '.env'));
    } else {
      mkdirSync(outside, { mode: 0o700 });
      if (location === 'parent') symlinkSync(outside, f.parent);
      if (location === 'opencode') {
        rmSync(join(f.root, '.opencode'), { recursive: true });
        symlinkSync(outside, join(f.root, '.opencode'));
      }
      if (location === 'target') {
        mkdirSync(f.parent, { mode: 0o700 });
        symlinkSync(join(outside, 'absent'), f.target);
      }
    }
    assert.equal(f.run().status, 1);
    if (location === 'env') assert.equal(f.run(['--emit-fd', '3']).status, 1);
  });
}

test('reject stdout, stderr and invalid fd arguments', t => {
  const f = fixture(t);
  for (const fd of ['0', '1', '2', '-1', '3.5', '03', '999999']) assert.equal(f.run(['--emit-fd', fd]).status, 1);
});
