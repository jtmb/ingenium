/**
 * MCP transport adapters for the project-scoped coordination registry.
 * DB ISOLATION: this module only proxies to the Ingenium API.
 */
import { api } from "../client.js";

export type CoordinationUpdateOperation =
  | "register"
  | "recover"
  | "update"
  | "heartbeat"
  | "close"
  | "takeover";

export interface CoordinationClaimInput {
  claim: Record<string, unknown>;
  baseline_sha256?: string | null;
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
  context_conversation_id?: string | null;
  context_revision?: number | null;
}

export interface CoordinationClaimBatchInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision: number;
  fence: number;
  ownership_token: string;
  claims: CoordinationClaimInput[];
  idempotency_key: string;
}

export interface CoordinationReleaseInput {
  worktree_id: string;
  session_id: string;
  incarnation: number;
  expected_revision: number;
  fence: number;
  ownership_token: string;
  claim_ids: string[];
  idempotency_key: string;
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
  "CLAIM_NOT_FOUND",
  "CLAIM_NOT_OWNED",
  "POINTER_NOT_FOUND",
  "POINTER_REVISION_CONFLICT",
  "COORDINATION_INTEGRITY_ERROR",
]);

const MUTATION_SESSION_KEYS = [
  "id",
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
  "id",
  "worktreeId",
  "sessionId",
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

const CLAIM_KEYS = ["id", "kind", "state", "createdAt", "updatedAt", "releasedAt"] as const;
const STATUS_KEYS = ["session", "claims", "claimCount", "claimsTruncated"] as const;
const MUTATION_KEYS = ["session"] as const;
const TAKEOVER_KEYS = ["session", "takeoverEvidenceId"] as const;
const CLAIM_MUTATION_KEYS = ["session", "claimIds"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_STATUS_CLAIMS = 100;
const MAX_MUTATION_CLAIM_IDS = 128;

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

function textResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
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
    || !isUuid(value.id)
    || !isSafeNonnegativeInteger(value.revision)
    || !isSafePositiveInteger(value.fence)
    || !isEnum(value.state, ["active", "quarantined", "closed"] as const)
    || !isTimestamp(value.heartbeatAt)
    || !isTimestamp(value.expiresAt)
    || !isSafeNonnegativeInteger(value.snapshotRevision)
    || !isNullable(value.currentTaskId, isUuid)
    || !isNullable(value.currentTaskRevision, isSafeNonnegativeInteger)
    || !isNullable(value.contextConversationId, isUuid)
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.updatedAt)) return undefined;

  return {
    id: value.id,
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
    || !isUuid(value.id)
    || !isOpaqueId(value.worktreeId)
    || !isOpaqueId(value.sessionId)
    || !isSafePositiveInteger(value.incarnation)
    || !isSafeNonnegativeInteger(value.revision)
    || !isSafePositiveInteger(value.fence)
    || !isEnum(value.state, ["active", "quarantined", "closed"] as const)
    || !isTimestamp(value.heartbeatAt)
    || !isTimestamp(value.expiresAt)
    || !isSafeNonnegativeInteger(value.snapshotRevision)
    || !isNullable(value.currentTaskId, isUuid)
    || !isNullable(value.currentTaskRevision, isSafeNonnegativeInteger)
    || !isNullable(value.contextConversationId, isUuid)
    || !isNullable(value.contextRevision, isSafeNonnegativeInteger)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)) return undefined;

  return {
    id: value.id,
    worktreeId: value.worktreeId,
    sessionId: value.sessionId,
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
    || !isUuid(value.id)
    || !isEnum(value.kind, ["path", "tree", "reserved"] as const)
    || !isEnum(value.state, ["active", "released", "dirty", "quarantined", "collision"] as const)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isNullable(value.releasedAt, isTimestamp)) return undefined;

  return {
    id: value.id,
    kind: value.kind,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    releasedAt: value.releasedAt,
  };
}

function claimIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > MAX_MUTATION_CLAIM_IDS
    || !value.every(isUuid)) return undefined;
  const ids = value as string[];
  return new Set(ids).size === ids.length ? ids : undefined;
}

type MutationResponseVariant = "session" | "takeover" | "claims";

function projectMutationResponse(
  data: unknown,
  variant: MutationResponseVariant,
): Record<string, unknown> | undefined {
  const keys = variant === "takeover"
    ? TAKEOVER_KEYS
    : variant === "claims" ? CLAIM_MUTATION_KEYS : MUTATION_KEYS;
  if (!hasExactKeys(data, keys)) return undefined;
  const session = mutationSession(data.session);
  if (!session) return undefined;

  const result: Record<string, unknown> = { session };
  if (variant === "takeover") {
    if (!isUuid(data.takeoverEvidenceId)) return undefined;
    result.takeoverEvidenceId = data.takeoverEvidenceId;
  }
  if (variant === "claims") {
    const ids = claimIds(data.claimIds);
    if (!ids) return undefined;
    result.claimIds = ids;
  }
  return result;
}

function projectStatusResponse(data: unknown): Record<string, unknown> | undefined {
  if (!hasExactKeys(data, STATUS_KEYS)
    || !Array.isArray(data.claims)
    || data.claims.length > MAX_STATUS_CLAIMS
    || !isSafeNonnegativeInteger(data.claimCount)
    || typeof data.claimsTruncated !== "boolean") return undefined;
  const session = statusSession(data.session);
  if (!session || !Array.isArray(data.claims)) return undefined;
  const claims = data.claims.map(claim);
  if (claims.some((entry) => entry === undefined)) return undefined;
  return {
    session,
    claims: claims as Record<string, unknown>[],
    claimCount: data.claimCount,
    claimsTruncated: data.claimsTruncated,
  };
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

function mutationBody(input: CoordinationUpdateInput): Record<string, unknown> {
  return {
    worktree_id: input.worktree_id,
    session_id: input.session_id,
    incarnation: input.incarnation,
    expected_revision: input.expected_revision,
    fence: input.fence,
    idempotency_key: input.idempotency_key,
  };
}

/** Read a redacted snapshot for one exact project/worktree/session/incarnation identity. */
export async function coordinationStatus(
  project: string,
  worktreeId: string,
  sessionId: string,
  incarnation: number,
): Promise<ToolResult> {
  return request(
    () => api.settled.get("/coordination/snapshot", {
      project,
      worktree_id: worktreeId,
      session_id: sessionId,
      incarnation: String(incarnation),
    }),
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
        (data) => projectMutationResponse(data, "session"),
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
    case "update":
      return request(
        () => api.settled.patch("/coordination/update", {
          ...leaseBody(input),
          snapshot: input.snapshot,
          snapshot_revision: input.snapshot_revision,
          current_task_id: input.current_task_id,
          current_task_revision: input.current_task_revision,
          context_conversation_id: input.context_conversation_id,
          context_revision: input.context_revision,
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
          ...mutationBody(input),
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
      claims: input.claims.map((entry) => ({
        claim: entry.claim,
        ...(entry.baseline_sha256 === undefined ? {} : { baseline_sha256: entry.baseline_sha256 }),
      })),
      idempotency_key: input.idempotency_key,
    }, { project }),
    (data) => projectMutationResponse(data, "claims"),
  );
}

/** Atomically release an exact, unique list of owned claim IDs. */
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
      claim_ids: input.claim_ids,
      idempotency_key: input.idempotency_key,
    }, { project }),
    (data) => projectMutationResponse(data, "claims"),
  );
}
