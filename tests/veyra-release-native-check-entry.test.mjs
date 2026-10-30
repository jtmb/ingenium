import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK, receiptPath, prepareCheckEnvironment, validateToolchain, validateReview, validateStorage,
  createCheckRunner, readReviewReceipt, cargoCheckReviewFacts, hasReviewAt, validateAliasIdentity, nativeEnvironmentIdentity } from '../tools/veyra-release/native-reviewed-cargo-check.mjs';
import { proposeNativeCheckGate } from '../tools/veyra-release/native-check-gate-patch.mjs';
const h = 'a'.repeat(64), tree = 'b'.repeat(40), policy = 'c'.repeat(64);
const env = { VEYRA_GENERATED_OUTPUT_ROOT: 'C:\\task', VEYRA_APPROVED_NATIVE_TASK_ROOT: 'C:\\task' };
function fixture() {
  const capture = { sourceTree: tree, sourceStateSha256: h, gatePolicySha256: policy,
    inputs: Object.fromEntries(['sourceFilesSha256', 'cacheSha256', 'toolchainSha256', 'rootsSha256', 'flagsSha256', 'nativeEnvironmentSha256'].map(k => [k, h])) };
  const receipt = { schemaVersion: 1, profile: CHECK.profile, reviewedBy: CHECK.reviewer, reviewed: true, hostInputsReviewed: true,
    sourceTree: tree, sourceStateSha256: h, gatePolicySha256: policy, inputs: { ...capture.inputs } };
  const storage = { stage: { approved_native_wsl_pair: true, local_task_budget_bytes: CHECK.ceiling, estimated_growth_bytes: CHECK.growth,
    task_allocated_bytes: 18000000000, system_free_bytes: 50 * 1024 ** 3, destination_free_bytes: 50 * 1024 ** 3,
    environment_filesystem_free_bytes: { WSL: 500 * 1024 ** 3 } } };
  const events = [];
  const adapters = { platform: () => 'win32', read: async () => { events.push('read'); return { value: receipt, sha256: h }; },
    capture: async () => { events.push('capture'); return capture; }, guard: async () => { events.push('guard'); return storage; },
    verifySource: async () => { events.push('source'); }, launch: async () => { events.push('launch'); } };
  return { capture, receipt, storage, events, adapters };
}
test('fixed operation and fixed combined growth; no command or estimate argument', () => {
  assert.deepEqual([...CHECK.argv], ['check', '--locked', '--offline', '-j1', '-p', 'veyra-service', '-p', 'veyra-desktop']);
  assert.equal(CHECK.growth, (2048 + 256) * 1024 ** 2); assert(Object.isFrozen(CHECK.argv));
  assert.equal(receiptPath(env), 'C:\\task\\qualification\\reviewed-cargo-check.json');
});
test('case-conflicting roots, flags/wrappers/profile/target overrides refuse', () => {
  assert.throws(() => receiptPath({ ...env, veyra_generated_output_root: 'D:\\other' }), /conflicting/);
  for (const key of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
    'CARGO_PROFILE_DEV_DEBUG', 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER', 'CARGO_BUILD_RUSTFLAGS']) {
    assert.throws(() => prepareCheckEnvironment({ [key]: 'changed' }), /refused/, key);
  }
  const original = { Cargo_Incremental: '1', CARGO_BUILD_JOBS: '8' }, prepared = prepareCheckEnvironment(original);
  assert.equal(original.Cargo_Incremental, '1'); assert.equal(prepared.CARGO_INCREMENTAL, '0');
  assert.equal(prepared.CARGO_BUILD_JOBS, '1'); assert.equal(prepared.CARGO_NET_OFFLINE, 'true'); assert.equal(prepared.Cargo_Incremental, undefined);
});
test('compiler binary AND driver must match pinned closure', () => {
  const pins = ['c9b44417dc8228b81923a1068a3c09e32d2793f2cced2a816789cf433c1f0d46', 'fc40f1c8b65095a22a48c111aadc279c26a049b7e4161e8b99ffe3eb23873e86', '6e0929ce2af23442bd04d9a03e9311e8f6806dafd54af8f6a85c3cee535bfa73'];
  validateToolchain(pins.map(x => ['input', { sha256: x }]));
  for (let i = 0; i < 3; i++) { const changed = pins.map(x => ['input', { sha256: x }]); changed[i][1].sha256 = h; assert.throws(() => validateToolchain(changed), /toolchain/); }
  assert.throws(() => validateToolchain([]), /toolchain/);
});
test('receipt rejects caller commands, policy numbers, unknown fields and unreviewed claims', () => {
  for (const patch of [{ command: ['build'] }, { reserveBytes: 1 }, { ceiling: 24 * 1024 ** 3 }, { reviewed: false },
    { hostInputsReviewed: false }, { reviewedBy: 'worker' }, { profile: 'full-build' }]) {
    const f = fixture(); Object.assign(f.receipt, patch); assert.throws(() => validateReview(f.receipt, f.capture, tree, policy));
  }
});
test('source/dependencies/cache/flags/config/toolchain/environment/physical roots must match current reviewed facts', () => {
  for (const key of Object.keys(fixture().capture.inputs)) {
    const f = fixture(); f.capture.inputs[key] = 'd'.repeat(64); assert.throws(() => validateReview(f.receipt, f.capture, tree, policy), /inputs changed/);
  }
  for (const key of ['sourceTree', 'sourceStateSha256', 'gatePolicySha256']) {
    const f = fixture(); f.capture[key] = 'd'.repeat(key === 'sourceTree' ? 40 : 64); assert.throws(() => validateReview(f.receipt, f.capture, tree, policy), /stale/);
  }
});
test('candidate facts never self-approve and contain no process environment', () => {
  const f = fixture(); f.capture.execution = { env: { PRIVATE: 'unrelated' } }; const candidate = cargoCheckReviewFacts(f.capture);
  assert.equal(candidate.reviewed, false); assert.equal(candidate.hostInputsReviewed, false);
  assert.equal(candidate.execution, undefined); assert.equal(JSON.stringify(candidate).includes('PRIVATE'), false);
});
test('original guard result must preserve exact cap, combined estimate and every post-growth floor', () => {
  validateStorage(fixture().storage);
  for (const patch of [{ approved_native_wsl_pair: false }, { local_task_budget_bytes: 24 * 1024 ** 3 }, { estimated_growth_bytes: 1 },
    { task_allocated_bytes: CHECK.ceiling - CHECK.growth + 1 }, { system_free_bytes: CHECK.floor + CHECK.growth - 1 },
    { destination_free_bytes: CHECK.floor + CHECK.growth - 1 }, { environment_filesystem_free_bytes: { WSL: CHECK.floor + CHECK.growth - 1 } }]) {
    const f = fixture(); Object.assign(f.storage.stage, patch); assert.throws(() => validateStorage(f.storage), /guard\/cap\/floors/);
  }
});
test('runner verifies independent inputs/source, original guard and re-read receipt BEFORE launch', async () => {
  const f = fixture(); const result = await createCheckRunner(f.adapters)('source', env, tree, policy);
  assert.deepEqual(f.events, ['read', 'capture', 'source', 'guard', 'read', 'source', 'launch', 'source']);
  assert.equal(result.estimatedGrowthBytes, CHECK.growth); assert.equal(result.independentReviewSha256, h);
});
test('non-Windows, config/remapper/alias rejection or guard failure never launches compiler', async () => {
  for (const reason of ['Cargo configuration overrides flags', 'compiler target alias mismatch', 'host cache missing']) {
    const f = fixture(); f.adapters.capture = async () => { throw new Error(reason); };
    await assert.rejects(createCheckRunner(f.adapters)('source', env, tree, policy), new RegExp(reason)); assert(!f.events.includes('launch'));
  }
  const f = fixture(); f.adapters.platform = () => 'linux'; await assert.rejects(createCheckRunner(f.adapters)('source', env, tree, policy), /Windows/); assert.equal(f.events.length, 0);
  const g = fixture(); g.adapters.guard = async () => { throw new Error('original guard refusal'); };
  await assert.rejects(createCheckRunner(g.adapters)('source', env, tree, policy), /guard refusal/); assert(!g.events.includes('launch'));
});
test('changed receipt or source during guard refuses before launch', async () => {
  const f = fixture(); let reads = 0; f.adapters.read = async () => ({ value: f.receipt, sha256: ++reads === 1 ? h : 'd'.repeat(64) });
  await assert.rejects(createCheckRunner(f.adapters)('source', env, tree, policy), /receipt changed/); assert(!f.events.includes('launch'));
  const g = fixture(); let checks = 0; g.adapters.verifySource = async () => { if (++checks === 2) throw new Error('Source drift'); };
  await assert.rejects(createCheckRunner(g.adapters)('source', env, tree, policy), /Source drift/); assert(!g.events.includes('launch'));
});
test('compiler first failure survives secondary post-run source drift', async () => {
  const f = fixture(); const first = new Error('first compiler failure'); let checks = 0;
  f.adapters.launch = async () => { throw first; }; f.adapters.verifySource = async () => { if (++checks === 3) throw new Error('after drift'); };
  await assert.rejects(createCheckRunner(f.adapters)('source', env, tree, policy), error => error === first && error.sourceStabilityFailure === 'after drift');
});
function receiptFs(options = {}) {
  const bytes = Buffer.from('{"reviewed":true}'); let closed = 0, statCalls = 0;
  const info = { dev: 1n, ino: 2n, size: BigInt(bytes.length), nlink: 1n, mtimeNs: 3n, ctimeNs: 4n,
    isFile: () => true, isSymbolicLink: () => false, ...options.info };
  const dir = { isDirectory: () => true, isSymbolicLink: () => false };
  const api = { realpath: async p => options.redirect ? 'D:\\elsewhere' : p,
    lstat: async p => p.endsWith('.json') ? { ...info, ...(options.replace && ++statCalls > 1 ? { ino: 99n } : {}) } : dir,
    open: async () => ({ stat: async () => ({ ...info, ...(options.openRace ? { ino: 8n } : {}) }),
      read: async (buffer, offset, length, position) => {
        if (options.readError) throw new Error('read failed');
        if (options.short) return { bytesRead: 0 };
        const amount = Math.min(length, bytes.length - position); if (amount > 0) bytes.copy(buffer, offset, position, position + amount);
        return { bytesRead: amount > 0 ? amount : options.grew ? 1 : 0 };
      }, close: async () => { closed++; } }) };
  return { api, closed: () => closed };
}
test('receipt descriptor read is bounded/single-link/contained and always closes', async () => {
  const f = receiptFs(); assert.equal((await readReviewReceipt(f.api, 'C:\\task', receiptPath(env))).value.reviewed, true); assert.equal(f.closed(), 1);
  for (const info of [{ nlink: 2n }, { size: 65537n }, { isSymbolicLink: () => true }]) {
    const g = receiptFs({ info }); await assert.rejects(readReviewReceipt(g.api, 'C:\\task', receiptPath(env)), /bounded/); assert.equal(g.closed(), 0);
  }
  const g = receiptFs(); await assert.rejects(readReviewReceipt(g.api, 'C:\\task', 'D:\\outside.json'), /escaped/);
});
test('receipt replacement/short/grown/read errors and redirected parents refuse, with handle cleanup', async () => {
  for (const options of [{ openRace: true }, { short: true }, { grew: true }, { readError: true }, { replace: true }]) {
    const f = receiptFs(options); await assert.rejects(readReviewReceipt(f.api, 'C:\\task', receiptPath(env))); assert.equal(f.closed(), 1);
  }
  const f = receiptFs({ redirect: true }); await assert.rejects(readReviewReceipt(f.api, 'C:\\task', receiptPath(env)), /redirected/); assert.equal(f.closed(), 0);
});
test('patch preparation rejects unknown/truncated/shared-source preimages', () => {
  assert.throws(() => proposeNativeCheckGate(Buffer.from('if (rust) {}')), /preimage/);
});

