import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { digest, portablePath } from './source-manifest.mjs';

const subjectKeys = ['platform', 'appRevision', 'nativeRevision', 'sourceSha256', 'artifactSha256'];
const maximumReceiptBytes = 4 * 1024 * 1024;

export function verifyReceiptBytes(descriptor, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumReceiptBytes) throw new Error('Receipt exceeds the supported size bound');
  if (digest(bytes) !== descriptor?.receiptSha256) throw new Error('Receipt bytes do not match the supplied hash');
  let receipt;
  try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Receipt is not valid UTF-8 JSON'); }
  if (receipt?.schemaVersion !== 1 || typeof receipt.fixture !== 'boolean'
      || !['pass', 'fail', 'incomplete'].includes(receipt.status)
      || !receipt.subject || subjectKeys.some(key => typeof receipt.subject[key] !== 'string')) throw new Error('Invalid release gate receipt');
  if (['gate', 'kind', 'status'].some(key => descriptor[key] !== receipt[key])
      || subjectKeys.some(key => descriptor.subject?.[key] !== receipt.subject[key])
      || (Object.hasOwn(descriptor, 'fixture') && descriptor.fixture !== receipt.fixture)) throw new Error('Receipt contradicts the supplied gate descriptor');
  return { gate: receipt.gate, kind: receipt.kind, status: receipt.status, subject: Object.fromEntries(subjectKeys.map(key => [key, receipt.subject[key]])),
    fixture: receipt.fixture, receiptSha256: descriptor.receiptSha256 };
}

export async function verifyEvidenceFiles(evidenceRoot, descriptors) {
  if (!path.isAbsolute(evidenceRoot) || !Array.isArray(descriptors)) throw new Error('Explicit absolute evidence root and descriptors required');
  const root = path.resolve(evidenceRoot);
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error('Evidence root must be an unlinked canonical directory');
  const results = [];
  for (const descriptor of descriptors) {
    const name = portablePath(descriptor.receiptPath);
    let filename = root;
    for (const part of name.split('/')) {
      filename = path.join(filename, part);
      if ((await lstat(filename)).isSymbolicLink()) throw new Error('Linked evidence input refused');
    }
    if (await realpath(filename) !== filename) throw new Error('Redirected evidence input refused');
    const entry = await lstat(filename);
    if (!entry.isFile() || entry.size <= 0 || entry.size > maximumReceiptBytes) throw new Error('Receipt must be a bounded regular file');
    const handle = await open(filename, 'r');
    try {
      const before = await handle.stat();
      if (before.dev !== entry.dev || before.ino !== entry.ino || before.size !== entry.size || !before.isFile()) throw new Error('Receipt changed before reading');
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (read.bytesRead === 0) throw new Error('Receipt truncated while reading');
        offset += read.bytesRead;
      }
      if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead !== 0) throw new Error('Receipt grew while reading');
      const after = await handle.stat();
      const current = await lstat(filename);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
          || after.ino !== current.ino || after.dev !== current.dev || current.isSymbolicLink()
          || await realpath(filename) !== filename) throw new Error('Receipt changed while reading');
      results.push(verifyReceiptBytes(descriptor, bytes));
    } finally { await handle.close(); }
  }
  return results;
}
