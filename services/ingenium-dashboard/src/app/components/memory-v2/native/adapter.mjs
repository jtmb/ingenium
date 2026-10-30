import { createMemoryController } from '../controller.mjs';

// Binding and subject are supplied by Native's actual inspected owner. This
// adapter never fabricates a Cloud principal or substitutes a default Project.
export function createNativeMemoryController({ request, custody, subject, chatId, newOperationId }) {
  let last;
  const call = (command, query_receipt = false) => request('POST', '/v1/goals/learned', {
    subject, chat_id: chatId, command, query_receipt,
  });
  const mappedReceipt = (response, record) => {
    const r = response?.receipt;
    const forgetting = record.change.target === 'forget';
    const operation = forgetting ? 'forget' : record.change.target === 'host' ? 'policy' : 'chat-policy';
    if (!r || r.operation_id !== record.operationId || r.scope_hash !== record.identity.scopeHash
      || r.kind !== (forgetting ? 'forget' : operation === 'policy' ? 'policy' : 'chat')
      || r.revision !== record.change.expectedRevision + (forgetting ? 0 : 1)) throw new Error('Native receipt does not match the original');
    return { status: 'committed', operationId: r.operation_id, scopeHash: r.scope_hash, operation, revision: r.revision };
  };
  const journal = {
    get: (key) => custody.get(key),
    async set(key, record) {
      if (!last || last.binding.bindingHash !== record.identity.bindingHash) throw new Error('Native owner changed');
      const values = record.change.values;
      const command = record.change.target === 'host'
        ? { kind: 'policy', operation_id: record.operationId, expected: record.change.expectedRevision,
          policy: { revision: values.revision, enabled: values.enabled, generate: values.generate,
            use_memories: values.useMemory, external_context: values.externalContext, min_idle_hours: last.policy.min_idle_hours } }
        : { kind: 'chat', operation_id: record.operationId, expected: record.change.expectedRevision,
          policy: { revision: values.revision, use_memories: values.useMemory, contribute: values.contribute } };
      await custody.set(key, { ...record, nativeCommand: command });
    },
    remove: (key, operation) => custody.remove(key, operation),
  };
  const controller = createMemoryController({ journal, newOperationId, api: {
    async read(binding) {
      const r = await call({ kind: 'inspect' });
      last = r;
      return { ...r.binding, available: r.available, canChange: r.canChange,
        policy: { ...r.policy, useMemory: r.policy.use_memories, externalContext: r.policy.external_context },
        chat: { ...r.chat, useMemory: r.chat.use_memories } };
    },
    async change(record) {
      const original = await custody.get(record.identity.scopeHash);
      if (!original || original.operationId !== record.operationId || !original.nativeCommand) throw new Error('Pending Native original unavailable');
      const result = await call(original.nativeCommand);
      const receipt = mappedReceipt(result, original);
      await custody.retain(record.identity.scopeHash, record.operationId, receipt);
      return { receipt };
    },
    async operation(binding, operationId) {
      const original = await custody.get(binding.scopeHash);
      if (!original || original.operationId !== operationId || !original.nativeCommand) throw new Error('Pending Native original unavailable');
      const result = await call(original.nativeCommand, true);
      const receipt = mappedReceipt(result, original);
      await custody.retain(binding.scopeHash, operationId, receipt);
      return receipt;
    },
  } });
  return Object.freeze({
    ...controller,
    async forget(entry) {
      const state = controller.getSnapshot(), identity = last?.binding;
      if (!identity || !state.available || state.pending || state.loading || state.unknownOperationId) return false;
      const operationId = newOperationId?.() ?? 'memory-' + crypto.randomUUID();
      const record = { identity, operationId, change: { target: 'forget', expectedRevision: entry.revision },
        nativeCommand: { kind: 'forget', operation_id: operationId, expected: entry.revision, memory_id: entry.id } };
      try {
        await custody.set(identity.scopeHash, record);
        await controller.activate(identity);
        const receipt = mappedReceipt(await call(record.nativeCommand), record);
        await custody.retain(identity.scopeHash, operationId, receipt);
        await custody.remove(identity.scopeHash, operationId);
        await controller.activate(identity);
        return true;
      } catch { await controller.activate(identity); return false; }
    },
    async reconcile(operationId) {
      const identity = last?.binding;
      if (!identity) return false;
      const original = await custody.get(identity.scopeHash);
      if (original?.change?.target !== 'forget') return controller.reconcile(operationId);
      if (original.operationId !== operationId) return false;
      try {
        const receipt = mappedReceipt(await call(original.nativeCommand, true), original);
        await custody.retain(identity.scopeHash, operationId, receipt);
        await custody.remove(identity.scopeHash, operationId);
        await controller.activate(identity); return true;
      } catch { await controller.activate(identity); return false; }
    },
    async inspect() {
      const response = await call({ kind: 'inspect' });
      last = response;
      await controller.activate(response.binding);
      return response;
    },
  });
}
