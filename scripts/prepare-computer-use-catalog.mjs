import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'yaml';

// Build-time only. The portable consumer uses Node built-ins and this reviewed
// catalog; it never installs a YAML parser into an OpenCode runtime.
const root = new URL('../', import.meta.url);
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-computer-use-catalog.mjs PINNED_BRAIN_ROOT');
const lockBytes = await readFile(new URL('config/computer-use.lock.json', root));
const lock = JSON.parse(lockBytes);
const skills = [];
for (const name of lock.skills) {
  const path = `.opencode/skills/${name}/SKILL.md`;
  const entry = lock.files.find(file => file.path === path);
  const bytes = await readFile(resolve(input, path));
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (!entry || entry.bytes !== bytes.length || entry.gitBlob !== blob) throw new Error(`Unpinned skill: ${path}`);
  const match = bytes.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${path}`);
  const metadata = parse(match[1]);
  if (metadata.name !== name || typeof metadata.description !== 'string' || !metadata.description.trim()) throw new Error(`Invalid skill metadata: ${path}`);
  if (metadata.autoinvoke !== undefined && typeof metadata.autoinvoke !== 'boolean') throw new Error(`Invalid autoinvoke: ${path}`);
  skills.push({ name, path, description: metadata.description, ...(metadata.autoinvoke === undefined ? {} : { autoinvoke: metadata.autoinvoke }), contentSha256: createHash('sha256').update(match[2]).digest('hex') });
}
const catalog = { schemaVersion: 1, revision: lock.revision, lockSha256: createHash('sha256').update(lockBytes).digest('hex'), skills };
await writeFile(new URL('config/computer-use-plugin/catalog.json', root), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ revision: lock.revision, skills: skills.length }));
