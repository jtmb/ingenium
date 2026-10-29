import { MemoryError } from './lifecycle.mjs';
const definitions = {
  policy: { method: 'GET', permission: 'read', keys: [], invoke: (memory, scope, request) => memory.policy(scope, request.chatId) },
  'set-policy': { method: 'PUT', permission: 'write-policy', keys: ['operationId', 'expectedRevision', 'enabled', 'generate', 'useMemory', 'externalContext'], invoke: (memory, scope, request) => memory.setPolicy(scope, request.body) },
  'set-chat-policy': { method: 'PUT', permission: 'write-policy', keys: ['operationId', 'expectedRevision', 'useMemory', 'contribute'], invoke: (memory, scope, request) => memory.setChatPolicy(scope, request.chatId, request.body) },
  recall: { method: 'GET', permission: 'read', keys: [], invoke: (memory, scope, request) => memory.recall(scope, request.chatId, request.query) },
  entries: { method: 'GET', permission: 'read', keys: [], invoke: (memory, scope, request) => memory.inspect(scope, request.query) },
  forget: { method: 'POST', permission: 'forget', keys: ['operationId', 'memoryId', 'expectedVersion'], invoke: (memory, scope, request) => memory.forget(scope, request.body) },
  'reset-preview': { method: 'GET', permission: 'forget', keys: [], invoke: (memory, scope) => memory.previewReset(scope) },
  reset: { method: 'POST', permission: 'forget', keys: ['operationId', 'confirmation'], invoke: (memory, scope, request) => memory.reset(scope, request.body) },
  operation: { method: 'GET', permission: 'read', keys: [], invoke: (memory, scope, request) => memory.operation(scope, request.operationId) },
};
const statuses = { FORBIDDEN: 403, INVALID_INPUT: 422, INVALID_SCOPE: 422, NOT_FOUND: 404, VERSION_CONFLICT: 409, OPERATION_CONFLICT: 409, RESET_CHANGED: 409 };

/** Framework adapter only. resolveScope must run authenticated API scope/CSRF checks,
 * never read owner/host/org from the request body. This module registers no routes.
 * Internal generation and backup/restore are intentionally absent from this public facade.
 */
export function memoryResponse(memory, resolveScope, request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (!Object.hasOwn(definitions, request.action)) return { status: 404, headers, body: { error: { code: 'NOT_FOUND', message: 'Memory operation not found' } } };
    const definition = definitions[request.action];
    if (request.method !== definition.method) return { status: 405, headers: { ...headers, Allow: definition.method }, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } } };
    const scope = resolveScope(request, definition.permission);
    if (!scope) throw new MemoryError('FORBIDDEN');
    if (['policy', 'set-chat-policy', 'recall'].includes(request.action) && (typeof request.chatId !== 'string' || !request.chatId.trim())) throw new MemoryError('INVALID_INPUT');
    const body = request.body ?? {};
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((key) => !definition.keys.includes(key))) throw new MemoryError('INVALID_INPUT');
    if (request.query && (typeof request.query !== 'object' || Array.isArray(request.query)
      || Object.keys(request.query).some((key) => !(request.action === 'recall' ? ['maxItems', 'maxTokens'] : request.action === 'entries' ? ['offset', 'limit'] : []).includes(key)))) throw new MemoryError('INVALID_INPUT');
    const data = definition.invoke(memory, scope, { ...request, body });
    return { status: 200, headers, body: { data } };
  } catch (error) {
    const known = error instanceof MemoryError && Object.hasOwn(statuses, error.code);
    return { status: known ? statuses[error.code] : 500, headers,
      body: { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? 'Memory request could not be completed' : 'Memory operation outcome may be unknown; reconcile the original operation receipt before retrying' } } };
  }
}
