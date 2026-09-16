#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = '/home/brajam/repos/ingenium';
const api = 'http://localhost:4097/api/v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function updateEnv(source, email, password) {
  if (typeof email !== 'string' || email.length < 3 || email.length > 320 || !email.includes('@')
    || email.includes('=') || [...email].some(character => character.charCodeAt(0) <= 32)) throw new Error('Invalid owner email');
  if (!/^[A-Za-z0-9_-]{32}$/.test(password)) throw new Error('Invalid generated password');
  for (const [key, value] of [['INGENIUM_DASHBOARD_EMAIL', email], ['INGENIUM_DASHBOARD_PASSWORD', password]]) {
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, 'gm');
    source = pattern.test(source)
      ? source.replace(pattern, () => `${key}=${value}`)
      : `${source}${source && !source.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
  }
  return source;
}

export function writeProtectedEnv(fd, contents) {
  writeFileSync(fd, contents, { mode: 0o600 });
  // mode on writeFileSync does not change an already-open inode.
  fchmodSync(fd, 0o600);
  fsyncSync(fd);
}

function readOwnedFile(path, secret = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1
      || stat.size > (secret ? 129 : 1024 * 1024) || (secret && (stat.mode & 0o777) !== 0o600)) throw new Error();
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

export async function recover(tokenPath) {
  let stage = 'protected-file preflight';
  let temporary;
  let fd;
  try {
    const parent = lstatSync(dirname(tokenPath));
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700
      || realpathSync(dirname(tokenPath)) !== dirname(tokenPath)) throw new Error();
    const token = readOwnedFile(tokenPath, true).replace(/\n$/, '');
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error();
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.uid !== process.getuid() || directory.gid !== process.getgid() || (directory.mode & 0o002) !== 0
      || realpathSync(root) !== root) throw new Error();
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root, stdio: 'ignore' });
    const target = resolve(root, '.env');
    const source = readOwnedFile(target);
    const request = async (path, body) => {
      const response = await fetch(`${api}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status !== (body ? 204 : 200)) {
        stage += ` HTTP ${response.status}`;
        throw new Error();
      }
      return body ? undefined : (await response.json()).data;
    };
    stage = 'organization lookup';
    const organizations = await request('/organizations');
    if (!Array.isArray(organizations)) throw new Error();
    const matches = new Map();
    for (const organization of organizations) {
      if (!uuid.test(organization?.id)) throw new Error();
      stage = 'member lookup';
      const members = await request(`/organizations/${organization.id}/members`);
      if (!Array.isArray(members)) throw new Error();
      for (const member of members) {
        if (member.role === 'owner' && member.status === 'active' && uuid.test(member.userId)
          && typeof member.email === 'string') matches.set(member.userId, member.email);
      }
    }
    if (matches.size !== 1) { stage = 'unique active account not found'; throw new Error(); }
    const [[userId, email]] = matches;
    const password = randomBytes(24).toString('base64url');
    const contents = updateEnv(source, email, password);
    stage = 'env staging';
    temporary = resolve(root, `.env.${randomUUID()}.tmp`);
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600);
    // Prepare the protected destination before invalidating the previous login.
    stage = 'recover (do not automatically retry an uncertain result)';
    await request('/bootstrap/recover', { userId, password });
    process.stdout.write('recover 204\n');
    stage = 'env install after successful recovery';
    if (readOwnedFile(target) !== source) throw new Error();
    writeProtectedEnv(fd, contents);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, target);
    temporary = undefined;
    const directoryFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    if (readOwnedFile(target, false) !== contents || (lstatSync(target).mode & 0o777) !== 0o600) throw new Error();
    process.stdout.write(`env updated (0600, email set)\nuserId ${userId}\n`);
  } catch {
    // Never emit underlying errors: request/file errors can include credentials.
    process.stderr.write(`Recovery failed: ${stage}\n`);
    process.exitCode = 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporary) unlinkSync(temporary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await recover(resolve(process.argv[2] ?? '/home/brajam/.config/ingenium/live-production/installation-api.token'));
}
