import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { validatePayload } from './payload-policy.mjs';

export async function collectPayload(root, policy) {
  root = await realpath(root);
  let files = [];
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const filePath = path.join(directory, name);
      const info = await lstat(filePath);
      const portable = prefix ? `${prefix}/${name}` : name;
      if (info.isSymbolicLink()) throw new Error(`Linked payload: ${portable}`);
      if (info.isDirectory()) await visit(filePath, portable);
      else {
        if (!info.isFile()) throw new Error(`Non-regular payload: ${portable}`);
        files.push({ path: portable, kind: 'file', bytes: info.size, sha256: '0'.repeat(64) });
      }
    }
  }
  await visit(root);
  validatePayload({ ...policy, files });
  for (const file of files) {
    const hash = createHash('sha256');
    const filename = path.join(root, ...file.path.split('/'));
    const before = await lstat(filename);
    if (await realpath(filename) !== filename || before.size !== file.bytes || !before.isFile() || before.isSymbolicLink()) throw new Error(`Payload changed: ${file.path}`);
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    const after = await lstat(filename);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.isSymbolicLink()) throw new Error(`Payload changed: ${file.path}`);
    file.sha256 = hash.digest('hex');
  }
  const hashed = files; files = []; await visit(root);
  if (JSON.stringify(files.map(({ path, bytes }) => ({ path, bytes }))) !== JSON.stringify(hashed.map(({ path, bytes }) => ({ path, bytes })))) throw new Error('Payload inventory changed during hashing');
  files = hashed;
  const summary = validatePayload({ ...policy, files });
  return { schemaVersion: 1, ...summary, inventorySha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files,
    runtimeAcceptance: 'not-run', engineExclusion: 'requires-reviewed-allowlist-and-exact-build-provenance' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node inspect-payload.mjs PAYLOAD_ROOT POLICY_JSON');
    console.log(JSON.stringify(await collectPayload(process.argv[2], JSON.parse(await readFile(process.argv[3], 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
