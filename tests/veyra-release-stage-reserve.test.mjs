import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { POLICY, reviewStageReserve } from '../tools/veyra-release/review-stage-reserve.mjs';

const observed = JSON.parse(readFileSync(new URL('../docs/workstreams/packaging/native-stage-observations.json', import.meta.url), 'utf8'));
const input = () => structuredClone(observed);

test('actual metadata inventory cannot fit the unchanged standard reservation', () => {
  const result = reviewStageReserve(input());
  assert.equal(result.measuredUsedBytes, 18518128128);
  assert.equal(result.maximumRecordedAdditionalBytes, 2956708352);
  assert.equal(result.additionalHeadroomForStandardBytes, 1338258944);
  assert.equal(result.standardReservationFitsRecordedInventory, false);
  assert.equal(result.buildAuthorized, false);
});

test('caller cannot provide a smaller reserve or enlarge the approved ceiling', () => {
  for (const delta of [{ reserveBytes: 1 }, { estimatedGrowthBytes: 1024 }, { proposedCeilingBytes: 24 * 1024 ** 3 }, { ceilingBytes: 24 * 1024 ** 3 }, { minimumFreeBytes: 1 }]) {
    assert.throws(() => reviewStageReserve({ ...input(), ...delta }));
  }
});

test('partial matching Cargo fingerprints do not prove desktop/full-graph freshness', () => {
  const result = reviewStageReserve(input());
  assert.ok(result.reasons.some(reason => reason.includes('both normal-gate packages')));
  assert.ok(result.reasons.some(reason => reason.includes('Disabled incremental')));
  assert.ok(result.reasons.some(reason => reason.includes('complete unit/build-script')));
  assert.ok(result.reasons.some(reason => reason.includes('peak trace')));
  assert.equal(result.smallerReserveProven, false);
});

test('final frontend size is never converted to a growth upper bound', () => {
  const next = input(); next.stage = 'frontend-only'; next.frontend.finalOutputBytes = 1;
  const result = reviewStageReserve(next);
  assert.ok(result.reasons.some(reason => reason.includes('not a peak-growth upper bound')));
  assert.ok(result.reasons.some(reason => reason.includes('cache was removed')));
  assert.equal(result.policy.standardGrowthBytes, 4 * 1024 ** 3);
  assert.equal(result.smallerReserveProven, false);
});

test('exact cap and free-space boundaries are preserved without authorizing execution', () => {
  const next = input(); next.allocation.nativeBudgetBytes = 8 * 1024 ** 3; next.allocation.linuxAllocatedBytes = 8 * 1024 ** 3;
  next.allocation.systemFreeBytes = 19 * 1024 ** 3; next.allocation.destinationFreeBytes = 19 * 1024 ** 3;
  assert.equal(reviewStageReserve(next).standardReservationFitsRecordedInventory, true);
  assert.equal(reviewStageReserve(next).buildAuthorized, false);
  next.allocation.linuxAllocatedBytes++; assert.equal(reviewStageReserve(next).standardReservationFitsRecordedInventory, false);
});

test('either filesystem floor blocks even when the task ceiling has room', () => {
  for (const key of ['systemFreeBytes', 'destinationFreeBytes']) {
    const next = input(); next.allocation.nativeBudgetBytes = 0; next.allocation.linuxAllocatedBytes = 0;
    next.allocation[key] = POLICY.minimumFreeBytes + POLICY.standardGrowthBytes - 1;
    assert.equal(reviewStageReserve(next).standardReservationFitsRecordedInventory, false);
  }
});

test('missing, fractional, negative and overflowing measurements refuse', () => {
  for (const value of [undefined, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const next = input(); next.allocation.nativeBudgetBytes = value;
    assert.throws(() => reviewStageReserve(next), /measurement/);
  }
  const next = input(); next.allocation.nativeBudgetBytes = Number.MAX_SAFE_INTEGER; next.allocation.linuxAllocatedBytes = 1;
  assert.throws(() => reviewStageReserve(next), /overflow/);
});

test('even caller-asserted perfect evidence cannot enable an unreviewed reduced profile', () => {
  const next = input(); next.stageAlignedPeakEvidence = true;
  next.cargo = { lastVerifiedPackages: ['veyra-service', 'veyra-desktop'], offline: true, jobs: 1, incrementalDisabled: true,
    dependencyPinsMatch: true, toolchainDeclarationsMatch: true, completeUnitAndBuildScriptCacheCertificate: true, compilerBinaryAndSourceAliasBound: true };
  const result = reviewStageReserve(next);
  assert.equal(result.smallerReserveProven, false);
  assert.equal(result.buildAuthorized, false);
  assert.ok(result.reasons.some(reason => reason.includes('No reduced reservation profile')));
});

test('CLI emits the actual refusal and cannot act as a build-authorization success', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('../tools/veyra-release/review-stage-reserve.mjs', import.meta.url));
  const evidence = fileURLToPath(new URL('../docs/workstreams/packaging/native-stage-observations.json', import.meta.url));
  const result = spawnSync(process.execPath, [cli, evidence], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.buildAuthorized, false);
  assert.equal(report.smallerReserveProven, false);
  assert.equal(report.additionalHeadroomForStandardBytes, 1338258944);
});
