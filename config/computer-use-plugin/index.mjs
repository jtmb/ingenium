import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOCK_SHA256 = 'fcd849d70385cfacfc8310d978ebd1c30453c8df029928ec906fe54605dcb0e7';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function plainFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error(`External brain requires a bounded plain file: ${path}`);
  return readFile(path);
}

export async function loadPinnedSkills(options = {}) {
  const brain = resolve(options.brainRoot ?? resolve(here, '../computer-use'));
  if ((await lstat(brain)).isSymbolicLink()) throw new Error('External brain root cannot be linked');
  const canonical = await realpath(brain);
  const lockBytes = await plainFile(resolve(options.lockPath ?? resolve(here, '../computer-use.lock.json')));
  if (sha256(lockBytes) !== LOCK_SHA256) throw new Error('External brain lock does not match the reviewed pin');
  const lock = JSON.parse(lockBytes);
  const catalog = JSON.parse(await plainFile(resolve(here, 'catalog.json')));
  if (catalog.schemaVersion !== 1 || catalog.revision !== lock.revision || catalog.lockSha256 !== LOCK_SHA256 || catalog.skills.length !== 23 || new Set(catalog.skills.map(skill => skill.name)).size !== 23) throw new Error('External brain catalog does not match the reviewed pin');
  if (catalog.skills.map(skill => skill.name).sort().join('\n') !== [...lock.skills].sort().join('\n')) throw new Error('External brain skill catalog is incomplete');
  const expected = new Set(['veyra-dependency.json', ...lock.files.map(file => file.path)]);
  const contents = new Map();
  async function inspect(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = resolve(directory, name);
      const key = prefix + name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Linked external brain entry: ${key}`);
      if (info.isDirectory()) {
        if (![...expected].some(name => name.startsWith(`${key}/`))) throw new Error(`Unexpected external brain directory: ${key}`);
        await inspect(path, `${key}/`);
      }
      else if (!info.isFile() || !expected.has(key)) throw new Error(`Unexpected external brain entry: ${key}`);
    }
  }
  await inspect(canonical);
  for (const entry of lock.files) {
    if (entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe external brain path');
    const path = resolve(canonical, entry.path);
    const rel = relative(canonical, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('External brain path escapes the pinned root');
    const bytes = await plainFile(path);
    if (bytes.length !== entry.bytes || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.gitBlob) throw new Error(`External brain file differs from its pin: ${entry.path}`);
    contents.set(entry.path, bytes);
  }
  const receipt = JSON.parse(await plainFile(resolve(canonical, 'veyra-dependency.json')));
  if (receipt.revision !== lock.revision || receipt.lockSha256 !== LOCK_SHA256 || receipt.files !== lock.files.length || receipt.appliedGlobalConfiguration !== false) throw new Error('External brain dependency receipt differs from its pin');
  return catalog.skills.map(skill => {
    if (skill.path !== `.opencode/skills/${skill.name}/SKILL.md` || typeof skill.description !== 'string') throw new Error('Invalid external skill metadata');
    const match = contents.get(skill.path)?.toString('utf8').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    if (!match || sha256(match[1]) !== skill.contentSha256) throw new Error(`External skill body differs from its catalog: ${skill.name}`);
    return { id: `computer-use:${skill.name}`, name: `computer-use:${skill.name}`, description: skill.description, ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }), path: resolve(canonical, skill.path), content: match[1] };
  });
}

export default {
  id: 'veyra.computer-use',
  async setup(ctx) {
    const skills = await loadPinnedSkills(ctx.options);
    await ctx.skill.transform(editor => {
      // Validate every collision before changing the registry. Never replace a
      // Veyra skill, including the two names shared with the external catalog.
      for (const skill of skills) {
        const existing = editor.get(skill.id);
        if (existing && (existing.name !== skill.name || existing.path !== skill.path || existing.content !== skill.content || existing.description !== skill.description || existing.autoinvoke !== skill.autoinvoke)) throw new Error(`External skill ID is already owned: ${skill.id}`);
      }
      for (const skill of skills) if (!editor.get(skill.id)) editor.add(skill);
    });
  },
};
