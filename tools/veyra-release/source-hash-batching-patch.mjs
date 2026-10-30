import { createHash } from 'node:crypto';
import { unifiedPatch } from './linux-recipe-patch.mjs';
export const SOURCE_BATCH_PREIMAGE = 'e5addff789c056feafd4c188a641f2d8987e586be15cdc0e07672869150a18f6';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function proposeSourceHashBatching(beforeBytes, helperBytes) {
  if (!Buffer.isBuffer(beforeBytes) || sha(beforeBytes) !== SOURCE_BATCH_PREIMAGE) throw new Error('Exact e5addff canonical entry preimage required');
  const before = beforeBytes.toString('utf8'), helper = helperBytes.toString('utf8');
  const original = "  const files = [];\n  for (const name of names) { safeRelative(name); files.push([name, await hashFile(root, path.join(root, name), 67108864)]); }";
  if (!before.includes(original) || !helper.includes('export async function hashSourceFileBatch(')) throw new Error('Source batch insertion boundary changed');
  let after = before.replace('async function sourceState(root, env) {', () => `${helper}\nasync function sourceState(root, env) {`);
  after = after.replace(original, () => "  const files = await hashSourceFileBatch(names, name => {\n    safeRelative(name);\n    return hashFile(root, path.join(root, name), 67108864);\n  });");
  const section = (text, begin, end) => text.slice(text.indexOf(begin), text.indexOf(end, text.indexOf(begin)));
  const descriptor = text => section(text, 'async function hashFile(', 'const exec = promisify(execFile);');
  const cache = text => section(text, 'async function cacheState(', '/** Read-only candidate capture.');
  if (descriptor(before) !== descriptor(after) || cache(before) !== cache(after)) throw new Error('Descriptor or cache hashing changed');
  return { after, patch: unifiedPatch(before, after, 'tools/reviewed-cargo-check.mjs'),
    preimageSha256: sha(beforeBytes), afterSha256: sha(Buffer.from(after)), helperSha256: sha(helperBytes),
    descriptorChecksPreserved: true, cacheHashingPreserved: true };
}
