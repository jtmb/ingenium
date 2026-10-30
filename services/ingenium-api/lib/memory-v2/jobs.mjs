import { createHash } from 'node:crypto';
import { scopeKey, MemoryError } from './lifecycle.mjs';

/** Invoked by the existing Jobs worker under its existing lease; creates no queue,
 * timer, transcript store or provider client. extract/minimize are qualified API adapters.
 */
export async function runMemoryExtraction({ memory, scope, chatId, operationId, sourceRefs, model, leaseValid, quota, extract, minimize, sourceVerification }) {
  if (![leaseValid, quota, extract, minimize].every((value) => typeof value === 'function') || typeof model !== 'string' || !model.trim()) throw new MemoryError('INVALID_ADAPTER');
  if (sourceVerification !== undefined && (!sourceVerification || typeof sourceVerification.refresh !== 'function'
    || typeof sourceVerification.withVerifiedSources !== 'function')) throw new MemoryError('INVALID_ADAPTER');
  const verified = async (work) => {
    if (!sourceVerification) return work();
    await sourceVerification.refresh();
    if (leaseValid() !== true) throw new MemoryError('LEASE_REVOKED');
    return sourceVerification.withVerifiedSources(work);
  };
  const existing = memory.operation(scope, operationId);
  if (existing) {
    const refs = sourceRefs.map(({ id, contentHash }) => ({ id, contentHash })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const jobHash = createHash('sha256').update(JSON.stringify([scopeKey(scope), chatId, refs, model])).digest('hex');
    if (existing.operation !== 'recall' || existing.jobHash !== jobHash) throw new MemoryError('OPERATION_CONFLICT');
    return { status: 'reconciled', receipt: existing };
  }
  if (leaseValid() !== true) throw new MemoryError('LEASE_REVOKED');
  const { admission, processed } = await verified(() => {
    const admission = memory.admit(scope, chatId, sourceRefs);
    return { admission, processed: memory.processedExtraction(scope, admission) };
  });
  if (processed) return { status: 'already-processed', memoryId: processed.memoryId };
  const budget = quota(model);
  if (budget !== 'available') return { status: 'deferred', reason: budget === 'exhausted' ? 'quota-exhausted' : 'quota-unknown' };
  const candidate = await extract({ scope, admission, model, maxOutputBytes: 8192 });
  if (typeof candidate !== 'string' || Buffer.byteLength(candidate, 'utf8') > 8192) throw new MemoryError('INVALID_CANDIDATE');
  const content = await minimize(candidate, { scope, admission });
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 8192) throw new MemoryError('INVALID_CANDIDATE');
  if (leaseValid() !== true) throw new MemoryError('LEASE_REVOKED');
  // Re-admission rechecks current ownership/exclusion and transcript hash after inference.
  return verified(() => {
    const current = memory.admit(scope, chatId, sourceRefs);
    if (current.inputHash !== admission.inputHash || current.policyRevision !== admission.policyRevision || current.chatRevision !== admission.chatRevision) throw new MemoryError('STALE_ADMISSION');
    return { status: 'committed', ...memory.commitRecall(scope, { operationId, admission, content, model }) };
  });
}
