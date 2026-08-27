/**
 * MCP transport adapters for the project-scoped coordination registry.
 * DB ISOLATION: this module only proxies to the Ingenium API.
 */
import { api } from "../client.js";
import { textResult } from "./result.js";

export type CoordinationUpdateOperation =
  | "register"
  | "recover"
  | "recovery_state"
  | "reconcile_epoch"
  | "recover_epoch"
  | "update"
  | "heartbeat"
  | "runtime_activity"
  | "close"
  | "takeover";

export interface CoordinationClaimInput {
  claim: Record<string, unknown>;
  baseline_sha256?: string | null;
  current_sha256?: string | null;
  repository_sha256?: string | null;
}

export interface CoordinationUpdateInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision?: number;
  fence?: number;
  ownership_token?: string;
  next_ownership_token?: string;
  ttl_ms?: number;
  idempotency_key?: string;
  snapshot?: Record<string, unknown>;
  snapshot_revision?: number;
  current_task_id?: string | null;
  current_task_revision?: number | null;
  quarantined_session_id?: string;
  quarantined_incarnation?: number;
  quarantined_fence?: number;
  quarantined_actor_id?: string;
  accepted_epoch?: number;
  recovery_footprint_hash?: string;
  runtime_id?: string;
  observed_at?: string;
}

export interface CoordinationClaimBatchInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision: number;
  fence: number;
  ownership_token: string;
  client_claim_key: string;
  claims: CoordinationClaimInput[];
  idempotency_key: string;
  operation?: "write" | "edit" | "create" | "delete" | "rename" | "apply_patch" | "repository" | "build";
}

export interface CoordinationReleaseInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision: number;
  fence: number;
  ownership_token: string;
  client_claim_key: string;
  idempotency_key: string;
}

export interface CoordinationClaimProofInput extends CoordinationReleaseInput {
  accepted_epoch: number;
  ttl_ms?: number;
  state?: "dirty" | "quarantined" | "collision";
  code?: "uncertain_apply" | "dirty_baseline";
  operation_id?: string;
  operation?: "write" | "edit" | "create" | "delete" | "rename" | "apply_patch" | "repository" | "build";
  footprint?: Array<{ path?: string; path_sha256: string; before_sha256: string | null; after_sha256: string | null }>;
}

export interface CoordinationHandoffInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision: number;
  fence: number;
  ownership_token: string;
  idempotency_key: string;
  operation_kind?: "write" | "edit";
  path?: string;
  baseline_sha256?: string | null;
  limit?: number;
  through_sequence?: number;
  through_revision?: number;
  memory_entry?: Record<string, unknown>;
}

interface ApiResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

type ToolResult = {
  isError?: boolean;
  content: [{ type: "text"; text: string }];
};

const COORDINATION_REQUEST_FAILED = "The coordination request failed.";
const COORDINATION_UNAVAILABLE = "The coordination service is unavailable.";
const COORDINATION_INVALID_RESPONSE = "The coordination response is invalid.";

const ALLOWED_ERROR_CODES = new Set([
  "RATE_LIMITED",
  "INVALID_COORDINATION_INPUT",
  "PROJECT_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "SESSION_IDENTITY_CONFLICT",
  "SESSION_CLOSED",
  "SESSION_NOT_ACTIVE",
  "SESSION_EXPIRED",
  "REVISION_CONFLICT",
  "FENCE_CONFLICT",
  "OWNERSHIP_TOKEN_MISMATCH",
  "IDEMPOTENCY_KEY_REUSED",
  "CLAIM_CONFLICT",
  "CLAIM_KEY_REUSED",
  "CLAIM_NOT_FOUND",
  "CLAIM_NOT_OWNED",
  "EPOCH_QUARANTINED",
  "BASELINE_MISMATCH",
  "FOOTPRINT_MISMATCH",
  "MANIFEST_GENERATION_CONFLICT",
  "POINTER_NOT_FOUND",
  "POINTER_REVISION_CONFLICT",
  "COORDINATION_INTEGRITY_ERROR",
]);

const MUTATION_SESSION_KEYS = [
  "actorId",
  "revision",
  "fence",
  "state",
  "heartbeatAt",
  "expiresAt",
  "snapshotRevision",
  "currentTaskId",
  "currentTaskRevision",
  "contextConversationId",
  "contextRevision",
  "updatedAt",
] as const;

const STATUS_SESSION_KEYS = [
  "actorId",
  "worktreeId",
  "incarnation",
  "revision",
  "fence",
  "state",
  "heartbeatAt",
  "expiresAt",
  "snapshotRevision",
  "currentTaskId",
  "currentTaskRevision",
  "contextConversationId",
  "contextRevision",
  "createdAt",
  "updatedAt",
] as const;

