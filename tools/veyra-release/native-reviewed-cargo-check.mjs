// Proposed canonical destination: Native tools/reviewed-cargo-check.mjs.
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 as path } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECK = Object.freeze({
  profile: 'native-cargo-check-existing-inputs-v1', growth: 2415919104,
  ceiling: 21474836480, floor: 16106127360,
  reviewer: '01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',
  argv: Object.freeze(['check', '--locked', '--offline', '-j1', '-p', 'veyra-service', '-p', 'veyra-desktop']),
});
const guardFiles = ['build-storage-preflight.mjs', 'check-windows-desktop-storage.ps1', 'windows-artifact-storage.ps1',
  'approved-native-task-storage.ps1', 'existing-wsl-task-storage.ps1', 'task-owned-allocation.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
const fail = message => { throw new Error(`Reviewed Cargo check refused: ${message}`); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const inside = (root, file) => { const rel = path.relative(root, file); return rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\'); };
function envGet(env, name) {
  const found = Object.keys(env).filter(key => key.toUpperCase() === name);
  if (new Set(found.map(key => env[key])).size > 1) fail(`conflicting environment keys: ${name}`);
  return found.length ? env[found[0]] : undefined;
}
function envSet(env, name, value) {
  for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key];
  env[name] = value;
}
export function receiptPath(env) {
  const root = envGet(env, 'VEYRA_GENERATED_OUTPUT_ROOT');
  if (!root || !path.isAbsolute(root) || root !== envGet(env, 'VEYRA_APPROVED_NATIVE_TASK_ROOT')) fail('registered native output root required');
  return path.join(root, 'qualification', 'reviewed-cargo-check.json');
}
const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every(key => a[key] === b[key]);
async function plainDirectory(api, root) {
  const info = await api.lstat(root, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await api.realpath(root) !== root) fail('redirected/non-directory root');
  return { device: String(info.dev), inode: String(info.ino), canonical: root };
}
async function ancestors(api, root, file) {
  if (!inside(root, file)) fail('file escaped its declared root');
  await plainDirectory(api, root);
  let cursor = path.dirname(file);
  while (cursor !== root) { await plainDirectory(api, cursor); const parent = path.dirname(cursor); if (parent === cursor) fail('file root unavailable'); cursor = parent; }
}
/** Bounded descriptor read; no following a replaced receipt or linked evidence file. */
export async function readReviewReceipt(api, root, file) {
  await ancestors(api, root, file);
  const before = await api.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 2n || before.size > 65536n) fail('receipt must be a bounded single-link plain file');
  let handle;
  try {
    handle = await api.open(file, 'r');
    const opened = await handle.stat({ bigint: true });
    if (!sameStat(before, opened)) fail('receipt changed before opening');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) fail('short receipt read'); offset += result.bytesRead; }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) fail('receipt grew');
    if (!sameStat(opened, await handle.stat({ bigint: true })) || !sameStat(opened, await api.lstat(file, { bigint: true }))) fail('receipt changed during read');
    return { value: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes) };
  } finally { if (handle) await handle.close(); }
}
async function hashFile(root, file, limit = 536870912) {
  await ancestors(fs, root, file);
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(limit)) fail('unsafe/oversized input file');
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const opened = await handle.stat({ bigint: true });
    if (!sameStat(before, opened)) fail('input changed before opening');
    const h = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
    while (offset < Number(opened.size)) { const result = await handle.read(buffer, 0, Math.min(buffer.length, Number(opened.size) - offset), offset); if (!result.bytesRead) fail('short input read'); h.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead; }
    if ((await handle.read(buffer, 0, 1, offset)).bytesRead || !sameStat(opened, await handle.stat({ bigint: true })) || !sameStat(opened, await fs.lstat(file, { bigint: true }))) fail('input changed during hashing');
    return { bytes: Number(opened.size), sha256: h.digest('hex') };
  } finally { if (handle) await handle.close(); }
}
const exec = promisify(execFile);
async function git(root, env, args) { return (await exec('git', args, { cwd: root, env, windowsHide: true, maxBuffer: 16 * 1024 ** 2 })).stdout.trim(); }
function safeRelative(value) {
  if (!value || value.includes('\\') || value.includes('\0') || value.includes(':') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('unsafe source relative path');
  return value;
}
async function sourceState(root, env) {
  if (await git(root, env, ['diff', '--name-only']) || await git(root, env, ['ls-files', '--others', '--exclude-standard'])) fail('working tree differs from staged source');
  const tree = await git(root, env, ['write-tree']);
  const names = (await git(root, env, ['ls-files', '-z'])).split('\0').filter(Boolean).sort();
  const files = [];
  for (const name of names) { safeRelative(name); files.push([name, await hashFile(root, path.join(root, name), 67108864)]); }
  return { tree, files, sha256: digest(files) };
}
function buildEnvironment(env) {
  const result = {};
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (/TOKEN|PASSWORD|SECRET|CREDENTIAL|PRIVATE_KEY|AUTH/.test(name)) continue;
    if (/^(CARGO|RUST|TAURI|DEP_)/.test(name) || /^(PATH|INCLUDE|LIB|LIBPATH|CC|CXX|AR|CFLAGS|CXXFLAGS|CL|_CL_|LINK|_LINK_|TEMP|TMP|TMPDIR|VEYRA_.*)$/.test(name)) {
      result[name] = envGet(env, name);
      if (/^CARGO_PROFILE_|^CARGO_TARGET_.+_(RUSTFLAGS|LINKER|RUNNER)$|^CARGO_BUILD_(RUSTFLAGS|RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|TARGET)$/.test(name)) fail('unreviewed Cargo profile/target/compiler override');
    }
  }
  return result;
}
export const nativeEnvironmentIdentity = env => digest(buildEnvironment(env));
export function prepareCheckEnvironment(original) {
  const env = { ...original };
  for (const name of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) if (envGet(env, name)) fail('preexisting Rust flags/wrapper override');
  buildEnvironment(env);
  for (const [name, value] of [['CARGO_INCREMENTAL', '0'], ['CARGO_BUILD_JOBS', '1'], ['CARGO_NET_OFFLINE', 'true']]) envSet(env, name, value);
  return env;
}
export function validateToolchain(toolchain) {
  const expected = ['c9b44417dc8228b81923a1068a3c09e32d2793f2cced2a816789cf433c1f0d46', 'fc40f1c8b65095a22a48c111aadc279c26a049b7e4161e8b99ffe3eb23873e86', '6e0929ce2af23442bd04d9a03e9311e8f6806dafd54af8f6a85c3cee535bfa73'];
  if (toolchain.length !== 3 || toolchain.some(([, info], index) => info.sha256 !== expected[index])) fail('Rust/Cargo/driver toolchain changed');
}
export function validateAliasIdentity(actual, alias) {
  if (!actual.ino || actual.dev !== alias.dev || actual.ino !== alias.ino || !alias.isDirectory()) fail('compiler/source alias mismatch');
}
async function cacheState(target) {
  const files = [], counts = { rmeta: 0, rlib: 0, dll: 0 }, summary = { registryRmeta: 0, workspaceRmeta: 0, macroDllPdb: 0, build: 0 };
  const walk = async directory => {
    await plainDirectory(fs, directory);
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('linked cache input');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(target, file).replaceAll('\\', '/');
        // A linked prior workspace test is retained/counted by the guard, but is
        // not a check-only input. No directory is deleted or subtracted.
        if (relative.startsWith('debug/deps/') && /^veyra_.*\.(exe|pdb)$/.test(entry.name)) continue;
        const info = await hashFile(target, file); files.push([relative, info]);
        if (relative.startsWith('debug/deps/')) {
          if (entry.name.endsWith('.rmeta')) { counts.rmeta++; summary[/^libveyra_/.test(entry.name) ? 'workspaceRmeta' : 'registryRmeta'] += info.bytes; }
          if (entry.name.endsWith('.rlib')) counts.rlib++;
          if (entry.name.endsWith('.dll')) counts.dll++;
          if (/\.(dll|pdb)$/.test(entry.name)) summary.macroDllPdb += info.bytes;
        }
        if (relative.startsWith('debug/build/')) summary.build += info.bytes;
      } else fail('non-file cache input');
    }
  };
  for (const child of ['deps', 'build', '.fingerprint']) await walk(path.join(target, 'debug', child));
  if (counts.rmeta < 400 || counts.rlib < 250 || counts.dll < 25) fail('compatible compiled cache is missing/cold');
  for (const pattern of [/libveyra_adapters-.*\.rmeta$/, /libveyra_service-.*\.rmeta$/, /libveyra_desktop-.*\.rmeta$/,
    /serde_derive-.*\.dll$/, /tokio_macros-.*\.dll$/, /ts_rs_macros-.*\.dll$/, /tauri_macros-.*\.dll$/]) {
    if (!files.some(([name]) => pattern.test(name))) fail('required check/host cache witness missing');
  }
  if (summary.registryRmeta > 768 * 1024 ** 2 || summary.workspaceRmeta > 256 * 1024 ** 2 || summary.build > 384 * 1024 ** 2 || summary.macroDllPdb > 192 * 1024 ** 2) fail('cache producer envelope changed');
  return { sha256: digest(files), counts, summary };
}

