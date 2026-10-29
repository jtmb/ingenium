import { createHash } from 'node:crypto';
import { MemoryLifecycle, MemoryError, scopeKey } from './lifecycle.mjs';

const denied = () => { throw new MemoryError('FORBIDDEN'); };
const unavailable = () => { throw new MemoryError('MEMORY_ADAPTER_UNAVAILABLE'); };
const id = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512;
const sameScope = (left, right) => ['organizationId', 'ownerUserId', 'hostId', 'environmentId', 'projectId', 'workspaceId', 'bindingHash', 'bindingEpoch', 'visibility']
  .every((field) => left?.[field] === right?.[field]);
const validPermissions = new Set(['read', 'read-source', 'write-policy', 'forget', 'generate', 'backup', 'restore']);
function hasCapability(principal, permission) {
  if (!Array.isArray(principal.scopes)) return false;
  const allowed = new Set(principal.scopes);
  if (allowed.has('*') || allowed.has('user:*') || allowed.has('memory:*')) return true;
  if (permission === 'read' || permission === 'read-source') return ['memory:read', 'memory:write', 'memory:share'].some((scope) => allowed.has(scope));
  if (permission === 'forget' || permission === 'write-policy') return allowed.has('memory:write');
  return allowed.has(`memory:${permission}`);
}
function selectors(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['projectId', 'workspaceId', 'runtimeId'].includes(key))
    || (input.projectId !== null && !id(input.projectId)) || !id(input.workspaceId) || !id(input.runtimeId)) throw new MemoryError('INVALID_INPUT');
  return Object.freeze({ projectId: input.projectId, workspaceId: input.workspaceId, runtimeId: input.runtimeId });
}

/** Request-scoped adapter. All identity/capability ports are server-owned; none
 * are filled from owner/org/hash request fields. Uses the existing core connection; no second database or scheduler is created.
 */