const CLAIM_KEYS = ["kind", "state", "createdAt", "updatedAt", "releasedAt"] as const;
const STATUS_KEYS = ["session", "claims", "claimCount", "claimsTruncated", "peers"] as const;
const PEER_SNAPSHOT_KEYS = [
  "peerId", "incarnation", "sessionRevision", "snapshotRevision", "status", "todos", "changedPaths",
  "currentTaskId", "contextRevision", "updatedAt",
] as const;
const PEER_TODO_KEYS = ["total", "pending", "inProgress", "completed", "cancelled", "state"] as const;
const PEER_CHANGED_PATH_KEYS = ["path", "operation", "additions", "deletions", "changeRevision"] as const;
const MUTATION_KEYS = ["session"] as const;
const TAKEOVER_KEYS = ["session", "takeoverEvidenceId"] as const;
const CLAIM_MUTATION_KEYS = ["session", "acceptedEpoch", "manifestGeneration"] as const;
const EPOCH_RECOVERY_STATE_KEYS = [
  "acceptedEpoch", "quarantineCode", "quarantinedSessionId", "quarantinedIncarnation",
  "quarantinedFence", "quarantinedActorId", "reconciliationRecorded",
] as const;
const HANDOFF_EVENT_KEYS = [
  "sequence", "eventId", "operation", "path", "baselineSha256", "sourceActorId", "sourceIncarnation",
  "sourceRevision", "currentTaskId", "currentTaskRevision", "contextConversationId", "contextRevision", "timestamp",
] as const;
const HANDOFF_PUBLISH_KEYS = ["session", "event"] as const;
const HANDOFF_CONSUME_KEYS = ["session", "events"] as const;
const HANDOFF_READ_KEYS = ["session", "events", "throughSequence", "acknowledgementRequired"] as const;
const REGISTER_KEYS = ["session", "memory"] as const;
const MEMORY_WINDOW_KEYS = ["conversationId", "revision", "entries", "throughRevision", "acknowledgementRequired"] as const;
const MEMORY_PUBLISH_KEYS = ["session", "memory"] as const;
const MEMORY_PUBLISHED_KEYS = ["conversationId", "revision", "entry"] as const;
const OPERATIONAL_ENTRY_KEYS = [
  "version", "type", "entryId", "actorId", "sourceRevision", "timestamp", "status", "actions", "checks",
  "todos", "currentTaskId", "contextRevision", "changedPaths", "nextWork",
] as const;
const OPERATIONAL_ACTION_KEYS = ["kind", "result", "pathSegments", "targetHash"] as const;
const OPERATIONAL_CHECK_KEYS = ["kind", "result", "targetHash"] as const;
const OPERATIONAL_CHANGED_PATH_KEYS = ["pathSegments", "operation", "additions", "deletions", "changeRevision"] as const;
const OPERATIONAL_NEXT_WORK_KEYS = ["kind", "referenceHash"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_STATUS_CLAIMS = 100;
const MAX_PEER_SNAPSHOTS = 128;
const MAX_PEER_CHANGED_PATHS = 32;
const MAX_PEER_COUNT = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeNonnegativeInteger(value) && value >= 1;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function isSafeHandoffPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || value !== value.trim()
    || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:\//.test(value)
    || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split("/");
  const secret = /(^|[-_.])(secret|secrets|token|tokens|password|passwd|credential|credentials|private|apikey|api[-_]?key|id_rsa|env)([-_.]|$)/i;
  return !segments.some((segment) => segment.length === 0 || Buffer.byteLength(segment, "utf8") > 255
    || segment === "." || segment === ".." || segment === ".git" || segment.startsWith("@") || secret.test(segment));
}