/** Read-only candidate capture. It never writes or approves an independent review receipt. */
export async function captureCargoCheckInputs(root, originalEnv) {
  if (process.platform !== 'win32') fail('native Windows stage only');
  const env = prepareCheckEnvironment(originalEnv), output = envGet(env, 'VEYRA_GENERATED_OUTPUT_ROOT'); receiptPath(env);
  const target = envGet(env, 'CARGO_TARGET_DIR'), home = envGet(env, 'CARGO_HOME'), rustc = envGet(env, 'RUSTC');
  if (!target || !home || !inside(output, target) || !inside(output, home) || target === home || inside(target, home) || inside(home, target)) fail('invalid disjoint compiler roots');
  if (!rustc || !path.isAbsolute(rustc) || path.basename(rustc).toLowerCase() !== 'rustc.exe') fail('explicit Rust compiler required');
  const bin = path.dirname(rustc), cargo = path.join(bin, 'cargo.exe'), driver = path.join(bin, 'rustc_driver-9cc664dca72b379e.dll');
  if (envGet(env, 'VEYRA_RUST_BIN') && envGet(env, 'VEYRA_RUST_BIN') !== bin) fail('Rust bin alias mismatch');
  for (const name of ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) if (envGet(env, name)) fail('preexisting Rust flags/wrapper override');
  for (const [name, value] of [['CARGO_INCREMENTAL', '0'], ['CARGO_BUILD_JOBS', '1'], ['CARGO_NET_OFFLINE', 'true']]) envSet(env, name, value);
  const state = await sourceState(root, env);
  const workspaceBytes = state.files.filter(([name]) => /^(apps\/service\/src|apps\/desktop\/src-tauri\/src|crates\/(adapters|contracts|core|harness)\/src)\//.test(name)).reduce((sum, [, info]) => sum + info.bytes, 0);
  if (workspaceBytes > 32 * 1024 ** 2) fail('workspace source exceeds reviewed estimate envelope');
  if (state.files.some(([name]) => /(^|\/)build\.rs$/.test(name) && !['apps/desktop/src-tauri/build.rs', 'apps/legacy-dock/build.rs'].includes(name))) fail('new build script generator requires review');
  const critical = state.files.filter(([name]) => /(^|\/)Cargo\.toml$|^Cargo\.lock$|^rust-toolchain|(^|\/)build\.rs$|^apps\/desktop\/src-tauri\/(tauri\.conf\.json|capabilities\/|icons\/)|^tools\/(feature-gate|reviewed-cargo-check|compiler-path-remap)\.mjs$/.test(name)
    || guardFiles.some(file => name === `tools/${file}`));
  for (const name of ['tools/feature-gate.mjs', 'tools/reviewed-cargo-check.mjs', 'tools/compiler-path-remap.mjs', ...guardFiles.map(file => `tools/${file}`)]) if (!critical.some(([file]) => file === name)) fail('required reviewed source closure missing');
  if (state.files.find(([name]) => name === 'tools/compiler-path-remap.mjs')[1].sha256 !== '49c34110e95b2a75efcc2827552fe856745b0db7d510e36d279cc334e85c2033') fail('original remapper source changed');
  const fixed = {
    'tools/build-storage-preflight.mjs': '44264ef0e6a54652bef115938afc0aa20a9cee4d1f18067289be00d30e61822b',
    'tools/check-windows-desktop-storage.ps1': '8b0214774f12d2c2983d58b360df65dca3e51d3c5b98ff1cd663ff72b34d07a0',
    'tools/windows-artifact-storage.ps1': '6dc3608c20d22527fbdeb876e32cad00b66c3d36b211db5cb360854b61966884',
    'tools/approved-native-task-storage.ps1': '8f56e44007bb4273b4cc6fd9ae092bd2f3cf393a8b90354a0b698dd6f19dfc71',
    'tools/existing-wsl-task-storage.ps1': 'a52481506cd15b71c9fff0c6fa7480a9983c56ad149ea486f6d8d6933d45f72e',
    'tools/task-owned-allocation.mjs': '38817d1eeaa229a8f5cbe5276c4d2cfd222b9231837da195e5ff9d4ce860c25f',
    'Cargo.lock': 'a7bb23ff65c5359cddd1f9e5f98a762070124424417808e3117fef746a368aee',
    'Cargo.toml': 'fff5964b782a834da6f721eaa9ad1a5ace5bb85a95ea0bd282f92f98c5e66039',
    'rust-toolchain.toml': '33b88122a255a699294430b8a7749841bafeca2d02f29d0e8c4a538c5ae688b7',
    'apps/service/Cargo.toml': '1b2f0c355fceebb50dc0990d36b114885540f1d581606482ac8809d7b5deaa3e',
    'apps/desktop/src-tauri/Cargo.toml': 'e4858798077c62426179401b01d7b9593493bd20bb67d714a386d0c0d93077f5',
    'crates/adapters/Cargo.toml': '5aabcaa2d40e26eeeaba5cfff79bed03d82c41d3f47b402a6328adee44fdfec6',
    'crates/contracts/Cargo.toml': 'ba309e1f824b13b69d42d47d328889cf326768d34bff94e1d1f183d217b2de7b',
    'crates/core/Cargo.toml': '005e5796b56f10568575756e1d2d959c179472c3e70a8456b966138956db65dd',
    'crates/harness/Cargo.toml': '4e5828c11b9e6aae620db43215fe54ce32049f6a095ad3d40ce3e251f3c54a71',
    'crates/wsl-owner-helper/Cargo.toml': 'cbdb6102237ab650bbcb4195ee6c38ffbe20e3ca13116a5d97dddf1fa063b8d0',
    'apps/legacy-dock/Cargo.toml': '975e24a087400e8f0625f820fe06f7e54f5098334ef8f00f963389f6758c6226',
    'apps/desktop/src-tauri/build.rs': '02ae8cec00e0cecee6622f96e6fc485274b0b9619c3e168ea14027c4b0174671',
    'apps/desktop/src-tauri/tauri.conf.json': 'be24f1f633c2475f0098429efd957a6ac71504baae95b65afab4d80a0bcc72f9',
  };
  for (const [name, expected] of Object.entries(fixed)) if (state.files.find(([file]) => file === name)?.[1].sha256 !== expected) fail('pinned declarations/build inputs changed');
  if (state.files.some(([name]) => /(^|\/)Cargo\.toml$/.test(name) && !Object.hasOwn(fixed, name))) fail('new workspace manifest requires review');
  const remap = await import(pathToFileURL(path.join(root, 'tools/compiler-path-remap.mjs')).href);
  // Source bytes were already frozen; the original remapper verifies Cargo config
  // absence, registered output aliases and refuses wrapper/flag overrides.
  const compiler = await remap.applyCompilerPathRemapping(env, root);
  const flags = envGet(env, 'CARGO_ENCODED_RUSTFLAGS');
  const flagSha = hash(JSON.stringify(flags.split('\u001f')));
  if (flagSha !== '38f2a7cedf28808b2c241a34162360c88c417b27e4d10f7a53cd3682bf1f2e27') fail('encoded flags differ from independently inspected cache');
  const roots = {};
  for (const [name, value] of Object.entries({ source: root, output, target, cargoHome: home, compilerBin: bin })) roots[name] = await plainDirectory(fs, value);
  const sourceAlias = envGet(env, 'VEYRA_WINDOWS_SOURCE_ALIAS');
  if (sourceAlias) {
    if (!path.isAbsolute(sourceAlias)) fail('source alias must be absolute');
    const actual = await fs.stat(root, { bigint: true }), alias = await fs.stat(sourceAlias, { bigint: true });
    validateAliasIdentity(actual, alias); roots.sourceAlias = { path: sourceAlias, device: String(alias.dev), inode: String(alias.ino) };
  }
  if (compiler.compilerTargetAlias) {
    const actual = await fs.stat(target, { bigint: true }), alias = await fs.stat(compiler.compilerTargetAlias, { bigint: true });
    validateAliasIdentity(actual, alias); roots.targetAlias = { path: compiler.compilerTargetAlias, device: String(alias.dev), inode: String(alias.ino) };
  }
  const toolchain = [];
  for (const file of [cargo, rustc, driver]) toolchain.push([path.basename(file), await hashFile(bin, file)]);
  validateToolchain(toolchain);
  const cache = await cacheState(target), nativeEnvironment = nativeEnvironmentIdentity(env);
  const gatePolicySha256 = state.files.find(([name]) => name === 'tools/feature-gate.mjs')[1].sha256;
  return { sourceTree: state.tree, sourceStateSha256: state.sha256, gatePolicySha256,
    inputs: { sourceFilesSha256: digest(critical), cacheSha256: cache.sha256, toolchainSha256: digest(toolchain), rootsSha256: digest(roots), flagsSha256: flagSha, nativeEnvironmentSha256: nativeEnvironment },
    cacheSummary: cache, execution: { env, cargo, target, compiler }, root, output };
}
export function validateReview(receipt, capture, expectedTree, expectedPolicy) {
  if (!keys(receipt, ['schemaVersion', 'profile', 'reviewedBy', 'reviewed', 'hostInputsReviewed', 'sourceTree', 'gatePolicySha256', 'sourceStateSha256', 'inputs'])
    || receipt.schemaVersion !== 1 || receipt.profile !== CHECK.profile || receipt.reviewedBy !== CHECK.reviewer || receipt.reviewed !== true || receipt.hostInputsReviewed !== true) fail('independent fixed-profile review receipt required');
  const names = ['sourceFilesSha256', 'cacheSha256', 'toolchainSha256', 'rootsSha256', 'flagsSha256', 'nativeEnvironmentSha256'];
  if (!keys(receipt.inputs, names) || names.some(name => !sha(receipt.inputs[name]) || receipt.inputs[name] !== capture.inputs[name])) fail('reviewed dependency/toolchain/flags/roots/environment/cache inputs changed');
  if (!/^[a-f0-9]{40}$/.test(expectedTree) || !sha(expectedPolicy) || receipt.sourceTree !== expectedTree || capture.sourceTree !== expectedTree
    || receipt.gatePolicySha256 !== expectedPolicy || capture.gatePolicySha256 !== expectedPolicy
    || !sha(receipt.sourceStateSha256) || receipt.sourceStateSha256 !== capture.sourceStateSha256) fail('review receipt is stale for exact staged Source/policy');
}
export function validateStorage(storage) {
  const s = storage?.stage;
  if (!s || s.approved_native_wsl_pair !== true || s.local_task_budget_bytes !== CHECK.ceiling || s.estimated_growth_bytes !== CHECK.growth
    || !Number.isSafeInteger(s.task_allocated_bytes) || s.task_allocated_bytes < 0 || s.task_allocated_bytes + CHECK.growth > CHECK.ceiling
    || ![s.system_free_bytes, s.destination_free_bytes, s.environment_filesystem_free_bytes?.WSL].every(v => Number.isSafeInteger(v) && v - CHECK.growth >= CHECK.floor)) fail('original paired-root guard/cap/floors did not qualify this stage');
}
async function originalGuard(capture) {
  const guardModule = path.join(capture.root, 'tools/build-storage-preflight.mjs');
  if ((await hashFile(capture.root, guardModule)).sha256 !== '44264ef0e6a54652bef115938afc0aa20a9cee4d1f18067289be00d30e61822b') fail('original storage module source changed');
  const { resolveStorageGuardScript } = await import(pathToFileURL(guardModule).href);
  const script = await resolveStorageGuardScript(capture.root, capture.execution.env);
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    '-SourceRoot', capture.root, '-DesktopOutput', envGet(capture.execution.env, 'VEYRA_DESKTOP_OUTPUT_DIR'), '-EstimatedGrowthBytes', String(CHECK.growth)],
  { env: capture.execution.env, windowsHide: true, maxBuffer: 1024 ** 2 });
  return JSON.parse(stdout.replace(/^\uFEFF/u, ''));
}
const production = { platform: () => process.platform, read: (env) => readReviewReceipt(fs, envGet(env, 'VEYRA_GENERATED_OUTPUT_ROOT'), receiptPath(env)),
  capture: captureCargoCheckInputs, guard: originalGuard,
  verifySource: async capture => { const state = await sourceState(capture.root, capture.execution.env); if (state.tree !== capture.sourceTree || state.sha256 !== capture.sourceStateSha256) fail('Source changed before/after compiler'); },
  launch: async capture => {
    const env = { ...capture.execution.env };
    if (capture.execution.compiler.compilerTargetAlias) envSet(env, 'CARGO_TARGET_DIR', capture.execution.compiler.compilerTargetAlias);
    await new Promise((accept, reject) => {
      const child = spawn(capture.execution.cargo, CHECK.argv, { cwd: capture.root, env, windowsHide: true, shell: false, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`Reviewed cargo check failed: code=${code}, signal=${signal}`)));
    });
  } };
