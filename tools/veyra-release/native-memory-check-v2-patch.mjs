import { createHash } from 'node:crypto';
import { unifiedPatch } from './linux-recipe-patch.mjs';
export const MEMORY_V2_ENTRY_PREIMAGE = 'c2404104d92c3e1f803bb5d7f3272674ec2dc6f8a9d1cd0c59f52822227aacbd';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function proposeNativeMemoryCheckV2(beforeBytes, fragmentBytes) {
  if (!Buffer.isBuffer(beforeBytes) || sha(beforeBytes) !== MEMORY_V2_ENTRY_PREIMAGE) throw new Error('Exact c240 canonical entry preimage required');
  const before = beforeBytes.toString('utf8'); let after = before;
  const once = (find, replacement) => { if (after.split(find).length !== 2) throw new Error('Exact v2 insertion anchor changed: ' + find.slice(0, 80)); after = after.replace(find, () => replacement); };
  once('});\nconst guardFiles =', `});\n${fragmentBytes.toString('utf8')}\nconst guardFiles =`);
  once('export async function captureCargoCheckInputs(root, originalEnv) {', 'export async function captureCargoCheckInputs(root, originalEnv, profile = CHECK.profile) {\n  reviewedCheckProfile(profile);');
  const oldWorkspace = "  const workspaceBytes = state.files.filter(([name]) => /^(apps\\/service\\/src|apps\\/desktop\\/src-tauri\\/src|crates\\/(adapters|contracts|core|harness)\\/src)\\//.test(name)).reduce((sum, [, info]) => sum + info.bytes, 0);";
  once(oldWorkspace, '  const workspaceBytes = workspaceBytesForCheckProfile(profile, state.files);');
  once('  for (const [name, expected] of Object.entries(fixed))', '  const admitted = pinsForCheckProfile(profile, fixed);\n  for (const [name, expected] of Object.entries(admitted))');
  once('!Object.hasOwn(fixed, name)', '!Object.hasOwn(admitted, name)');
  once("  const remap = await import(pathToFileURL(path.join(root, 'tools/compiler-path-remap.mjs')).href);",
    "  const actualLockSha256 = state.files.find(([name]) => name === 'Cargo.lock')[1].sha256;\n  const memoryLockResolutionSha256 = profile === MEMORY_CHECK_V2.profile\n    ? await readMemoryResolution(fs, root, env, actualLockSha256) : undefined;\n  const remap = await import(pathToFileURL(path.join(root, 'tools/compiler-path-remap.mjs')).href);");
  once('  const cache = await cacheState(target), nativeEnvironment = nativeEnvironmentIdentity(env);',
    '  const cache = await cacheState(target), nativeEnvironment = nativeEnvironmentIdentity(env);\n  const memoryFeatureSha256 = profile === MEMORY_CHECK_V2.profile ? await captureMemoryFeatureWitnesses(target) : undefined;\n  const cacheSha256 = memoryFeatureSha256 ? digest({ originalCache: cache.sha256, memoryFeatures: memoryFeatureSha256 }) : cache.sha256;');
  once('  return { sourceTree: state.tree, sourceStateSha256: state.sha256, gatePolicySha256,',
    '  return { profile, actualLockSha256, memoryLockResolutionSha256, sourceTree: state.tree, sourceStateSha256: state.sha256, gatePolicySha256,');
  once('cacheSha256: cache.sha256, toolchainSha256:', 'cacheSha256, toolchainSha256:');
  const oldReview = "  if (!keys(receipt, ['schemaVersion', 'profile', 'reviewedBy', 'reviewed', 'hostInputsReviewed', 'sourceTree', 'gatePolicySha256', 'sourceStateSha256', 'inputs'])\n    || receipt.schemaVersion !== 1 || receipt.profile !== CHECK.profile || receipt.reviewedBy !== CHECK.reviewer || receipt.reviewed !== true || receipt.hostInputsReviewed !== true) fail('independent fixed-profile review receipt required');";
  const newReview = "  const profile = reviewedCheckProfile(receipt?.profile), memory = profile === MEMORY_CHECK_V2.profile;\n  const fields = ['schemaVersion', 'profile', 'reviewedBy', 'reviewed', 'hostInputsReviewed', 'sourceTree', 'gatePolicySha256', 'sourceStateSha256', 'inputs'];\n  if (memory) fields.push('memoryLockResolutionSha256');\n  if (!keys(receipt, fields) || receipt.schemaVersion !== 1 || receipt.profile !== profile || receipt.reviewedBy !== CHECK.reviewer || receipt.reviewed !== true || receipt.hostInputsReviewed !== true) fail('independent fixed-profile review receipt required');\n  if ((capture.profile ?? CHECK.profile) !== profile) fail('captured check profile differs from approved receipt');\n  if (memory && (capture.actualLockSha256 !== MEMORY_CHECK_V2.resolvedLock\n    || receipt.memoryLockResolutionSha256 !== MEMORY_CHECK_V2.resolutionSha256\n    || capture.memoryLockResolutionSha256 !== receipt.memoryLockResolutionSha256)) fail('approved v2 actual lock/r2 resolution binding required');";
  once(oldReview, newReview);
  once('  capture: captureCargoCheckInputs, guard: originalGuard,', '  capture: captureCargoCheckInputs, guard: originalGuard, verifyResolution: verifyMemoryResolutionCapture,');
  once('    const first = await adapters.read(env), capture = await adapters.capture(root, env);',
    '    const first = await adapters.read(env), profile = reviewedCheckProfile(first.value?.profile);\n    const capture = await adapters.capture(root, env, profile);');
  once('    await adapters.verifySource(capture);\n    let failure;',
    "    await adapters.verifySource(capture);\n    if (profile === MEMORY_CHECK_V2.profile) {\n      if (typeof adapters.verifyResolution !== 'function') fail('v2 actual resolution verifier unavailable');\n      await adapters.verifyResolution(capture);\n    }\n    let failure;");
  once('    return { profile: CHECK.profile, independentReviewSha256:', '    return { profile, independentReviewSha256:');
  const oldFacts = "export function cargoCheckReviewFacts(capture) {\n  return { schemaVersion: 1, profile: CHECK.profile, reviewedBy: CHECK.reviewer, reviewed: false, hostInputsReviewed: false,\n    sourceTree: capture.sourceTree, gatePolicySha256: capture.gatePolicySha256, sourceStateSha256: capture.sourceStateSha256, inputs: { ...capture.inputs } };\n}";
  const newFacts = "export function cargoCheckReviewFacts(capture) {\n  const profile = reviewedCheckProfile(capture.profile), facts = { schemaVersion: 1, profile, reviewedBy: CHECK.reviewer, reviewed: false, hostInputsReviewed: false,\n    sourceTree: capture.sourceTree, gatePolicySha256: capture.gatePolicySha256, sourceStateSha256: capture.sourceStateSha256, inputs: { ...capture.inputs } };\n  if (profile === MEMORY_CHECK_V2.profile) facts.memoryLockResolutionSha256 = capture.memoryLockResolutionSha256;\n  return facts;\n}";
  once(oldFacts, newFacts);
  const section = (text, begin, end) => text.slice(text.indexOf(begin), text.indexOf(end, text.indexOf(begin)));
  for (const [begin, end] of [['async function hashFile(', 'const exec = promisify(execFile);'],
    ['async function cacheState(', '/** Read-only candidate capture.'], ['  const fixed = {', '  };\n'],
    ['export function validateStorage(', 'async function originalGuard('], ['async function originalGuard(', 'const production ='],
    ['  launch: async capture => {', '/** Adapter seam']]) {
    if (section(before, begin, end) !== section(after, begin, end)) throw new Error('Original validation/guard/launcher changed: ' + begin);
  }
  return { after, patch: unifiedPatch(before, after, 'tools/reviewed-cargo-check.mjs'), preimageSha256: sha(beforeBytes), afterSha256: sha(Buffer.from(after)), fragmentSha256: sha(fragmentBytes),
    v1FixedPinsPreserved: true, descriptorCacheGuardAndCompilerPreserved: true };
}