function isEncodedPath(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) return false;
  const decoded: string[] = [];
  for (const segment of value) {
    if (typeof segment !== "string" || segment.length < 1 || segment.length > 342
      || !/^[A-Za-z0-9_-]+$/.test(segment)) return false;
    const bytes = Buffer.from(segment, "base64url");
    const text = bytes.toString("utf8");
    if (bytes.length > 255 || Buffer.from(text, "utf8").toString("base64url") !== segment) return false;
    decoded.push(text);
  }
  return isSafeHandoffPath(decoded.join("/"));
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNullable(value: unknown, validator: (entry: unknown) => boolean): boolean {
  return value === null || validator(value);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function errorResult(code: string, message: string, currentRevision?: number): ToolResult {
  return textResult({
    error: {
      code,
      message,
      ...(currentRevision === undefined ? {} : { currentRevision }),
    },
  }) as ToolResult & { isError: true };
}

function failedResult(code: string, message: string, currentRevision?: number): ToolResult {
  return {
    ...errorResult(code, message, currentRevision),
    isError: true,
  };
}

function safeErrorResponse(data: unknown): ToolResult {
  const error = isRecord(data) && isRecord(data.error) ? data.error : {};
  const upstreamCode = error.code;
  const code = typeof upstreamCode === "string" && ALLOWED_ERROR_CODES.has(upstreamCode)
    ? upstreamCode
    : "COORDINATION_REQUEST_FAILED";
  const currentRevision = error.currentRevision;
  return failedResult(
    code,
    COORDINATION_REQUEST_FAILED,
    typeof currentRevision === "number"
      && Number.isSafeInteger(currentRevision)
      && currentRevision >= 0
      ? currentRevision
      : undefined,
  );
}

function unavailableResult(): ToolResult {
  return failedResult("COORDINATION_UNAVAILABLE", COORDINATION_UNAVAILABLE);
}

function invalidResponseResult(): ToolResult {
  return failedResult("COORDINATION_INVALID_RESPONSE", COORDINATION_INVALID_RESPONSE);
}

function mutationSession(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, MUTATION_SESSION_KEYS)
    || typeof value.actorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(value.actorId)
    || !isSafeNonnegativeInteger(value.revision)
    || !isSafePositiveInteger(value.fence)
    || !isEnum(value.state, ["active", "quarantined", "closed"] as const)
    || !isTimestamp(value.heartbeatAt)
    || !isTimestamp(value.expiresAt)
    || !isSafeNonnegativeInteger(value.snapshotRevision)
    || !isNullable(value.currentTaskId, (entry) => typeof entry === "string" && /^task-[0-9a-f]{64}$/.test(entry))
    || !isNullable(value.currentTaskRevision, isSafeNonnegativeInteger)
    || !isNullable(value.contextConversationId, isUuid)
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.updatedAt)) return undefined;

  return {
    actorId: value.actorId,
    revision: value.revision,
    fence: value.fence,
    state: value.state,
    heartbeatAt: value.heartbeatAt,
    expiresAt: value.expiresAt,
    snapshotRevision: value.snapshotRevision,
    currentTaskId: value.currentTaskId,
    currentTaskRevision: value.currentTaskRevision,
    contextConversationId: value.contextConversationId,
    contextRevision: value.contextRevision,
    updatedAt: value.updatedAt,
  };
}

function statusSession(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, STATUS_SESSION_KEYS)
    || typeof value.actorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(value.actorId)
    || !isOpaqueId(value.worktreeId)
    || !isSafePositiveInteger(value.incarnation)
    || !isSafeNonnegativeInteger(value.revision)
    || !isSafePositiveInteger(value.fence)
    || !isEnum(value.state, ["active", "quarantined", "closed"] as const)
    || !isTimestamp(value.heartbeatAt)
    || !isTimestamp(value.expiresAt)
    || !isSafeNonnegativeInteger(value.snapshotRevision)
    || !isNullable(value.currentTaskId, (entry) => typeof entry === "string" && /^task-[0-9a-f]{64}$/.test(entry))
    || !isNullable(value.currentTaskRevision, isSafeNonnegativeInteger)
    || !isNullable(value.contextConversationId, isUuid)
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)) return undefined;

  return {
    actorId: value.actorId,
    worktreeId: value.worktreeId,
    incarnation: value.incarnation,
    revision: value.revision,
    fence: value.fence,
    state: value.state,
    heartbeatAt: value.heartbeatAt,
    expiresAt: value.expiresAt,
    snapshotRevision: value.snapshotRevision,
    currentTaskId: value.currentTaskId,
    currentTaskRevision: value.currentTaskRevision,
    contextConversationId: value.contextConversationId,
    contextRevision: value.contextRevision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function claim(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, CLAIM_KEYS)
    || !isEnum(value.kind, ["path", "tree", "reserved"] as const)
    || !isEnum(value.state, ["active", "released", "dirty", "quarantined", "collision"] as const)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isNullable(value.releasedAt, isTimestamp)) return undefined;

  return {
    kind: value.kind,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    releasedAt: value.releasedAt,
  };
}

type MutationResponseVariant = "session" | "takeover" | "claims";

