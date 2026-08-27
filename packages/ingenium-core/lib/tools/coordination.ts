import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  CONTEXT_METADATA_MAX_BYTES,
  isBoundedContextMetadata,
  type ContextMetadata,
  type CoordinationClaimState,
  type CoordinationSession,
  type CoordinationSessionState,
} from "../schema.js";
import {
  canonicalTaskClaimBatch,
  taskClaimsOverlap,
  type TaskClaim,
} from "./task-claims.js";
import * as contextConversations from "./context-conversations.js";

export const COORDINATION_TTL_MIN_MS = 1_000;
export const COORDINATION_TTL_MAX_MS = 5 * 60 * 1_000;
export const COORDINATION_MAX_CLAIMS_PER_MUTATION = 128;
export const COORDINATION_STATUS_CLAIM_LIMIT = 100;
export const COORDINATION_STATUS_PEER_LIMIT = 128;
export const COORDINATION_HANDOFF_LIMIT = 32;
export const COORDINATION_MEMORY_LIMIT = 8;
export const COORDINATION_MEMORY_ACTION_LIMIT = 64;
export const COORDINATION_MEMORY_CHECK_LIMIT = 32;

export type CoordinationErrorCode =
  | "INVALID_COORDINATION_INPUT"
  | "PROJECT_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_IDENTITY_CONFLICT"
  | "SESSION_CLOSED"
  | "SESSION_NOT_ACTIVE"
  | "SESSION_EXPIRED"
  | "REVISION_CONFLICT"
  | "FENCE_CONFLICT"
  | "OWNERSHIP_TOKEN_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "CLAIM_CONFLICT"
  | "CLAIM_KEY_REUSED"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_NOT_OWNED"
  | "EPOCH_QUARANTINED"
  | "BASELINE_MISMATCH"
  | "FOOTPRINT_MISMATCH"
  | "MANIFEST_GENERATION_CONFLICT"
  | "POINTER_NOT_FOUND"
  | "POINTER_REVISION_CONFLICT"
  | "COORDINATION_INTEGRITY_ERROR";

/** Stable failures for COORD-101. Token material and claim values are never embedded in messages. */
export class CoordinationError extends Error {
  constructor(
    public readonly code: CoordinationErrorCode,
    public readonly currentRevision?: number,
  ) {
    super(code);
    this.name = "CoordinationError";
  }
}

export interface CoordinationSessionIdentity {
  worktreeId: string;
  sessionId: string;
  incarnation: number;
}

export interface CoordinationOwnershipInput extends CoordinationSessionIdentity {
  ownershipToken: string;
}

export interface CoordinationLeaseInput extends CoordinationSessionIdentity {
  expectedRevision: number;
  fence: number;
  ownershipToken: string;
  idempotencyKey: string;
}

export interface RegisterCoordinationSessionInput extends CoordinationSessionIdentity {
  ownershipToken: string;
  ttlMs: number;
  idempotencyKey: string;
  contextConversationId?: string;
  contextRevision?: number;
}

export interface RecoverCoordinationSessionInput extends CoordinationLeaseInput {
  nextOwnershipToken: string;
  ttlMs: number;
}

export interface AuthorizedTakeoverCoordinationSessionInput extends CoordinationOwnershipInput {
  expectedRevision: number;
  fence: number;
  nextOwnershipToken: string;
  ttlMs: number;
  idempotencyKey: string;
}

export interface UpdateCoordinationSnapshotInput extends CoordinationLeaseInput {
  snapshot: ContextMetadata;
  snapshotRevision: number;
  currentTaskId: string | null;
  currentTaskRevision: number | null;
  contextConversationId: string | null;
  contextRevision: number | null;
}

export interface HeartbeatCoordinationSessionInput extends CoordinationLeaseInput {
  ttlMs: number;
}

export interface CoordinationClaimInput {
  claim: TaskClaim;
  baselineSha256?: string | null;
  currentSha256?: string | null;
  repositorySha256?: string | null;
}

export interface ClaimCoordinationBatchInput extends CoordinationLeaseInput {
  clientClaimKey: string;
  claims: CoordinationClaimInput[];
  operation?: ManagedCoordinationOperation;
}

export interface ReleaseCoordinationClaimsInput extends CoordinationLeaseInput {
  clientClaimKey: string;
}

export interface MarkCoordinationClaimsInput extends ReleaseCoordinationClaimsInput {
  state: Exclude<CoordinationClaimState, "active" | "released">;
}

export type ManagedCoordinationOperation = "write" | "edit" | "create" | "delete" | "rename" | "apply_patch" | "repository" | "build";

export interface CoordinationClaimProof extends CoordinationLeaseInput {
  clientClaimKey: string;
  acceptedEpoch: number;
}

export interface CoordinationFootprintEntry {
  path?: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface CompleteManagedMutationInput extends CoordinationClaimProof {
  operationId: string;
  operation: ManagedCoordinationOperation;
  footprint: CoordinationFootprintEntry[];
}

export interface RenewCoordinationClaimsInput extends CoordinationClaimProof {
  ttlMs: number;
}

export interface RecoverCoordinationEpochInput extends CoordinationLeaseInput {
  quarantinedSessionId: string;
  quarantinedIncarnation: number;
  quarantinedFence: number;
  quarantinedActorId: string;
  acceptedEpoch: number;
  recoveryFootprintHash: string;
}

export type ReconcileCoordinationEpochInput = RecoverCoordinationEpochInput;

export interface CoordinationEpochRecoveryState {
  acceptedEpoch: number;
  quarantineCode: "unexpected_footprint" | "uncertain_apply" | "dirty_baseline";
  quarantinedSessionId: string;
  quarantinedIncarnation: number;
  quarantinedFence: number;
  quarantinedActorId: string;
  reconciliationRecorded: boolean;
}

export interface CoordinationSessionMutationResult {
  id: string;
  actorId: string;
  revision: number;
  fence: number;
  state: CoordinationSessionState;
  heartbeatAt: string;
  expiresAt: string;
  snapshotRevision: number;
  currentTaskId: string | null;
  currentTaskRevision: number | null;
  contextConversationId: string | null;
  contextRevision: number | null;
  updatedAt: string;
}

/** Non-secret evidence is persisted only in the immutable takeover receipt. */
export interface AuthorizedTakeoverCoordinationSessionResult extends CoordinationSessionMutationResult {
  takeoverEvidenceId: string;
}

export interface CoordinationClaimMutationResult {
  session: CoordinationSessionMutationResult;
  acceptedEpoch: number;
  manifestGeneration: number;
  operationId?: string;
}

export interface CoordinationStatusClaim {
  kind: "path" | "tree" | "reserved";
  state: CoordinationClaimState;
  createdAt: string;
  updatedAt: string;
  releasedAt: string | null;
}

export interface CoordinationHandoffEvent {
  sequence: number;
  eventId: string;
  operation: "write" | "edit";
  path: string;
  baselineSha256: string | null;
  sourceActorId: string;
  sourceIncarnation: number;
  sourceRevision: number;
  currentTaskId: string | null;
  currentTaskRevision: number | null;
  contextConversationId: string | null;
  contextRevision: number | null;
  timestamp: string;
}

export interface PublishCoordinationHandoffInput extends CoordinationLeaseInput {
  operation: CoordinationHandoffEvent["operation"];
  path: string;
  baselineSha256?: string | null;
}

export interface ConsumeCoordinationHandoffsInput extends CoordinationLeaseInput {
  limit?: number;
}

export interface AcknowledgeCoordinationHandoffsInput extends CoordinationLeaseInput {
  throughSequence: number;
}

export interface CoordinationHandoffMutationResult {
  session: CoordinationSessionMutationResult;
  event: CoordinationHandoffEvent;
}

export interface CoordinationHandoffConsumeResult {
  session: CoordinationSessionMutationResult;
  events: CoordinationHandoffEvent[];
}

export interface CoordinationHandoffReadResult extends CoordinationHandoffConsumeResult {
  throughSequence: number;
  acknowledgementRequired: boolean;
}

export type CoordinationOperationalStatus = "active" | "working" | "idle" | "completed" | "error";
export type CoordinationOperationalActionKind = "read" | "search" | "write" | "edit" | "execute";
export type CoordinationOperationalCheckKind = "test" | "typecheck" | "lint" | "build" | "format" | "security" | "other";
export type CoordinationNextWorkKind = "none" | "continue_task" | "review_changes" | "run_checks" | "address_failure";

export interface CoordinationOperationalEntryInput {
  status: CoordinationOperationalStatus;
  actions: Array<{
    kind: CoordinationOperationalActionKind;
    result: "succeeded";
    pathSegments: string[] | null;
    targetHash: string | null;
  }>;
  checks: Array<{
    kind: CoordinationOperationalCheckKind;
    result: "passed" | "failed";
    targetHash: string;
  }>;
  todos: CoordinationPeerSnapshot["todos"];
  currentTaskId: string | null;
  changedPaths: Array<{
    pathSegments: string[];
    operation: "write" | "edit";
    additions: number;
    deletions: number;
    changeRevision: number;
  }>;
  nextWork: {
    kind: CoordinationNextWorkKind;
    referenceHash: string | null;
  };
}

export interface CoordinationOperationalEntry extends CoordinationOperationalEntryInput {
  version: 1;
  type: "operational";
  entryId: string;
  actorId: string;
  sourceRevision: number;
  contextRevision: number;
  timestamp: string;
}

export interface PublishCoordinationMemoryInput extends CoordinationLeaseInput {
  entry: CoordinationOperationalEntryInput;
}

export interface CoordinationMemoryWindow {
  conversationId: string;
  revision: number;
  entries: CoordinationOperationalEntry[];
  throughRevision: number;
  acknowledgementRequired: boolean;
}

export interface ReadCoordinationMemoryInput extends CoordinationLeaseInput {
  limit?: number;
}

export interface AcknowledgeCoordinationMemoryInput extends CoordinationLeaseInput {
  throughRevision: number;
}

export interface CoordinationMemoryReadResult {
  session: CoordinationSessionMutationResult;
  memory: CoordinationMemoryWindow;
}

export interface CoordinationMemoryMutationResult {
  session: CoordinationSessionMutationResult;
  memory: {
    conversationId: string;
    revision: number;
    entry: CoordinationOperationalEntry;
  };
}

export interface CoordinationPeerSnapshot {
  peerId: string;
  incarnation: number;
  sessionRevision: number;
  snapshotRevision: number;
  status: "active" | "working" | "idle";
  todos: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    state: "none" | "pending" | "in_progress" | "complete" | "cancelled" | "mixed";
  };
  changedPaths: Array<{
    path: string;
    operation: "write" | "edit";
    additions: number;
    deletions: number;
    changeRevision: number;
  }>;
  currentTaskId: string | null;
  contextRevision: number | null;
  updatedAt: string;
}

export interface CoordinationStatus {
  session: CoordinationSession;
  claims: CoordinationStatusClaim[];
  claimsTruncated: boolean;
  peers: CoordinationPeerSnapshot[];
}

type Db = ReturnType<typeof getDb>;
type CoordinationOperation =
  | "register"
  | "recover"
  | "authorized_takeover"
  | "snapshot_update"
  | "heartbeat"
  | "claim_batch"
  | "renew_claims"
  | "complete_managed_mutation"
  | "reconcile_epoch"
  | "recover_epoch"
  | "release_claims"
  | "mark_claims"
  | "handoff_publish"
  | "handoff_consume"
  | "handoff_acknowledge"
  | "memory_publish"
  | "memory_acknowledge"
  | "close";

interface StoredSession {
  id: string;
  project_id: string;
  worktree_id: string;
  session_id: string;
  incarnation: number;
  ownership_token_hash: string;
  revision: number;
  fence: number;
  state: CoordinationSessionState;
  heartbeat_at: string;
  expires_at: string;
  snapshot_json: string;
  snapshot_revision: number;
  current_task_id: string | null;
  current_task_revision: number | null;
  context_conversation_id: string | null;
  context_revision: number | null;
  created_at: string;
  updated_at: string;
}

interface StoredClaim {
  id: string;
  project_id: string;
  coordination_session_id: string;
  worktree_id: string;
  incarnation: number;
  fence: number;
  accepted_epoch: number | null;
  client_claim_key_hash: string | null;
  kind: CoordinationStatusClaim["kind"];
  value: string;
  baseline_sha256: string | null;
  state: CoordinationClaimState;
  created_at: string;
  updated_at: string;
  released_at: string | null;
}

