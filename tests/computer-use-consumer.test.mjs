import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile, mkdtemp, cp, writeFile, rm, lstat, realpath, symlink, unlink, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { parse } from 'yaml';
import { Config } from '@opencode/schema/config';
import { Skill } from '@opencode/schema/skill';
import { Schema } from 'effect';
import consumer, { loadPinnedSkills } from '../config/computer-use-plugin/index.mjs';

const brainRoot = process.env.VEYRA_TEST_PINNED_BRAIN_ROOT;
const lockPath = new URL('../config/computer-use.lock.json', import.meta.url).pathname;
const options = { brainRoot, lockPath };
const enabled = { skip: !brainRoot && 'Set VEYRA_TEST_PINNED_BRAIN_ROOT to the verified external dependency' };

test('all external skills coexist with Veyra IDs and load their original bodies', enabled, async () => {
  const skills = await loadPinnedSkills(options);
  const owned = ['database-conventions','development-conventions','devops-conventions','documentation','mcp-tooling','security-audit','self-learning','skill-maintenance'].map(id => ({ id, name: id, path: `/veyra/${id}/SKILL.md`, content: `Veyra ${id}` }));
  const registry = new Map(owned.map(skill => [skill.id, skill]));
  const before = structuredClone(owned);
  const editor = { get: id => registry.get(id), add: skill => { assert.ok(!registry.has(skill.id)); registry.set(skill.id, skill); } };
  const ctx = { options, skill: { transform: async callback => { callback(editor); callback(editor); } } };
  await consumer.setup(ctx);
  assert.equal(skills.length, 23);
  assert.equal(registry.size, 31);
  assert.deepEqual(owned, before);
  for (const skill of skills) {
    Schema.decodeUnknownSync(Skill.Info)(skill);
    const source = await readFile(skill.path, 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    const metadata = parse(match[1]);
    assert.equal(skill.name, `computer-use:${metadata.name}`);
    assert.equal(skill.description, metadata.description);
    assert.equal(skill.content, match[2]);
  }
  Schema.decodeUnknownSync(Config.Info)({ plugins: [{ package: '/portable/computer-use-plugin', options }] });
});

test('a conflicting namespaced ID fails before registering any external skill', enabled, async () => {
  let additions = 0;
  await assert.rejects(consumer.setup({ options, skill: { transform: async callback => callback({ get: id => id === 'computer-use:websearch' ? { id, content: 'another owner' } : undefined, add: () => additions++ }) } }), /already owned/);
  assert.equal(additions, 0);
});

test('modified reference files and linked entries fail before registration', enabled, async () => {
  const scratchBase = process.env.TMPDIR;
  assert.ok(scratchBase, 'A task-owned temporary root is required');
  const scratch = await mkdtemp(join(scratchBase, 'brain-consumer-test-'));
  const canonicalBase = await realpath(scratchBase);
  assert.ok(!relative(canonicalBase, await realpath(scratch)).startsWith('..'));
  try {
    const fixture = join(scratch, 'computer-use');
    await cp(brainRoot, fixture, { recursive: true, dereference: false });
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const reference = lock.files.find(file => file.path.endsWith('references/useful-comments/guidelines.md'));
    const changed = join(fixture, reference.path);
    // cp preserves readonly provenance; change only this explicitly owned test copy.
    const { chmod } = await import('node:fs/promises');
    await chmod(changed, 0o600);
    const original = await readFile(changed);
    await writeFile(changed, Buffer.concat([original, Buffer.from('\nchanged fixture\n')]));
    await assert.rejects(loadPinnedSkills({ brainRoot: fixture, lockPath }), /differs from its pin/);
    await writeFile(changed, original);
    await symlink(resolve(scratchBase), join(fixture, 'unexpected-link'), 'dir');
    await assert.rejects(loadPinnedSkills({ brainRoot: fixture, lockPath }), /Linked external brain/);
  } finally {
    assert.equal((await lstat(scratch)).isSymbolicLink(), false);
    assert.ok(!relative(canonicalBase, await realpath(scratch)).startsWith('..'));
    const fixtureLink = join(scratch, 'computer-use/unexpected-link');
    const linked = await lstat(fixtureLink).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (linked) { assert.ok(linked.isSymbolicLink()); await unlink(fixtureLink); }
    let allocatedBytes = 0;
    const seen = new Set();
    async function measure(path) {
      const info = await lstat(path);
      assert.ok(!info.isSymbolicLink());
      const identity = `${info.dev}:${info.ino}`;
      if (!seen.has(identity)) { allocatedBytes += info.blocks * 512; seen.add(identity); }
      if (info.isDirectory()) for (const name of await readdir(path)) { assert.notEqual(name, '.git'); await measure(join(path, name)); }
    }
    await measure(scratch);
    await rm(scratch, { recursive: true, force: false });
    assert.equal(await realpath(scratchBase), canonicalBase);
    console.log(JSON.stringify({ removed: scratch, linuxAllocatedBytes: allocatedBytes, regeneration: 'copy the verified pinned dependency for the modified-reference/link test', windowsDiskRecoveryClaimed: false }));
  }
});
