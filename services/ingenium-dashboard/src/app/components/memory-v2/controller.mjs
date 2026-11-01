const initialPolicy = () => ({ revision: 0, enabled: false, generate: false, useMemory: false, externalContext: false });
const initialChat = () => ({ revision: 0, useMemory: false, contribute: false });
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
function policy(value, fields) {
  if (!value || !validRevision(value.revision) || fields.some((field) => typeof value[field] !== 'boolean')) throw new TypeError('Invalid memory policy response');
  return Object.freeze(Object.fromEntries(['revision', ...fields].map((field) => [field, value[field]])));
}
function identity(value) {
  if (!value || ['scopeKey', 'scopeHash', 'chatId', 'bindingHash'].some((field) => typeof value[field] !== 'string' || !value[field].trim()) || !validRevision(value.bindingEpoch)) throw new TypeError('Invalid memory binding');
  return Object.freeze(Object.fromEntries(['scopeKey', 'scopeHash', 'chatId', 'bindingHash', 'bindingEpoch'].map((field) => [field, value[field]])));
}
const same = (a, b) => a && b && ['scopeKey', 'scopeHash', 'chatId', 'bindingHash', 'bindingEpoch'].every((field) => a[field] === b[field]);

/** API/draft-journal adapters remain the only persistence owners. The controller
 * journals operation identity before sending and never automatically retries a write.
 */