function projectMutationResponse(
  data: unknown,
  variant: MutationResponseVariant,
): Record<string, unknown> | undefined {
  if (!isRecord(data)) return undefined;
  const keys = variant === "takeover"
    ? TAKEOVER_KEYS
    : variant === "claims" ? CLAIM_MUTATION_KEYS : MUTATION_KEYS;
  const claimKeysValid = variant !== "claims"
    || (hasExactKeys(data, CLAIM_MUTATION_KEYS)
      || hasExactKeys(data, [...CLAIM_MUTATION_KEYS, "operationId"]));
  if ((variant === "claims" && !claimKeysValid) || (variant !== "claims" && !hasExactKeys(data, keys))) return undefined;
  const session = mutationSession(data.session);
  if (!session) return undefined;

  const result: Record<string, unknown> = { session };
  if (variant === "takeover") {
    if (!isUuid(data.takeoverEvidenceId)) return undefined;
    result.takeoverEvidenceId = data.takeoverEvidenceId;
  }
  if (variant === "claims") {
    if (!isSafePositiveInteger(data.acceptedEpoch) || !isSafeNonnegativeInteger(data.manifestGeneration)
      || (data.operationId !== undefined && !isUuid(data.operationId))) return undefined;
    result.acceptedEpoch = data.acceptedEpoch;
    result.manifestGeneration = data.manifestGeneration;
    if (data.operationId !== undefined) result.operationId = data.operationId;
  }
  return result;
}

function projectEpochRecoveryStateResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, EPOCH_RECOVERY_STATE_KEYS)
    || !isSafePositiveInteger(data.acceptedEpoch)
    || !isEnum(data.quarantineCode, ["unexpected_footprint", "uncertain_apply", "dirty_baseline"] as const)
    || !isOpaqueId(data.quarantinedSessionId)
    || !isSafePositiveInteger(data.quarantinedIncarnation)
    || !isSafePositiveInteger(data.quarantinedFence)
    || typeof data.quarantinedActorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(data.quarantinedActorId)
    || typeof data.reconciliationRecorded !== "boolean") return undefined;
  return Object.fromEntries(EPOCH_RECOVERY_STATE_KEYS.map((key) => [key, data[key]]));
}

function operationalEntry(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, OPERATIONAL_ENTRY_KEYS)
    || value.version !== 1 || value.type !== "operational" || !isUuid(value.entryId)
    || typeof value.actorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(value.actorId)
    || !isSafePositiveInteger(value.sourceRevision) || !isTimestamp(value.timestamp)
    || !isEnum(value.status, ["active", "working", "idle", "completed", "error"] as const)
    || !Array.isArray(value.actions) || value.actions.length > 64
    || !Array.isArray(value.checks) || value.checks.length > 32
    || !hasExactKeys(value.todos, PEER_TODO_KEYS)
    || !Array.isArray(value.changedPaths) || value.changedPaths.length > MAX_PEER_CHANGED_PATHS
    || !isNullable(value.currentTaskId, (entry) => typeof entry === "string" && /^task-[0-9a-f]{64}$/.test(entry))
    || !isSafeNonnegativeInteger(value.contextRevision)
    || !hasExactKeys(value.nextWork, OPERATIONAL_NEXT_WORK_KEYS)) return undefined;
  const actions = value.actions.map((entry) => {
    if (!hasExactKeys(entry, OPERATIONAL_ACTION_KEYS)
      || !isEnum(entry.kind, ["read", "search", "write", "edit", "execute"] as const)
      || entry.result !== "succeeded"
      || (entry.pathSegments === null) === (entry.targetHash === null)
      || !isNullable(entry.pathSegments, isEncodedPath)
      || !isNullable(entry.targetHash, (target) => typeof target === "string" && /^[0-9a-f]{64}$/.test(target))) return undefined;
    return Object.fromEntries(OPERATIONAL_ACTION_KEYS.map((key) => [key, entry[key]]));
  });
  const checks = value.checks.map((entry) => {
    if (!hasExactKeys(entry, OPERATIONAL_CHECK_KEYS)
      || !isEnum(entry.kind, ["test", "typecheck", "lint", "build", "format", "security", "other"] as const)
      || !isEnum(entry.result, ["passed", "failed"] as const)
      || typeof entry.targetHash !== "string" || !/^[0-9a-f]{64}$/.test(entry.targetHash)) return undefined;
    return Object.fromEntries(OPERATIONAL_CHECK_KEYS.map((key) => [key, entry[key]]));
  });
  const changedPaths = value.changedPaths.map((entry) => {
    if (!hasExactKeys(entry, OPERATIONAL_CHANGED_PATH_KEYS) || !isEncodedPath(entry.pathSegments)
      || !isEnum(entry.operation, ["write", "edit"] as const)
      || !isSafeNonnegativeInteger(entry.additions) || entry.additions > MAX_PEER_COUNT
      || !isSafeNonnegativeInteger(entry.deletions) || entry.deletions > MAX_PEER_COUNT
      || !isSafePositiveInteger(entry.changeRevision)) return undefined;
    return Object.fromEntries(OPERATIONAL_CHANGED_PATH_KEYS.map((key) => [key, entry[key]]));
  });
  const todos = value.todos;
  const nextWork = value.nextWork;
  if (actions.some((entry) => entry === undefined) || checks.some((entry) => entry === undefined)
    || changedPaths.some((entry) => entry === undefined)
    || ![todos.total, todos.pending, todos.inProgress, todos.completed, todos.cancelled]
      .every((count) => isSafeNonnegativeInteger(count) && count <= MAX_PEER_COUNT)
    || todos.total !== (todos.pending as number) + (todos.inProgress as number)
      + (todos.completed as number) + (todos.cancelled as number)
    || !isEnum(todos.state, ["none", "pending", "in_progress", "complete", "cancelled", "mixed"] as const)
    || !isEnum(nextWork.kind, ["none", "continue_task", "review_changes", "run_checks", "address_failure"] as const)
    || !isNullable(nextWork.referenceHash, (entry) => typeof entry === "string" && /^[0-9a-f]{64}$/.test(entry))) return undefined;
  return {
    ...Object.fromEntries(OPERATIONAL_ENTRY_KEYS.slice(0, 7).map((key) => [key, value[key]])),
    actions: actions as Record<string, unknown>[],
    checks: checks as Record<string, unknown>[],
    todos: Object.fromEntries(PEER_TODO_KEYS.map((key) => [key, todos[key]])),
    currentTaskId: value.currentTaskId,
    contextRevision: value.contextRevision,
    changedPaths: changedPaths as Record<string, unknown>[],
    nextWork: Object.fromEntries(OPERATIONAL_NEXT_WORK_KEYS.map((key) => [key, nextWork[key]])),
  };
}

