export class ProjectError extends Error {
  constructor(code, status = 422) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code = "VALIDATION_ERROR", status = 422) {
  if (!condition) throw new ProjectError(code, status);
}
export function text(value, maxLength = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !Array.from(value).some(c => c.charCodeAt(0) < 32);
}
export function scopeKey(scope) {
  requireValue(text(scope?.instanceId) && text(scope?.organizationId) && text(scope?.ownerUserId));
  return JSON.stringify([scope.instanceId, scope.organizationId, scope.ownerUserId]);
}
export function sameScope(a, b) { return scopeKey(a) === scopeKey(b); }

export function validateBinding(binding) {
  requireValue(binding?.version === 1 && text(binding.id) && text(binding.hostId) &&
    text(binding.environmentId) && text(binding.workspaceBindingId) &&
    text(binding.canonicalRootId) && text(binding.directory, 32760) && text(binding.shellId) &&
    text(binding.workspaceIdentity) && text(binding.ownerInstanceId) &&
    Number.isSafeInteger(binding.ownerRevision) && binding.ownerRevision > 0 &&
    typeof binding.mappingHash === "string" && binding.mappingHash.length === 64 &&
    Array.from(binding.mappingHash).every(c => "0123456789abcdef".includes(c)) &&
    Number.isSafeInteger(binding.securityEpoch) && binding.securityEpoch >= 0);
  requireValue(["windows", "wsl", "cluster"].includes(binding.kind));
  const fields = ["version", "id", "hostId", "environmentId", "workspaceBindingId",
    "canonicalRootId", "directory", "shellId", "securityEpoch", "kind",
    "workspaceIdentity", "mappingHash", "ownerInstanceId", "ownerRevision",
    ...(binding.kind === "wsl" ? ["distro", "user"] : []),
    ...(binding.kind === "cluster" ? ["runtimeId", "storageId"] : [])];
  requireValue(Object.keys(binding).every(key => fields.includes(key)));
  requireValue(binding.kind !== "wsl" || (text(binding.distro) && text(binding.user)));
  requireValue(binding.kind !== "cluster" || (text(binding.runtimeId) && text(binding.storageId)));
  // Paths are resolved by the host owner, never canonicalized on a different OS.
  return binding;
}

export function resolveExecution({scope, project, binding, admission, capability}) {
  scopeKey(scope); validateBinding(binding);
  requireValue(project === null || (project && sameScope(scope, project.scope)), "FORBIDDEN", 403);
  requireValue(project === null || project.archivedAt === null && project.archived !== true, "PROJECT_ARCHIVED", 409);
  requireValue(admission && sameScope(scope, admission.scope), "FORBIDDEN", 403);
  for (const key of ["id", "hostId", "environmentId", "workspaceBindingId", "canonicalRootId",
    "directory", "shellId", "securityEpoch", "kind", "distro", "user", "runtimeId", "storageId",
    "workspaceIdentity", "mappingHash", "ownerInstanceId", "ownerRevision"]) {
    requireValue(binding[key] === admission.binding?.[key], "STALE_EXECUTION_BINDING", 409);
  }
  requireValue(admission.projectId === (project?.id ?? null), "FORBIDDEN", 403);
  requireValue(admission.online === true, "HOST_UNAVAILABLE", 503);
  requireValue(Array.isArray(admission.capabilities) && admission.capabilities.includes(capability),
    "CAPABILITY_DENIED", 403);
  if (project !== null) {
    requireValue(project.roots.some(root => root.canonicalRootId === binding.canonicalRootId &&
      root.hostId === binding.hostId && root.environmentId === binding.environmentId),
      "WORKSPACE_MISMATCH", 409);
  }
  return Object.freeze({...binding});
}

const transitions = {
  creating: ["active", "create_failed", "unknown"],
  active: ["archive_intent"],
  archive_intent: ["archived", "unknown"],
  archived: ["restore_intent"],
  restore_intent: ["active", "unknown"],
  create_failed: [],
  unknown: [],
};
export function transitionWorktree(record, next, evidence) {
  requireValue(transitions[record.state]?.includes(next), "WORKTREE_CONFLICT", 409);
  requireValue(evidence?.operationId === record.operationId, "OPERATION_CONFLICT", 409);
  if (next === "archive_intent") {
    requireValue(evidence.owned === true && evidence.inactive === true &&
      evidence.recoveryVerified === true && text(evidence.recoveryRef) &&
      evidence.hasSubmodules === false && evidence.hasEmbeddedRepositories === false &&
      evidence.protectedIgnoredFiles === true, "RECOVERY_REQUIRED", 409);
  }
  if (next === "active" || next === "archived") {
    requireValue(evidence.ownerConfirmed === true, "OUTCOME_UNKNOWN", 409);
  }
  return {...record, state: next, revision: record.revision + 1,
    recoveryRef: evidence.recoveryRef ?? record.recoveryRef};
}
export function terminalDimensions(columns, rows) {
  requireValue(Number.isInteger(columns) && columns >= 2 && columns <= 500 &&
    Number.isInteger(rows) && rows >= 1 && rows <= 300);
  return {columns, rows};
}
export function terminalInput(value) {
  requireValue(typeof value === "string" && new TextEncoder().encode(value).byteLength <= 65536);
  return value;
}
export function readTerminalWindow(chunks, afterSequence, maxBytes = 262144) {
  requireValue(Number.isSafeInteger(afterSequence) && afterSequence >= 0 &&
    Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1048576);
  requireValue(Array.isArray(chunks) && chunks.length <= 16384);
  let previous = -1;
  for (const chunk of chunks) {
    requireValue(Number.isSafeInteger(chunk.sequence) && chunk.sequence > previous &&
      typeof chunk.data === "string" && new TextEncoder().encode(chunk.data).byteLength <= 65536);
    previous = chunk.sequence;
  }
  const selected = chunks.filter(c => c.sequence > afterSequence);
  let bytes = 0; const output = [];
  for (const chunk of selected) {
    requireValue(Number.isSafeInteger(chunk.sequence) && typeof chunk.data === "string");
    const size = new TextEncoder().encode(chunk.data).byteLength;
    if (bytes + size > maxBytes) break;
    output.push(chunk); bytes += size;
  }
  return {chunks: output, nextSequence: output.at(-1)?.sequence ?? afterSequence,
    truncated: output.length < selected.length,
    gap: selected.length > 0 && selected[0].sequence !== afterSequence + 1,
    requiredBytes: output.length === 0 && selected.length > 0 ?
      new TextEncoder().encode(selected[0].data).byteLength : null};
}
