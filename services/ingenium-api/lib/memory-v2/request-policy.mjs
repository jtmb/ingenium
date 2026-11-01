import { MemoryError } from './lifecycle.mjs';
const reads = new Set(['read','read-source']);
const writes = new Set(['write-policy','forget']);
const unsafeMethods = new Set(['POST','PUT','PATCH','DELETE']);
function identityKey(principal) {
  if (!principal || !['user','service'].includes(principal.type) || typeof principal.id !== 'string' || !Array.isArray(principal.scopes)) return null;
  return JSON.stringify([principal.type,principal.id,principal.tokenId ?? null,principal.session?.id ?? null,principal.session?.security_epoch ?? null,
    principal.organizationId ?? null,principal.projectId ?? null,[...(principal.projectIds ?? [])].sort(),principal.workspaceId ?? null,
    principal.storageMappingHash ?? null,[...principal.scopes].sort()]);
}
/** Reuses decisions from existing owners; this seam neither parses credentials nor grants permissions. */
export function authorizeMemoryRequestOperation({ permission, expectedPrincipal, identity, method, csrf, decide }) {
  if (!reads.has(permission) && !writes.has(permission) && permission !== 'preview-forget') return false;
  const expected = identityKey(expectedPrincipal), current = identityKey(identity?.principal);
  if (expected === null || current !== expected || typeof csrf !== 'function' || typeof decide !== 'function') return false;
  if (writes.has(permission) && !unsafeMethods.has(method)) return false;
  if (permission === 'preview-forget' && method !== 'GET' && !unsafeMethods.has(method)) return false;
  if (unsafeMethods.has(method) && csrf(identity.principal) !== true) return false;
  return decide(identity.principal,reads.has(permission) ? 'read' : 'write') === true;
}

export function mapRequestExecutionFailure(error, ErrorClass) {
  if (!(error instanceof ErrorClass)) throw error;
  const invalid = ['INVALID_EXECUTION_SELECTION','INVALID_CHAT_BINDING','WORKSPACE_V2_EXECUTION_SELECTION'];
  const forbidden = ['EXECUTION_IDENTITY_UNAVAILABLE','EXECUTION_IDENTITY_CHANGED','EXECUTION_SCOPE_UNAVAILABLE','CHAT_BINDING_UNAVAILABLE','WORKSPACE_V2_USER_IDENTITY','WORKSPACE_V2_EXECUTION_SCOPE'];
  const unavailable = ['EXECUTION_RUNTIME_UNAVAILABLE','EXECUTION_PLACEMENT_UNAVAILABLE','EXECUTION_BINDING_CHANGED','PROJECTLESS_EXECUTION_OWNER_UNAVAILABLE','COMPATIBILITY_EXECUTION_OWNER_UNAVAILABLE','WORKSPACE_V2_RUNTIME_NOT_READY','WORKSPACE_V2_ORIGINAL_PLACEMENT_UNAVAILABLE','WORKSPACE_V2_ORIGINAL_PLACEMENT_CONTEXT_REQUIRED','WORKSPACE_V2_BINDING_CHANGED'];
  if (invalid.includes(error.code)) return new MemoryError('INVALID_INPUT');
  if (forbidden.includes(error.code)) return new MemoryError('FORBIDDEN');
  if (unavailable.includes(error.code)) return new MemoryError('MEMORY_ADAPTER_UNAVAILABLE');
  throw error;
}
