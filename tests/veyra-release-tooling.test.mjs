import assert from 'node:assert/strict';
import test from 'node:test';
import { digest, sourceEntry, portablePath, assertRevision } from '../tools/veyra-release/source-manifest.mjs';
import { validatePayload } from '../tools/veyra-release/payload-policy.mjs';
import { RELEASE_GATES, evaluateRelease } from '../tools/veyra-release/qualification.mjs';
import { validateBinding, planBrowserOperation, executeBrowserOperation } from '../packages/veyra-operations/platform-browser.mjs';
import { COMPATIBILITY_CHECKS, operationsCompatibility } from '../packages/veyra-operations/compatibility.mjs';

const sha = 'a'.repeat(64);
const candidate = { platform: 'windows', appRevision: 'b'.repeat(40), nativeRevision: 'c'.repeat(40), sourceSha256: sha, artifactSha256: 'd'.repeat(64) };
const acceptance = { featureDispositions: 74, views: 47, settings: 20, windowsRows: 11, originalContractSha256: sha, retainedContractSha256: sha };
const qualifiedRows = target => Object.entries(RELEASE_GATES).filter(([, rule]) => rule.platforms.includes(target.platform)).map(([gate, rule]) => ({ gate, status: 'pass', kind: rule.kind, subject: { ...target }, receiptSha256: sha }));
const release = (evidence = [], target = candidate) => evaluateRelease({ candidate: target, evidence, acceptance });
const payload = (names, platform = 'linux') => ({ platform, files: names.map(name => ({ path: name, kind: 'file', sha256: sha, bytes: 50 })), requiredPaths: [names[0]], approvedPaths: [...names] });
const binding = { kind: 'windows-native', installationId: 'installation', accountId: 'account', projectId: 'project', runtimeId: 'runtime', admission: { workspaceIdentity: 'workspace', workspaceHash: 'immutable-hash', workspaceEpoch: 1, hostId: 'host', canonicalDirectory: 'C:/workspace', serviceInstanceId: 'instance', projectRevision: 2 } };
const request = () => ({ binding: { ...binding }, target: { kind: 'paired-tab', tabId: 'tab', sessionId: 'session' }, action: 'screenshot', grant: { ...binding, action: 'screenshot', tabId: 'tab', sessionId: 'session', expiresAt: Date.now() + 60000 } });

test('source blob proof hashes raw bytes and rejects normalized or changed content', () => {
  const bytes = Buffer.from('first\r\nsecond\n');
  const object = digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
  assert.equal(sourceEntry('src/file.mjs', '100644', object, bytes).sha256, digest(bytes));
  assert.throws(() => sourceEntry('src/file.mjs', '100644', object, Buffer.from('first\nsecond\n')), /differs/);
  assert.throws(() => sourceEntry('submodule', '160000', object, bytes), /mode/);
});

test('portable paths and revisions reject escapes, absolute paths and abbreviations', () => {
  for (const name of ['../x', '/x', 'a//x', 'a\\x', 'C:/x', 'a/./x', 'x\0y', 'x\ny']) assert.throws(() => portablePath(name));
  assert.equal(portablePath('a/b-c.js'), 'a/b-c.js');
  assert.equal(assertRevision('a'.repeat(40)), 'a'.repeat(40));
  for (const revision of ['a'.repeat(7), 'A'.repeat(40), 'z'.repeat(40)]) assert.throws(() => assertRevision(revision));
});

test('payload allowlist measures unpacked bytes without claiming compressed size', () => {
  assert.deepEqual(validatePayload(payload(['bin/veyra-api', 'LICENSE'])), { platform: 'linux', fileCount: 2, unpackedBytes: 100, inferenceEngineInspection: 'path-inventory-only' });
});

test('Linux payload rejects Windows engine and model paths', () => {
  for (const name of ['lib/llama.dll', 'models/local.bin', 'weights/a', 'lib/model-manager.js', 'data/a.gguf', 'lib/ggml.so']) {
    assert.throws(() => validatePayload(payload([name])), /excluded|Private/);
  }
});

test('payload rejects private state, links, case collisions, missing and unreviewed files', () => {
  for (const name of ['.env', '.env.local', 'data/credentials/a', '.git/config', 'node_modules/a', 'target/debug/a']) assert.throws(() => validatePayload(payload([name])));
  assert.throws(() => validatePayload(payload(['a', 'A'])), /colliding/);
  const input = payload(['a']); input.files[0].kind = 'symlink'; assert.throws(() => validatePayload(input));
  const missing = payload(['a']); missing.requiredPaths.push('absent'); assert.throws(() => validatePayload(missing), /missing/);
  const extra = payload(['a']); extra.approvedPaths = ['b']; assert.throws(() => validatePayload(extra), /Unreviewed/);
  const malformed = payload(['a']); malformed.files[0].sha256 = 'z'.repeat(64); assert.throws(() => validatePayload(malformed));
});

