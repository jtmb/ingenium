export const RELEASE_GATES = Object.freeze({
  'frozen-suite-integrity': { platforms: ['windows', 'linux'], kind: 'provenance' },
  'effective-runtime-context-lock': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'patch-tool-test-provenance': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'independent-performance': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'context-compaction-vision': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'windows-selected-app-cancel': { platforms: ['windows'], kind: 'runtime' },
  'source-provenance': { platforms: ['windows', 'linux'], kind: 'provenance' },
  'payload-boundary': { platforms: ['windows', 'linux'], kind: 'provenance' },
  'license-signing-update-rollback': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'api-auth-isolation': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'operations-compatibility': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'backup-isolated-restore': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'mail-provider-vault': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'brain-fresh-process': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'visual-contract': { platforms: ['windows', 'linux'], kind: 'visual' },
  'browser-selected-target': { platforms: ['windows', 'linux'], kind: 'runtime' },
  'windows-lifecycle': { platforms: ['windows'], kind: 'runtime' },
  'windows-native-wsl-terminal-reconnect': { platforms: ['windows'], kind: 'runtime' },
  'windows-engine-preservation': { platforms: ['windows'], kind: 'preservation' },
  'cluster-ingress-auth-digest': { platforms: ['linux'], kind: 'runtime' },
  'cluster-persistence-restart-rollback': { platforms: ['linux'], kind: 'runtime' },
  'linux-engine-exclusion': { platforms: ['linux'], kind: 'provenance' },
  'cleanup-reconciliation': { platforms: ['windows', 'linux'], kind: 'cleanup' },
});

function hex(value, length) {
  return typeof value === 'string' && value.length === length && [...value].every(c => '0123456789abcdef'.includes(c));
}

export function evaluateRelease({ candidate, evidence, acceptance }) {
  if (!candidate || !['windows', 'linux'].includes(candidate.platform)
      || !hex(candidate.appRevision, 40) || !hex(candidate.nativeRevision, 40)
      || !hex(candidate.sourceSha256, 64) || !hex(candidate.artifactSha256, 64)) throw new Error('Exact candidate identities required');
  if (!Array.isArray(evidence)) throw new Error('Evidence list required');
  const issues = [];
  if (!acceptance || acceptance.featureDispositions !== 74 || acceptance.views !== 47
      || acceptance.settings !== 20 || acceptance.windowsRows !== 11
      || acceptance.originalContractSha256 !== acceptance.retainedContractSha256
      || !hex(acceptance.originalContractSha256, 64)) issues.push('Original acceptance inventory or hashes not preserved');
  const seen = new Set();
  for (const row of evidence) {
    if (!row || !Object.hasOwn(RELEASE_GATES, row.gate) || seen.has(row.gate)) throw new Error('Unknown or duplicate qualification gate');
    seen.add(row.gate);
    if (!['pass', 'fail', 'incomplete'].includes(row.status)) throw new Error('Invalid evidence status');
  }
  const gates = Object.entries(RELEASE_GATES).filter(([, rule]) => rule.platforms.includes(candidate.platform)).map(([gate, rule]) => {
    const row = evidence.find(item => item.gate === gate);
    let reason = 'missing evidence';
    if (row) {
      const matches = ['platform', 'appRevision', 'nativeRevision', 'sourceSha256', 'artifactSha256'].every(key => row.subject?.[key] === candidate[key]);
      if (!matches) reason = 'evidence belongs to a different candidate';
      else if (row.status !== 'pass') reason = row.status;
      else if (row.kind !== rule.kind || row.fixture === true) reason = 'evidence does not qualify this gate';
      else if (!hex(row.receiptSha256, 64)) reason = 'missing immutable evidence receipt';
      else reason = null;
    }
    return { gate, status: reason === null ? 'pass' : reason === 'fail' ? 'fail' : 'incomplete', reason, observedStatus: row?.status ?? 'missing' };
  });
  return { schemaVersion: 1, candidate, status: issues.length === 0 && gates.every(row => row.status === 'pass') ? 'qualified' : gates.some(row => row.status === 'fail') ? 'fail' : 'incomplete',
    issues, gates, fullProductAcceptance: 'coordinator-owned' };
}