/** Adapter seam is for fixture-free CPU tests; the canonical gate calls only the fixed production export below. */
export function createCheckRunner(adapters) {
  return async (root, env, expectedTree, expectedPolicy) => {
    if (adapters.platform() !== 'win32') fail('native Windows stage only');
    const first = await adapters.read(env), capture = await adapters.capture(root, env);
    validateReview(first.value, capture, expectedTree, expectedPolicy);
    await adapters.verifySource(capture);
    const storage = await adapters.guard(capture); validateStorage(storage);
    const currentReceipt = await adapters.read(env);
    if (currentReceipt.sha256 !== first.sha256) fail('independent receipt changed before use');
    await adapters.verifySource(capture);
    let failure;
    try { await adapters.launch(capture); } catch (error) { failure = error; }
    try { await adapters.verifySource(capture); } catch (error) { if (!failure) failure = error; else failure.sourceStabilityFailure = error.message; }
    if (failure) throw failure;
    return { profile: CHECK.profile, independentReviewSha256: first.sha256, sourceTree: expectedTree, estimatedGrowthBytes: CHECK.growth };
  };
}
export const runReviewedCargoCheck = createCheckRunner(production);
export function cargoCheckReviewFacts(capture) {
  return { schemaVersion: 1, profile: CHECK.profile, reviewedBy: CHECK.reviewer, reviewed: false, hostInputsReviewed: false,
    sourceTree: capture.sourceTree, gatePolicySha256: capture.gatePolicySha256, sourceStateSha256: capture.sourceStateSha256, inputs: { ...capture.inputs } };
}
export async function hasReviewAt(api, env) {
  // The fixed task receipt is the only selection. An absent native registration
  // or absent receipt preserves the original generic path; invalid presence fails.
  if (!envGet(env, 'VEYRA_APPROVED_NATIVE_TASK_ROOT')) return false;
  try { await api.lstat(receiptPath(env)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export const hasReviewedCargoCheck = env => hasReviewAt(fs, env);