interface StoredHandoffEvent {
  sequence: number;
  id: string;
  operation: CoordinationHandoffEvent["operation"];
  path: string;
  baseline_sha256: string | null;
  session_id: string;
  incarnation: number;
  source_revision: number;
  current_task_id: string | null;
  current_task_revision: number | null;
  context_conversation_id: string | null;
  context_revision: number | null;
  created_at: string;
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OWNERSHIP_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const CLIENT_CLAIM_KEY = OWNERSHIP_TOKEN;
const SHA256 = /^[0-9a-f]{64}$/;
const OPAQUE_TASK_ID = /^task-[0-9a-f]{64}$/;
const PEER_SNAPSHOT_VERSION = 1;
const PEER_SNAPSHOT_PATH_LIMIT = 32;
const PEER_SNAPSHOT_COUNT_LIMIT = 1_000_000;
const MAX_RECEIPT_BYTES = 16_384;
const OPERATIONAL_STATUSES = ["active", "working", "idle", "completed", "error"] as const;
const OPERATIONAL_ACTION_KINDS = ["read", "search", "write", "edit", "execute"] as const;
const OPERATIONAL_CHECK_KINDS = ["test", "typecheck", "lint", "build", "format", "security", "other"] as const;
const NEXT_WORK_KINDS = ["none", "continue_task", "review_changes", "run_checks", "address_failure"] as const;
const SNAPSHOT_CREDENTIAL_KEY_WORDS = new Set([
  "token", "secret", "password", "credential", "authorization", "bearer", "privatekey", "apikey",
]);

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Derive the opaque launcher-bound worktree identity without persisting filesystem topology. */
export function coordinationWorktreeId(workspaceId: string, storageMappingHash: string): string {
  if (typeof workspaceId !== "string" || workspaceId.length === 0 || workspaceId.length > 256
    || typeof storageMappingHash !== "string" || !SHA256.test(storageMappingHash)
    || /[\u0000-\u001f\u007f]/.test(workspaceId)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  return `worktree-${createHash("sha256").update(workspaceId).update("\0").update(storageMappingHash).digest("hex")}`;
}

export function coordinationActorId(sessionId: string, incarnation: number): string {
  if (!isCoordinationOpaqueId(sessionId) || !isSafePositiveInteger(incarnation)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  return `actor-${sha256(`${sessionId}\0${incarnation}`)}`;
}

export function ensureCoordinationMemory(projectId: string, worktreeId: string) {
  assertProjectId(projectId);
  if (!isCoordinationOpaqueId(worktreeId)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  return contextConversations.createContextConversation(projectId, {
    title: "Coordination operational memory",
    tags: ["coordination", "operational-memory"],
    priority: 5,
    metadata: { kind: "coordination_operational_memory", version: 2, worktreeId },
    idempotencyKey: `coordination-memory-v2-${sha256(worktreeId)}`,
    visibility: "project",
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function requestHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeNonnegativeInteger(value) && value >= 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validate opaque coordination identifiers without treating them as paths. */
export function isCoordinationOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

/** Validate a caller-supplied, URL-safe ownership secret. */
export function isCoordinationOwnershipToken(value: unknown): value is string {
  return typeof value === "string" && OWNERSHIP_TOKEN.test(value);
}

/** Generate a supported ownership token; callers remain responsible for retaining it. */
export function generateCoordinationOwnershipToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isCoordinationClientClaimKey(value: unknown): value is string {
  return typeof value === "string" && CLIENT_CLAIM_KEY.test(value);
}

export function isCoordinationSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function tokenHash(token: string): string {
  return sha256(token);
}

function hashesEqual(left: string, right: string): boolean {
  return isCoordinationSha256(left)
    && isCoordinationSha256(right)
    && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertIdentity(value: CoordinationSessionIdentity): void {
  if (!isCoordinationOpaqueId(value.worktreeId)
    || !isCoordinationOpaqueId(value.sessionId)
    || !isSafePositiveInteger(value.incarnation)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function assertProjectId(projectId: string): void {
  if (!isCoordinationOpaqueId(projectId)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
}

function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function assertTtl(ttlMs: unknown): asserts ttlMs is number {
  if (typeof ttlMs !== "number"
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < COORDINATION_TTL_MIN_MS
    || ttlMs > COORDINATION_TTL_MAX_MS) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function assertLeaseInput(value: CoordinationLeaseInput): void {
  assertIdentity(value);
  assertIdempotencyKey(value.idempotencyKey);
  if (!isSafeNonnegativeInteger(value.expectedRevision)
    || !isSafePositiveInteger(value.fence)
    || !isCoordinationOwnershipToken(value.ownershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function assertAuthorizedTakeoverInput(value: AuthorizedTakeoverCoordinationSessionInput): void {
  assertIdentity(value);
  assertIdempotencyKey(value.idempotencyKey);
  assertTtl(value.ttlMs);
  if (!isSafeNonnegativeInteger(value.expectedRevision)
    || !isSafePositiveInteger(value.fence)
    || !isCoordinationOwnershipToken(value.ownershipToken)
    || !isCoordinationOwnershipToken(value.nextOwnershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  if (value.ownershipToken === value.nextOwnershipToken) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function assertOwnershipTokensAreNotPublicSessionValues(
  db: Db,
  projectId: string,
  identity: CoordinationSessionIdentity,
  ownershipTokens: readonly string[],
): void {
  const publicValues = new Set<string>([identity.worktreeId, identity.sessionId]);
  const sessions = db.prepare(
    `SELECT id, worktree_id, session_id, current_task_id, context_conversation_id
     FROM coordination_sessions
     WHERE project_id = ?`,
  ).all(projectId) as Array<Pick<StoredSession,
    "id" | "worktree_id" | "session_id" | "current_task_id" | "context_conversation_id">>;
  for (const session of sessions) {
    publicValues.add(session.id);
    publicValues.add(session.worktree_id);
    publicValues.add(session.session_id);
    if (session.current_task_id !== null) publicValues.add(session.current_task_id);
    if (session.context_conversation_id !== null) publicValues.add(session.context_conversation_id);
  }
  if (ownershipTokens.some((token) => publicValues.has(token))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function expiryFrom(current: string, ttlMs: number): string {
  return new Date(Date.parse(current) + ttlMs).toISOString();
}

function isCredentialBearingSnapshotKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const compact = words.join("");
  return words.some((word) => SNAPSHOT_CREDENTIAL_KEY_WORDS.has(word))
    || SNAPSHOT_CREDENTIAL_KEY_WORDS.has(compact);
}

function containsUnsafeSnapshotData(value: unknown, ownershipTokens: readonly string[]): boolean {
  if (typeof value === "string") return ownershipTokens.some((token) => value.includes(token));
  if (Array.isArray(value)) return value.some((entry) => containsUnsafeSnapshotData(entry, ownershipTokens));
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => (
    isCredentialBearingSnapshotKey(key)
    || ownershipTokens.some((token) => key.includes(token))
    || containsUnsafeSnapshotData(entry, ownershipTokens)
  ));
}

function assertSafeSnapshot(snapshot: unknown, ownershipTokens: readonly string[] = []): asserts snapshot is ContextMetadata {
  if (!isBoundedContextMetadata(snapshot) || containsUnsafeSnapshotData(snapshot, ownershipTokens)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function snapshotJson(snapshot: unknown, ownershipTokens: readonly string[] = []): string {
  assertSafeSnapshot(snapshot, ownershipTokens);
  try {
    const json = JSON.stringify(snapshot);
    if (Buffer.byteLength(json, "utf8") > CONTEXT_METADATA_MAX_BYTES) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    return json;
  } catch (error) {
    if (error instanceof CoordinationError) throw error;
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function parseStoredSnapshot(value: string): ContextMetadata {
  try {
    const parsed = JSON.parse(value);
    if (!isBoundedContextMetadata(parsed)) throw new Error("invalid snapshot");
    return parsed;
  } catch {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
}

function requireProject(db: Db, projectId: string): void {
  if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) {
    throw new CoordinationError("PROJECT_NOT_FOUND");
  }
}

function storedSession(
  db: Db,
  projectId: string,
  identity: CoordinationSessionIdentity,
): StoredSession | undefined {
  return db.prepare(
    `SELECT * FROM coordination_sessions
     WHERE project_id = ? AND worktree_id = ? AND session_id = ? AND incarnation = ?`,
  ).get(projectId, identity.worktreeId, identity.sessionId, identity.incarnation) as StoredSession | undefined;
}

function requireSession(db: Db, projectId: string, identity: CoordinationSessionIdentity): StoredSession {
  const session = storedSession(db, projectId, identity);
  if (!session) throw new CoordinationError("SESSION_NOT_FOUND");
  return session;
}

function storedSessionById(db: Db, projectId: string, coordinationSessionId: string): StoredSession | undefined {
  return db.prepare(
    "SELECT * FROM coordination_sessions WHERE project_id = ? AND id = ?",
  ).get(projectId, coordinationSessionId) as StoredSession | undefined;
}

function readSession(row: StoredSession): CoordinationSession {
  if (!UUID.test(row.id)
    || !isCoordinationOpaqueId(row.project_id)
    || !isCoordinationOpaqueId(row.worktree_id)
    || !isCoordinationOpaqueId(row.session_id)
    || !isSafePositiveInteger(row.incarnation)
    || !isSafeNonnegativeInteger(row.revision)
    || !isSafePositiveInteger(row.fence)
    || !["active", "quarantined", "closed"].includes(row.state)
    || !isSafeNonnegativeInteger(row.snapshot_revision)
    || typeof row.heartbeat_at !== "string"
    || typeof row.expires_at !== "string"
    || typeof row.created_at !== "string"
    || typeof row.updated_at !== "string"
    || !pointerPairIsValid(row.current_task_id, row.current_task_revision)
    || !pointerPairIsValid(row.context_conversation_id, row.context_revision)) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return {
    id: row.id,
    project_id: row.project_id,
    worktree_id: row.worktree_id,
    session_id: row.session_id,
    incarnation: row.incarnation,
    revision: row.revision,
    fence: row.fence,
    state: row.state,
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
    snapshot: parseStoredSnapshot(row.snapshot_json),
    snapshot_revision: row.snapshot_revision,
    current_task_id: row.current_task_id,
    current_task_revision: row.current_task_revision,
    context_conversation_id: row.context_conversation_id,
    context_revision: row.context_revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function readClaim(row: StoredClaim): CoordinationStatusClaim {
  if (!UUID.test(row.id)
    || !isCoordinationOpaqueId(row.project_id)
    || !UUID.test(row.coordination_session_id)
    || !isCoordinationOpaqueId(row.worktree_id)
    || !isSafePositiveInteger(row.incarnation)
    || !isSafePositiveInteger(row.fence)
    || !isSafePositiveInteger(row.accepted_epoch)
    || !["path", "tree", "reserved"].includes(row.kind)
    || typeof row.value !== "string"
    || (row.baseline_sha256 !== null && !isCoordinationSha256(row.baseline_sha256))
    || !["active", "released", "dirty", "quarantined", "collision"].includes(row.state)
    || typeof row.created_at !== "string"
    || typeof row.updated_at !== "string"
    || (row.released_at !== null && typeof row.released_at !== "string")) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  const claim = row.kind === "reserved"
    ? { kind: "reserved", name: row.value }
    : { kind: row.kind, path: row.value };
  if (!canonicalTaskClaimBatch([claim])) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  return {
    kind: row.kind,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    releasedAt: row.released_at,
  };
}

function mutationResult(session: StoredSession): CoordinationSessionMutationResult {
  const safe = readSession(session);
  return {
    id: safe.id,
    actorId: coordinationActorId(safe.session_id, safe.incarnation),
    revision: safe.revision,
    fence: safe.fence,
    state: safe.state,
    heartbeatAt: safe.heartbeat_at,
    expiresAt: safe.expires_at,
    snapshotRevision: safe.snapshot_revision,
    currentTaskId: safe.current_task_id,
    currentTaskRevision: safe.current_task_revision,
    contextConversationId: safe.context_conversation_id,
    contextRevision: safe.context_revision,
    updatedAt: safe.updated_at,
  };
}

function pointerPairIsValid(id: unknown, revision: unknown): id is string | null {
  return (id === null && revision === null)
    || (isCoordinationOpaqueId(id) && isSafeNonnegativeInteger(revision));
}

function assertPointerPair(id: unknown, revision: unknown): void {
  if (!pointerPairIsValid(id, revision)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
}

function isExpired(session: StoredSession, current: string): boolean {
  const expiresAt = Date.parse(session.expires_at);
  const nowAt = Date.parse(current);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(nowAt)) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return expiresAt <= nowAt;
}

function requireActiveLease(
  db: Db,
  projectId: string,
  input: CoordinationLeaseInput,
  ownershipHash: string,
  current: string,
): StoredSession {
  const session = requireSession(db, projectId, input);
  if (session.revision !== input.expectedRevision) {
    throw new CoordinationError("REVISION_CONFLICT", session.revision);
  }
  if (session.fence !== input.fence) throw new CoordinationError("FENCE_CONFLICT");
  if (!hashesEqual(session.ownership_token_hash, ownershipHash)) {
    throw new CoordinationError("OWNERSHIP_TOKEN_MISMATCH");
  }
  if (session.state === "closed") throw new CoordinationError("SESSION_CLOSED");
  if (session.state !== "active") throw new CoordinationError("SESSION_NOT_ACTIVE");
  if (isExpired(session, current)) throw new CoordinationError("SESSION_EXPIRED");
  return session;
}

function requireRecoverableLease(
  db: Db,
  projectId: string,
  input: RecoverCoordinationSessionInput,
  ownershipHash: string,
): StoredSession {
  const session = requireSession(db, projectId, input);
  if (session.revision !== input.expectedRevision) {
    throw new CoordinationError("REVISION_CONFLICT", session.revision);
  }
  if (session.fence !== input.fence) throw new CoordinationError("FENCE_CONFLICT");
  if (!hashesEqual(session.ownership_token_hash, ownershipHash)) {
    throw new CoordinationError("OWNERSHIP_TOKEN_MISMATCH");
  }
  if (session.state === "closed") throw new CoordinationError("SESSION_CLOSED");
  return session;
}

function readReceipt<T>(
  db: Db,
  projectId: string,
  operation: CoordinationOperation,
  idempotencyKey: string,
  hash: string,
): T | undefined {
  const receipt = db.prepare(
    `SELECT operation, request_hash, result_json
     FROM coordination_mutation_receipts
     WHERE project_id = ? AND idempotency_key = ?`,
  ).get(projectId, idempotencyKey) as { operation: string; request_hash: string; result_json: string } | undefined;
  if (!receipt) return undefined;
  if (receipt.operation !== operation || !hashesEqual(receipt.request_hash, hash)) {
    throw new CoordinationError("IDEMPOTENCY_KEY_REUSED");
  }
  try {
    return JSON.parse(receipt.result_json) as T;
  } catch {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
}

function writeReceipt<T>(
  db: Db,
  projectId: string,
  operation: CoordinationOperation,
  idempotencyKey: string,
  hash: string,
  result: T,
): T {
  const resultJson = JSON.stringify(result);
  if (Buffer.byteLength(resultJson, "utf8") > MAX_RECEIPT_BYTES) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  db.prepare(
    `INSERT INTO coordination_mutation_receipts
     (id, project_id, operation, idempotency_key, request_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), projectId, operation, idempotencyKey, hash, resultJson, now());
  return result;
}

function allocateFence(db: Db, projectId: string, worktreeId: string, current: string): number {
  db.prepare(
    `INSERT INTO coordination_worktrees (project_id, worktree_id, next_fence, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(project_id, worktree_id) DO NOTHING`,
  ).run(projectId, worktreeId, current, current);
  const advanced = db.prepare(
    `UPDATE coordination_worktrees
     SET next_fence = MAX(
       next_fence,
       COALESCE((SELECT MAX(fence) + 1 FROM coordination_sessions
                 WHERE project_id = ? AND worktree_id = ?), 1),
       COALESCE((SELECT MAX(fence) + 1 FROM coordination_claims
                 WHERE project_id = ? AND worktree_id = ?), 1)
     ) + 1,
     updated_at = ?
     WHERE project_id = ? AND worktree_id = ?
     RETURNING next_fence - 1 AS fence`,
  ).get(projectId, worktreeId, projectId, worktreeId, current, projectId, worktreeId) as { fence: number } | undefined;
  const fence = advanced?.fence;
  if (!isSafePositiveInteger(fence)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  return fence;
}

function maximumForeignClaimFence(db: Db, projectId: string, session: StoredSession): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(fence), 0) AS fence
     FROM coordination_claims
     WHERE project_id = ? AND worktree_id = ? AND coordination_session_id <> ?`,
  ).get(projectId, session.worktree_id, session.id) as { fence: number } | undefined;
  if (!row || !isSafeNonnegativeInteger(row.fence)) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return row.fence;
}

function advanceActiveSession(
  db: Db,
  projectId: string,
  session: StoredSession,
  input: CoordinationLeaseInput,
  ownershipHash: string,
  current: string,
  setClause: string,
  setParameters: unknown[],
): StoredSession {
  const changed = db.prepare(
    `UPDATE coordination_sessions
     SET ${setClause}
     WHERE project_id = ? AND worktree_id = ? AND session_id = ? AND incarnation = ?
       AND revision = ? AND fence = ? AND ownership_token_hash = ?
       AND state = 'active' AND expires_at > ?`,
  ).run(
    ...setParameters,
    projectId, input.worktreeId, input.sessionId, input.incarnation,
    session.revision, input.fence, ownershipHash, current,
  );
  if (changed.changes !== 1) throw new CoordinationError("REVISION_CONFLICT", session.revision);
  return requireSession(db, projectId, input);
}

function assertPointersMatchProject(db: Db, projectId: string, input: UpdateCoordinationSnapshotInput): void {
  assertPointerPair(input.currentTaskId, input.currentTaskRevision);
  assertPointerPair(input.contextConversationId, input.contextRevision);
  if (input.currentTaskId !== null) {
    const task = db.prepare(
      "SELECT revision FROM tasks WHERE project_id = ? AND id = ?",
    ).get(projectId, input.currentTaskId) as { revision: number } | undefined;
    if (!task) throw new CoordinationError("POINTER_NOT_FOUND");
    if (task.revision !== input.currentTaskRevision) throw new CoordinationError("POINTER_REVISION_CONFLICT");
  }
  if (input.contextConversationId !== null) {
    const context = db.prepare(
      `SELECT count(message.id) AS revision
       FROM context_conversations conversation
       LEFT JOIN context_messages message
         ON message.project_id = conversation.project_id AND message.conversation_id = conversation.id
       WHERE conversation.project_id = ? AND conversation.id = ?
       GROUP BY conversation.project_id, conversation.id`,
    ).get(projectId, input.contextConversationId) as { revision: number } | undefined;
    if (!context) throw new CoordinationError("POINTER_NOT_FOUND");
    if (context.revision !== input.contextRevision) throw new CoordinationError("POINTER_REVISION_CONFLICT");
  }
}

function normalizedClaimBatch(value: unknown): Array<{
  claim: TaskClaim;
  baselineSha256: string | null;
  currentSha256: string | null | undefined;
  repositorySha256: string | null | undefined;
}> {
  if (!Array.isArray(value) || value.length === 0 || value.length > COORDINATION_MAX_CLAIMS_PER_MUTATION) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const inputs = value.map((entry) => {
    if (!isPlainRecord(entry)
      || !Object.keys(entry).every((key) => ["claim", "baselineSha256", "currentSha256", "repositorySha256"].includes(key))) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    const baseline = entry.baselineSha256 ?? null;
    if (baseline !== null && !isCoordinationSha256(baseline)) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    for (const hash of [entry.currentSha256, entry.repositorySha256]) {
      if (hash !== undefined && hash !== null && !isCoordinationSha256(hash)) {
        throw new CoordinationError("INVALID_COORDINATION_INPUT");
      }
    }
    return {
      claim: entry.claim,
      baselineSha256: baseline,
      currentSha256: entry.currentSha256 as string | null | undefined,
      repositorySha256: entry.repositorySha256 as string | null | undefined,
    };
  });
  const claims = canonicalTaskClaimBatch(inputs.map((entry) => entry.claim));
  if (!claims) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  for (let index = 0; index < claims.length; index += 1) {
    for (let other = index + 1; other < claims.length; other += 1) {
      if (taskClaimsOverlap(claims[index], claims[other])) {
        throw new CoordinationError("CLAIM_CONFLICT");
      }
    }
  }
  return claims.map((claim, index) => ({
    claim,
    baselineSha256: inputs[index]!.baselineSha256,
    currentSha256: inputs[index]!.currentSha256,
    repositorySha256: inputs[index]!.repositorySha256,
  }));
}

function claimAsTaskClaim(claim: Pick<StoredClaim, "kind" | "value">): TaskClaim {
  if (claim.kind === "reserved") {
    if (claim.value !== "@build" && claim.value !== "@repository") {
      throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    }
    return { kind: "reserved", name: claim.value };
  }
  if (claim.kind !== "path" && claim.kind !== "tree") {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return { kind: claim.kind, path: claim.value };
}

function releaseExpiredClaims(
  db: Db,
  projectId: string,
  worktreeId: string,
  releasedAt: string,
): number {
  return db.prepare(
    `UPDATE coordination_claims
     SET state = 'released', released_at = ?, updated_at = ?
     WHERE project_id = ? AND worktree_id = ? AND state <> 'released'
       AND EXISTS (
         SELECT 1 FROM coordination_sessions
         WHERE coordination_sessions.project_id = coordination_claims.project_id
           AND coordination_sessions.id = coordination_claims.coordination_session_id
           AND coordination_sessions.worktree_id = coordination_claims.worktree_id
           AND coordination_sessions.incarnation = coordination_claims.incarnation
           AND coordination_sessions.fence = coordination_claims.fence
           AND (coordination_sessions.state = 'closed' OR coordination_sessions.expires_at <= ?)
       )`,
  ).run(releasedAt, releasedAt, projectId, worktreeId, releasedAt).changes;
}

function assertNoPersistedOverlap(
  db: Db,
  projectId: string,
  worktreeId: string,
  claims: Array<{ claim: TaskClaim }>,
): void {
  const persisted = db.prepare(
    `SELECT kind, value
     FROM coordination_claims
     WHERE project_id = ? AND worktree_id = ? AND state <> 'released'`,
  ).all(projectId, worktreeId) as Array<Pick<StoredClaim, "kind" | "value">>;
  for (const existing of persisted) {
    const existingClaim = claimAsTaskClaim(existing);
    if (claims.some(({ claim }) => taskClaimsOverlap(claim, existingClaim))) {
      throw new CoordinationError("CLAIM_CONFLICT");
    }
  }
}

interface WorktreeEpoch {
  accepted_epoch: number;
  state: "active" | "quarantined";
  quarantine_code: "unexpected_footprint" | "uncertain_apply" | "dirty_baseline" | null;
  quarantined_coordination_session_id: string | null;
  quarantined_incarnation: number | null;
  quarantined_fence: number | null;
  reconciliation_footprint_hash: string | null;
}

function worktreeEpoch(db: Db, projectId: string, worktreeId: string, current: string): WorktreeEpoch {
  db.prepare(
    `INSERT INTO coordination_worktree_epochs
     (project_id, worktree_id, accepted_epoch, state, quarantine_code, updated_at)
     VALUES (?, ?, 1, 'active', NULL, ?)
     ON CONFLICT(project_id, worktree_id) DO NOTHING`,
  ).run(projectId, worktreeId, current);
  const epoch = db.prepare(
    `SELECT accepted_epoch, state, quarantine_code, quarantined_coordination_session_id,
            quarantined_incarnation, quarantined_fence, reconciliation_footprint_hash
     FROM coordination_worktree_epochs WHERE project_id = ? AND worktree_id = ?`,
  ).get(projectId, worktreeId) as WorktreeEpoch | undefined;
  if (!epoch || !isSafePositiveInteger(epoch.accepted_epoch)
    || (epoch.state !== "active" && epoch.state !== "quarantined")) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return epoch;
}

function repositoryGeneration(db: Db, projectId: string, worktreeId: string, current: string): number {
  db.prepare(
    `INSERT INTO repository_sync_generations (project_id, worktree_id, generation, manifest_hash, updated_at)
     VALUES (?, ?, 0, NULL, ?) ON CONFLICT(project_id, worktree_id) DO NOTHING`,
  ).run(projectId, worktreeId, current);
  const row = db.prepare(
    "SELECT generation FROM repository_sync_generations WHERE project_id = ? AND worktree_id = ?",
  ).get(projectId, worktreeId) as { generation: number } | undefined;
  if (!row || !isSafeNonnegativeInteger(row.generation)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  return row.generation;
}

function assertAcceptedBaselines(
  db: Db,
  projectId: string,
  worktreeId: string,
  claims: ReturnType<typeof normalizedClaimBatch>,
): void {
  for (const entry of claims) {
    if (entry.claim.kind !== "path") {
      if (entry.currentSha256 !== undefined || entry.repositorySha256 !== undefined) {
        throw new CoordinationError("INVALID_COORDINATION_INPUT");
      }
      continue;
    }
    if (entry.currentSha256 === undefined || entry.repositorySha256 === undefined) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    const accepted = db.prepare(
      `SELECT accepted_sha256 FROM coordination_managed_paths
       WHERE project_id = ? AND worktree_id = ? AND path = ?`,
    ).get(projectId, worktreeId, entry.claim.path) as { accepted_sha256: string | null } | undefined;
    const expected = accepted ? accepted.accepted_sha256 : entry.repositorySha256;
    if (entry.currentSha256 !== expected) throw new CoordinationError("BASELINE_MISMATCH");
  }
}

function claimMutationResult(
  db: Db,
  projectId: string,
  session: StoredSession,
  acceptedEpoch: number,
  current: string,
  operationId?: string,
): CoordinationClaimMutationResult {
  return {
    session: mutationResult(session),
    acceptedEpoch,
    manifestGeneration: repositoryGeneration(db, projectId, session.worktree_id, current),
    ...(operationId ? { operationId } : {}),
  };
}

function assertManagedOperation(value: unknown): asserts value is ManagedCoordinationOperation {
  if (!["write", "edit", "create", "delete", "rename", "apply_patch", "repository", "build"].includes(value as string)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function ownedActiveClaims(
  db: Db,
  projectId: string,
  session: StoredSession,
  clientClaimKeyHash: string,
): StoredClaim[] {
  const rows = db.prepare(
    `SELECT * FROM coordination_claims
     WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
       AND incarnation = ? AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
  ).all(
    projectId, session.id, session.worktree_id, session.incarnation, session.fence, clientClaimKeyHash,
  ) as StoredClaim[];
  if (rows.length === 0) throw new CoordinationError("CLAIM_NOT_FOUND");
  for (const claim of rows) {
    if (claim.coordination_session_id !== session.id
      || claim.worktree_id !== session.worktree_id
      || claim.incarnation !== session.incarnation
      || claim.fence !== session.fence
      || claim.state !== "active") {
      throw new CoordinationError("CLAIM_NOT_OWNED");
    }
  }
  return rows;
}

function normalizedHandoffPath(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || value !== value.trim()
    || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:\//.test(value)
    || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const secret = /(^|[-_.])(secret|secrets|token|tokens|password|passwd|credential|credentials|private|apikey|api[-_]?key|id_rsa|env)([-_.]|$)/i;
  if (value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".."
    || Buffer.byteLength(segment, "utf8") > 255 || segment === ".git" || segment.startsWith("@") || secret.test(segment))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  return value;
}

function normalizedEncodedPath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const decoded: string[] = [];
  for (const segment of value) {
    if (typeof segment !== "string" || segment.length < 1 || segment.length > 342
      || !/^[A-Za-z0-9_-]+$/.test(segment)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
    const bytes = Buffer.from(segment, "base64url");
    const text = bytes.toString("utf8");
    if (bytes.length > 255 || Buffer.from(text, "utf8").toString("base64url") !== segment) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    decoded.push(text);
  }
  return encodedHandoffPath(normalizedHandoffPath(decoded.join("/")));
}

function normalizedOperationalEntryInput(value: unknown): CoordinationOperationalEntryInput {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["status", "actions", "checks", "todos", "currentTaskId", "changedPaths", "nextWork"])
    || !OPERATIONAL_STATUSES.includes(value.status as CoordinationOperationalStatus)
    || !Array.isArray(value.actions) || value.actions.length > COORDINATION_MEMORY_ACTION_LIMIT
    || !Array.isArray(value.checks) || value.checks.length > COORDINATION_MEMORY_CHECK_LIMIT
    || !isPlainRecord(value.todos)
    || !hasExactKeys(value.todos, ["total", "pending", "inProgress", "completed", "cancelled", "state"])
    || !Array.isArray(value.changedPaths) || value.changedPaths.length > PEER_SNAPSHOT_PATH_LIMIT
    || !isPlainRecord(value.nextWork)
    || !hasExactKeys(value.nextWork, ["kind", "referenceHash"])) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const actions = value.actions.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["kind", "result", "pathSegments", "targetHash"])
      || !OPERATIONAL_ACTION_KINDS.includes(entry.kind as CoordinationOperationalActionKind)
      || entry.result !== "succeeded"
      || (entry.pathSegments === null) === (entry.targetHash === null)
      || (entry.targetHash !== null && !isCoordinationSha256(entry.targetHash))) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    return {
      kind: entry.kind as CoordinationOperationalActionKind,
      result: "succeeded" as const,
      pathSegments: entry.pathSegments === null ? null : normalizedEncodedPath(entry.pathSegments),
      targetHash: entry.targetHash as string | null,
    };
  });
  const checks = value.checks.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["kind", "result", "targetHash"])
      || !OPERATIONAL_CHECK_KINDS.includes(entry.kind as CoordinationOperationalCheckKind)
      || (entry.result !== "passed" && entry.result !== "failed")
      || !isCoordinationSha256(entry.targetHash)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
    return {
      kind: entry.kind as CoordinationOperationalCheckKind,
      result: entry.result as "passed" | "failed",
      targetHash: entry.targetHash,
    };
  });
  const todoCounts = {
    pending: value.todos.pending as number,
    inProgress: value.todos.inProgress as number,
    completed: value.todos.completed as number,
    cancelled: value.todos.cancelled as number,
  };
  if (![value.todos.total, ...Object.values(todoCounts)].every(boundedSnapshotCount)
    || value.todos.total !== Object.values(todoCounts).reduce((total, count) => total + count, 0)
    || value.todos.state !== todoState(todoCounts)
    || (value.currentTaskId !== null && (typeof value.currentTaskId !== "string" || !OPAQUE_TASK_ID.test(value.currentTaskId)))
    || !NEXT_WORK_KINDS.includes(value.nextWork.kind as CoordinationNextWorkKind)
    || (value.nextWork.referenceHash !== null && !isCoordinationSha256(value.nextWork.referenceHash))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const changedPaths = value.changedPaths.map((entry) => {
    if (!isPlainRecord(entry)
      || !hasExactKeys(entry, ["pathSegments", "operation", "additions", "deletions", "changeRevision"])
      || (entry.operation !== "write" && entry.operation !== "edit")
      || !boundedSnapshotCount(entry.additions) || !boundedSnapshotCount(entry.deletions)
      || !isSafePositiveInteger(entry.changeRevision)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
    return {
      pathSegments: normalizedEncodedPath(entry.pathSegments),
      operation: entry.operation as "write" | "edit",
      additions: entry.additions,
      deletions: entry.deletions,
      changeRevision: entry.changeRevision,
    };
  });
  return {
    status: value.status as CoordinationOperationalStatus,
    actions,
    checks,
    todos: {
      total: value.todos.total as number,
      ...todoCounts as Omit<CoordinationPeerSnapshot["todos"], "total" | "state">,
      state: value.todos.state as CoordinationPeerSnapshot["todos"]["state"],
    },
    currentTaskId: value.currentTaskId as string | null,
    changedPaths,
    nextWork: {
      kind: value.nextWork.kind as CoordinationNextWorkKind,
      referenceHash: value.nextWork.referenceHash as string | null,
    },
  };
}

function readOperationalEntry(value: unknown): CoordinationOperationalEntry {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ["version", "type", "entryId", "actorId", "sourceRevision", "timestamp",
      "status", "actions", "checks", "todos", "currentTaskId", "contextRevision", "changedPaths", "nextWork"])
    || value.version !== 1 || value.type !== "operational" || typeof value.entryId !== "string" || !UUID.test(value.entryId)
    || typeof value.actorId !== "string" || !/^actor-[0-9a-f]{64}$/.test(value.actorId)
    || !isSafePositiveInteger(value.sourceRevision) || typeof value.timestamp !== "string"
    || !Number.isFinite(Date.parse(value.timestamp))
    || !isSafeNonnegativeInteger(value.contextRevision)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  try {
    const input = normalizedOperationalEntryInput({
      status: value.status,
      actions: value.actions,
      checks: value.checks,
      todos: value.todos,
      currentTaskId: value.currentTaskId,
      changedPaths: value.changedPaths,
      nextWork: value.nextWork,
    });
    return {
      version: 1,
      type: "operational",
      entryId: value.entryId,
      actorId: value.actorId,
      sourceRevision: value.sourceRevision,
      contextRevision: value.contextRevision,
      timestamp: value.timestamp,
      ...input,
    };
  } catch {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
}

function requireCoordinationMemory(
  db: Db,
  projectId: string,
  worktreeId: string,
  conversationId: string,
): number {
  const row = db.prepare(
    `SELECT conversation.metadata, count(message.id) AS revision
     FROM context_conversations conversation
     LEFT JOIN context_messages message
       ON message.project_id = conversation.project_id AND message.conversation_id = conversation.id
     WHERE conversation.project_id = ? AND conversation.id = ?
     GROUP BY conversation.id`,
  ).get(projectId, conversationId) as { metadata: string; revision: number } | undefined;
  if (!row || !isSafeNonnegativeInteger(row.revision)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  try {
    const metadata = JSON.parse(row.metadata) as unknown;
    if (!isPlainRecord(metadata)
      || !hasExactKeys(metadata, ["kind", "version", "worktreeId"])
      || metadata.kind !== "coordination_operational_memory" || metadata.version !== 2
      || metadata.worktreeId !== worktreeId) throw new Error("invalid coordination memory");
  } catch {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return row.revision;
}

export function readCoordinationMemory(
  projectId: string,
  worktreeId: string,
  limit = COORDINATION_MEMORY_LIMIT,
): CoordinationMemoryWindow {
  assertProjectId(projectId);
  if (!isCoordinationOpaqueId(worktreeId) || !Number.isSafeInteger(limit) || limit < 1 || limit > COORDINATION_MEMORY_LIMIT) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const memory = ensureCoordinationMemory(projectId, worktreeId);
  const db = getDb(dbPath());
  const revision = requireCoordinationMemory(db, projectId, worktreeId, memory.id);
  const rows = db.prepare(
    `SELECT content, metadata FROM (
       SELECT content, metadata, sequence FROM context_messages
       WHERE project_id = ? AND conversation_id = ?
         AND json_extract(metadata, '$.kind') = 'coordination_operational_entry'
       ORDER BY sequence DESC LIMIT ?
     ) ORDER BY sequence ASC`,
  ).all(projectId, memory.id, limit) as Array<{ content: string; metadata: string }>;
  const entries = rows.map((row) => {
    try {
      const metadata = JSON.parse(row.metadata) as unknown;
      const content = JSON.parse(row.content) as unknown;
      if (!isPlainRecord(metadata) || !hasExactKeys(metadata, ["kind", "version", "entryId"])
        || metadata.kind !== "coordination_operational_entry" || metadata.version !== 1
        || !isPlainRecord(content) || metadata.entryId !== content.entryId) throw new Error("invalid entry");
      return readOperationalEntry(content);
    } catch {
      throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    }
  });
  return { conversationId: memory.id, revision, entries, throughRevision: revision, acknowledgementRequired: false };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function boundedSnapshotCount(value: unknown): value is number {
  return isSafeNonnegativeInteger(value) && value <= PEER_SNAPSHOT_COUNT_LIMIT;
}

function todoState(counts: Omit<CoordinationPeerSnapshot["todos"], "total" | "state">): CoordinationPeerSnapshot["todos"]["state"] {
  const populated = [counts.pending, counts.inProgress, counts.completed, counts.cancelled].filter((count) => count > 0).length;
  if (populated === 0) return "none";
  if (populated > 1) return "mixed";
  if (counts.inProgress > 0) return "in_progress";
  if (counts.pending > 0) return "pending";
  if (counts.completed > 0) return "complete";
  return "cancelled";
}

function projectedPeerSnapshot(session: StoredSession): CoordinationPeerSnapshot | undefined {
  const snapshot = parseStoredSnapshot(session.snapshot_json);
  if (!hasExactKeys(snapshot, ["version", "status", "todos", "changedPaths", "currentTaskId", "contextRevision"])
    || snapshot.version !== PEER_SNAPSHOT_VERSION
    || (snapshot.status !== "active" && snapshot.status !== "working" && snapshot.status !== "idle")
    || !isPlainRecord(snapshot.todos)
    || !hasExactKeys(snapshot.todos, ["pending", "inProgress", "completed", "cancelled"])
    || !boundedSnapshotCount(snapshot.todos.pending)
    || !boundedSnapshotCount(snapshot.todos.inProgress)
    || !boundedSnapshotCount(snapshot.todos.completed)
    || !boundedSnapshotCount(snapshot.todos.cancelled)
    || !Array.isArray(snapshot.changedPaths)
    || snapshot.changedPaths.length > PEER_SNAPSHOT_PATH_LIMIT
    || (snapshot.currentTaskId !== null && (typeof snapshot.currentTaskId !== "string" || !OPAQUE_TASK_ID.test(snapshot.currentTaskId)))
    || (snapshot.contextRevision !== null && !isSafeNonnegativeInteger(snapshot.contextRevision))) return undefined;

  const changedPaths: CoordinationPeerSnapshot["changedPaths"] = [];
  for (const entry of snapshot.changedPaths) {
    if (!isPlainRecord(entry)
      || !hasExactKeys(entry, ["path", "operation", "additions", "deletions", "changeRevision"])
      || (entry.operation !== "write" && entry.operation !== "edit")
      || !boundedSnapshotCount(entry.additions)
      || !boundedSnapshotCount(entry.deletions)
      || !isSafePositiveInteger(entry.changeRevision)) return undefined;
    let path: string;
    try {
      path = normalizedHandoffPath(entry.path);
    } catch {
      return undefined;
    }
    changedPaths.push({
      path,
      operation: entry.operation,
      additions: entry.additions,
      deletions: entry.deletions,
      changeRevision: entry.changeRevision,
    });
  }

  const counts = {
    pending: snapshot.todos.pending,
    inProgress: snapshot.todos.inProgress,
    completed: snapshot.todos.completed,
    cancelled: snapshot.todos.cancelled,
  };
  return {
    peerId: `peer-${sha256(`${session.session_id}\0${session.incarnation}`)}`,
    incarnation: session.incarnation,
    sessionRevision: session.revision,
    snapshotRevision: session.snapshot_revision,
    status: snapshot.status,
    todos: {
      ...counts,
      total: counts.pending + counts.inProgress + counts.completed + counts.cancelled,
      state: todoState(counts),
    },
    changedPaths,
    currentTaskId: snapshot.currentTaskId,
    contextRevision: snapshot.contextRevision,
    updatedAt: session.updated_at,
  };
}

function readHandoff(row: StoredHandoffEvent): CoordinationHandoffEvent {
  return {
    sequence: row.sequence,
    eventId: row.id,
    operation: row.operation,
    path: row.path,
    baselineSha256: row.baseline_sha256,
    sourceActorId: coordinationActorId(row.session_id, row.incarnation),
    sourceIncarnation: row.incarnation,
    sourceRevision: row.source_revision,
    currentTaskId: opaqueTaskId(row.current_task_id),
    currentTaskRevision: row.current_task_revision,
    contextConversationId: row.context_conversation_id,
    contextRevision: row.context_revision,
    timestamp: row.created_at,
  };
}

function encodedHandoffPath(path: string): string[] {
  return path.split("/").map((segment) => Buffer.from(segment, "utf8").toString("base64url"));
}

function opaqueTaskId(value: string | null): string | null {
  return value === null || /^task-[0-9a-f]{64}$/.test(value) ? value : `task-${sha256(value)}`;
}

function handoffReceipt(row: StoredHandoffEvent): Record<string, unknown> {
  return {
    version: 1,
    type: "handoff_receipt",
    sequence: row.sequence,
    eventId: row.id,
    operation: row.operation,
    pathSegments: encodedHandoffPath(row.path),
    baselineSha256: row.baseline_sha256,
    sourceActorId: coordinationActorId(row.session_id, row.incarnation),
    sourceIncarnation: row.incarnation,
    sourceRevision: row.source_revision,
    currentTaskId: opaqueTaskId(row.current_task_id),
    timestamp: row.created_at,
  };
}

function contextMemoryMatches(db: Db, projectId: string, row: StoredHandoffEvent): boolean {
  if (row.context_conversation_id === null || row.context_revision === null || row.context_revision < 1) return false;
  const message = db.prepare(
    `SELECT content, metadata FROM context_messages
     WHERE project_id = ? AND conversation_id = ? AND sequence = ? AND role = 'system'`,
  ).get(projectId, row.context_conversation_id, row.context_revision - 1) as {
    content: string;
    metadata: string;
  } | undefined;
  if (!message) return false;
  try {
    const metadata = JSON.parse(message.metadata) as unknown;
    const content = JSON.parse(message.content) as unknown;
    return isPlainRecord(metadata)
      && hasExactKeys(metadata, ["kind", "version", "eventId"])
      && metadata.kind === "coordination_handoff_receipt"
      && metadata.version === 1
      && metadata.eventId === row.id
      && isPlainRecord(content)
      && requestHash(content) === requestHash(handoffReceipt(row));
  } catch {
    return false;
  }
}

function selectHandoffRows(
  db: Db,
  projectId: string,
  worktreeId: string,
  afterSequence: number,
): StoredHandoffEvent[] {
  return db.prepare(
    `SELECT event.sequence, event.id, event.operation, event.path, event.baseline_sha256,
            event.source_revision, event.current_task_id, event.current_task_revision,
            event.context_conversation_id, event.context_revision, event.created_at,
            source.session_id, source.incarnation
     FROM coordination_handoff_events event
     JOIN coordination_sessions source
       ON source.project_id = event.project_id AND source.id = event.source_coordination_session_id
     WHERE event.project_id = ? AND event.worktree_id = ? AND event.sequence > ?
     ORDER BY event.sequence ASC
     LIMIT ?`,
  ).all(projectId, worktreeId, afterSequence, COORDINATION_HANDOFF_LIMIT * 4) as StoredHandoffEvent[];
}

function storedHandoffById(db: Db, projectId: string, eventId: string): StoredHandoffEvent | undefined {
  return db.prepare(
    `SELECT event.sequence, event.id, event.operation, event.path, event.baseline_sha256,
            event.source_revision, event.current_task_id, event.current_task_revision,
            event.context_conversation_id, event.context_revision, event.created_at,
            source.session_id, source.incarnation
     FROM coordination_handoff_events event
     JOIN coordination_sessions source
       ON source.project_id = event.project_id AND source.id = event.source_coordination_session_id
     WHERE event.project_id = ? AND event.id = ?`,
  ).get(projectId, eventId) as StoredHandoffEvent | undefined;
}

/** Register a new opaque session identity and allocate a durable, never-reused worktree fence. */
export function registerCoordinationSession(
  projectId: string,
  input: RegisterCoordinationSessionInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertIdentity(input);
  assertIdempotencyKey(input.idempotencyKey);
  assertTtl(input.ttlMs);
  if (!isCoordinationOwnershipToken(input.ownershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  if ((input.contextConversationId === undefined) !== (input.contextRevision === undefined)
    || (input.contextConversationId !== undefined && !UUID.test(input.contextConversationId))
    || (input.contextRevision !== undefined && !isSafeNonnegativeInteger(input.contextRevision))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    assertOwnershipTokensAreNotPublicSessionValues(db, projectId, input, [input.ownershipToken]);
    const ownershipHash = tokenHash(input.ownershipToken);
    const hash = requestHash({
      operation: "register",
      projectId,
      identity: identityForHash(input),
      ownershipTokenHash: ownershipHash,
      ttlMs: input.ttlMs,
      contextConversationId: input.contextConversationId ?? null,
      // The API-owned operational-memory revision may advance between retries; the stable conversation is the request identity.
    });
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "register", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    if (storedSession(db, projectId, input)) throw new CoordinationError("SESSION_IDENTITY_CONFLICT");
    if (input.contextConversationId !== undefined) {
      const context = db.prepare(
        `SELECT count(message.id) AS revision
         FROM context_conversations conversation
         LEFT JOIN context_messages message
           ON message.project_id = conversation.project_id AND message.conversation_id = conversation.id
         WHERE conversation.project_id = ? AND conversation.id = ?
         GROUP BY conversation.id`,
      ).get(projectId, input.contextConversationId) as { revision: number } | undefined;
      if (!context) throw new CoordinationError("POINTER_NOT_FOUND");
      if (context.revision !== input.contextRevision) throw new CoordinationError("POINTER_REVISION_CONFLICT");
    }
    const createdAt = now();
    releaseExpiredClaims(db, projectId, input.worktreeId, createdAt);
    const fence = allocateFence(db, projectId, input.worktreeId, createdAt);
    db.prepare(
      `INSERT INTO coordination_sessions
       (id, project_id, worktree_id, session_id, incarnation, ownership_token_hash, revision, fence, state,
        heartbeat_at, expires_at, snapshot_json, snapshot_revision, current_task_id, current_task_revision,
         context_conversation_id, context_revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, '{}', 0, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), projectId, input.worktreeId, input.sessionId, input.incarnation, ownershipHash, fence,
      createdAt, expiryFrom(createdAt, input.ttlMs), input.contextConversationId ?? null,
      input.contextRevision ?? null, createdAt, createdAt,
    );
    const session = requireSession(db, projectId, input);
    const previousCursor = db.prepare(
      `SELECT cursor.last_sequence AS sequence
       FROM coordination_handoff_cursors cursor
       JOIN coordination_sessions prior
         ON prior.project_id = cursor.project_id AND prior.id = cursor.coordination_session_id
       WHERE prior.project_id = ? AND prior.worktree_id = ? AND prior.session_id = ? AND prior.id <> ?
       ORDER BY prior.incarnation DESC LIMIT 1`,
    ).get(projectId, input.worktreeId, input.sessionId, session.id) as { sequence: number } | undefined;
    const latestHandoff = db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM coordination_handoff_events WHERE project_id = ? AND worktree_id = ?",
    ).get(projectId, input.worktreeId) as { sequence: number };
    db.prepare(
      `INSERT INTO coordination_handoff_cursors
       (project_id, coordination_session_id, worktree_id, last_sequence, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(projectId, session.id, input.worktreeId, previousCursor?.sequence ?? latestHandoff.sequence, createdAt);
    if (input.contextConversationId !== undefined && input.contextRevision !== undefined) {
      const previousMemoryCursor = db.prepare(
        `SELECT cursor.last_revision AS revision
         FROM coordination_memory_cursors cursor
         JOIN coordination_sessions prior
           ON prior.project_id = cursor.project_id AND prior.id = cursor.coordination_session_id
         WHERE prior.project_id = ? AND prior.worktree_id = ? AND prior.session_id = ? AND prior.id <> ?
         ORDER BY prior.incarnation DESC LIMIT 1`,
      ).get(projectId, input.worktreeId, input.sessionId, session.id) as { revision: number } | undefined;
      db.prepare(
        `INSERT INTO coordination_memory_cursors
         (project_id, coordination_session_id, worktree_id, conversation_id, last_revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        projectId,
        session.id,
        input.worktreeId,
        input.contextConversationId,
        previousMemoryCursor?.revision ?? Math.max(0, input.contextRevision - COORDINATION_MEMORY_LIMIT),
        createdAt,
      );
    }
    return {
      result: writeReceipt(db, projectId, "register", input.idempotencyKey, hash, mutationResult(session)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Rotate the ownership token and advance the fence after proving the exact prior lease. */
export function recoverCoordinationSession(
  projectId: string,
  input: RecoverCoordinationSessionInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  assertTtl(input.ttlMs);
  if (!isCoordinationOwnershipToken(input.nextOwnershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  if (input.ownershipToken === input.nextOwnershipToken) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    assertOwnershipTokensAreNotPublicSessionValues(
      db, projectId, input, [input.ownershipToken, input.nextOwnershipToken],
    );
    const persisted = storedSession(db, projectId, input);
    if (persisted) {
      assertSafeSnapshot(parseStoredSnapshot(persisted.snapshot_json), [input.ownershipToken, input.nextOwnershipToken]);
    }
    const ownershipHash = tokenHash(input.ownershipToken);
    const nextOwnershipHash = tokenHash(input.nextOwnershipToken);
    const hash = requestHash({
      operation: "recover",
      projectId,
      identity: identityForHash(input),
      expectedRevision: input.expectedRevision,
      fence: input.fence,
      ownershipTokenHash: ownershipHash,
      nextOwnershipTokenHash: nextOwnershipHash,
      ttlMs: input.ttlMs,
    });
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "recover", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const session = requireRecoverableLease(db, projectId, input, ownershipHash);
    const updatedAt = now();
    if (worktreeEpoch(db, projectId, input.worktreeId, updatedAt).state !== "active") {
      throw new CoordinationError("EPOCH_QUARANTINED");
    }
    const nextFence = allocateFence(db, projectId, input.worktreeId, updatedAt);
    if (nextFence <= session.fence) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const changed = db.prepare(
      `UPDATE coordination_sessions
       SET ownership_token_hash = ?, fence = ?, state = 'active', revision = revision + 1,
           heartbeat_at = ?, expires_at = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND session_id = ? AND incarnation = ?
         AND revision = ? AND fence = ? AND ownership_token_hash = ? AND state <> 'closed'`,
    ).run(
      nextOwnershipHash, nextFence, updatedAt, expiryFrom(updatedAt, input.ttlMs), updatedAt,
      projectId, input.worktreeId, input.sessionId, input.incarnation,
      session.revision, input.fence, ownershipHash,
    );
    if (changed.changes !== 1) throw new CoordinationError("REVISION_CONFLICT", session.revision);
    db.prepare(
      `UPDATE coordination_claims
       SET fence = ?, updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
         AND incarnation = ? AND fence = ? AND state <> 'released'`,
    ).run(nextFence, updatedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence);
    const updated = requireSession(db, projectId, input);
    return {
      result: writeReceipt(db, projectId, "recover", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Replace an active or quarantined session's owner after proving the current ownership token. */
export function authorizedTakeoverCoordinationSession(
  projectId: string,
  input: AuthorizedTakeoverCoordinationSessionInput,
): AuthorizedTakeoverCoordinationSessionResult {
  assertProjectId(projectId);
  assertAuthorizedTakeoverInput(input);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const ownershipHash = tokenHash(input.ownershipToken);
    const nextOwnershipHash = tokenHash(input.nextOwnershipToken);
    const hash = requestHash({
      operation: "authorized_takeover",
      projectId,
      identity: identityForHash(input),
      expectedRevision: input.expectedRevision,
      fence: input.fence,
      ownershipTokenHash: ownershipHash,
      nextOwnershipTokenHash: nextOwnershipHash,
      ttlMs: input.ttlMs,
    });
    const replay = readReceipt<AuthorizedTakeoverCoordinationSessionResult>(
      db, projectId, "authorized_takeover", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const session = requireRecoverableLease(db, projectId, input, ownershipHash);
    assertOwnershipTokensAreNotPublicSessionValues(
      db, projectId, input, [input.ownershipToken, input.nextOwnershipToken],
    );
    assertSafeSnapshot(parseStoredSnapshot(session.snapshot_json), [input.ownershipToken, input.nextOwnershipToken]);
    const updatedAt = now();
    if (worktreeEpoch(db, projectId, input.worktreeId, updatedAt).state !== "active") {
      throw new CoordinationError("EPOCH_QUARANTINED");
    }
    const nextFence = allocateFence(db, projectId, input.worktreeId, updatedAt);
    if (nextFence <= session.fence) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const changed = db.prepare(
      `UPDATE coordination_sessions
       SET ownership_token_hash = ?, fence = ?, state = 'active', revision = revision + 1,
           heartbeat_at = ?, expires_at = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND session_id = ? AND incarnation = ?
          AND revision = ? AND fence = ? AND ownership_token_hash = ? AND state <> 'closed'`,
    ).run(
      nextOwnershipHash, nextFence, updatedAt, expiryFrom(updatedAt, input.ttlMs), updatedAt,
       projectId, input.worktreeId, input.sessionId, input.incarnation,
       session.revision, input.fence, ownershipHash,
    );
    if (changed.changes !== 1) throw new CoordinationError("REVISION_CONFLICT", session.revision);
    db.prepare(
      `UPDATE coordination_claims
       SET fence = ?, updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
         AND incarnation = ? AND fence = ? AND state <> 'released'`,
    ).run(nextFence, updatedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence);
    const updated = requireSession(db, projectId, input);
    const response: AuthorizedTakeoverCoordinationSessionResult = {
      ...mutationResult(updated),
      takeoverEvidenceId: randomUUID(),
    };
    return {
      result: writeReceipt(db, projectId, "authorized_takeover", input.idempotencyKey, hash, response),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Replace the bounded operational snapshot and its project-owned task/context pointers. */
export function updateCoordinationSnapshot(
  projectId: string,
  input: UpdateCoordinationSnapshotInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  if (!isSafeNonnegativeInteger(input.snapshotRevision)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  if ((input.currentTaskId !== null && input.currentTaskId === input.ownershipToken)
    || (input.contextConversationId !== null && input.contextConversationId === input.ownershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const serializedSnapshot = snapshotJson(input.snapshot, [input.ownershipToken]);
  assertPointerPair(input.currentTaskId, input.currentTaskRevision);
  assertPointerPair(input.contextConversationId, input.contextRevision);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "snapshot_update",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    snapshot: input.snapshot,
    snapshotRevision: input.snapshotRevision,
    currentTaskId: input.currentTaskId,
    currentTaskRevision: input.currentTaskRevision,
    contextConversationId: input.contextConversationId,
    contextRevision: input.contextRevision,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "snapshot_update", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const updatedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, updatedAt);
    assertPointersMatchProject(db, projectId, input);
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      updatedAt,
      `snapshot_json = ?, snapshot_revision = ?, current_task_id = ?, current_task_revision = ?,
       context_conversation_id = ?, context_revision = ?, revision = revision + 1, updated_at = ?`,
      [
        serializedSnapshot, input.snapshotRevision, input.currentTaskId, input.currentTaskRevision,
        input.contextConversationId, input.contextRevision, updatedAt,
      ],
    );
    return {
      result: writeReceipt(db, projectId, "snapshot_update", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Extend an active lease only while it remains unexpired; expired sessions must recover explicitly. */
export function heartbeatCoordinationSession(
  projectId: string,
  input: HeartbeatCoordinationSessionInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  assertTtl(input.ttlMs);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "heartbeat",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    ttlMs: input.ttlMs,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "heartbeat", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const heartbeatAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, heartbeatAt);
    const expiresAt = new Date(Math.max(
      Date.parse(session.expires_at) + 1,
      Date.parse(heartbeatAt) + input.ttlMs,
    )).toISOString();
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      heartbeatAt,
      "heartbeat_at = ?, expires_at = ?, revision = revision + 1, updated_at = ?",
      [heartbeatAt, expiresAt, heartbeatAt],
    );
    return {
      result: writeReceipt(db, projectId, "heartbeat", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Publish one content-free write handoff while proving the source session lease. */
export function publishCoordinationHandoff(
  projectId: string,
  input: PublishCoordinationHandoffInput,
): CoordinationHandoffMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const path = normalizedHandoffPath(input.path);
  if (input.operation !== "write" && input.operation !== "edit") {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const baselineSha256 = input.baselineSha256 ?? null;
  if (baselineSha256 !== null && (typeof baselineSha256 !== "string" || !SHA256.test(baselineSha256))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const memory = ensureCoordinationMemory(projectId, input.worktreeId);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "handoff_publish",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    handoff: { operation: input.operation, path, baselineSha256 },
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationHandoffMutationResult>(
      db, projectId, "handoff_publish", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const createdAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, createdAt);
    const eventId = randomUUID();
    const sourceRevision = session.revision + 1;
    db.prepare(
      `INSERT INTO coordination_handoff_events
       (id, project_id, worktree_id, source_coordination_session_id, source_revision, operation, path,
        baseline_sha256, current_task_id, current_task_revision, context_conversation_id, context_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      eventId, projectId, input.worktreeId, session.id, sourceRevision, input.operation, path,
      baselineSha256, session.current_task_id, session.current_task_revision,
       null, null, createdAt,
    );
    const persistedEvent = storedHandoffById(db, projectId, eventId);
    if (!persistedEvent) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const contextRevision = (db.prepare(
      "SELECT count(*) AS revision FROM context_messages WHERE project_id = ? AND conversation_id = ?",
    ).get(projectId, memory.id) as { revision: number }).revision;
    const appended = contextConversations.appendContextMessageInTransaction(db, projectId, memory.id, {
      role: "system",
      content: JSON.stringify(handoffReceipt(persistedEvent)),
      tags: ["coordination", "handoff-receipt"],
      priority: 5,
      metadata: { kind: "coordination_handoff_receipt", version: 1, eventId },
      expectedRevision: contextRevision,
      idempotencyKey: `coordination-event-${eventId.replaceAll("-", "")}`,
    });
    db.prepare(
      `UPDATE coordination_handoff_events
       SET context_conversation_id = ?, context_revision = ?
       WHERE project_id = ? AND id = ?`,
    ).run(memory.id, appended.revision, projectId, eventId);
    const updated = advanceActiveSession(
      db, projectId, session, input, ownershipHash, createdAt,
      "context_conversation_id = ?, context_revision = ?, revision = revision + 1, updated_at = ?",
      [memory.id, appended.revision, createdAt],
    );
    const event = storedHandoffById(db, projectId, eventId);
    if (!event) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const mutation = { session: mutationResult(updated), event: readHandoff(event) };
    return {
      result: writeReceipt(db, projectId, "handoff_publish", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

export function publishCoordinationMemory(
  projectId: string,
  input: PublishCoordinationMemoryInput,
): CoordinationMemoryMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const normalizedEntry = normalizedOperationalEntryInput(input.entry);
  if (Buffer.byteLength(JSON.stringify(normalizedEntry), "utf8") > 12_288) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const memory = ensureCoordinationMemory(projectId, input.worktreeId);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "memory_publish",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    entry: normalizedEntry,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationMemoryMutationResult>(
      db, projectId, "memory_publish", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const createdAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, createdAt);
    const contextRevision = requireCoordinationMemory(db, projectId, input.worktreeId, memory.id);
    if (session.context_conversation_id !== memory.id) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const entry: CoordinationOperationalEntry = {
      version: 1,
      type: "operational",
      entryId: randomUUID(),
      actorId: coordinationActorId(session.session_id, session.incarnation),
      sourceRevision: session.revision + 1,
      // This is the server-observed revision immediately before the atomic append.
      contextRevision,
      timestamp: createdAt,
      ...normalizedEntry,
    };
    const appended = contextConversations.appendContextMessageInTransaction(db, projectId, memory.id, {
      role: "system",
      content: JSON.stringify(entry),
      tags: ["coordination", "operational-memory"],
      priority: 5,
      metadata: { kind: "coordination_operational_entry", version: 1, entryId: entry.entryId },
      expectedRevision: contextRevision,
      idempotencyKey: `coordination-memory-${sha256(`${session.id}\0${input.idempotencyKey}`)}`,
    });
    const updated = advanceActiveSession(
      db, projectId, session, input, ownershipHash, createdAt,
      "context_conversation_id = ?, context_revision = ?, revision = revision + 1, updated_at = ?",
      [memory.id, appended.revision, createdAt],
    );
    const mutation: CoordinationMemoryMutationResult = {
      session: mutationResult(updated),
      memory: { conversationId: memory.id, revision: appended.revision, entry },
    };
    return {
      result: writeReceipt(db, projectId, "memory_publish", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Read unseen typed operational memory without advancing the receiver cursor. */
export function readCoordinationMemoryUpdates(
  projectId: string,
  input: ReadCoordinationMemoryInput,
): CoordinationMemoryReadResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const limit = input.limit ?? COORDINATION_MEMORY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > COORDINATION_MEMORY_LIMIT) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const db = getDb(dbPath());
  requireProject(db, projectId);
  const session = requireActiveLease(db, projectId, input, tokenHash(input.ownershipToken), now());
  if (!session.context_conversation_id) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  const revision = requireCoordinationMemory(db, projectId, input.worktreeId, session.context_conversation_id);
  const cursor = db.prepare(
    `SELECT conversation_id, last_revision FROM coordination_memory_cursors
     WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
  ).get(projectId, session.id, input.worktreeId) as { conversation_id: string; last_revision: number } | undefined;
  if (!cursor || cursor.conversation_id !== session.context_conversation_id || cursor.last_revision > revision) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  const rows = db.prepare(
    `SELECT sequence, content, metadata FROM context_messages
     WHERE project_id = ? AND conversation_id = ? AND sequence >= ?
     ORDER BY sequence ASC LIMIT ?`,
  ).all(
    projectId,
    session.context_conversation_id,
    cursor.last_revision,
    limit * 4,
  ) as Array<{ sequence: number; content: string; metadata: string }>;
  const receiverActorId = coordinationActorId(session.session_id, session.incarnation);
  const entries: CoordinationOperationalEntry[] = [];
  let throughRevision = cursor.last_revision;
  for (const row of rows) {
    throughRevision = row.sequence + 1;
    let metadata: unknown;
    try {
      metadata = JSON.parse(row.metadata) as unknown;
    } catch {
      throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    }
    if (!isPlainRecord(metadata) || metadata.kind !== "coordination_operational_entry") continue;
    try {
      const content = JSON.parse(row.content) as unknown;
      if (!hasExactKeys(metadata, ["kind", "version", "entryId"])
        || metadata.version !== 1 || !isPlainRecord(content) || metadata.entryId !== content.entryId) {
        throw new Error("invalid entry");
      }
      const entry = readOperationalEntry(content);
      if (entry.actorId !== receiverActorId) entries.push(entry);
    } catch {
      throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    }
    if (entries.length === limit) break;
  }
  return {
    session: mutationResult(session),
    memory: {
      conversationId: session.context_conversation_id,
      revision,
      entries,
      throughRevision,
      acknowledgementRequired: throughRevision > cursor.last_revision,
    },
  };
}

/** Advance the durable memory cursor only after the receiver validates its transform payload. */
export function acknowledgeCoordinationMemory(
  projectId: string,
  input: AcknowledgeCoordinationMemoryInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  if (!isSafeNonnegativeInteger(input.throughRevision)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "memory_acknowledge",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    throughRevision: input.throughRevision,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationSessionMutationResult>(
      db, projectId, "memory_acknowledge", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const acknowledgedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, acknowledgedAt);
    if (!session.context_conversation_id) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const maximum = requireCoordinationMemory(db, projectId, input.worktreeId, session.context_conversation_id);
    const cursor = db.prepare(
      `SELECT conversation_id, last_revision FROM coordination_memory_cursors
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
    ).get(projectId, session.id, input.worktreeId) as { conversation_id: string; last_revision: number } | undefined;
    if (!cursor || cursor.conversation_id !== session.context_conversation_id) {
      throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    }
    if (input.throughRevision < cursor.last_revision || input.throughRevision > maximum) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    let updated = session;
    if (input.throughRevision > cursor.last_revision) {
      db.prepare(
        `UPDATE coordination_memory_cursors SET last_revision = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
      ).run(input.throughRevision, acknowledgedAt, projectId, session.id, input.worktreeId);
      updated = advanceActiveSession(
        db, projectId, session, input, ownershipHash, acknowledgedAt,
        "revision = revision + 1, updated_at = ?", [acknowledgedAt],
      );
    }
    return {
      result: writeReceipt(db, projectId, "memory_acknowledge", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Read a bounded, Context-validated batch without advancing the durable receiver cursor. */
export function readCoordinationHandoffs(
  projectId: string,
  input: ConsumeCoordinationHandoffsInput,
): CoordinationHandoffReadResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const limit = input.limit ?? COORDINATION_HANDOFF_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > COORDINATION_HANDOFF_LIMIT) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const db = getDb(dbPath());
  requireProject(db, projectId);
  const session = requireActiveLease(db, projectId, input, tokenHash(input.ownershipToken), now());
  const cursor = db.prepare(
    `SELECT last_sequence FROM coordination_handoff_cursors
     WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
  ).get(projectId, session.id, input.worktreeId) as { last_sequence: number } | undefined;
  if (!cursor) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");

  const scanned = selectHandoffRows(db, projectId, input.worktreeId, cursor.last_sequence);
  const events: CoordinationHandoffEvent[] = [];
  let throughSequence = cursor.last_sequence;
  for (const row of scanned) {
    if (!contextMemoryMatches(db, projectId, row)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    if (row.session_id !== input.sessionId || row.incarnation !== input.incarnation) {
      if (events.length === limit) break;
      events.push(readHandoff(row));
    }
    throughSequence = row.sequence;
  }
  return {
    session: mutationResult(session),
    events,
    throughSequence,
    acknowledgementRequired: throughSequence > cursor.last_sequence,
  };
}

/** Advance only through a batch that the receiver already validated and injected. */
export function acknowledgeCoordinationHandoffs(
  projectId: string,
  input: AcknowledgeCoordinationHandoffsInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  if (!isSafeNonnegativeInteger(input.throughSequence)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "handoff_acknowledge",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    throughSequence: input.throughSequence,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationSessionMutationResult>(
      db, projectId, "handoff_acknowledge", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const acknowledgedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, acknowledgedAt);
    const cursor = db.prepare(
      `SELECT last_sequence FROM coordination_handoff_cursors
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
    ).get(projectId, session.id, input.worktreeId) as { last_sequence: number } | undefined;
    if (!cursor) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const maximum = (db.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM coordination_handoff_events WHERE project_id = ? AND worktree_id = ?",
    ).get(projectId, input.worktreeId) as { sequence: number }).sequence;
    if (input.throughSequence < cursor.last_sequence || input.throughSequence > maximum) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    let updated = session;
    if (input.throughSequence > cursor.last_sequence) {
      db.prepare(
        `UPDATE coordination_handoff_cursors SET last_sequence = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
      ).run(input.throughSequence, acknowledgedAt, projectId, session.id, input.worktreeId);
      updated = advanceActiveSession(
        db, projectId, session, input, ownershipHash, acknowledgedAt,
        "revision = revision + 1, updated_at = ?", [acknowledgedAt],
      );
    }
    return {
      result: writeReceipt(db, projectId, "handoff_acknowledge", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Atomically consume the next bounded peer-write batch for one receiving session. */
export function consumeCoordinationHandoffs(
  projectId: string,
  input: ConsumeCoordinationHandoffsInput,
): CoordinationHandoffConsumeResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const limit = input.limit ?? COORDINATION_HANDOFF_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > COORDINATION_HANDOFF_LIMIT) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "handoff_consume",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    limit,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationHandoffConsumeResult>(
      db, projectId, "handoff_consume", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const consumedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, consumedAt);
    const cursor = db.prepare(
      `SELECT last_sequence FROM coordination_handoff_cursors
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
    ).get(projectId, session.id, input.worktreeId) as { last_sequence: number } | undefined;
    if (!cursor) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");

    const scanned = selectHandoffRows(db, projectId, input.worktreeId, cursor.last_sequence);
    const events: CoordinationHandoffEvent[] = [];
    let lastSequence = cursor.last_sequence;
    for (const row of scanned) {
      if (row.session_id !== input.sessionId || row.incarnation !== input.incarnation) {
        if (events.length === limit) break;
        events.push(readHandoff(row));
      }
      lastSequence = row.sequence;
    }

    let updated = session;
    if (lastSequence !== cursor.last_sequence) {
      db.prepare(
        `UPDATE coordination_handoff_cursors SET last_sequence = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?`,
      ).run(lastSequence, consumedAt, projectId, session.id, input.worktreeId);
      updated = advanceActiveSession(
        db, projectId, session, input, ownershipHash, consumedAt,
        "revision = revision + 1, updated_at = ?", [consumedAt],
      );
    }
    const mutation = { session: mutationResult(updated), events };
    return {
      result: writeReceipt(db, projectId, "handoff_consume", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Atomically reserve a non-overlapping canonical claim batch in one project/worktree. */
export function claimCoordinationBatch(
  projectId: string,
  input: ClaimCoordinationBatchInput,
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  if (!isCoordinationClientClaimKey(input.clientClaimKey) || input.clientClaimKey === input.ownershipToken) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const claims = normalizedClaimBatch(input.claims);
  if (input.operation !== undefined) assertManagedOperation(input.operation);
  const ownershipHash = tokenHash(input.ownershipToken);
  const clientClaimKeyHash = tokenHash(input.clientClaimKey);
  const hash = requestHash({
    operation: "claim_batch",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    clientClaimKeyHash,
    claims,
    operationKind: input.operation,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(db, projectId, "claim_batch", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const createdAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, createdAt);
    const epoch = worktreeEpoch(db, projectId, input.worktreeId, createdAt);
    if (epoch.state !== "active") throw new CoordinationError("EPOCH_QUARANTINED");
    releaseExpiredClaims(db, projectId, input.worktreeId, createdAt);
    const reusedKey = db.prepare(
      `SELECT 1 FROM coordination_claims
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
         AND incarnation = ? AND client_claim_key_hash = ? LIMIT 1`,
    ).get(projectId, session.id, input.worktreeId, input.incarnation, clientClaimKeyHash);
    if (reusedKey) throw new CoordinationError("CLAIM_KEY_REUSED");
    if (input.operation !== undefined) assertAcceptedBaselines(db, projectId, input.worktreeId, claims);
    assertNoPersistedOverlap(db, projectId, input.worktreeId, claims);
    const priorFence = maximumForeignClaimFence(db, projectId, session);
    const claimFence = priorFence >= session.fence
      ? allocateFence(db, projectId, input.worktreeId, createdAt)
      : session.fence;
    if (claimFence <= priorFence) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      createdAt,
      claimFence === session.fence
        ? "revision = revision + 1, updated_at = ?"
        : "fence = ?, revision = revision + 1, updated_at = ?",
      claimFence === session.fence ? [createdAt] : [claimFence, createdAt],
    );
    if (claimFence !== session.fence) {
      db.prepare(
        `UPDATE coordination_claims
         SET fence = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
           AND incarnation = ? AND fence = ? AND state <> 'released'`,
      ).run(
        claimFence, createdAt, projectId, session.id, input.worktreeId, input.incarnation, session.fence,
      );
    }
    const insert = db.prepare(
      `INSERT INTO coordination_claims
       (id, project_id, coordination_session_id, worktree_id, incarnation, fence, accepted_epoch, client_claim_key_hash,
        kind, value, baseline_sha256,
         state, created_at, updated_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
    );
    for (const { claim, baselineSha256, currentSha256 } of claims) {
      const id = randomUUID();
      const value = claim.kind === "reserved" ? claim.name : claim.path;
      insert.run(
        id, projectId, session.id, input.worktreeId, input.incarnation, claimFence, epoch.accepted_epoch,
        clientClaimKeyHash, claim.kind, value, currentSha256 === undefined ? baselineSha256 : currentSha256, createdAt, createdAt,
      );
    }
    let operationId: string | undefined;
    if (input.operation !== undefined) {
      operationId = randomUUID();
      const declaredPathsHash = requestHash(claims.map(({ claim }) => claim));
      db.prepare(
        `INSERT INTO coordination_managed_operations
         (id, project_id, coordination_session_id, worktree_id, incarnation, fence, accepted_epoch,
          client_claim_key_hash, operation, state, declared_paths_hash, footprint_hash, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, NULL, ?, NULL)`,
      ).run(
        operationId, projectId, session.id, input.worktreeId, input.incarnation, claimFence,
        epoch.accepted_epoch, clientClaimKeyHash, input.operation, declaredPathsHash, createdAt,
      );
    }
    const mutation = claimMutationResult(db, projectId, updated, epoch.accepted_epoch, createdAt, operationId);
    return {
      result: writeReceipt(db, projectId, "claim_batch", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

function normalizedClaimProof(input: CoordinationClaimProof): { ownershipHash: string; clientClaimKeyHash: string } {
  assertLeaseInput(input);
  if (!isCoordinationClientClaimKey(input.clientClaimKey) || input.clientClaimKey === input.ownershipToken
    || !isSafePositiveInteger(input.acceptedEpoch)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  return { ownershipHash: tokenHash(input.ownershipToken), clientClaimKeyHash: tokenHash(input.clientClaimKey) };
}

/** Verify an exact caller-held claim, accepted epoch, fence, and unexpired lease. */
export function verifyCoordinationClaims(
  projectId: string,
  input: CoordinationClaimProof,
  requiredReservedClaim?: "@repository" | "@build",
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  const { ownershipHash, clientClaimKeyHash } = normalizedClaimProof(input);
  const db = getDb(dbPath());
  requireProject(db, projectId);
  const current = now();
  const session = requireActiveLease(db, projectId, input, ownershipHash, current);
  const epoch = worktreeEpoch(db, projectId, input.worktreeId, current);
  if (epoch.state !== "active" || epoch.accepted_epoch !== input.acceptedEpoch) {
    throw new CoordinationError("EPOCH_QUARANTINED");
  }
  const claims = ownedActiveClaims(db, projectId, session, clientClaimKeyHash);
  if (requiredReservedClaim && !claims.some((claim) => claim.kind === "reserved" && claim.value === requiredReservedClaim)) {
    throw new CoordinationError("CLAIM_NOT_OWNED");
  }
  return claimMutationResult(db, projectId, session, epoch.accepted_epoch, current);
}

/** Extend a claim holder's lease only after verifying the exact claim proof. */
export function renewCoordinationClaims(
  projectId: string,
  input: RenewCoordinationClaimsInput,
  requiredReservedClaim?: "@repository" | "@build",
): CoordinationClaimMutationResult {
  assertTtl(input.ttlMs);
  const verified = verifyCoordinationClaims(projectId, input, requiredReservedClaim);
  heartbeatCoordinationSession(projectId, { ...input, ttlMs: input.ttlMs });
  const db = getDb(dbPath());
  return claimMutationResult(db, projectId, requireSession(db, projectId, input), verified.acceptedEpoch, now());
}

function normalizedFootprint(value: unknown): CoordinationFootprintEntry[] {
  if (!Array.isArray(value) || value.length > COORDINATION_MAX_CLAIMS_PER_MUTATION * 2) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const paths = new Set<string>();
  return value.map((entry) => {
    if (!isPlainRecord(entry) || !Object.keys(entry).every((key) => ["path", "pathSha256", "beforeSha256", "afterSha256"].includes(key))
      || !isCoordinationSha256(entry.pathSha256)
      || (entry.beforeSha256 !== null && !isCoordinationSha256(entry.beforeSha256))
      || (entry.afterSha256 !== null && !isCoordinationSha256(entry.afterSha256))) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    const path = entry.path === undefined ? undefined : normalizedHandoffPath(entry.path);
    if (path !== undefined && (!hashesEqual(sha256(path), entry.pathSha256) || paths.has(path))) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    if (path !== undefined) paths.add(path);
    return {
      ...(path === undefined ? {} : { path }),
      pathSha256: entry.pathSha256,
      beforeSha256: entry.beforeSha256 as string | null,
      afterSha256: entry.afterSha256 as string | null,
    };
  });
}

/** Verify actual worktree footprint, advance accepted baselines, and release only the matching claim batch. */
export function completeManagedMutation(
  projectId: string,
  input: CompleteManagedMutationInput,
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertManagedOperation(input.operation);
  if (!UUID.test(input.operationId)) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  const footprint = normalizedFootprint(input.footprint);
  const { ownershipHash, clientClaimKeyHash } = normalizedClaimProof(input);
  const outcome = execTransaction(() => {
    const db = getDb(dbPath());
    requireProject(db, projectId);
    const completedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, completedAt);
    const epoch = worktreeEpoch(db, projectId, input.worktreeId, completedAt);
    if (epoch.state !== "active" || epoch.accepted_epoch !== input.acceptedEpoch) {
      throw new CoordinationError("EPOCH_QUARANTINED");
    }
    const claims = ownedActiveClaims(db, projectId, session, clientClaimKeyHash);
    const operation = db.prepare(
      `SELECT operation, state, accepted_epoch, fence, client_claim_key_hash
       FROM coordination_managed_operations WHERE id = ? AND project_id = ? AND coordination_session_id = ?`,
    ).get(input.operationId, projectId, session.id) as {
      operation: string; state: string; accepted_epoch: number; fence: number; client_claim_key_hash: string;
    } | undefined;
    if (!operation || operation.state !== "claimed" || operation.operation !== input.operation
      || operation.accepted_epoch !== input.acceptedEpoch || operation.fence !== input.fence
      || !hashesEqual(operation.client_claim_key_hash, clientClaimKeyHash)) {
      throw new CoordinationError("CLAIM_NOT_OWNED");
    }

    const claimedPaths = new Map(claims.filter((claim) => claim.kind === "path").map((claim) => [claim.value, claim]));
    const actualPaths = new Map(footprint.filter((entry) => entry.path !== undefined).map((entry) => [entry.path!, entry]));
    const coarseRepository = input.operation === "repository"
      && claims.some((claim) => claim.kind === "reserved" && claim.value === "@repository");
    const coarseBuild = input.operation === "build"
      && claims.some((claim) => claim.kind === "reserved" && claim.value === "@build");
    let mismatch = footprint.some((entry) => entry.path === undefined)
      || (coarseBuild && footprint.length > 0)
      || (!coarseRepository && [...actualPaths.keys()].some((path) => !claimedPaths.has(path)))
      || [...actualPaths].some(([path, entry]) => {
        const claim = claimedPaths.get(path);
        return claim !== undefined && entry.beforeSha256 !== claim.baseline_sha256;
      });
    if (input.operation === "delete") mismatch ||= [...actualPaths.values()].some((entry) => entry.afterSha256 !== null);
    if (input.operation === "create") mismatch ||= [...actualPaths.values()].some((entry) => entry.afterSha256 === null);

    const footprintHash = requestHash(footprint.map(({ path, pathSha256, ...entry }) => ({
      pathSha256: path ? sha256(path) : pathSha256,
      ...entry,
    })));
    if (mismatch) {
      db.prepare(
        `UPDATE coordination_claims SET state = 'quarantined', updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ? AND incarnation = ?
           AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
      ).run(completedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash);
      db.prepare(
        `UPDATE coordination_managed_operations SET state = 'quarantined', footprint_hash = ?, completed_at = ?
         WHERE id = ? AND state = 'claimed'`,
      ).run(footprintHash, completedAt, input.operationId);
      db.prepare(
        `UPDATE coordination_worktree_epochs
         SET state = 'quarantined', quarantine_code = 'unexpected_footprint',
             quarantined_coordination_session_id = ?, quarantined_incarnation = ?, quarantined_fence = ?,
             reconciliation_footprint_hash = NULL, updated_at = ?
         WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ?`,
      ).run(session.id, input.incarnation, input.fence, completedAt, projectId, input.worktreeId, input.acceptedEpoch);
      db.prepare(
        `UPDATE coordination_sessions SET state = 'quarantined', revision = revision + 1, updated_at = ?
         WHERE project_id = ? AND id = ? AND revision = ? AND fence = ? AND state = 'active'`,
      ).run(completedAt, projectId, session.id, session.revision, input.fence);
      return { mismatch: true as const };
    }

    const acceptedPaths = coarseRepository ? actualPaths.keys() : claimedPaths.keys();
    const upsert = db.prepare(
      `INSERT INTO coordination_managed_paths
       (project_id, worktree_id, path, accepted_sha256, accepted_epoch, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, worktree_id, path) DO UPDATE SET
         accepted_sha256 = excluded.accepted_sha256, accepted_epoch = excluded.accepted_epoch, updated_at = excluded.updated_at`,
    );
    for (const path of acceptedPaths) {
      const accepted = actualPaths.get(path)?.afterSha256 ?? claimedPaths.get(path)?.baseline_sha256 ?? null;
      upsert.run(projectId, input.worktreeId, path, accepted, input.acceptedEpoch, completedAt);
    }
    db.prepare(
      `UPDATE coordination_claims SET state = 'released', released_at = ?, updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ? AND incarnation = ?
         AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
    ).run(completedAt, completedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash);
    db.prepare(
      `UPDATE coordination_managed_operations SET state = 'verified', footprint_hash = ?, completed_at = ?
       WHERE id = ? AND state = 'claimed'`,
    ).run(footprintHash, completedAt, input.operationId);
    const updated = advanceActiveSession(
      db, projectId, session, input, ownershipHash, completedAt,
      "revision = revision + 1, updated_at = ?", [completedAt],
    );
    return { mismatch: false as const, result: claimMutationResult(db, projectId, updated, input.acceptedEpoch, completedAt) };
  });
  checkpointAfterWrite();
  if (outcome.mismatch) throw new CoordinationError("FOOTPRINT_MISMATCH");
  return outcome.result;
}

/** Quarantine an uncertain operation and its complete accepted worktree epoch. */
export function quarantineCoordinationClaims(
  projectId: string,
  input: CoordinationClaimProof,
  code: "uncertain_apply" | "dirty_baseline" = "uncertain_apply",
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  const { ownershipHash, clientClaimKeyHash } = normalizedClaimProof(input);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    requireProject(db, projectId);
    const quarantinedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, quarantinedAt);
    const epoch = worktreeEpoch(db, projectId, input.worktreeId, quarantinedAt);
    if (epoch.accepted_epoch !== input.acceptedEpoch) throw new CoordinationError("EPOCH_QUARANTINED");
    ownedActiveClaims(db, projectId, session, clientClaimKeyHash);
    db.prepare(
      `UPDATE coordination_claims SET state = 'quarantined', updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ? AND incarnation = ?
         AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
    ).run(quarantinedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash);
    db.prepare(
      `UPDATE coordination_managed_operations SET state = 'uncertain', completed_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ? AND incarnation = ?
         AND fence = ? AND client_claim_key_hash = ? AND state = 'claimed'`,
    ).run(quarantinedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash);
    db.prepare(
      `UPDATE coordination_worktree_epochs
       SET state = 'quarantined', quarantine_code = ?,
           quarantined_coordination_session_id = ?, quarantined_incarnation = ?, quarantined_fence = ?,
           reconciliation_footprint_hash = NULL, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ?`,
    ).run(code, session.id, input.incarnation, input.fence, quarantinedAt, projectId, input.worktreeId, input.acceptedEpoch);
    const changed = db.prepare(
      `UPDATE coordination_sessions SET state = 'quarantined', revision = revision + 1, updated_at = ?
       WHERE project_id = ? AND id = ? AND revision = ? AND fence = ? AND state = 'active'`,
    ).run(quarantinedAt, projectId, session.id, session.revision, input.fence);
    if (changed.changes !== 1) throw new CoordinationError("REVISION_CONFLICT", session.revision);
    return claimMutationResult(db, projectId, requireSession(db, projectId, input), epoch.accepted_epoch, quarantinedAt);
  });
  checkpointAfterWrite();
  return result;
}

function assertEpochRecoveryInput(input: RecoverCoordinationEpochInput): void {
  assertLeaseInput(input);
  if (!isCoordinationOpaqueId(input.quarantinedSessionId)
    || !isSafePositiveInteger(input.quarantinedIncarnation)
    || !isSafePositiveInteger(input.quarantinedFence)
    || input.quarantinedActorId !== coordinationActorId(input.quarantinedSessionId, input.quarantinedIncarnation)
    || !isSafePositiveInteger(input.acceptedEpoch)
    || !isCoordinationSha256(input.recoveryFootprintHash)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
}

function requireQuarantinedEpochOwner(
  db: Db,
  projectId: string,
  input: RecoverCoordinationEpochInput,
  current: string,
): { epoch: WorktreeEpoch; owner: StoredSession } {
  const epoch = worktreeEpoch(db, projectId, input.worktreeId, current);
  const owner = storedSession(db, projectId, {
    worktreeId: input.worktreeId,
    sessionId: input.quarantinedSessionId,
    incarnation: input.quarantinedIncarnation,
  });
  if (epoch.state !== "quarantined" || epoch.accepted_epoch !== input.acceptedEpoch
    || !owner || epoch.quarantined_coordination_session_id !== owner.id
    || epoch.quarantined_incarnation !== input.quarantinedIncarnation
    || epoch.quarantined_fence !== input.quarantinedFence
    || owner.fence !== input.quarantinedFence
    || input.quarantinedActorId !== coordinationActorId(owner.session_id, owner.incarnation)
    || (owner.state !== "quarantined" && !(owner.state === "active" && isExpired(owner, current)))) {
    throw new CoordinationError("CLAIM_CONFLICT");
  }
  return { epoch, owner };
}

/** Read the exact bounded proof needed to reconcile a project/worktree-scoped quarantined epoch. */
export function getCoordinationEpochRecoveryState(
  projectId: string,
  input: CoordinationLeaseInput,
): CoordinationEpochRecoveryState {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const db = getDb(dbPath());
  requireProject(db, projectId);
  const current = now();
  requireActiveLease(db, projectId, input, tokenHash(input.ownershipToken), current);
  const epoch = worktreeEpoch(db, projectId, input.worktreeId, current);
  if (epoch.state !== "quarantined" || epoch.quarantine_code === null
    || epoch.quarantined_coordination_session_id === null
    || epoch.quarantined_incarnation === null || epoch.quarantined_fence === null) {
    throw new CoordinationError("EPOCH_QUARANTINED");
  }
  const owner = storedSessionById(db, projectId, epoch.quarantined_coordination_session_id);
  if (!owner || owner.worktree_id !== input.worktreeId
    || owner.incarnation !== epoch.quarantined_incarnation || owner.fence !== epoch.quarantined_fence) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  return {
    acceptedEpoch: epoch.accepted_epoch,
    quarantineCode: epoch.quarantine_code,
    quarantinedSessionId: owner.session_id,
    quarantinedIncarnation: owner.incarnation,
    quarantinedFence: owner.fence,
    quarantinedActorId: coordinationActorId(owner.session_id, owner.incarnation),
    reconciliationRecorded: epoch.reconciliation_footprint_hash !== null,
  };
}

/** Record one authoritative scan while the old owner and epoch remain fenced. */
export function reconcileCoordinationEpoch(
  projectId: string,
  input: ReconcileCoordinationEpochInput,
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertEpochRecoveryInput(input);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "reconcile_epoch", projectId, identity: identityForHash(input),
    expectedRevision: input.expectedRevision, fence: input.fence, ownershipTokenHash: ownershipHash,
    quarantinedSessionId: input.quarantinedSessionId, quarantinedIncarnation: input.quarantinedIncarnation,
    quarantinedFence: input.quarantinedFence, quarantinedActorId: input.quarantinedActorId,
    acceptedEpoch: input.acceptedEpoch, recoveryFootprintHash: input.recoveryFootprintHash,
  });
  const outcome = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(
      db, projectId, "reconcile_epoch", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const reconciledAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, reconciledAt);
    const { epoch } = requireQuarantinedEpochOwner(db, projectId, input, reconciledAt);
    const changed = db.prepare(
      `UPDATE coordination_worktree_epochs SET reconciliation_footprint_hash = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ? AND state = 'quarantined'
         AND quarantined_coordination_session_id IS NOT NULL`,
    ).run(input.recoveryFootprintHash, reconciledAt, projectId, input.worktreeId, input.acceptedEpoch);
    if (changed.changes !== 1) throw new CoordinationError("CLAIM_CONFLICT");
    const updated = advanceActiveSession(
      db, projectId, session, input, ownershipHash, reconciledAt,
      "revision = revision + 1, updated_at = ?", [reconciledAt],
    );
    const mutation = claimMutationResult(db, projectId, updated, epoch.accepted_epoch, reconciledAt);
    return {
      result: writeReceipt(db, projectId, "reconcile_epoch", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (outcome.written) checkpointAfterWrite();
  return outcome.result;
}

/** Retire only the proven old epoch owner and atomically accept its fenced successor. */
export function recoverCoordinationEpoch(
  projectId: string,
  input: RecoverCoordinationEpochInput,
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertEpochRecoveryInput(input);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "recover_epoch", projectId, identity: identityForHash(input),
    expectedRevision: input.expectedRevision, fence: input.fence, ownershipTokenHash: ownershipHash,
    quarantinedSessionId: input.quarantinedSessionId, quarantinedIncarnation: input.quarantinedIncarnation,
    quarantinedFence: input.quarantinedFence, quarantinedActorId: input.quarantinedActorId,
    acceptedEpoch: input.acceptedEpoch, recoveryFootprintHash: input.recoveryFootprintHash,
  });
  const outcome = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(
      db, projectId, "recover_epoch", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const recoveredAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, recoveredAt);
    const { epoch, owner } = requireQuarantinedEpochOwner(db, projectId, input, recoveredAt);
    if (epoch.reconciliation_footprint_hash === null
      || !hashesEqual(epoch.reconciliation_footprint_hash, input.recoveryFootprintHash)) {
      throw new CoordinationError("FOOTPRINT_MISMATCH");
    }
    releaseExpiredClaims(db, projectId, input.worktreeId, recoveredAt);
    const foreign = db.prepare(
      `SELECT 1 FROM coordination_claims
       WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ?
         AND coordination_session_id <> ? AND state <> 'released' LIMIT 1`,
    ).get(projectId, input.worktreeId, input.acceptedEpoch, owner.id);
    if (foreign) throw new CoordinationError("CLAIM_CONFLICT");
    db.prepare(
      `UPDATE coordination_claims SET state = 'released', released_at = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ?
         AND coordination_session_id = ? AND state <> 'released'`,
    ).run(recoveredAt, recoveredAt, projectId, input.worktreeId, input.acceptedEpoch, owner.id);
    const closed = db.prepare(
      `UPDATE coordination_sessions
       SET state = 'closed', revision = revision + 1, expires_at = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND worktree_id = ? AND incarnation = ? AND fence = ?
         AND (state = 'quarantined' OR (state = 'active' AND expires_at <= ?))`,
    ).run(
      recoveredAt, recoveredAt, projectId, owner.id, input.worktreeId,
      input.quarantinedIncarnation, input.quarantinedFence, recoveredAt,
    );
    if (closed.changes !== 1) throw new CoordinationError("CLAIM_CONFLICT");
    const nextEpoch = epoch.accepted_epoch + 1;
    const advanced = db.prepare(
      `UPDATE coordination_worktree_epochs
       SET accepted_epoch = ?, state = 'active', quarantine_code = NULL,
           quarantined_coordination_session_id = NULL, quarantined_incarnation = NULL,
           quarantined_fence = NULL, reconciliation_footprint_hash = NULL, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND accepted_epoch = ? AND state = 'quarantined'
         AND quarantined_coordination_session_id = ? AND quarantined_incarnation = ? AND quarantined_fence = ?`,
    ).run(
      nextEpoch, recoveredAt, projectId, input.worktreeId, epoch.accepted_epoch,
      owner.id, input.quarantinedIncarnation, input.quarantinedFence,
    );
    if (advanced.changes !== 1) throw new CoordinationError("CLAIM_CONFLICT");
    const successorFence = allocateFence(db, projectId, input.worktreeId, recoveredAt);
    const updated = advanceActiveSession(
      db, projectId, session, input, ownershipHash, recoveredAt,
      "fence = ?, revision = revision + 1, updated_at = ?", [successorFence, recoveredAt],
    );
    const mutation = claimMutationResult(db, projectId, updated, nextEpoch, recoveredAt);
    return {
      result: writeReceipt(db, projectId, "recover_epoch", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (outcome.written) checkpointAfterWrite();
  return outcome.result;
}

/** Release an owned active claim batch atomically. */
export function releaseCoordinationClaims(
  projectId: string,
  input: ReleaseCoordinationClaimsInput,
): CoordinationClaimMutationResult {
  return mutateCoordinationClaims(projectId, input, "release_claims");
}

/** Mark owned active claims as dirty, quarantined, or colliding without releasing them. */
export function markCoordinationClaims(
  projectId: string,
  input: MarkCoordinationClaimsInput,
): CoordinationClaimMutationResult {
  if (input.state !== "dirty" && input.state !== "quarantined" && input.state !== "collision") {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  return mutateCoordinationClaims(projectId, input, "mark_claims");
}

function mutateCoordinationClaims(
  projectId: string,
  input: ReleaseCoordinationClaimsInput | MarkCoordinationClaimsInput,
  operation: "release_claims" | "mark_claims",
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  if (!isCoordinationClientClaimKey(input.clientClaimKey) || input.clientClaimKey === input.ownershipToken) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const clientClaimKeyHash = tokenHash(input.clientClaimKey);
  const markState = operation === "mark_claims" ? (input as MarkCoordinationClaimsInput).state : undefined;
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation,
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    clientClaimKeyHash,
    state: markState,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(db, projectId, operation, input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const updatedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, updatedAt);
    const claims = ownedActiveClaims(db, projectId, session, clientClaimKeyHash);
    const mutation = operation === "release_claims"
      ? db.prepare(
        `UPDATE coordination_claims
         SET state = 'released', released_at = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
            AND incarnation = ? AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
      ).run(
        updatedAt, updatedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash,
      )
      : db.prepare(
        `UPDATE coordination_claims
         SET state = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
            AND incarnation = ? AND fence = ? AND client_claim_key_hash = ? AND state = 'active'`,
      ).run(markState, updatedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence, clientClaimKeyHash);
    if (mutation.changes !== claims.length) throw new CoordinationError("CLAIM_NOT_OWNED");
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      updatedAt,
      "revision = revision + 1, updated_at = ?",
      [updatedAt],
    );
    const epoch = worktreeEpoch(db, projectId, input.worktreeId, updatedAt);
    const response = claimMutationResult(db, projectId, updated, epoch.accepted_epoch, updatedAt);
    return {
      result: writeReceipt(db, projectId, operation, input.idempotencyKey, hash, response),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Close an active session and release its exact fenced claims while retaining history. */
export function closeCoordinationSession(
  projectId: string,
  input: CoordinationLeaseInput,
): CoordinationSessionMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "close",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "close", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const closedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, closedAt);
    db.prepare(
      `UPDATE coordination_claims
       SET state = 'released', released_at = ?, updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND worktree_id = ?
         AND incarnation = ? AND fence = ? AND state <> 'released'`,
    ).run(closedAt, closedAt, projectId, session.id, input.worktreeId, input.incarnation, input.fence);
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      closedAt,
      "state = 'closed', expires_at = ?, revision = revision + 1, updated_at = ?",
      [closedAt, closedAt],
    );
    return {
      result: writeReceipt(db, projectId, "close", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Read a retained session only inside its owning project. Ownership-token hashes are never selected into output. */
export function getCoordinationSession(projectId: string, coordinationSessionId: string): CoordinationSession | undefined {
  assertProjectId(projectId);
  if (typeof coordinationSessionId !== "string" || !UUID.test(coordinationSessionId)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const row = storedSessionById(getDb(dbPath()), projectId, coordinationSessionId);
  return row ? readSession(row) : undefined;
}

/** Read one exact session identity, retained claims, and sanitized active peer snapshots. */
export function getCoordinationStatus(
  projectId: string,
  input: CoordinationOwnershipInput,
): CoordinationStatus | undefined {
  assertProjectId(projectId);
  assertIdentity(input);
  if (!isCoordinationOwnershipToken(input.ownershipToken)) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const db = getDb(dbPath());
  const session = storedSession(db, projectId, input);
  if (!session || !hashesEqual(session.ownership_token_hash, tokenHash(input.ownershipToken))) return undefined;
  const rows = db.prepare(
    `SELECT * FROM coordination_claims
     WHERE project_id = ? AND coordination_session_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  ).all(projectId, session.id, COORDINATION_STATUS_CLAIM_LIMIT + 1) as StoredClaim[];
  const current = now();
  const peers = (db.prepare(
    `SELECT * FROM coordination_sessions
     WHERE project_id = ? AND worktree_id = ? AND id <> ?
       AND state = 'active' AND expires_at > ?
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
  ).all(projectId, session.worktree_id, session.id, current, COORDINATION_STATUS_PEER_LIMIT) as StoredSession[])
    .map(projectedPeerSnapshot)
    .filter((peer): peer is CoordinationPeerSnapshot => peer !== undefined);
  return {
    session: readSession(session),
    claims: rows.slice(0, COORDINATION_STATUS_CLAIM_LIMIT).map(readClaim),
    claimsTruncated: rows.length > COORDINATION_STATUS_CLAIM_LIMIT,
    peers,
  };
}

function identityForHash(value: CoordinationSessionIdentity): CoordinationSessionIdentity {
  return {
    worktreeId: value.worktreeId,
    sessionId: value.sessionId,
    incarnation: value.incarnation,
  };
}
