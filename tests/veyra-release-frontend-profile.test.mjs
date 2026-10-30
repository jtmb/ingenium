import test from 'node:test';
import assert from 'node:assert/strict';
import { FRONTEND_PROFILE as P, FRONTEND_EXECUTION as E, reviewFrontendStage } from '../tools/veyra-release/frontend-stage-profile.mjs';
const MiB = 1024 ** 2;
function candidate() {
  const pins = Object.fromEntries(['sourceGraphSha256', 'installedInputsSha256', 'packageLockSha256', 'configSha256',
    'wrapperSha256', 'noticeScopeSha256', 'publicGraphSha256', 'nodeBinarySha256'].map((key, index) => [key, String(index).repeat(64)]));
  Object.assign(pins, { platform: 'win32', arch: 'x64', nodeVersion: '24.18.0' });
  return { profile: P.id, execution: structuredClone(E), reviewedInputs: pins, observedInputs: { ...pins },
    typecheck: { exitCode: 0, noEmit: true, receiptSha256: 'a'.repeat(64), sourceGraphSha256: pins.sourceGraphSha256, installedInputsSha256: pins.installedInputsSha256 },
    assumptions: { emptyPlainOutputs: true, immutableInstalledInputs: true, noAdditionalConfigOrPlugins: true,
      sourceStylesRemainCssOnly: true, scopedEnvironment: true, exclusiveBuildLease: true, normalMixedGateUnchanged: true },
    observations: { webSourceBytes: 6000294, publicBytes: 1986352, previousDistributionBytes: 23669726, previousCacheBytes: 99280116 },
    allocation: { nativeBudgetBytes: 11391497728, linuxAllocatedBytes: 7143284736,
      systemFreeBytes: 48 * 1024 ** 3, destinationFreeBytes: 600 * 1024 ** 3, freshForLease: true } };
}
test('fixed estimate components total 2 GiB, with separate 256 MiB source allowance', () => {
  assert.equal(Object.values(P.estimate).reduce((a, b) => a + b, 0), 2 * 1024 ** 3);
  assert.equal(P.reserveBytes, 2 * 1024 ** 3); assert.equal(P.sourceAllowanceBytes, 256 * MiB);
});
test('reported coordinator inventory fits estimate but never grants a build', () => {
  const r = reviewFrontendStage(candidate()); assert.equal(r.eligibleForCoordinatorReview, true);
  assert.equal(r.estimatedPeakWithSourceBytes, 20950701568); assert.equal(r.remainingCeilingBytes, 524134912);
  assert.equal(r.buildAuthorized, false); assert.equal(r.mutationPerformed, false);
});
test('every source/runtime/dependency identity must match', () => {
  for (const key of Object.keys(candidate().observedInputs)) {
    const c = candidate(); c.observedInputs[key] = key.endsWith('Sha256') ? 'f'.repeat(64) : 'changed';
    assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false, key);
  }
});
test('empty identity sets and missing noEmit qualification refuse', () => {
  const c = candidate(); c.reviewedInputs = {}; c.observedInputs = {};
  assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
  for (const patch of [{ exitCode: 1 }, { noEmit: false }, { receiptSha256: '' }, { sourceGraphSha256: 'b'.repeat(64) }, { installedInputsSha256: 'c'.repeat(64) }]) {
    const v = candidate(); Object.assign(v.typecheck, patch); assert.equal(reviewFrontendStage(v).eligibleForCoordinatorReview, false);
  }
});
test('mixed/Cargo/npm/typechecking/watch/custom plugin command changes refuse', () => {
  for (const patch of [{ cargo: true }, { dependencyInstall: true }, { typecheck: 'rerun' }, { watch: true }, { write: false }, { extraPlugin: true }, { mode: 'development' }, { entries: ['index.html'] }]) {
    const c = candidate(); Object.assign(c.execution, patch); assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
  }
});
test('all planning assumptions must be verified, without imposing a quota prerequisite', () => {
  for (const key of Object.keys(candidate().assumptions)) {
    const c = candidate(); c.assumptions[key] = false; assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false, key);
  }
});
test('cap includes stage and source growth; boundary comparison is inclusive', () => {
  const c = candidate(); c.allocation.nativeBudgetBytes += 524134912;
  assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, true);
  c.allocation.nativeBudgetBytes += 1; assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
});
test('both free-space floors include estimated growth and measurements must be fresh', () => {
  for (const field of ['systemFreeBytes', 'destinationFreeBytes']) {
    const c = candidate(); c.allocation[field] = P.minimumFreeBytes + P.reserveBytes + P.sourceAllowanceBytes;
    assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, true);
    c.allocation[field] -= 1; assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
  }
  const c = candidate(); c.allocation.freshForLease = false; assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
});
test('unknown policy, missing/unsafe measurements and caller-selected reserves refuse', () => {
  for (const key of ['reserveBytes', 'ceilingBytes', 'minimumFreeBytes', 'sourceAllowanceBytes']) {
    const c = candidate(); c[key] = 1; assert.throws(() => reviewFrontendStage(c), /Caller-selected/);
  }
  for (const value of [undefined, -1, Number.MAX_SAFE_INTEGER, NaN]) {
    const c = candidate(); c.allocation.nativeBudgetBytes = value; assert.throws(() => reviewFrontendStage(c));
  }
  const c = candidate(); c.profile = 'cargo'; assert.throws(() => reviewFrontendStage(c), /Unknown/);
});
test('new style/config/assets or missing prior observation require a new estimate review', () => {
  for (const patch of [{ webSourceBytes: 16 * MiB + 1 }, { publicBytes: 8 * MiB + 1 }, { previousCacheBytes: 0 }, { previousDistributionBytes: undefined }]) {
    const c = candidate(); Object.assign(c.observations, patch); assert.equal(reviewFrontendStage(c).eligibleForCoordinatorReview, false);
  }
});
