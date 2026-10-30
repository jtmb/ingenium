/** Root future execution after install/seal. No Python/module/model imports. */
import { readFileSync, lstatSync, readdirSync, openSync, closeSync, readSync, fstatSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
const fail = code => { throw new Error(code); };
const normalize = s => s.toLowerCase().replace(/[-_.]+/g, '_');
function digest(path) {
  const fd = openSync(path, 'r');
  try { const before = fstatSync(fd), h = createHash('sha256'), b = Buffer.alloc(65536); let count = 0;
    for (;;) { const n = readSync(fd, b, 0, b.length, null); if (!n) break; count += n; h.update(b.subarray(0, n)); }
    const after = fstatSync(fd); if (before.ino !== after.ino || before.size !== count || before.mtimeMs !== after.mtimeMs) fail('INSTALLED_FILE_CHANGED');
    return { sha256: h.digest('hex'), bytes: count };
  } finally { closeSync(fd); }
}
function csv(line) {
  const cells = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { cells.push(value); value = ''; } else value += c; }
  if (quoted) fail('RECORD_CSV'); cells.push(value); if (cells.length !== 3) fail('RECORD_COLUMNS'); return cells;
}
export function verifyInstalledClosure(siteRoot, packages, vadExpected) {
  if (process.platform !== 'linux') fail('QUALIFIED_PLATFORM_ENVIRONMENT_CUSTODY_UNSUPPORTED');
  siteRoot = resolve(siteRoot); const files = new Map(), directories = [];
  function walk(path, depth = 0) {
    if (depth > 64 || files.size > 131072) fail('ENVIRONMENT_BOUND');
    const stat = lstatSync(path); if (stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022) fail('ENVIRONMENT_NOT_SEALED');
    if (stat.isDirectory()) { directories.push(path); for (const name of readdirSync(path)) walk(resolve(path, name), depth + 1); }
    else if (stat.isFile() && stat.nlink === 1) files.set(path, digest(path)); else fail('ENVIRONMENT_FILE_CUSTODY');
  }
  walk(siteRoot);
  const expected = new Map(packages.map(p => [normalize(p.name), p.version])), observed = new Set(), declared = new Set();
  const infos = directories.filter(path => relative(siteRoot, path).split(sep).length === 1 && path.endsWith('.dist-info'));
  if (expected.size !== 32 || infos.length !== expected.size) fail('EXACT_DEPENDENCY_CLOSURE_REQUIRED');
  for (const info of infos) {
    const metadataPath = resolve(info, 'METADATA'), metadata = readFileSync(metadataPath, 'utf8'); if (Buffer.byteLength(metadata) > 1048576) fail('DEPENDENCY_METADATA_BOUND');
    const name = metadata.match(/^Name: (.+)$/m)?.[1], version = metadata.match(/^Version: (.+)$/m)?.[1];
    if (!name || expected.get(normalize(name)) !== version || observed.has(normalize(name))) fail('INSTALLED_PIN_MISMATCH'); observed.add(normalize(name));
    const recordPath = resolve(info, 'RECORD'), record = readFileSync(recordPath, 'utf8'); if (Buffer.byteLength(record) > 8388608) fail('RECORD_BOUND');
    for (const line of record.split(/\r?\n/).filter(Boolean)) {
      const [name, encoded, length] = csv(line), path = resolve(siteRoot, name);
      if (relative(siteRoot, path).startsWith('..') || !files.has(path)) fail('RECORD_OUTSIDE_DECLARED_ENVIRONMENT');
      declared.add(path); const fact = files.get(path);
      if (!encoded && !length && path === recordPath) continue;
      if (!encoded.startsWith('sha256=') || Buffer.from(fact.sha256, 'hex').toString('base64url') !== encoded.slice(7)
        || String(fact.bytes) !== length) fail('INSTALLED_RECORD_HASH');
    }
  }
  if ([...files.keys()].some(path => !declared.has(path))) fail('UNRECORDED_INSTALLED_FILE');
  const vad = files.get(resolve(siteRoot, 'faster_whisper/assets/silero_vad_v6.onnx'));
  if (!vad || vad.bytes !== 1245151 || !vadExpected?.sha256 || vad.sha256 !== vadExpected.sha256) fail('INSTALLED_VAD_NOT_PINNED');
  return { version: 1, allRecordHashesVerified: true, environmentSealed: true, packages: [...expected].map(([name, version]) => ({ name, version })),
    files: [...files].map(([path, fact]) => ({ file: relative(siteRoot, path), ...fact })),
    bytes: [...files.values()].reduce((n, f) => n + f.bytes, 0), bundledVad: { file: 'faster_whisper/assets/silero_vad_v6.onnx', ...vad }, runtimeQualified: false };
}