test('Windows inventory can preserve existing engine executables without bundling weights', () => {
  assert.equal(validatePayload(payload(['Veyra.exe', 'veyra-inference.dll'], 'windows')).fileCount, 2);
  assert.throws(() => validatePayload(payload(['models/preserved.gguf'], 'windows')), /Private/);
});

test('qualification keeps missing platform gates open', () => {
  const result = release(); assert.equal(result.status, 'incomplete');
  assert.ok(result.gates.some(row => row.gate === 'windows-native-wsl-terminal-reconnect' && row.status === 'incomplete'));
  assert.ok(!result.gates.some(row => row.gate === 'linux-engine-exclusion'));
});

test('complete exact-candidate evidence passes the reducer for either platform', () => {
  for (const platform of ['windows', 'linux']) {
    const target = { ...candidate, platform };
    assert.equal(release(qualifiedRows(target), target).status, 'qualified');
  }
});

test('qualification rejects stale artifacts, fixture success and build evidence for runtime', () => {
  for (const mutation of [row => { row.subject.artifactSha256 = 'e'.repeat(64); }, row => { row.fixture = true; }, row => { row.kind = 'build'; }, row => { row.receiptSha256 = ''; }]) {
    const rows = qualifiedRows(candidate); mutation(rows.find(row => row.kind === 'runtime'));
    assert.equal(release(rows).status, 'incomplete');
  }
});

test('qualification retains failure and rejects contradictory duplicate evidence', () => {
  const rows = qualifiedRows(candidate); rows[0].status = 'fail';
  assert.equal(release(rows).status, 'fail'); assert.equal(release(rows).gates[0].observedStatus, 'fail');
  assert.throws(() => release([...rows, rows[0]]), /duplicate/);
  assert.throws(() => release([{ gate: 'invented', status: 'pass' }]), /Unknown/);
});

test('qualification never drops original acceptance inventories or hashes', () => {
  for (const delta of [{ views: 46 }, { settings: 19 }, { windowsRows: 10 }, { featureDispositions: 73 }, { retainedContractSha256: 'f'.repeat(64) }]) {
    assert.equal(evaluateRelease({ candidate, evidence: qualifiedRows(candidate), acceptance: { ...acceptance, ...delta } }).status, 'incomplete');
  }
});

test('bindings require selected WSL identity and preserve explicit projectless scope', () => {
  assert.equal(validateBinding({ ...binding, projectId: null }).projectId, null);
  const absent = { ...binding }; delete absent.projectId; assert.throws(() => validateBinding(absent));
  assert.throws(() => validateBinding({ ...binding, kind: 'windows-wsl' }), /distro/);
  assert.equal(validateBinding({ ...binding, kind: 'windows-wsl', distro: 'Ubuntu', user: 'tester', workdir: '/workspace' }).kind, 'windows-wsl');
});

test('browser plan rejects mismatched account, project, runtime, tab and expired grants', () => {
  for (const key of ['kind', 'installationId', 'accountId', 'projectId', 'runtimeId', 'tabId', 'sessionId', 'action']) {
    const input = request(); input.grant[key] = 'other'; assert.throws(() => planBrowserOperation(input), /capability/);
  }
  const input = request(); input.grant.expiresAt = 10; input.grant.now = 0;
  assert.throws(() => planBrowserOperation(input, 20), /capability/);
  assert.equal(planBrowserOperation(request()).adapter, 'paired-browser');
});

test('browser targets cannot silently change Windows/WSL/cluster environment', () => {
  const input = request(); input.binding = { ...binding, kind: 'linux-cluster', clusterId: 'cluster', namespace: 'namespace' };
  assert.throws(() => planBrowserOperation(input), /remote/);
  input.target.kind = 'remote-tab'; input.grant = { ...input.grant, ...input.binding }; assert.equal(planBrowserOperation(input).adapter, 'remote-browser');
  const wsl = request(); wsl.binding = { ...binding, kind: 'windows-wsl', distro: 'Ubuntu', user: 'tester', workdir: '/workspace' }; wsl.target.kind = 'native-tab';
  assert.throws(() => planBrowserOperation(wsl), /native Windows/);
});

test('browser cancellation before dispatch invokes no transport', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(executeBrowserOperation(request(), async () => { calls++; }, controller.signal), /cancelled/);
  assert.equal(calls, 0);
});