function memoryWindow(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, MEMORY_WINDOW_KEYS) || !isUuid(value.conversationId)
    || !isSafeNonnegativeInteger(value.revision) || !isSafeNonnegativeInteger(value.throughRevision)
    || value.throughRevision > value.revision || typeof value.acknowledgementRequired !== "boolean"
    || !Array.isArray(value.entries) || value.entries.length > 8) return undefined;
  const entries = value.entries.map(operationalEntry);
  return entries.every((entry) => entry !== undefined)
    ? { conversationId: value.conversationId, revision: value.revision, entries: entries as Record<string, unknown>[],
      throughRevision: value.throughRevision, acknowledgementRequired: value.acknowledgementRequired }
    : undefined;
}

function projectRegisterResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, REGISTER_KEYS)) return undefined;
  const session = mutationSession(data.session);
  const memory = memoryWindow(data.memory);
  return session && memory ? { session, memory } : undefined;
}

function projectMemoryPublishResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, MEMORY_PUBLISH_KEYS) || !hasExactKeys(data.memory, MEMORY_PUBLISHED_KEYS)
    || !isUuid(data.memory.conversationId) || !isSafePositiveInteger(data.memory.revision)) return undefined;
  const session = mutationSession(data.session);
  const entry = operationalEntry(data.memory.entry);
  return session && entry
    ? { session, memory: { conversationId: data.memory.conversationId, revision: data.memory.revision, entry } }
    : undefined;
}

function projectStatusResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, STATUS_KEYS)
    || !Array.isArray(data.claims)
    || data.claims.length > MAX_STATUS_CLAIMS
    || !Array.isArray(data.peers)
    || data.peers.length > MAX_PEER_SNAPSHOTS
    || !isSafeNonnegativeInteger(data.claimCount)
    || typeof data.claimsTruncated !== "boolean") return undefined;
  const session = statusSession(data.session);
  if (!session || !Array.isArray(data.claims)) return undefined;
  const claims = data.claims.map(claim);
  const peers = data.peers.map(peerSnapshot);
  if (claims.some((entry) => entry === undefined) || peers.some((entry) => entry === undefined)) return undefined;
  return {
    session,
    claims: claims as Record<string, unknown>[],
    claimCount: data.claimCount,
    claimsTruncated: data.claimsTruncated,
    peers: peers as Record<string, unknown>[],
  };
}

