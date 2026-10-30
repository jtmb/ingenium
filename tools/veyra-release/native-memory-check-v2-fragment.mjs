// Inline-only canonical v2 fragment. The exact patch generator supplies the
// existing canonical CHECK/FD/path/hash/guard bindings; no standalone execution.
export const MEMORY_CHECK_V2 = Object.freeze({
  profile: 'native-cargo-check-memory-existing-inputs-v2',
  baselineLock: 'a7bb23ff65c5359cddd1f9e5f98a762070124424417808e3117fef746a368aee',
  resolvedLock: 'a5b1f51eb57f93d553abe9d5d428db773fc4e4d43d55dd1269443a3af058fd07',
  resolutionSha256: '6665747af0de1fce18bffe6ba72b2e4e982553536a5f7c8c49196dece2aa90cb',
});
export function reviewedCheckProfile(profile = CHECK.profile) {
  if (profile !== CHECK.profile && profile !== MEMORY_CHECK_V2.profile) fail('unknown explicit check profile');
  return profile;
}
export function pinsForCheckProfile(profile, v1) {
  reviewedCheckProfile(profile);
  if (profile === CHECK.profile) return v1;
  return { ...v1,
    'Cargo.lock': MEMORY_CHECK_V2.resolvedLock,
    'Cargo.toml': 'eaea8832bacb74027fee855571261af75a8ac22b30a54c4e6fbdcc160d156ef8',
    'apps/service/Cargo.toml': 'c6190b4dcb1c06c0233c737a8312a14423841324fb0f43241900ae9de06a8823',
    'crates/adapters/Cargo.toml': '5c373ba8208a61f90dc685109f901f14fec2ce5c0acbc11dd32c067bdbd41e31',
    'crates/veyra-memory/Cargo.toml': 'b5e7a3824ed4a17b81d49b07c1bc916e4920116da6c52094ed200f0c2d955b01' };
}
export function workspaceBytesForCheckProfile(profile, files) {
  reviewedCheckProfile(profile);
  const ordinary = files.filter(([name]) => /^(apps\/service\/src|apps\/desktop\/src-tauri\/src|crates\/(adapters|contracts|core|harness)\/src)\//.test(name)).reduce((sum, [, info]) => sum + info.bytes, 0);
  if (profile === CHECK.profile) return ordinary;
  const memory = files.filter(([name]) => name.startsWith('crates/veyra-memory/src/'));
  const bytes = memory.reduce((sum, [, info]) => sum + info.bytes, 0);
  if (!memory.some(([name]) => name === 'crates/veyra-memory/src/lib.rs') || bytes > 128 * 1024) fail('Memory library source is absent or exceeds v2 envelope');
  return ordinary + bytes;
}
export function memoryResolutionLocation(root, env) {
  const paired = envGet(env, 'VEYRA_EXISTING_WSL_TASK_ROOT');
  if (!paired || !path.isAbsolute(paired) || !inside(paired, root)) fail('registered paired Source root required for actual r2 witness');
  const file = path.join(path.dirname(root), 'coordination', 'integration', 'native-memory-lock-resolution-r2.json');
  if (!inside(paired, file)) fail('actual r2 witness escaped registered paired task');
  return { root: paired, file };
}
export function validateMemoryResolution(record, rawSha256, actualLockSha256) {
  const command = ['metadata', '--offline', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'];
  if (rawSha256 !== MEMORY_CHECK_V2.resolutionSha256 || actualLockSha256 !== MEMORY_CHECK_V2.resolvedLock
    || record?.owner !== CHECK.reviewer || record.beforeSha256 !== MEMORY_CHECK_V2.baselineLock || record.code !== 0 || record.compiled !== false
    || JSON.stringify(record.command) !== JSON.stringify(command) || record.actualLockResolvedByCoordinator !== true
    || record.verification?.expectedSha256 !== MEMORY_CHECK_V2.resolvedLock || record.verification?.actualSha256 !== MEMORY_CHECK_V2.resolvedLock
    || record.verification?.registryRecordsUnchanged !== true) fail('actual pinned Root r2 offline resolution/current lock witness required');
}
export async function readMemoryResolution(api, root, env, actualLockSha256) {
  const location = memoryResolutionLocation(root, env);
  const result = await readReviewReceipt(api, location.root, location.file);
  validateMemoryResolution(result.value, result.sha256, actualLockSha256);
  return result.sha256;
}
export const MEMORY_V2_WITNESSES = Object.freeze([
  Object.freeze({ unit: 'serde-2e7442c4eb067551/lib-serde.json', fingerprint: 'fb548b1dddda13980733867c8f60169e930e7c410639122ac4d270db17621e36', features: '["alloc","default","derive","rc","serde_derive","std"]', artifact: 'libserde-2e7442c4eb067551.rmeta', bytes: 525960 }),
  Object.freeze({ unit: 'serde_json-5d4f944bbcd2ad4d/lib-serde_json.json', fingerprint: 'ef0091f01dedebac2db6841c5545360dbac009d01eec436f8eaecee23530bb9e', features: '["default","raw_value","std"]', artifact: 'libserde_json-5d4f944bbcd2ad4d.rmeta', bytes: 1067744 }),
  Object.freeze({ unit: 'sha2-a3752a26a8a920cd/lib-sha2.json', fingerprint: 'cc5d0af20e9e8bf6c9561806559952e07c72a1fbd06af3625c90f815faf8686a', features: '["default","std"]', artifact: 'libsha2-a3752a26a8a920cd.rmeta', bytes: 640108 }),
  Object.freeze({ unit: 'serde_derive-e0400d55e3df06a8/lib-serde_derive.json', fingerprint: 'db61c6c24f01fc2e702c12ecf96914041e877c7f5de147a07d1512d598bf5b23', features: '["default"]', artifact: 'serde_derive-e0400d55e3df06a8.dll', bytes: 2782208 }),
]);
export function validateMemoryFeatureWitness(expected, fingerprint, artifact) {
  // Exact raw fingerprint identity binds compiler/profile/flags without parsing
  // its u64 numeric identifiers through JavaScript's floating-point numbers.
  if (fingerprint.sha256 !== expected.fingerprint || JSON.stringify(JSON.parse(fingerprint.value.features)) !== expected.features
    || artifact.bytes !== expected.bytes || !sha(artifact.sha256)) fail('v2 compiled dependency/derive feature witness changed or missing');
}
async function captureMemoryFeatureWitnesses(target) {
  const facts = [];
  for (const expected of MEMORY_V2_WITNESSES) {
    const fingerprint = await readReviewReceipt(fs, target, path.join(target, 'debug', '.fingerprint', expected.unit));
    const artifact = await hashFile(target, path.join(target, 'debug', 'deps', expected.artifact));
    validateMemoryFeatureWitness(expected, fingerprint, artifact);
    facts.push([expected.unit, fingerprint.sha256, expected.artifact, artifact]);
  }
  return digest(facts);
}
async function verifyMemoryResolutionCapture(capture) {
  if (capture.profile !== MEMORY_CHECK_V2.profile) return;
  const sha256 = await readMemoryResolution(fs, capture.root, capture.execution.env, capture.actualLockSha256);
  if (sha256 !== capture.memoryLockResolutionSha256) fail('actual r2 resolution witness changed before use');
}
