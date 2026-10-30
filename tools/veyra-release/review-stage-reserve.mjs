import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const POLICY = Object.freeze({ ceilingBytes: 20 * 1024 ** 3, minimumFreeBytes: 15 * 1024 ** 3, standardGrowthBytes: 4 * 1024 ** 3 });
const bytes = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Missing or invalid byte measurement: ' + label);
  return value;
};

/** Read-only review. It cannot grant a lease, change a guard or choose a reserve. */
export function reviewStageReserve(input) {
  if (!input || !['cached-cargo-source-check', 'frontend-only'].includes(input.stage)) throw new Error('Known stage required');
  if (Object.hasOwn(input, 'reserveBytes') || Object.hasOwn(input, 'estimatedGrowthBytes') || Object.hasOwn(input, 'proposedCeilingBytes')) throw new Error('Caller-selected reserve or ceiling is not accepted');
  if (input.ceilingBytes !== undefined && input.ceilingBytes !== POLICY.ceilingBytes) throw new Error('The approved ceiling remains 20 GiB');
  if (input.minimumFreeBytes !== undefined && input.minimumFreeBytes !== POLICY.minimumFreeBytes) throw new Error('The free-space floor remains 15 GiB');
  const allocation = input.allocation ?? {};
  const native = bytes(allocation.nativeBudgetBytes, 'native'), linux = bytes(allocation.linuxAllocatedBytes, 'Linux');
  const systemFree = bytes(allocation.systemFreeBytes, 'Windows C: free'), destinationFree = bytes(allocation.destinationFreeBytes, 'destination free');
  const used = native + linux;
  if (!Number.isSafeInteger(used)) throw new Error('Allocation byte total overflow');
  const headroom = {
    ceiling: Math.max(0, POLICY.ceilingBytes - used),
    system: Math.max(0, systemFree - POLICY.minimumFreeBytes),
    destination: Math.max(0, destinationFree - POLICY.minimumFreeBytes),
  };
  const available = Math.min(headroom.ceiling, headroom.system, headroom.destination);
  const reasons = [];
  if (input.normalGatePreserved !== true) reasons.push('Normal source gate has not been preserved');
  if (input.stage === 'cached-cargo-source-check') {
    const cargo = input.cargo ?? {};
    const packages = Array.isArray(cargo.lastVerifiedPackages) ? [...cargo.lastVerifiedPackages].sort() : [];
    if (JSON.stringify(packages) !== JSON.stringify(['veyra-desktop', 'veyra-service'])) reasons.push('Prior check does not cover both normal-gate packages');
    if (cargo.offline !== true || cargo.jobs !== 1) reasons.push('Offline one-job execution identity is unverified');
    if (cargo.incrementalDisabled !== true) reasons.push('Disabled incremental mode was not recorded for the matching cache');
    if (cargo.dependencyPinsMatch !== true || cargo.toolchainDeclarationsMatch !== true) reasons.push('Dependency/toolchain identity is not proven');
    if (cargo.completeUnitAndBuildScriptCacheCertificate !== true) reasons.push('Matching partial fingerprints do not prove complete unit/build-script freshness');
    if (cargo.compilerBinaryAndSourceAliasBound !== true) reasons.push('Actual compiler binary and source/target alias identities are not bound');
  } else {
    const frontend = input.frontend ?? {};
    if (frontend.identicalInputGraph !== true) reasons.push('Current frontend source/config/plugin graph differs or is unverified');
    if (frontend.emptyDeclaredOutputs !== true || frontend.readonlyDependenciesQualified !== true) reasons.push('Declared empty outputs and exact read-only dependencies need qualification');
    if (frontend.cacheRetained !== true) reasons.push('Prior frontend cache was removed; a cached profile cannot be assumed');
    if (frontend.finalOutputBytes !== undefined) bytes(frontend.finalOutputBytes, 'observed final frontend outputs');
    reasons.push('Final dist/cache sizes are observations, not a peak-growth upper bound');
  }
  if (input.stageAlignedPeakEvidence !== true) reasons.push('No stage-aligned conservative peak trace/bound is recorded');
  // This implementation intentionally contains no reduced profile: current
  // evidence does not justify one. New proof requires a separately reviewed policy.
  reasons.push('No reduced reservation profile is qualified by this review');
  return { schemaVersion: 1, stage: input.stage, policy: POLICY, measuredUsedBytes: used,
    recordedHeadroomBytes: headroom, maximumRecordedAdditionalBytes: available,
    standardReservationFitsRecordedInventory: available >= POLICY.standardGrowthBytes,
    additionalHeadroomForStandardBytes: Math.max(0, POLICY.standardGrowthBytes - available),
    smallerReserveProven: false, reasons,
    disposition: 'Retain the normal 4 GiB reservation; unknown/cold stages refuse or use the normal guard',
    buildAuthorized: false, mutationPerformed: false,
    nextAction: 'Coordinator reviews missing evidence or remeasures after independently authorized work; no cap/floor relaxation or protected cleanup retry' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node review-stage-reserve.mjs OBSERVED_STAGE_EVIDENCE_JSON');
    const report = reviewStageReserve(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.smallerReserveProven ? 0 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
