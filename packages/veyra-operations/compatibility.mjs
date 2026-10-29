export const COMPATIBILITY_CHECKS = Object.freeze([
  'single-api-database-writer', 'migration-owner-unchanged', 'account-org-project-isolation',
  'installation-chat-defaults', 'jobs-event-queue-single-owner', 'scheduler-restart-recovery',
  'backup-download-integrity', 'isolated-restore', 'secret-ciphertext-compatible',
  'vault-step-up-and-consumer-denial', 'mail-oauth-callback', 'mail-sync-reconnect',
  'mail-send-known-outcome', 'provider-model-catalog', 'provider-auth-reconnect',
  'mcp-tool-visibility', 'protected-broker-denial', 'cloudflare-public-only',
]);

// This reducer consumes verifier receipts; it neither opens the DB nor owns auth.
export function operationsCompatibility({ candidateId, observations }) {
  if (typeof candidateId !== 'string' || !candidateId.trim() || !Array.isArray(observations)) throw new Error('Candidate and observations required');
  const seen = new Set();
  for (const row of observations) {
    if (!row || !COMPATIBILITY_CHECKS.includes(row.check) || seen.has(row.check)) throw new Error('Unknown or duplicate compatibility check');
    if (!['pass', 'fail', 'unknown', 'incomplete'].includes(row.status)) throw new Error('Invalid compatibility observation');
    seen.add(row.check);
  }
  const checks = COMPATIBILITY_CHECKS.map(check => {
    const row = observations.find(item => item.check === check);
    const status = !row || row.candidateId !== candidateId || row.fixture === true
      || typeof row.receiptSha256 !== 'string' || row.receiptSha256.length !== 64
      || [...row.receiptSha256].some(c => !'0123456789abcdef'.includes(c)) ? 'incomplete' : row.status;
    return { check, status, retryAllowed: false };
  });
  return { candidateId, status: checks.every(row => row.status === 'pass') ? 'compatible' : 'incomplete', checks };
}
