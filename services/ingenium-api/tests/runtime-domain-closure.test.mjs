import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planDomainRuntime, materializeDomainRuntime } from '../scripts/copy-domain-runtime.mjs';

async function fixture(run) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'veyra-runtime-closure-'));
  const api = join(root, 'services/ingenium-api/lib/voice-v2');
  const shared = join(root, 'packages/veyra-voice');
  mkdirSync(api, { recursive: true }); mkdirSync(shared, { recursive: true });
  try { await run({ root, api, shared, destination: join(root, 'generated') }); }
  finally {
    const rel = relative(parent, realpathSync(root));
    if (!rel || isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('veyra-runtime-closure-')) throw new Error('Fixture containment failed');
    const measure = target => {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) throw new Error('Fixture preservation failed');
      return stat.blocks * 512 + (stat.isDirectory() ? readdirSync(target).reduce((sum, name) => sum + measure(join(target, name)), 0) : 0);
    };
    const allocatedBytes = measure(root);
    // No services, subprocesses, databases or external paths are used by this fixture.
    rmSync(root, { recursive: true });
    console.log(JSON.stringify({ cleanup: 'removed-owned-static-module-fixture', path: root, allocatedBytes, regeneration: 'runtime-domain-closure.test.mjs' }));
  }
}

test('built modules resolve the shared closure while source and ordinary strings remain exact', () => fixture(async ({ root, api, shared, destination }) => {
  const reference = '../../../../packages/veyra-voice/session.mjs';
  const original = `import { value } from '${reference}';\nexport const output = value;\nexport const untouched = '${reference}';\n`;
  writeFileSync(join(api, 'service.mjs'), original);
  writeFileSync(join(shared, 'session.mjs'), 'export const value = 42;\n');
  const plan = planDomainRuntime({ sourceRoot: root, destination });
  assert.equal(plan.entries.length, 2);
  const manifest = materializeDomainRuntime(plan);
  assert.equal(manifest.files.length, 2);
  const built = await import(pathToFileURL(join(destination, 'lib/voice-v2/service.mjs')));
  assert.equal(built.output, 42);
  assert.equal(built.untouched, reference);
  assert.equal(readFileSync(join(api, 'service.mjs'), 'utf8'), original);
  assert.match(readFileSync(join(destination, 'lib/voice-v2/service.mjs'), 'utf8'), /\.\.\/\.\.\/veyra-packages\/veyra-voice\/session\.mjs/);
}));

test('undeclared relative dependencies are rejected before materializing a distribution', () => fixture(async ({ root, api, destination }) => {
  writeFileSync(join(api, 'service.mjs'), "import '../../../../outside.mjs';\n");
  writeFileSync(join(root, 'outside.mjs'), 'throw new Error("must not execute");\n');
  assert.throws(() => planDomainRuntime({ sourceRoot: root, destination }), /outside reviewed closure/);
}));