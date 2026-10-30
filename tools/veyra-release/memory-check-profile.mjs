import { readFileSync } from 'node:fs';
import { CARGO_CHECK_PROFILE as BASE, CARGO_CHECK_EXECUTION } from './cargo-check-stage-profile.mjs';
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
export const MEMORY_CHECK_POLICY = freeze(JSON.parse(readFileSync(new URL('./memory-check-profile.lock.json', import.meta.url), 'utf8')));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bytes = (value, label) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} bytes`); return value; };
/** New narrow planning profile. It neither changes v1 nor authorizes a compiler. */
export function reviewMemoryCheckStage(input) {
  const P = MEMORY_CHECK_POLICY;
  if (!input || input.profile !== P.profile) throw new Error('Exact Memory v2 profile required');
  for (const key of ['reserveBytes', 'ceilingBytes', 'minimumFreeBytes', 'sourceAllowanceBytes', 'allowedManifests', 'allowedRegistryPackages']) if (Object.hasOwn(input, key)) throw new Error('Caller policy/manifest bypass is not accepted');
  const reasons = [];
  if (!same(input.execution, CARGO_CHECK_EXECUTION)) reasons.push('Exact existing native check-only operation required');
  const observed = input.declarations ?? {}, names = P.manifests.map(row => row.path).sort();
  if (!same(Object.keys(observed).sort(), names) || P.manifests.some(row => observed[row.path] !== row.afterSha256)) reasons.push('Only the exact pinned Memory workspace declaration delta is allowed');
  if (input.baselineLockSha256 !== P.baselineLockSha256 || input.actualResolvedLockSha256 !== P.expectedResolvedLockSha256 || input.actualLockResolvedByCoordinator !== true) reasons.push('Actual coordinator-resolved lock must match the narrow expected graph; projection alone is not resolution');
  if (!sha(input.frozenSourceSha256) || input.frozenSourceSha256 !== input.observedSourceSha256) reasons.push('Current integrated workspace Source is not frozen/matching');
  const witnesses = input.featureWitnesses;
  if (!Array.isArray(witnesses) || !same(witnesses.map(row => row.package).sort(), P.featureWitnesses.map(row => row.package).sort())) reasons.push('Exact compatible dependency/derive witness set required');
  for (const expected of P.featureWitnesses) {
    const row = Array.isArray(witnesses) ? witnesses.find(value => value.package === expected.package) : undefined;
    if (!row || !Array.isArray(row.features) || !expected.requiredFeatures.every(name => row.features.includes(name))
      || row.features.some(name => !expected.allowedFeatures.includes(name)) || !same([...row.features].sort(), [...expected.features].sort())
      || row.unit !== expected.unit || row.fingerprintSha256 !== expected.fingerprintSha256 || row.compiledArtifact !== expected.compiledArtifact || row.artifactBytes !== expected.artifactBytes
      || row.compiler !== expected.compiler || row.profile !== expected.profile
      || row.flagsSha256 !== expected.flagsSha256 || row.compiledArtifactPresent !== true || row.packageVersion !== ({ serde: '1.0.229', serde_json: '1.0.151', sha2: '0.10.9', serde_derive: '1.0.229' })[expected.package]) reasons.push(`Missing/cold/drifted compiled feature witness: ${expected.package}`);
  }
  for (const key of ['sameRegistryAndHostGraph', 'onlyMemoryWorkspaceAddition', 'compatibleCompiledHostInputs', 'noNewGenerator', 'sameToolchainFlagsConfigAndPhysicalAliases',
    'scopedEnvironment', 'exclusiveBuildLease', 'v1AndGenericGuardUnchanged']) if (input.assumptions?.[key] !== true) reasons.push(`Unverified assumption: ${key}`);
  for (const [key, limit] of Object.entries({ registryRmetaBytes: 768 * 1024 ** 2, workspaceRmetaBytes: 256 * 1024 ** 2,
    buildOutputsBytes: 384 * 1024 ** 2, macroDllAndPdbBytes: 192 * 1024 ** 2, totalWorkspaceSourceBytes: 32 * 1024 ** 2, memoryLibrarySourceBytes: 128 * 1024 })) {
    if (bytes(input.observations?.[key], key) > limit) reasons.push(`${key} exceeds reviewed envelope`);
  }
  const a = input.allocation ?? {}, growth = BASE.reserveBytes + BASE.sourceAllowanceBytes;
  const peak = bytes(a.nativeBudgetBytes, 'native allocation') + bytes(a.linuxAllocatedBytes, 'paired Linux allocation') + growth;
  if (!Number.isSafeInteger(peak)) throw new Error('Allocation overflow');
  if (peak > BASE.ceilingBytes) reasons.push('Memory check estimate and concurrent Source exceed 20 GiB');
  for (const key of ['systemFreeBytes', 'destinationFreeBytes']) if (bytes(a[key], key) - growth < BASE.minimumFreeBytes) reasons.push(`${key} cannot retain 15 GiB`);
  if (a.freshForLease !== true) reasons.push('Fresh paired-root measurements for exclusive lease required');
  return { schemaVersion: 1, profile: P.profile, extendsEstimate: P.extends, stageBytes: BASE.reserveBytes, concurrentSourceBytes: BASE.sourceAllowanceBytes,
    estimatedPeakWithSourceBytes: peak, remainingCeilingBytes: BASE.ceilingBytes - peak, reasons, eligibleForCoordinatorReview: reasons.length === 0,
    newRegistryOrHostGraphAllowed: false, newWorkspaceMetadataExpected: true, v1Modified: false, buildAuthorized: false, mutationPerformed: false,
    disposition: reasons.length ? 'Refuse v2; reconcile actual lock/input drift or use separately reviewed normal 4 GiB stage' : 'Narrow Memory graph fits conservative existing estimate; independent canonical v2 integration and execution still required' };
}
