/** Source only. Root runs AFTER exact-size/SHA256 locked wheel downloads.
 * No wheel imports, extraction, package install or model execution. */
import { openSync, closeSync, readSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
const fail = code => { throw new Error(code); };
export function inspectWheel(path, expected) {
  const fd = openSync(path, 'r');
  try {
    const before = fstatSync(fd), digest = createHash('sha256'), block = Buffer.alloc(65536);
    if (!before.isFile() || before.size !== expected.size) fail('WHEEL_SIZE');
    for (let at = 0; at < before.size;) { const n = readSync(fd, block, 0, Math.min(block.length, before.size - at), at); if (!n) fail('WHEEL_TRUNCATED'); digest.update(block.subarray(0, n)); at += n; }
    if (digest.digest('hex') !== expected.sha256) fail('WHEEL_HASH');
    const tail = Buffer.alloc(Math.min(65557, before.size)); readSync(fd, tail, 0, tail.length, before.size - tail.length);
    let end = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) fail('WHEEL_MULTI_DISK_OR_ZIP64');
    const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (count === 65535 || bytes > 8388608 || offset + bytes > before.size - 22) fail('WHEEL_DIRECTORY_BOUND');
    const directory = Buffer.alloc(bytes); if (readSync(fd, directory, 0, bytes, offset) !== bytes) fail('WHEEL_DIRECTORY_TRUNCATED');
    const entries = []; let at = 0;
    while (at < directory.length) {
      if (at + 46 > bytes || directory.readUInt32LE(at) !== 0x02014b50) fail('WHEEL_DIRECTORY_SHAPE');
      const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10), compressed = directory.readUInt32LE(at + 20), expanded = directory.readUInt32LE(at + 24);
      const nameBytes = directory.readUInt16LE(at + 28), extraBytes = directory.readUInt16LE(at + 30), commentBytes = directory.readUInt16LE(at + 32);
      const mode = directory.readUInt32LE(at + 38) >>> 16, localOffset = directory.readUInt32LE(at + 42);
      if (flags & 1 || ![0, 8].includes(method) || [compressed, expanded, localOffset].includes(0xffffffff) || at + 46 + nameBytes + extraBytes + commentBytes > bytes) fail('WHEEL_UNSUPPORTED_ENTRY');
      const name = directory.subarray(at + 46, at + 46 + nameBytes).toString('utf8');
      if (!name || Buffer.byteLength(name) > 4096 || /[\u0000-\u001f\u007f]/u.test(name) || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(p => p === '..' || p === '.') || (mode & 0o170000) === 0o120000 || entries.some(e => e.name === name)) fail('WHEEL_ENTRY_CUSTODY');
      entries.push({ name, compressed, expanded, localOffset, method }); at += 46 + nameBytes + extraBytes + commentBytes;
    }
    if (entries.length !== count) fail('WHEEL_ENTRY_COUNT');
    function readEntry(entry, maximum) {
      if (entry.expanded > maximum || entry.compressed > maximum) fail('WHEEL_METADATA_BOUND');
      const header = Buffer.alloc(30); if (readSync(fd, header, 0, 30, entry.localOffset) !== 30 || header.readUInt32LE(0) !== 0x04034b50) fail('WHEEL_LOCAL_HEADER');
      const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      if (start + entry.compressed > offset) fail('WHEEL_LOCAL_BOUND');
      const raw = Buffer.alloc(entry.compressed); if (readSync(fd, raw, 0, raw.length, start) !== raw.length) fail('WHEEL_ENTRY_TRUNCATED');
      const value = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: maximum });
      if (value.length !== entry.expanded) fail('WHEEL_EXPANDED_SIZE'); return value;
    }
    const record = entries.find(e => e.name.endsWith('.dist-info/RECORD'));
    if (!record) fail('WHEEL_RECORD_MISSING');
    const recordText = readEntry(record, 4194304).toString('utf8');
    let entryPoints = 0;
    const entryPointFile = entries.find(e => e.name.endsWith('.dist-info/entry_points.txt'));
    if (entryPointFile) {
      let scripts = false;
      for (const raw of readEntry(entryPointFile, 1048576).toString('utf8').split(/\r?\n/)) {
        const line = raw.trim(); if (line.startsWith('[')) scripts = ['[console_scripts]', '[gui_scripts]'].includes(line);
        else if (scripts && line && !line.startsWith('#') && !line.startsWith(';')) { if (!line.includes('=')) fail('ENTRY_POINT_METADATA'); entryPoints++; }
      }
    }
    let bundledVad = null;
    const vad = entries.find(e => e.name === 'faster_whisper/assets/silero_vad_v6.onnx');
    if (vad) {
      if (vad.expanded !== 1245151) fail('PINNED_BUNDLED_VAD_SIZE');
      const value = readEntry(vad, 2097152), sha256 = createHash('sha256').update(value).digest('hex');
      const encoded = Buffer.from(sha256, 'hex').toString('base64url');
      if (!recordText.split(/\r?\n/).includes(`${vad.name},sha256=${encoded},${value.length}`)) fail('BUNDLED_VAD_RECORD_HASH');
      const gitBlobSha1 = createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
      if (gitBlobSha1 !== '9febab9bc0aa5ae2b27e69243d813427212bfb36') fail('BUNDLED_VAD_UPSTREAM_BLOB');
      bundledVad = { file: vad.name, bytes: value.length, sha256, gitBlobSha1 };
    }
    const after = fstatSync(fd); if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('WHEEL_CHANGED');
    return { filename: expected.filename, compressedBytes: before.size, sha256: expected.sha256,
      expandedBytes: entries.reduce((n, e) => n + e.expanded, 0), files: entries.filter(e => !e.name.endsWith('/')).length,
      entryPoints, bundledVad, metadataOnly: true, installed: false };
  } finally { closeSync(fd); }
}