function peerSnapshot(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, PEER_SNAPSHOT_KEYS)
    || typeof value.peerId !== "string" || !/^peer-[0-9a-f]{64}$/.test(value.peerId)
    || !isSafePositiveInteger(value.incarnation)
    || !isSafeNonnegativeInteger(value.sessionRevision)
    || !isSafeNonnegativeInteger(value.snapshotRevision)
    || !isEnum(value.status, ["active", "working", "idle"] as const)
    || !hasExactKeys(value.todos, PEER_TODO_KEYS)
    || !Array.isArray(value.changedPaths) || value.changedPaths.length > MAX_PEER_CHANGED_PATHS
    || !isNullable(value.currentTaskId, (entry) => typeof entry === "string" && /^task-[0-9a-f]{64}$/.test(entry))
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.updatedAt)) return undefined;
  const todos = value.todos;
  if (![todos.total, todos.pending, todos.inProgress, todos.completed, todos.cancelled]
    .every((count) => isSafeNonnegativeInteger(count) && count <= MAX_PEER_COUNT)
    || !isEnum(todos.state, ["none", "pending", "in_progress", "complete", "cancelled", "mixed"] as const)) return undefined;
  const total = todos.total as number;
  const pending = todos.pending as number;
  const inProgress = todos.inProgress as number;
  const completed = todos.completed as number;
  const cancelled = todos.cancelled as number;
  if (total !== pending + inProgress + completed + cancelled) return undefined;
  const changedPaths = value.changedPaths.map((entry) => {
    if (!hasExactKeys(entry, PEER_CHANGED_PATH_KEYS)
      || !isSafeHandoffPath(entry.path)
      || !isEnum(entry.operation, ["write", "edit"] as const)
      || !isSafeNonnegativeInteger(entry.additions) || entry.additions > MAX_PEER_COUNT
      || !isSafeNonnegativeInteger(entry.deletions) || entry.deletions > MAX_PEER_COUNT
      || !isSafePositiveInteger(entry.changeRevision)) return undefined;
    return Object.fromEntries(PEER_CHANGED_PATH_KEYS.map((key) => [key, entry[key]]));
  });
  if (changedPaths.some((entry) => entry === undefined)) return undefined;
  return {
    peerId: value.peerId,
    incarnation: value.incarnation,
    sessionRevision: value.sessionRevision,
    snapshotRevision: value.snapshotRevision,
    status: value.status,
    todos: Object.fromEntries(PEER_TODO_KEYS.map((key) => [key, todos[key]])),
    changedPaths: changedPaths as Record<string, unknown>[],
    currentTaskId: value.currentTaskId,
    contextRevision: value.contextRevision,
    updatedAt: value.updatedAt,
  };
}

function handoffEvent(value: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(value, HANDOFF_EVENT_KEYS)
    || !isSafePositiveInteger(value.sequence)
    || !isUuid(value.eventId)
    || !isEnum(value.operation, ["write", "edit"] as const)
    || !isSafeHandoffPath(value.path)
    || !isNullable(value.baselineSha256, (entry) => typeof entry === "string" && /^[0-9a-f]{64}$/.test(entry))
    || typeof value.sourceActorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(value.sourceActorId)
    || !isSafePositiveInteger(value.sourceIncarnation)
    || !isSafePositiveInteger(value.sourceRevision)
    || !isNullable(value.currentTaskId, isUuid)
    || !isNullable(value.currentTaskRevision, isSafeNonnegativeInteger)
    || !isNullable(value.contextConversationId, isUuid)
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.timestamp)) return undefined;
  return Object.fromEntries(HANDOFF_EVENT_KEYS.map((key) => [key, value[key]]));
}

function projectHandoffPublishResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, HANDOFF_PUBLISH_KEYS)) return undefined;
  const session = mutationSession(data.session);
  const event = handoffEvent(data.event);
  return session && event ? { session, event } : undefined;
}

function projectHandoffConsumeResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, HANDOFF_CONSUME_KEYS) || !Array.isArray(data.events)
    || data.events.length > 32) return undefined;
  const session = mutationSession(data.session);
  const events = data.events.map(handoffEvent);
  return session && events.every((event) => event !== undefined)
    ? { session, events: events as Record<string, unknown>[] }
    : undefined;
}

function projectHandoffReadResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, HANDOFF_READ_KEYS) || !Array.isArray(data.events)
    || data.events.length > 32 || !isSafeNonnegativeInteger(data.throughSequence)
    || typeof data.acknowledgementRequired !== "boolean") return undefined;
  const session = mutationSession(data.session);
  const events = data.events.map(handoffEvent);
  return session && events.every((event) => event !== undefined)
    ? { session, events: events as Record<string, unknown>[], throughSequence: data.throughSequence,
      acknowledgementRequired: data.acknowledgementRequired }
    : undefined;
}

function projectRuntimeActivityResponse(data: unknown): Record<string, unknown> | undefined {
  return hasExactKeys(data, ["accepted", "renewed"])
    && data.accepted === true && typeof data.renewed === "boolean"
    ? { accepted: true, renewed: data.renewed }
    : undefined;
}

