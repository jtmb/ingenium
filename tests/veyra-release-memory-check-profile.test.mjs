import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMemoryLock, verifyMemoryLockDelta } from '../tools/veyra-release/memory-lock-delta.mjs';
import { MEMORY_CHECK_POLICY as P, reviewMemoryCheckStage as review } from '../tools/veyra-release/memory-check-profile.mjs';
import { CARGO_CHECK_EXECUTION as E, CARGO_CHECK_PROFILE as V1 } from '../tools/veyra-release/cargo-check-stage-profile.mjs';
import { CHECK, validateReview } from '../tools/veyra-release/native-reviewed-cargo-check.mjs';
import { POLICY } from '../tools/veyra-release/review-stage-reserve.mjs';
const MiB = 1024 ** 2;
function candidate() {
  return { profile: P.profile, execution: structuredClone(E), declarations: Object.fromEntries(P.manifests.map(row => [row.path, row.afterSha256])),
    baselineLockSha256: P.baselineLockSha256, actualResolvedLockSha256: P.expectedResolvedLockSha256, actualLockResolvedByCoordinator: true,
    frozenSourceSha256: 'a'.repeat(64), observedSourceSha256: 'a'.repeat(64),
    featureWitnesses: P.featureWitnesses.map(row => ({ ...structuredClone(row), packageVersion: ({ serde: '1.0.229', serde_json: '1.0.151', sha2: '0.10.9', serde_derive: '1.0.229' })[row.package], compiledArtifactPresent: true })),
    assumptions: { sameRegistryAndHostGraph: true, onlyMemoryWorkspaceAddition: true, compatibleCompiledHostInputs: true, noNewGenerator: true,
      sameToolchainFlagsConfigAndPhysicalAliases: true, scopedEnvironment: true, exclusiveBuildLease: true, v1AndGenericGuardUnchanged: true },
    observations: { registryRmetaBytes: 695954498, workspaceRmetaBytes: 129915884, buildOutputsBytes: 293691902, macroDllAndPdbBytes: 194718720,
      totalWorkspaceSourceBytes: 20848378 + P.newLibrarySourceBytes, memoryLibrarySourceBytes: P.newLibrarySourceBytes },
    allocation: { nativeBudgetBytes: 11391497728, linuxAllocatedBytes: 7143284736, systemFreeBytes: 48 * 1024 ** 3,
      destinationFreeBytes: 600 * 1024 ** 3, freshForLease: true } };
}
function tinyLock() {
  const registry = (name, version) => `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${'a'.repeat(64)}"\n\n`;
  return '# CPU-only graph fixture, not actual Cargo resolution\nversion = 4\n\n'
    + registry('serde', '1.0.229') + registry('serde_json', '1.0.151') + registry('sha2', '0.10.9')
    + '[[package]]\nname = "veyra-adapters"\nversion = "0.3.0-preview.1"\ndependencies = [\n "serde",\n "serde_json",\n "sha2",\n]\n\n'
    + '[[package]]\nname = "veyra-service"\nversion = "0.3.0-preview.1"\ndependencies = [\n "serde",\n "veyra-adapters",\n]\n';
}
test('v2 admits only the pinned Memory addition with actual resolved lock and unchanged conservative budget', () => {
  const r = review(candidate()); assert.equal(r.eligibleForCoordinatorReview, true); assert.equal(r.stageBytes, 2048 * MiB);
  assert.equal(r.concurrentSourceBytes, 256 * MiB); assert.equal(r.buildAuthorized, false); assert.equal(r.v1Modified, false);
  assert.equal(r.newWorkspaceMetadataExpected, true); assert.equal(r.newRegistryOrHostGraphAllowed, false);
});
test('all ten manifest pins and their exact path set are required; no blanket declaration bypass', () => {
  for (const key of Object.keys(candidate().declarations)) { const c = candidate(); c.declarations[key] = 'f'.repeat(64); assert.equal(review(c).eligibleForCoordinatorReview, false, key); }
  const c = candidate(); c.declarations['crates/other/Cargo.toml'] = 'f'.repeat(64); assert.equal(review(c).eligibleForCoordinatorReview, false);
  const missing = candidate(); delete missing.declarations['crates/veyra-memory/Cargo.toml']; assert.equal(review(missing).eligibleForCoordinatorReview, false);
});
test('projected hash without actual Root resolution cannot qualify, and registry/version/source changes refuse', () => {
  for (const patch of [{ actualLockResolvedByCoordinator: false }, { actualResolvedLockSha256: 'f'.repeat(64) }, { baselineLockSha256: 'f'.repeat(64) }]) {
    const c = candidate(); Object.assign(c, patch); assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
});
test('feature/default/derive/ASM/host profile/compiler/flags/artifact witness changes refuse', () => {
  for (const patch of [{ features: ['default'] }, { features: ['default', 'std', 'asm'] }, { profile: 'other' }, { compiler: 'other' },
    { flagsSha256: 'f'.repeat(64) }, { fingerprintSha256: 'f'.repeat(64) }, { compiledArtifactPresent: false }, { packageVersion: '0.11.0' }, { unit: 'new-unit' }]) {
    const c = candidate(); Object.assign(c.featureWitnesses.find(row => row.package === 'sha2'), patch); assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
  const c = candidate(); c.featureWitnesses = c.featureWitnesses.filter(row => row.package !== 'serde_derive'); assert.equal(review(c).eligibleForCoordinatorReview, false);
});
test('extra uuid or any new dependency/host graph is outside this immutable Memory proposal', () => {
  assert.equal(P.uuidDelta.startsWith('None'), true);
  const c = candidate(); c.featureWitnesses.push({ package: 'uuid' }); assert.equal(review(c).eligibleForCoordinatorReview, false);
  for (const key of Object.keys(candidate().assumptions)) { const c = candidate(); c.assumptions[key] = false; assert.equal(review(c).eligibleForCoordinatorReview, false, key); }
});
test('Source must be current and memory/workspace producer envelopes remain reviewed', () => {
  const c = candidate(); c.observedSourceSha256 = 'b'.repeat(64); assert.equal(review(c).eligibleForCoordinatorReview, false);
  for (const [key, value] of Object.entries({ memoryLibrarySourceBytes: 128 * 1024 + 1, totalWorkspaceSourceBytes: 32 * MiB + 1, workspaceRmetaBytes: 256 * MiB + 1 })) {
    const c = candidate(); c.observations[key] = value; assert.equal(review(c).eligibleForCoordinatorReview, false);
  }
});
test('check-only argv, cap, floors, lease and caller policy restrictions remain', () => {
  const c = candidate(); c.execution.argv = ['build']; assert.equal(review(c).eligibleForCoordinatorReview, false);
  const a = candidate(); a.allocation.nativeBudgetBytes += 524134913; assert.equal(review(a).eligibleForCoordinatorReview, false);
  const b = candidate(); b.allocation.systemFreeBytes = 15 * 1024 ** 3; assert.equal(review(b).eligibleForCoordinatorReview, false);
  const d = candidate(); d.allocation.freshForLease = false; assert.equal(review(d).eligibleForCoordinatorReview, false);
  for (const key of ['reserveBytes', 'ceilingBytes', 'allowedManifests', 'allowedRegistryPackages']) { const c = candidate(); c[key] = 1; assert.throws(() => review(c), /bypass/); }
});
test('v1 fixed receipt rejects v2; original pure policy and generic4GiB unchanged', () => {
  assert.equal(V1.id, 'native-cargo-check-existing-inputs-v1'); assert.equal(CHECK.profile, V1.id); assert.equal(POLICY.standardGrowthBytes, 4 * 1024 ** 3);
  assert.throws(() => validateReview({ profile: P.profile }, {}, 'a'.repeat(40), 'b'.repeat(64)), /fixed-profile/);
  assert.equal(Object.isFrozen(P.manifests), true); assert.equal(Object.isFrozen(P.featureWitnesses[0].features), true);
});
test('exact lock transform adds one package and only two existing workspace edges', () => {
  const before = tinyLock(), after = projectMemoryLock(before).toString('utf8');
  const added = after.match(/name = "veyra-memory"/g); assert.equal(added.length, 1);
  assert.equal((after.match(/ "veyra-memory",/g) ?? []).length, 2);
  assert(after.includes('name = "veyra-memory"\nversion = "0.1.0"\ndependencies = [\n "serde",\n "serde_json",\n "sha2",\n]'));
  assert.equal(verifyMemoryLockDelta(before, after).registryRecordsUnchanged, true);
});
test('lock delta validator refuses changed registry checksum/version, extra package/edge/source and formatting drift', () => {
  const before = tinyLock(), after = projectMemoryLock(before).toString('utf8');
  for (const changed of [after.replace('1.0.229', '1.0.230'), after.replace('checksum = "a', 'checksum = "b'),
    after.replace(' "sha2",', ' "sha2",\n "uuid",'), after + '\n[[package]]\nname = "extra"\nversion = "1"\n', after.replace('name = "veyra-memory"', 'source = "git+other"\nname = "veyra-memory"'), after.replace('version = 4', 'version = 3')]) assert.throws(() => verifyMemoryLockDelta(before, changed), /delta exceeds/);
});
test('lock projection refuses preexisting memory, ambiguous/changed packages and unsupported baseline', () => {
  const before = tinyLock();
  assert.throws(() => projectMemoryLock(before.replace('1.0.229', '1.0.230')), /resolution changed/);
  assert.throws(() => projectMemoryLock(before + '\n[[package]]\nname = "serde"\nversion = "1.0.229"\n'), /ambiguous/);
  assert.throws(() => projectMemoryLock(projectMemoryLock(before)), /already present/);
  assert.throws(() => projectMemoryLock(before.replaceAll('\n', '\r\n')), /LF/);
});