test('fixed receipt absence retains generic default; invalid presence never silently falls back', async () => {
  const missing = { lstat: async () => { const error = new Error('absent'); error.code = 'ENOENT'; throw error; } };
  assert.equal(await hasReviewAt(missing, env), false);
  assert.equal(await hasReviewAt({ lstat: async () => { throw new Error('must not read'); } }, {}), false);
  assert.equal(await hasReviewAt({ lstat: async () => ({}) }, env), true);
  await assert.rejects(hasReviewAt({ lstat: async () => { throw new Error('access denied'); } }, env), /access denied/);
});

test('source/output aliases must identify the same physical directory', () => {
  const original = { dev: 1n, ino: 2n }, alias = { dev: 1n, ino: 2n, isDirectory: () => true };
  validateAliasIdentity(original, alias);
  for (const patch of [{ dev: 3n }, { ino: 4n }, { isDirectory: () => false }]) assert.throws(() => validateAliasIdentity(original, { ...alias, ...patch }), /alias mismatch/);
  assert.throws(() => validateAliasIdentity({ dev: 1n, ino: 0n }, alias), /alias mismatch/);
});

test('delivered canonical entry and patch match exact reviewed preimage receipt', async () => {
  const base = new URL('../', import.meta.url);
  const meta = JSON.parse(await readFile(new URL('docs/workstreams/packaging/native-reviewed-cargo-check-preimages.json', base), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(new URL(meta.canonicalEntrySource, base))), meta.canonicalEntrySha256);
  const patch = await readFile(new URL('docs/workstreams/packaging/native-reviewed-cargo-check-gate.patch', base));
  assert.equal(hash(patch), meta.patchSha256); assert.equal(patch.length, meta.patchBytes);
  assert.equal(meta.originalGenericBranchPreserved, true);
  assert(patch.toString().includes("mode === '--staged' && !ci"));
});

test('native environment identity covers build inputs without hashing credential values', () => {
  const a = { PATH: 'tools', CARGO_REGISTRIES_CRATES_IO_TOKEN: 'first', TAURI_SIGNING_PRIVATE_KEY: 'private-first' };
  const b = { ...a, CARGO_REGISTRIES_CRATES_IO_TOKEN: 'second', TAURI_SIGNING_PRIVATE_KEY: 'private-second' };
  assert.equal(nativeEnvironmentIdentity(a), nativeEnvironmentIdentity(b));
  assert.notEqual(nativeEnvironmentIdentity(a), nativeEnvironmentIdentity({ ...b, PATH: 'changed-tools' }));
});