async function request(
  call: () => Promise<ApiResponse>,
  projectResponse: (data: unknown) => Record<string, unknown> | undefined,
): Promise<ToolResult> {
  try {
    const response = await call();
    if (!response.ok) return safeErrorResponse(response.data);
    const projected = projectResponse(response.data);
    return projected === undefined ? invalidResponseResult() : textResult(projected);
  } catch {
    return unavailableResult();
  }
}

function leaseBody(input: CoordinationUpdateInput): Record<string, unknown> {
  return {
    worktree_id: input.worktree_id,
    session_id: input.session_id,
    incarnation: input.incarnation,
    expected_revision: input.expected_revision,
    fence: input.fence,
    ownership_token: input.ownership_token,
    idempotency_key: input.idempotency_key,
  };
}

/** Read a redacted snapshot for one exact project/worktree/session/incarnation identity. */
export async function coordinationStatus(
  project: string,
  worktreeId: string,
  sessionId: string,
  incarnation: number,
  ownershipToken: string,
): Promise<ToolResult> {
  return request(
    () => api.settled.getCoordinationSnapshot(project, worktreeId, sessionId, incarnation, ownershipToken),
    projectStatusResponse,
  );
}

/** Dispatch one coordination session operation to its exact API route and method. */
export async function coordinationUpdate(
  project: string,
  operation: CoordinationUpdateOperation,
  input: CoordinationUpdateInput,
): Promise<ToolResult> {
  switch (operation) {
    case "runtime_activity":
      return request(
        () => api.settled.post("/runtimes/activity", {
          runtimeId: input.runtime_id,
          observedAt: input.observed_at,
        }, { project }),
        projectRuntimeActivityResponse,
      );
    case "register":
      return request(
        () => api.settled.post("/coordination/register", {
          worktree_id: input.worktree_id,
          session_id: input.session_id,
          incarnation: input.incarnation,
          ownership_token: input.ownership_token,
          ttl_ms: input.ttl_ms,
          idempotency_key: input.idempotency_key,
        }, { project }),
        projectRegisterResponse,
      );
    case "recover":
      return request(
        () => api.settled.post("/coordination/recover", {
          ...leaseBody(input),
          next_ownership_token: input.next_ownership_token,
          ttl_ms: input.ttl_ms,
        }, { project }),
        (data) => projectMutationResponse(data, "session"),
      );
    case "recovery_state":
      return request(
        () => api.settled.post("/coordination/epoch/recovery-state", leaseBody(input), { project }),
        projectEpochRecoveryStateResponse,
      );
    case "reconcile_epoch":
    case "recover_epoch":
      return request(
        () => api.settled.post(`/coordination/epoch/${operation === "reconcile_epoch" ? "reconcile" : "recover"}`, {
          ...leaseBody(input),
          quarantined_session_id: input.quarantined_session_id,
          quarantined_incarnation: input.quarantined_incarnation,
          quarantined_fence: input.quarantined_fence,
          quarantined_actor_id: input.quarantined_actor_id,
          accepted_epoch: input.accepted_epoch,
          recovery_footprint_hash: input.recovery_footprint_hash,
        }, { project }),
        (data) => projectMutationResponse(data, "claims"),
      );
    case "update":
      return request(
        () => api.settled.patch("/coordination/update", {
          ...leaseBody(input),
          snapshot: input.snapshot,
          snapshot_revision: input.snapshot_revision,
          current_task_id: input.current_task_id,
          current_task_revision: input.current_task_revision,
        }, { project }),
        (data) => projectMutationResponse(data, "session"),
      );
    case "heartbeat":
      return request(
        () => api.settled.post("/coordination/heartbeat", {
          ...leaseBody(input),
          ttl_ms: input.ttl_ms,
        }, { project }),
        (data) => projectMutationResponse(data, "session"),
      );
    case "close":
      return request(
        () => api.settled.post("/coordination/close", leaseBody(input), { project }),
        (data) => projectMutationResponse(data, "session"),
      );
    case "takeover":
      return request(
        () => api.settled.post("/coordination/takeover", {
          ...leaseBody(input),
          next_ownership_token: input.next_ownership_token,
          ttl_ms: input.ttl_ms,
        }, { project }),
        (data) => projectMutationResponse(data, "takeover"),
      );
  }
}

