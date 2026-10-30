import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function digest(bytes, algorithm = 'sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

export function assertRevision(value) {
  if (typeof value !== 'string' || value.length !== 40 || [...value].some(c => !'0123456789abcdef'.includes(c))) {
    throw new Error('A full lowercase Git SHA-1 revision is required');
  }
  return value;
}

export function portablePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':')
      || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Expected a confined portable relative path');
  }
  return value;
}

export function sourceEntry(name, mode, object, bytes) {
  portablePath(name);
  if (!['100644', '100755'].includes(mode)) throw new Error(`Unsupported source mode: ${name}`);
  const actual = digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
  if (actual !== object) throw new Error(`Working source differs from commit: ${name}`);
  return { path: name, mode, gitBlob: object, bytes: bytes.length, sha256: digest(bytes) };
}

export function collectSource(root, expectedRevision) {
  assertRevision(expectedRevision);
  root = realpathSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) throw new Error('Root must be the exact repository top level');
  if (git('rev-parse', 'HEAD').trim() !== expectedRevision) throw new Error('Unexpected source revision');
  if (git('status', '--porcelain=v1', '--untracked-files=all').trim()) throw new Error('Source must be clean, including untracked files');
  const tree = git('ls-tree', '-rz', '--full-tree', expectedRevision).split('\0').filter(Boolean);
  const files = tree.map(row => {
    const tab = row.indexOf('\t');
    const [mode, type, object] = row.slice(0, tab).split(' ');
    const name = portablePath(row.slice(tab + 1));
    if (type !== 'blob') throw new Error(`Submodules are not materialized release inputs: ${name}`);
    let cursor = root;
    for (const part of name.split('/')) {
      cursor = path.join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Linked source input: ${name}`);
    }
    if (!lstatSync(cursor).isFile()) throw new Error(`Not a regular source file: ${name}`);
    return sourceEntry(name, mode, object, readFileSync(cursor));
  });
  if (git('status', '--porcelain=v1', '--untracked-files=all').trim()
      || git('rev-parse', 'HEAD').trim() !== expectedRevision) throw new Error('Source changed during inventory');
  const sourceDateEpoch = Number(git('show', '-s', '--format=%ct', expectedRevision).trim());
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch <= 0) throw new Error('Invalid source commit epoch');
  return { schemaVersion: 1, revision: expectedRevision, sourceDateEpoch, tree: git('rev-parse', 'HEAD^{tree}').trim(),
    sourceSha256: digest(JSON.stringify(files)), fileCount: files.length,
    sourceBytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node source-manifest.mjs SOURCE_ROOT FULL_REVISION');
    console.log(JSON.stringify(collectSource(process.argv[2], process.argv[3]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