export function createApiMemorySession({ core, request, selected, authenticate, resolveExistingScope, resolveExecution, resolveChatBinding,
  authorizeOperation, resolveSourceState, resolveProjectlessScope, clock }) {
  const selection = selectors(selected);
  if (!core || !['getDb', 'execTransaction', 'checkpointAfterWrite'].every((key) => typeof core[key] === 'function')
    || ![authenticate, resolveExistingScope, resolveExecution, resolveChatBinding, authorizeOperation, resolveSourceState].every((port) => typeof port === 'function')) throw new MemoryError('INVALID_ADAPTER');
  const db = core.getDb();
  const connection = () => { if (core.getDb() !== db) unavailable(); return db; };
  function resolve(permission, chatId = null) {
    if (!validPermissions.has(permission) || (chatId !== null && !id(chatId))) denied();
    const authenticated = authenticate(request);
    const principal = authenticated?.principal;
    if (!principal || !['user', 'service'].includes(principal.type) || !id(principal.id) || !hasCapability(principal, permission)) denied();
    connection();
    let ownership;
    if (principal.type === 'service') {
      const proof = authenticated.attestation;
      if (!id(principal.tokenId) || principal.workspaceId !== selection.workspaceId || !id(principal.storageMappingHash)
        || !proof || proof.credentialId !== principal.tokenId || proof.workspaceId !== selection.workspaceId || proof.storageMappingHash !== principal.storageMappingHash) denied();
    }
    if (selection.projectId === null) {
      if (typeof resolveProjectlessScope !== 'function' || principal.type !== 'user') unavailable();
      ownership = resolveProjectlessScope({ request, principal, workspaceId: selection.workspaceId });
      if (!ownership || ownership.projectId !== null || ownership.ownerUserId !== principal.id || ownership.workspaceId !== selection.workspaceId
        || ownership.status !== 'authorized' || ownership.visibility !== 'private') denied();
    } else {
      // This is the existing explicit-memory resolver, including credential epoch,
      // expiry, service-principal and storage-path attestation checks.
      const legacyPrincipal = principal.type === 'user' ? { type: 'user', userId: principal.id }
        : { type: 'service', servicePrincipalId: principal.id, credentialId: principal.tokenId, storageMappingHash: principal.storageMappingHash };
      const legacy = resolveExistingScope({ projectId: selection.projectId, workspaceId: selection.workspaceId, principal: legacyPrincipal, allowProjectVisibility: false });
      if (!legacy || legacy.projectId !== selection.projectId || legacy.workspaceId !== selection.workspaceId || !id(legacy.organizationId) || !id(legacy.ownerUserId)
        || (principal.type === 'user' && legacy.ownerUserId !== principal.id)) denied();
      ownership = connection().prepare(`SELECT w.id AS workspaceId,w.organization_id AS organizationId,w.project_id AS projectId,
        w.owner_user_id AS ownerUserId,w.storage_mapping_hash AS bindingHash,w.security_epoch AS bindingEpoch,w.status
        FROM authorized_workspaces w JOIN projects p ON p.id=w.project_id AND p.organization_id=w.organization_id
        JOIN organization_memberships m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id AND m.status='active'
        WHERE w.id=? AND w.organization_id=? AND w.project_id=? AND w.owner_user_id=? AND w.status='authorized' AND p.archived_at IS NULL`)
        .get(selection.workspaceId, legacy.organizationId, selection.projectId, legacy.ownerUserId);
      if (!ownership || (principal.type === 'service' && ownership.bindingHash !== principal.storageMappingHash)) denied();
    }
    if (!id(ownership.organizationId) || !id(ownership.bindingHash) || !Number.isSafeInteger(ownership.bindingEpoch) || ownership.bindingEpoch < 0) denied();
    const execution = resolveExecution({ request, principal, ownership: Object.freeze({ ...ownership }), runtimeId: selection.runtimeId });
    if (!execution || execution.available !== true || !['runtime', 'native', 'compatibility'].includes(execution.mode)
      || execution.runtimeId !== selection.runtimeId || !id(execution.hostId) || !id(execution.environmentId)
      || ['workspaceId', 'ownerUserId', 'organizationId', 'projectId', 'bindingHash', 'bindingEpoch'].some((field) => execution[field] !== ownership[field])) denied();
    if (execution.mode === 'runtime') {
      const runtime = connection().prepare(`SELECT id FROM runtime_instances WHERE id=? AND workspace_id=? AND organization_id=? AND project_id=?
        AND owner_user_id=? AND security_epoch=? AND state IN ('READY','IDLE')`)
        .get(selection.runtimeId, ownership.workspaceId, ownership.organizationId, ownership.projectId, ownership.ownerUserId, ownership.bindingEpoch);
      if (!runtime) denied();
    }
    const scope = Object.freeze({ organizationId: ownership.organizationId, ownerUserId: ownership.ownerUserId,
      projectId: ownership.projectId, workspaceId: ownership.workspaceId, bindingHash: ownership.bindingHash, bindingEpoch: ownership.bindingEpoch,
      hostId: execution.hostId, environmentId: execution.environmentId, visibility: 'private' });
    scopeKey(scope);
    if (authorizeOperation({ request, principal, scope, execution, permission, chatId }) !== true) denied();
    if (chatId !== null) {
      const chat = resolveChatBinding({ request, principal, scope, execution, chatId });
      if (!chat || chat.chatId !== chatId || chat.runtimeId !== execution.runtimeId || chat.available !== true || chat.visibility !== 'private'
        || ['organizationId', 'ownerUserId', 'projectId', 'workspaceId', 'hostId', 'environmentId', 'bindingHash', 'bindingEpoch'].some((field) => chat[field] !== scope[field])) denied();
    }
    return { scope, execution, principal };
  }
  function assertScope(scope, permission, chatId) {
    const current = resolve(permission, chatId);
    if (!sameScope(scope, current.scope)) denied();
    return current;
  }
  function readSource(scope, chatId, messageId) {
    if (!id(messageId)) return null;
    const current = assertScope(scope, 'read-source', chatId);
    // Projectless context is unavailable until its real owner provides an exact
    // mapping; never read a legacy global project as a substitute.
    if (scope.projectId === null) return null;
    const row = connection().prepare(`SELECT m.id,m.conversation_id,m.content,m.content_hash,m.role
      FROM context_messages m JOIN context_conversations c ON c.project_id=m.project_id AND c.id=m.conversation_id
      WHERE m.id=? AND c.project_id=? AND c.organization_id=? AND c.owner_user_id=? AND c.visibility='private'
        AND json_extract(c.metadata,'$.source')='opencode-chat' AND json_extract(c.metadata,'$.sourceRuntimeId')=?
        AND json_extract(c.metadata,'$.sourceSessionId')=?`).get(messageId, scope.projectId, scope.organizationId, scope.ownerUserId, current.execution.runtimeId, chatId);
    if (!row || !['user', 'assistant', 'tool'].includes(row.role) || typeof row.content !== 'string'
      || createHash('sha256').update(row.content, 'utf8').digest('hex') !== row.content_hash) return null;
    const state = resolveSourceState({ request, principal: current.principal, scope, execution: current.execution, chatId,
      messageId, conversationId: row.conversation_id, role: row.role, contentHash: row.content_hash });
    if (!state || ['active', 'excluded', 'uncertain', 'idleEligible'].some((field) => typeof state[field] !== 'boolean') || state.excluded || state.uncertain) return null;
    return { content: row.content, role: row.role, contentHash: row.content_hash, kind: row.role === 'tool' ? 'tool' : 'transcript',
      active: state.active, excluded: state.excluded, uncertain: state.uncertain, idleEligible: state.idleEligible,
      contentKind: 'untrusted_context_data', instructionAuthority: false };
  }
  const memory = new MemoryLifecycle({ db, clock,
    authorize: (scope, permission, chatId) => { assertScope(scope, permission, chatId); return true; },
    sources: (scope, chatId, sourceId) => {
      const source = readSource(scope, chatId, sourceId);
      if (!source) return null;
      const { content, role, contentKind, instructionAuthority, ...state } = source;
      return state;
    },
    runTransaction: (work) => { connection(); if (db.inTransaction !== false) unavailable(); return core.execTransaction(work, 1); },
    checkpoint: () => { connection(); if (db.inTransaction !== false) unavailable(); core.checkpointAfterWrite(); },
  });
  return Object.freeze({ memory, resolveScope: (permission, chatId = null) => resolve(permission, chatId).scope, readSource });
}