export function createMemoryController({ api, journal, newOperationId = () => `memory-${crypto.randomUUID()}` }) {
  if (!api || !journal || !['read', 'change', 'operation'].every((field) => typeof api[field] === 'function')
    || !['get', 'set', 'remove'].every((field) => typeof journal[field] === 'function')) throw new TypeError('Memory controller adapters are required');
  const listeners = new Set(), inFlight = new Map(); let current = null, epoch = 0, readEpoch = 0, disposed = false;
  let state = Object.freeze({ scopeKey: '', chatId: '', available: false, canChange: false, loading: false, pending: false, policy: initialPolicy(), chat: initialChat() });
  const publish = (patch) => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };
  const isCurrent = (captured, generation) => !disposed && generation === epoch && same(captured, current);
  function receiptMatches(receipt, record) {
    return receipt?.status === 'committed' && receipt.operationId === record.operationId && receipt.scopeHash === record.identity.scopeHash
      && receipt.operation === (record.change.target === 'host' ? 'policy' : 'chat-policy') && receipt.revision === record.change.expectedRevision + 1;
  }
  async function pendingAt(binding) {
    const record = await journal.get(binding.scopeHash);
    if (record && (record.identity?.scopeHash !== binding.scopeHash || typeof record.operationId !== 'string' || !record.change)) throw new TypeError('Invalid pending memory request');
    return record;
  }
  async function load(captured, generation) {
    const read = ++readEpoch;
    try {
      const result = await api.read(captured);
      if (!isCurrent(captured, generation) || read !== readEpoch) return;
      if (result.scopeHash !== captured.scopeHash || result.chatId !== captured.chatId || result.bindingHash !== captured.bindingHash || result.bindingEpoch !== captured.bindingEpoch
        || typeof result.available !== 'boolean' || typeof result.canChange !== 'boolean') throw new TypeError('Memory response binding changed');
      publish({ policy: policy(result.policy, ['enabled', 'generate', 'useMemory', 'externalContext']), chat: policy(result.chat, ['useMemory', 'contribute']),
        available: result.available, canChange: result.canChange, loading: false });
    } catch {
      if (isCurrent(captured, generation) && read === readEpoch) publish({ available: false, canChange: false, loading: false, error: 'Memory availability could not be verified. Refresh this binding before making changes.' });
    }
  }
  async function activate(value) {
    if (disposed) throw new Error('Memory controller is disposed');
    current = identity(value); const captured = current, generation = ++epoch;
    publish({ scopeKey: captured.scopeKey, chatId: captured.chatId, available: false, canChange: false, loading: true, pending: false,
      unknownOperationId: undefined, error: undefined, policy: initialPolicy(), chat: initialChat() });
    try {
      // A journal restored after reload is always uncertain until its receipt is checked.
      const record = inFlight.get(captured.scopeHash) ?? await pendingAt(captured);
      if (!isCurrent(captured, generation)) return;
      if (record) publish({ unknownOperationId: record.operationId });
    } catch {
      if (isCurrent(captured, generation)) publish({ loading: false, error: 'Pending memory requests could not be recovered. No changes will be sent.' });
      return;
    }
    if (isCurrent(captured, generation)) await load(captured, generation);
  }
  async function refreshSettledScope(record, error = undefined) {
    if (!disposed && current?.scopeHash === record.identity.scopeHash) {
      const binding = current, generation = epoch;
      publish({ pending: false, unknownOperationId: undefined, error });
      await load(binding, generation);
    }
  }
  async function change(scopeKey, chatId, input) {
    const captured = current, generation = epoch;
    if (!captured || captured.scopeKey !== scopeKey || captured.chatId !== chatId || !state.available || !state.canChange || state.loading || state.pending || state.unknownOperationId || inFlight.has(captured.scopeHash)) return false;
    const fields = input?.target === 'host' ? ['enabled', 'generate', 'useMemory', 'externalContext'] : input?.target === 'chat' ? ['useMemory', 'contribute'] : null;
    if (!fields || !validRevision(input.expectedRevision)) throw new TypeError('Invalid memory policy change');
    const values = policy(input.values, fields), prior = input.target === 'host' ? state.policy : state.chat;
    if (input.expectedRevision !== prior.revision || values.revision !== prior.revision) throw new TypeError('Stale memory policy revision');
    const record = { identity: captured, operationId: newOperationId(), change: { target: input.target, expectedRevision: input.expectedRevision, values } };
    if (typeof record.operationId !== 'string' || !record.operationId.trim()) throw new TypeError('Invalid memory operation ID');
    inFlight.set(captured.scopeHash, record);
    publish({ pending: true, error: undefined });
    try {
      const existing = await pendingAt(captured);
      if (existing) {
        inFlight.delete(captured.scopeHash);
        if (isCurrent(captured, generation)) publish({ pending: false, unknownOperationId: existing.operationId });
        return false;
      }
      await journal.set(captured.scopeHash, record);
    } catch {
      inFlight.delete(captured.scopeHash);
      if (isCurrent(captured, generation)) publish({ pending: false, available: false, canChange: false, error: 'The pending request could not be preserved. No change was sent.' });
      return false;
    }
    try {
      const result = await api.change(record);
      if (!receiptMatches(result?.receipt, record)) throw new Error('Unknown memory receipt');
      await journal.remove(captured.scopeHash, record.operationId);
      await refreshSettledScope(record);
      return true;
    } catch (error) {
      // Only a definitive pre-commit 4xx response can release the pending journal.
      const definitive = { 401: ['UNAUTHORIZED', 'AUTH_REQUIRED'], 403: ['FORBIDDEN'], 404: ['NOT_FOUND'],
        409: ['VERSION_CONFLICT', 'OPERATION_CONFLICT', 'RESET_CHANGED'], 422: ['INVALID_INPUT', 'INVALID_SCOPE'] };
      const rejected = api.rejectedBeforeDispatch?.(error) === true || definitive[error?.status]?.includes(error?.code) === true;
      if (rejected) {
        try { await journal.remove(captured.scopeHash, record.operationId); }
        catch { if (isCurrent(captured, generation)) publish({ pending: false, unknownOperationId: record.operationId, error: 'The request journal could not be reconciled.' }); return false; }
      }
      if (rejected) {
        await refreshSettledScope(record, 'The memory change was rejected. Refresh the current policy before changing it.');
      } else if (isCurrent(captured, generation)) {
        publish({ pending: false, unknownOperationId: record.operationId,
          error: 'The change outcome is unknown. Check its original receipt before making another change.' });
      }
      return false;
    } finally {
      if (inFlight.get(captured.scopeHash)?.operationId === record.operationId) inFlight.delete(captured.scopeHash);
    }
  }
  async function reconcile(operationId) {
    const captured = current, generation = epoch;
    if (!captured || state.pending) return false;
    let record;
    publish({ pending: true });
    try { record = await pendingAt(captured); }
    catch { if (isCurrent(captured, generation)) publish({ pending: false, error: 'Pending memory request could not be recovered.' }); return false; }
    if (!isCurrent(captured, generation)) return false;
    if (!record || record.operationId !== operationId) { publish({ pending: false, error: 'The original pending request could not be verified.' }); return false; }
    try {
      const receipt = await api.operation(captured, operationId);
      if (!receiptMatches(receipt, record)) throw new Error('Receipt is absent or does not match');
      await journal.remove(captured.scopeHash, operationId);
      await refreshSettledScope(record);
      return true;
    } catch {
      if (isCurrent(captured, generation)) publish({ pending: false, unknownOperationId: operationId, error: 'No matching committed receipt is available yet. The original request remains preserved; no write was retried.' });
      return false;
    }
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    activate, change, reconcile,
    dispose: () => { disposed = true; epoch++; readEpoch++; listeners.clear(); },
  });
}
