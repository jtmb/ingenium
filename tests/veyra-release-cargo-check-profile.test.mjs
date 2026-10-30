import test from 'node:test';
import assert from 'node:assert/strict';
import { CARGO_CHECK_PROFILE as P, CARGO_CHECK_EXECUTION as E, reviewCargoCheckStage as review } from '../tools/veyra-release/cargo-check-stage-profile.mjs';
const MiB = 1024 ** 2;
function candidate() {
  const pins = Object.fromEntries(['lockSha256', 'manifestsSha256', 'toolchainDeclarationSha256', 'cargoBinarySha256',
    'rustcBinaryClosureSha256', 'encodedRustflagsSha256', 'remapperSha256', 'cargoConfigStateSha256',
    'sourceTargetCargoHomeIdentitySha256', 'dependencyFeaturesAndProfilesSha256', 'buildScriptInputsSha256', 'nativeBuildEnvironmentSha256'].map((key, i) => [key, i.toString(16).repeat(64)]));
  return { profile: P.id, execution: structuredClone(E), reviewedDependencyInputs: pins, observedDependencyInputs: { ...pins },
    frozenSourceSha256: 'b'.repeat(64), observedSourceSha256: 'b'.repeat(64),
    assumptions: { compiledDependencyInputsPresent: true, registryHostRlibsUnchanged: true, noFeatureOrDependencyGraphChange: true,
      noCargoConfigOrFlagOverride: true, samePhysicalSourceTargetCargoHome: true, scopedEnvironment: true,
      exclusiveBuildLease: true, normalFullBuildGuardUnchanged: true, noNewBuildScriptGenerators: true },
    observations: { registryRmetaBytes: 695954498, workspaceRmetaBytes: 129915884, buildOutputsBytes: 293691902,
      macroDllAndPdbBytes: 194718720, workspaceSourceBytes: 20848378,
      normalTwoPackageCheckSucceeded: true, checkCacheMatchesDeclarations: true },
    allocation: { nativeBudgetBytes: 11391497728, linuxAllocatedBytes: 7143284736,
      systemFreeBytes: 48 * 1024 ** 3, destinationFreeBytes: 600 * 1024 ** 3, freshForLease: true } };
}
test('complete simultaneous components total 2 GiB, source charged separately', () => {
  assert.equal(Object.values(P.estimate).reduce((a, b) => a + b), P.reserveBytes);
  assert.equal(P.reserveBytes, 2048 * MiB); assert.equal(P.sourceAllowanceBytes, 256 * MiB);
});
test('measured producer set fits proposal; reviewer never authorizes compiler execution', () => {
  const r = review(candidate()); assert.equal(r.eligibleForCoordinatorReview, true);
  assert.equal(r.remainingCeilingBytes, 524134912); assert.equal(r.buildAuthorized, false); assert.equal(r.mutationPerformed, false);
});
test('build/test/link/package/all-target/profile/feature/dependency and incremental command changes refuse', () => {
  for (const argv of [['build'], ['test'], [...E.argv, '--all-targets'], [...E.argv, '--release'], [...E.argv, '--features', 'test-support'], ['check', '-p', 'veyra-service']]) {
    const c = candidate(); c.execution.argv = argv; assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
  for (const patch of [{ CARGO_INCREMENTAL: '1' }, { CARGO_BUILD_JOBS: '2' }, { CARGO_NET_OFFLINE: 'false' },
    { explicitTarget: true }, { fullBuild: true }, { toolchain: '1.98.0' }, { extraRustflags: true }]) {
    const c = candidate(); Object.assign(c.execution, patch); assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
});
test('every declaration/compiler/flag/profile/config/alias/build-script identity must match', () => {
  for (const key of Object.keys(candidate().observedDependencyInputs)) {
    const c = candidate(); c.observedDependencyInputs[key] = 'f'.repeat(64); assert.equal(review(c).eligibleForCoordinatorReview, false, key);
  }
  const c = candidate(); c.reviewedDependencyInputs = {}; c.observedDependencyInputs = {}; assert.equal(review(c).eligibleForCoordinatorReview, false);
});
test('implementation-only workspace changes can be newly frozen without pretending old source is unchanged', () => {
  const c = candidate(); c.frozenSourceSha256 = c.observedSourceSha256 = 'c'.repeat(64);
  assert.equal(review(c).eligibleForCoordinatorReview, true);
  c.observedSourceSha256 = 'd'.repeat(64); assert.equal(review(c).eligibleForCoordinatorReview, false);
});
test('cold/missing host codegen inputs, new generators or graph differences refuse', () => {
  for (const key of Object.keys(candidate().assumptions)) {
    const c = candidate(); c.assumptions[key] = false; assert.equal(review(c).eligibleForCoordinatorReview, false, key);
  }
  for (const key of ['normalTwoPackageCheckSucceeded', 'checkCacheMatchesDeclarations']) {
    const c = candidate(); c.observations[key] = false; assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
});
test('observed producer envelopes are reviewed separately from retained linked/incremental bytes', () => {
  for (const [key, limit] of Object.entries({ registryRmetaBytes: 768 * MiB, workspaceRmetaBytes: 256 * MiB,
    buildOutputsBytes: 384 * MiB, macroDllAndPdbBytes: 192 * MiB, workspaceSourceBytes: 32 * MiB })) {
    const c = candidate(); c.observations[key] = limit; assert.equal(review(c).eligibleForCoordinatorReview, true);
    c.observations[key]++; assert.equal(review(c).eligibleForCoordinatorReview, false, key);
  }
});
test('starting inventory retains old incremental and test artifacts in cap arithmetic', () => {
  const c = candidate(); c.allocation.nativeBudgetBytes += 524134912;
  assert.equal(review(c).eligibleForCoordinatorReview, true); c.allocation.nativeBudgetBytes++;
  assert.equal(review(c).eligibleForCoordinatorReview, false);
});
test('both floors charge growth; stale lease measurement refuses', () => {
  for (const key of ['systemFreeBytes', 'destinationFreeBytes']) {
    const c = candidate(); c.allocation[key] = P.minimumFreeBytes + P.reserveBytes + P.sourceAllowanceBytes;
    assert.equal(review(c).eligibleForCoordinatorReview, true); c.allocation[key]--;
    assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
  const c = candidate(); c.allocation.freshForLease = false; assert.equal(review(c).eligibleForCoordinatorReview, false);
});
test('unknown policy and caller-selected ceiling/reserve refuse', () => {
  for (const key of ['reserveBytes', 'ceilingBytes', 'minimumFreeBytes', 'sourceAllowanceBytes']) {
    const c = candidate(); c[key] = 1; assert.throws(() => review(c), /Caller-selected/);
  }
  const c = candidate(); c.profile = 'full-build'; assert.throws(() => review(c), /Unknown/);
});
test('missing, negative, fractional and overflowing byte measurements refuse', () => {
  for (const value of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const c = candidate(); c.allocation.nativeBudgetBytes = value; assert.throws(() => review(c));
  }
  const c = candidate(); delete c.observations.registryRmetaBytes; assert.throws(() => review(c));
});
