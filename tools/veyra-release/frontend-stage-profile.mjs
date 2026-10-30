import { createHash } from 'node:crypto';

const MiB = 1024 ** 2;
export const FRONTEND_PROFILE = Object.freeze({
  id: 'native-frontend-production-v1',
  reserveBytes: 2048 * MiB,
  sourceAllowanceBytes: 256 * MiB,
  ceilingBytes: 20 * 1024 ** 3,
  minimumFreeBytes: 15 * 1024 ** 3,
  estimate: Object.freeze({ distributionAndPublic: 512 * MiB, cache: 512 * MiB,
    simultaneousTemporaryAndReplacement: 512 * MiB, browserScopeEvidence: 64 * MiB,
    scopedLogsAndTemp: 64 * MiB, allocationAndUncertainty: 384 * MiB }),
});
export const FRONTEND_EXECUTION = Object.freeze({
  operation: 'programmatic-vite-build-with-browser-scope', mode: 'production',
  configLoader: 'runner', write: true, watch: false, sourcemap: false,
  entries: Object.freeze(['index.html', 'mini.html']), typecheck: 'reuse-matching-qualified-noEmit',
  moduleCapture: 'main-and-workers', contractsAlias: 'packages/contracts/src/index.ts',
  publicCopy: 'complete-unchanged', dependencyInstall: false, cargo: false,
});
const identities = ['sourceGraphSha256', 'installedInputsSha256', 'packageLockSha256',
  'configSha256', 'wrapperSha256', 'noticeScopeSha256', 'publicGraphSha256', 'nodeBinarySha256'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
const equal = (a, b) => same(canonical(a), canonical(b));
const bytes = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name} byte measurement`);
  return value;
};

/** Conservative planning review only. The coordinator owns approval, fresh measurements and execution. */
export function reviewFrontendStage(input) {
  if (!input || input.profile !== FRONTEND_PROFILE.id) throw new Error('Unknown frontend profile');
  for (const key of ['reserveBytes', 'ceilingBytes', 'minimumFreeBytes', 'sourceAllowanceBytes']) {
    if (Object.hasOwn(input, key)) throw new Error('Caller-selected policy values are not accepted');
  }
  const reasons = [];
  if (!equal(input.execution, FRONTEND_EXECUTION)) reasons.push('Execution differs from the reviewed frontend-only operation');
  const expected = input.reviewedInputs ?? {}, current = input.observedInputs ?? {};
  for (const key of identities) {
    if (!digest(expected[key]) || !digest(current[key]) || expected[key] !== current[key]) reasons.push(`Missing or changed ${key}`);
  }
  if (expected.platform !== 'win32' || current.platform !== 'win32' || expected.arch !== 'x64' || current.arch !== 'x64'
    || !/^24\./.test(current.nodeVersion ?? '') || expected.nodeVersion !== current.nodeVersion) reasons.push('Unreviewed runtime identity');
  const typecheck = input.typecheck ?? {};
  if (typecheck.exitCode !== 0 || typecheck.noEmit !== true || !digest(typecheck.receiptSha256)
    || typecheck.sourceGraphSha256 !== current.sourceGraphSha256
    || typecheck.installedInputsSha256 !== current.installedInputsSha256) reasons.push('Matching qualified noEmit receipt is absent');
  const assumptions = input.assumptions ?? {};
  for (const key of ['emptyPlainOutputs', 'immutableInstalledInputs', 'noAdditionalConfigOrPlugins',
    'sourceStylesRemainCssOnly', 'scopedEnvironment', 'exclusiveBuildLease', 'normalMixedGateUnchanged']) {
    if (assumptions[key] !== true) reasons.push(`Unverified assumption: ${key}`);
  }
  const observations = input.observations ?? {};
  // Growth envelopes are admission conditions for this estimate, not hard quotas.
  if (!Number.isSafeInteger(observations.webSourceBytes) || observations.webSourceBytes < 0 || observations.webSourceBytes > 16 * MiB
    || !Number.isSafeInteger(observations.publicBytes) || observations.publicBytes < 0 || observations.publicBytes > 8 * MiB) reasons.push('Source/public inputs exceed the reviewed estimate envelope');
  if (observations.previousDistributionBytes !== 23669726 || observations.previousCacheBytes !== 99280116) reasons.push('Prior measured production outputs are not identified');
  const a = input.allocation ?? {};
  const native = bytes(a.nativeBudgetBytes, 'native allocation');
  const linux = bytes(a.linuxAllocatedBytes, 'paired Linux allocation');
  const systemFree = bytes(a.systemFreeBytes, 'Windows free');
  const destinationFree = bytes(a.destinationFreeBytes, 'destination free');
  const total = native + linux + FRONTEND_PROFILE.reserveBytes + FRONTEND_PROFILE.sourceAllowanceBytes;
  if (!Number.isSafeInteger(total)) throw new Error('Allocation arithmetic overflow');
  if (total > FRONTEND_PROFILE.ceilingBytes) reasons.push('Peak estimate plus concurrent source allowance exceeds 20 GiB');
  const growth = FRONTEND_PROFILE.reserveBytes + FRONTEND_PROFILE.sourceAllowanceBytes;
  if (systemFree - growth < FRONTEND_PROFILE.minimumFreeBytes) reasons.push('Windows 15 GiB post-stage reserve would not survive');
  if (destinationFree - growth < FRONTEND_PROFILE.minimumFreeBytes) reasons.push('Destination 15 GiB post-stage reserve would not survive');
  if (a.freshForLease !== true) reasons.push('Fresh paired-root measurements for the exclusive lease are absent');
  return { schemaVersion: 1, profile: FRONTEND_PROFILE, eligibleForCoordinatorReview: reasons.length === 0,
    buildAuthorized: false, mutationPerformed: false, reasons, estimatedPeakWithSourceBytes: total,
    remainingCeilingBytes: FRONTEND_PROFILE.ceilingBytes - total,
    inputIdentitySha256: createHash('sha256').update(JSON.stringify(canonical(current))).digest('hex'),
    disposition: reasons.length ? 'Refuse this profile; use normal 4 GiB guard or resolve the stated drift/capacity condition'
      : 'Conservative frontend-only estimate fits; independent coordinator review and stage lease remain required' };
}