test('browser interrupted or malformed outcomes remain unknown without replay', async () => {
  let calls = 0;
  const result = await executeBrowserOperation(request(), async () => { calls++; throw new Error('private detail'); });
  assert.equal(calls, 1); assert.deepEqual(result, { status: 'unknown', retryAllowed: false, reason: 'transport-interrupted' });
  assert.equal((await executeBrowserOperation(request(), async () => ({ status: 'made-up' }))).status, 'unknown');
  const controller = new AbortController();
  assert.equal((await executeBrowserOperation(request(), async () => { controller.abort(); return { status: 'completed' }; }, controller.signal)).status, 'unknown');
});

test('browser forwards explicit completed and denied outcomes without retry authority', async () => {
  for (const status of ['completed', 'denied', 'failed', 'unknown']) {
    const result = await executeBrowserOperation(request(), async (plan) => { assert.equal(plan.target.tabId, 'tab'); return { status, receipt: 'opaque-receipt-id' }; });
    assert.equal(result.status, status); assert.equal(result.retryAllowed, false);
  }
});

test('operations compatibility requires all real same-candidate observations', () => {
  const observations = COMPATIBILITY_CHECKS.map(check => ({ check, candidateId: 'candidate', status: 'pass', receiptSha256: sha }));
  assert.equal(operationsCompatibility({ candidateId: 'candidate', observations }).status, 'compatible');
  assert.equal(operationsCompatibility({ candidateId: 'new-candidate', observations }).status, 'incomplete');
  assert.equal(operationsCompatibility({ candidateId: 'candidate', observations: [] }).checks.length, 18);
  observations[0].fixture = true; assert.equal(operationsCompatibility({ candidateId: 'candidate', observations }).status, 'incomplete');
});

test('unknown mail outcome stays unknown and cannot authorize retry', () => {
  const observations = [{ check: 'mail-send-known-outcome', candidateId: 'candidate', status: 'unknown', receiptSha256: sha }];
  const result = operationsCompatibility({ candidateId: 'candidate', observations });
  assert.deepEqual(result.checks.find(row => row.check === 'mail-send-known-outcome'), { check: 'mail-send-known-outcome', status: 'unknown', retryAllowed: false });
  assert.throws(() => operationsCompatibility({ candidateId: 'candidate', observations: [...observations, ...observations] }), /duplicate/);
});


// These read the small checked-in tooling directory and create no fixture files.
test('filesystem payload collector hashes actual bytes and refuses an incomplete allowlist', async () => {
  const { collectPayload } = await import('../tools/veyra-release/inspect-payload.mjs');
  const { readdir, readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../tools/veyra-release/', import.meta.url));
  const names = (await readdir(root)).sort();
  const result = await collectPayload(root, { platform: 'linux', approvedPaths: names, requiredPaths: ['source-manifest.mjs'] });
  assert.equal(result.fileCount, names.length);
  assert.equal(result.files.find(file => file.path === 'source-manifest.mjs').sha256, digest(await readFile(new URL('../tools/veyra-release/source-manifest.mjs', import.meta.url))));
  await assert.rejects(collectPayload(root, { platform: 'linux', approvedPaths: ['source-manifest.mjs'], requiredPaths: ['source-manifest.mjs'] }), /Unreviewed/);
});

test('navigation forwards the exact URL only within an explicitly granted HTTP origin', () => {
  const input = request(); input.action = 'navigate'; input.grant.action = 'navigate';
  input.grant.allowedOrigins = ['https://example.com']; input.input = { url: 'https://example.com/path?q=1' };
  assert.deepEqual(planBrowserOperation(input).input, input.input);
  for (const url of ['https://other.example/path', 'javascript:alert(1)', 'https://user:password@example.com/']) {
    input.input.url = url; assert.throws(() => planBrowserOperation(input));
  }
  delete input.input; assert.throws(() => planBrowserOperation(input), /URL/);
});

test('DOM query forwarding is bounded and drops unrecognized execution payloads', () => {
  const input = request(); input.action = 'dom'; input.grant.action = 'dom';
  input.input = { selector: 'button[aria-label="Save"]', script: 'not-forwarded' };
  assert.deepEqual(planBrowserOperation(input).input, { selector: input.input.selector });
  input.input.selector = ''; assert.throws(() => planBrowserOperation(input));
  input.input.selector = 'x'.repeat(4097); assert.throws(() => planBrowserOperation(input), /bound/);
});

test('browser capability binds immutable workspace epoch, native instance and project revision', () => {
  for (const key of ['workspaceIdentity', 'workspaceHash', 'hostId', 'canonicalDirectory', 'serviceInstanceId', 'workspaceEpoch', 'projectRevision']) {
    const input = request(); input.grant.admission = { ...input.grant.admission, [key]: typeof input.grant.admission[key] === 'number' ? 999 : 'other' };
    assert.throws(() => planBrowserOperation(input), /capability/);
  }
  const input = request(); delete input.binding.admission; assert.throws(() => planBrowserOperation(input), /admission/);
});
