import { POLICY } from './review-stage-reserve.mjs';
const MiB = 1024 ** 2;
export const CARGO_CHECK_PROFILE = Object.freeze({
  id: 'native-cargo-check-existing-inputs-v1', reserveBytes: 2048 * MiB,
  sourceAllowanceBytes: 256 * MiB, ceilingBytes: POLICY.ceilingBytes, minimumFreeBytes: POLICY.minimumFreeBytes,
  estimate: Object.freeze({ registryMetadata: 768 * MiB, workspaceMetadata: 256 * MiB,
    buildScriptsAndNativeOut: 384 * MiB, macroHostArtifacts: 192 * MiB,
    simultaneousTemporaryReplacement: 256 * MiB, logsAndFingerprints: 32 * MiB,
    allocationAndUncertainty: 160 * MiB }),
});
export const CARGO_CHECK_EXECUTION = Object.freeze({
  argv: Object.freeze(['check', '--locked', '--offline', '-j1', '-p', 'veyra-service', '-p', 'veyra-desktop']),
  CARGO_INCREMENTAL: '0', CARGO_BUILD_JOBS: '1', CARGO_NET_OFFLINE: 'true',
  profile: 'dev', platform: 'win32', host: 'x86_64-pc-windows-msvc', explicitTarget: false,
  toolchain: '1.99.0', tests: false, fullBuild: false, package: false,
});
const identityKeys = ['lockSha256', 'manifestsSha256', 'toolchainDeclarationSha256', 'cargoBinarySha256',
  'rustcBinaryClosureSha256', 'encodedRustflagsSha256', 'remapperSha256', 'cargoConfigStateSha256',
  'sourceTargetCargoHomeIdentitySha256', 'dependencyFeaturesAndProfilesSha256', 'buildScriptInputsSha256', 'nativeBuildEnvironmentSha256'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const bytes = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} byte measurement`);
  return value;
};

/** Planning estimate for a separate check-only stage; never a compiler launcher or build permission. */
export function reviewCargoCheckStage(input) {
  if (!input || input.profile !== CARGO_CHECK_PROFILE.id) throw new Error('Unknown Cargo check-only profile');
  for (const key of ['reserveBytes', 'ceilingBytes', 'minimumFreeBytes', 'sourceAllowanceBytes']) {
    if (Object.hasOwn(input, key)) throw new Error('Caller-selected policy values are not accepted');
  }
  const reasons = [];
  if (!same(input.execution, CARGO_CHECK_EXECUTION)) reasons.push('Command/environment differs from the reviewed check-only operation');
  const reviewed = input.reviewedDependencyInputs ?? {}, observed = input.observedDependencyInputs ?? {};
  for (const key of identityKeys) {
    if (!sha(reviewed[key]) || reviewed[key] !== observed[key]) reasons.push(`Missing or changed ${key}`);
  }
  // Workspace implementation may change; freeze its current bytes independently
  // from the declaration/host/dependency cache identity used by this estimate.
  if (!sha(input.frozenSourceSha256) || input.frozenSourceSha256 !== input.observedSourceSha256) reasons.push('Exact integrated workspace Source is not frozen/matching');
  const assumptions = input.assumptions ?? {};
  for (const key of ['compiledDependencyInputsPresent', 'registryHostRlibsUnchanged', 'noFeatureOrDependencyGraphChange',
    'noCargoConfigOrFlagOverride', 'samePhysicalSourceTargetCargoHome', 'scopedEnvironment', 'exclusiveBuildLease',
    'normalFullBuildGuardUnchanged', 'noNewBuildScriptGenerators']) {
    if (assumptions[key] !== true) reasons.push(`Unverified estimate assumption: ${key}`);
  }
  const observations = input.observations ?? {};
  for (const [key, limit] of Object.entries({ registryRmetaBytes: 768 * MiB, workspaceRmetaBytes: 256 * MiB,
    buildOutputsBytes: 384 * MiB, macroDllAndPdbBytes: 192 * MiB, workspaceSourceBytes: 32 * MiB })) {
    const value = bytes(observations[key], key);
    if (value > limit) reasons.push(`${key} exceeds the reviewed producer envelope`);
  }
  if (observations.normalTwoPackageCheckSucceeded !== true || observations.checkCacheMatchesDeclarations !== true) reasons.push('Existing two-package check/declaration cache evidence is absent');
  const a = input.allocation ?? {};
  const growth = CARGO_CHECK_PROFILE.reserveBytes + CARGO_CHECK_PROFILE.sourceAllowanceBytes;
  const peak = bytes(a.nativeBudgetBytes, 'native allocation') + bytes(a.linuxAllocatedBytes, 'paired Linux allocation') + growth;
  if (!Number.isSafeInteger(peak)) throw new Error('Allocation arithmetic overflow');
  if (peak > CARGO_CHECK_PROFILE.ceilingBytes) reasons.push('Check-only estimate plus source allowance exceeds 20 GiB');
  for (const key of ['systemFreeBytes', 'destinationFreeBytes']) {
    if (bytes(a[key], key) - growth < CARGO_CHECK_PROFILE.minimumFreeBytes) reasons.push(`${key} would not preserve 15 GiB after estimated growth`);
  }
  if (a.freshForLease !== true) reasons.push('Fresh paired-root measurements for the exclusive lease are absent');
  return { schemaVersion: 1, profile: CARGO_CHECK_PROFILE, eligibleForCoordinatorReview: reasons.length === 0,
    buildAuthorized: false, mutationPerformed: false, reasons, estimatedPeakWithSourceBytes: peak,
    remainingCeilingBytes: CARGO_CHECK_PROFILE.ceilingBytes - peak,
    disposition: reasons.length ? 'Refuse this profile; review changed/missing inputs or use normal 4 GiB stage'
      : 'Conservative check-only estimate fits; independent coordinator review and exact-source stage lease remain required' };
}