/** Gates injection only. Explicit save/edit/forget remain with the existing API. */
export async function explicitMemoryForChat({ memory, scope, chatId, loadExplicit }) {
  const before = memory.policy(scope, chatId);
  const enabled = (value) => value.policy.enabled && value.policy.useMemory && value.chat.useMemory;
  if (!enabled(before)) return { excluded: true, reason: 'policy', page: null };
  if (scope.projectId === null) return { excluded: true, reason: 'explicit-projectless-unavailable', page: null };
  if (typeof loadExplicit !== 'function') unavailable();
  const page = await loadExplicit({ organizationId: scope.organizationId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    ownerUserId: scope.ownerUserId, allowProjectVisibility: false });
  const after = memory.policy(scope, chatId);
  if (!enabled(after) || before.policy.revision !== after.policy.revision || before.chat.revision !== after.chat.revision) return { excluded: true, reason: 'policy-changed', page: null };
  if (!page || !Array.isArray(page.items) || page.items.length > 16 || page.items.some((item) => !item || item.instructionAuthority !== false
    || item.contentKind !== 'untrusted_memory_data' || !item.memory || item.memory.state !== 'active' || item.memory.visibility !== 'private'
    || ['organizationId', 'ownerUserId', 'projectId', 'workspaceId'].some((field) => item.memory[field] !== scope[field]))) throw new MemoryError('SOURCE_UNAVAILABLE');
  return { excluded: false, reason: null, page };
}