/** Atomically claim a bounded batch of redacted coordination claims. */
export async function coordinationClaim(
  project: string,
  input: CoordinationClaimBatchInput,
): Promise<ToolResult> {
  return request(
    () => api.settled.post("/coordination/claims/batch", {
      worktree_id: input.worktree_id,
      session_id: input.session_id,
      incarnation: input.incarnation,
      expected_revision: input.expected_revision,
      fence: input.fence,
      ownership_token: input.ownership_token,
      client_claim_key: input.client_claim_key,
      claims: input.claims.map((entry) => ({
        claim: entry.claim,
        ...(entry.baseline_sha256 === undefined ? {} : { baseline_sha256: entry.baseline_sha256 }),
        ...(entry.current_sha256 === undefined ? {} : { current_sha256: entry.current_sha256 }),
        ...(entry.repository_sha256 === undefined ? {} : { repository_sha256: entry.repository_sha256 }),
      })),
      operation: input.operation,
      idempotency_key: input.idempotency_key,
    }, { project }),
    (data) => projectMutationResponse(data, "claims"),
  );
}

/** Atomically release the claim batch bound to an owned client claim key. */
export async function coordinationRelease(
  project: string,
  input: CoordinationReleaseInput,
): Promise<ToolResult> {
  return request(
    () => api.settled.post("/coordination/claims/release", {
      worktree_id: input.worktree_id,
      session_id: input.session_id,
      incarnation: input.incarnation,
      expected_revision: input.expected_revision,
      fence: input.fence,
      ownership_token: input.ownership_token,
      client_claim_key: input.client_claim_key,
      idempotency_key: input.idempotency_key,
    }, { project }),
    (data) => projectMutationResponse(data, "claims"),
  );
}

function claimProofBody(input: CoordinationClaimProofInput): Record<string, unknown> {
  return {
    worktree_id: input.worktree_id,
    session_id: input.session_id,
    incarnation: input.incarnation,
    expected_revision: input.expected_revision,
    fence: input.fence,
    ownership_token: input.ownership_token,
    client_claim_key: input.client_claim_key,
    accepted_epoch: input.accepted_epoch,
    idempotency_key: input.idempotency_key,
  };
}

export async function coordinationClaimAction(
  project: string,
  action: "verify" | "renew" | "mark" | "quarantine" | "complete",
  input: CoordinationClaimProofInput,
): Promise<ToolResult> {
  const suffix = action === "complete" ? "complete" : action;
  const extra = action === "renew" ? { ttl_ms: input.ttl_ms }
    : action === "mark" ? { state: input.state }
      : action === "quarantine" ? { code: input.code }
        : action === "complete" ? {
          operation_id: input.operation_id,
          operation: input.operation,
          footprint: input.footprint,
        } : {};
  return request(
    () => api.settled.post(`/coordination/claims/${suffix}`, { ...claimProofBody(input), ...extra }, { project }),
    (data) => projectMutationResponse(data, "claims"),
  );
}

/** Publish, read, acknowledge, consume, or persist sanitized coordination state. */
export async function coordinationHandoff(
  project: string,
  operation: "publish" | "read" | "ack" | "consume" | "memory" | "memory_read" | "memory_ack",
  input: CoordinationHandoffInput,
): Promise<ToolResult> {
  const body = {
    worktree_id: input.worktree_id,
    session_id: input.session_id,
    incarnation: input.incarnation,
    expected_revision: input.expected_revision,
    fence: input.fence,
    ownership_token: input.ownership_token,
    idempotency_key: input.idempotency_key,
  };
  if (operation === "publish") {
    return request(
      () => api.settled.post("/coordination/handoffs/publish", {
        ...body,
        operation: input.operation_kind,
        path: input.path,
        baseline_sha256: input.baseline_sha256,
      }, { project }),
      projectHandoffPublishResponse,
    );
  }
  if (operation === "read") {
    return request(
      () => api.settled.post("/coordination/handoffs/read", { ...body, limit: input.limit }, { project }),
      projectHandoffReadResponse,
    );
  }
  if (operation === "ack") {
    return request(
      () => api.settled.post("/coordination/handoffs/ack", {
        ...body,
        through_sequence: input.through_sequence,
      }, { project }),
      (data) => projectMutationResponse(data, "session"),
    );
  }
  if (operation === "memory") {
    return request(
      () => api.settled.post("/coordination/memory/publish", { ...body, entry: input.memory_entry }, { project }),
      projectMemoryPublishResponse,
    );
  }
  if (operation === "memory_read") {
    return request(
      () => api.settled.post("/coordination/memory/read", { ...body, limit: input.limit }, { project }),
      projectRegisterResponse,
    );
  }
  if (operation === "memory_ack") {
    return request(
      () => api.settled.post("/coordination/memory/ack", {
        ...body,
        through_revision: input.through_revision,
      }, { project }),
      (data) => projectMutationResponse(data, "session"),
    );
  }
  return request(
    () => api.settled.post("/coordination/handoffs/consume", { ...body, limit: input.limit }, { project }),
    projectHandoffConsumeResponse,
  );
}
