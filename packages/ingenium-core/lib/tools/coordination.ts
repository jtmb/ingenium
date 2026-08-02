import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  CONTEXT_METADATA_MAX_BYTES,
  isBoundedContextMetadata,
  type ContextMetadata,
  type CoordinationClaim,
  type CoordinationClaimState,
  type CoordinationSession,
  type CoordinationSessionState,
} from "../schema.js";
import {
  canonicalTaskClaimBatch,
  taskClaimsOverlap,
  type TaskClaim,
} from "./task-claims.js";

export const COORDINATION_TTL_MIN_MS = 1_000;
export const COORDINATION_TTL_MAX_MS = 5 * 60 * 1_000;
export const COORDINATION_MAX_CLAIMS_PER_MUTATION = 128;
export const COORDINATION_STATUS_CLAIM_LIMIT = 100;

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
  | "CLAIM_NOT_FOUND"
  | "CLAIM_NOT_OWNED"
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
}

export interface RecoverCoordinationSessionInput extends CoordinationLeaseInput {
  nextOwnershipToken: string;
  ttlMs: number;
}

/** API authorization is the caller boundary; this operation deliberately has no old ownership token. */
export interface AuthorizedTakeoverCoordinationSessionInput extends CoordinationSessionIdentity {
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
}

export interface ClaimCoordinationBatchInput extends CoordinationLeaseInput {
  claims: CoordinationClaimInput[];
}

export interface ReleaseCoordinationClaimsInput extends CoordinationLeaseInput {
  claimIds: string[];
}

export interface MarkCoordinationClaimsInput extends ReleaseCoordinationClaimsInput {
  state: Exclude<CoordinationClaimState, "active" | "released">;
}

export interface CoordinationSessionMutationResult {
  id: string;
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
  claimIds: string[];
}

export interface CoordinationStatus {
  session: CoordinationSession;
  claims: CoordinationClaim[];
  claimsTruncated: boolean;
}

type Db = ReturnType<typeof getDb>;
type CoordinationOperation =
  | "register"
  | "recover"
  | "authorized_takeover"
  | "snapshot_update"
  | "heartbeat"
  | "claim_batch"
  | "release_claims"
  | "mark_claims"
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
  kind: CoordinationClaim["kind"];
  value: string;
  baseline_sha256: string | null;
  state: CoordinationClaimState;
  created_at: string;
  updated_at: string;
  released_at: string | null;
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OWNERSHIP_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_RECEIPT_BYTES = 16_384;
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
    || !isCoordinationOwnershipToken(value.nextOwnershipToken)) {
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

function readClaim(row: StoredClaim): CoordinationClaim {
  if (!UUID.test(row.id)
    || !isCoordinationOpaqueId(row.project_id)
    || !UUID.test(row.coordination_session_id)
    || !isCoordinationOpaqueId(row.worktree_id)
    || !isSafePositiveInteger(row.incarnation)
    || !isSafePositiveInteger(row.fence)
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
    id: row.id,
    project_id: row.project_id,
    coordination_session_id: row.coordination_session_id,
    worktree_id: row.worktree_id,
    incarnation: row.incarnation,
    fence: row.fence,
    kind: row.kind,
    value: row.value,
    baseline_sha256: row.baseline_sha256,
    state: row.state,
    created_at: row.created_at,
    updated_at: row.updated_at,
    released_at: row.released_at,
  };
}

function mutationResult(session: StoredSession): CoordinationSessionMutationResult {
  const safe = readSession(session);
  return {
    id: safe.id,
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
     SET next_fence = next_fence + 1, updated_at = ?
     WHERE project_id = ? AND worktree_id = ?`,
  ).run(current, projectId, worktreeId);
  if (advanced.changes !== 1) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  const worktree = db.prepare(
    "SELECT next_fence FROM coordination_worktrees WHERE project_id = ? AND worktree_id = ?",
  ).get(projectId, worktreeId) as { next_fence: number } | undefined;
  if (!worktree || !isSafePositiveInteger(worktree.next_fence) || worktree.next_fence <= 1) {
    throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  }
  const fence = worktree.next_fence - 1;
  if (!isSafePositiveInteger(fence)) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
  return fence;
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

function normalizedClaimBatch(value: unknown): Array<{ claim: TaskClaim; baselineSha256: string | null }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > COORDINATION_MAX_CLAIMS_PER_MUTATION) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const inputs = value.map((entry) => {
    if (!isPlainRecord(entry)
      || !Object.keys(entry).every((key) => key === "claim" || key === "baselineSha256")) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    const baseline = entry.baselineSha256 ?? null;
    if (baseline !== null && !isCoordinationSha256(baseline)) {
      throw new CoordinationError("INVALID_COORDINATION_INPUT");
    }
    return { claim: entry.claim, baselineSha256: baseline };
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
  return claims.map((claim, index) => ({ claim, baselineSha256: inputs[index]!.baselineSha256 }));
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

function normalizedClaimIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > COORDINATION_MAX_CLAIMS_PER_MUTATION
    || !value.every((id) => typeof id === "string" && UUID.test(id))) {
    throw new CoordinationError("INVALID_COORDINATION_INPUT");
  }
  const ids = [...new Set(value)].sort();
  if (ids.length !== value.length) throw new CoordinationError("INVALID_COORDINATION_INPUT");
  return ids;
}

function ownedActiveClaims(
  db: Db,
  projectId: string,
  session: StoredSession,
  claimIds: string[],
): StoredClaim[] {
  const placeholders = claimIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT * FROM coordination_claims
     WHERE project_id = ? AND id IN (${placeholders})`,
  ).all(projectId, ...claimIds) as StoredClaim[];
  if (rows.length !== claimIds.length) throw new CoordinationError("CLAIM_NOT_FOUND");
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
    });
    const replay = readReceipt<CoordinationSessionMutationResult>(db, projectId, "register", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    if (storedSession(db, projectId, input)) throw new CoordinationError("SESSION_IDENTITY_CONFLICT");
    const createdAt = now();
    const fence = allocateFence(db, projectId, input.worktreeId, createdAt);
    db.prepare(
      `INSERT INTO coordination_sessions
       (id, project_id, worktree_id, session_id, incarnation, ownership_token_hash, revision, fence, state,
        heartbeat_at, expires_at, snapshot_json, snapshot_revision, current_task_id, current_task_revision,
        context_conversation_id, context_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, '{}', 0, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(
      randomUUID(), projectId, input.worktreeId, input.sessionId, input.incarnation, ownershipHash, fence,
      createdAt, expiryFrom(createdAt, input.ttlMs), createdAt, createdAt,
    );
    const session = requireSession(db, projectId, input);
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
       WHERE project_id = ? AND coordination_session_id = ? AND state <> 'released'`,
    ).run(nextFence, updatedAt, projectId, session.id);
    const updated = requireSession(db, projectId, input);
    return {
      result: writeReceipt(db, projectId, "recover", input.idempotencyKey, hash, mutationResult(updated)),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/**
 * Replace an active or quarantined session's owner after the API authorizes it.
 * The old ownership token is intentionally not accepted at this core boundary.
 */
export function authorizedTakeoverCoordinationSession(
  projectId: string,
  input: AuthorizedTakeoverCoordinationSessionInput,
): AuthorizedTakeoverCoordinationSessionResult {
  assertProjectId(projectId);
  assertAuthorizedTakeoverInput(input);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    assertOwnershipTokensAreNotPublicSessionValues(db, projectId, input, [input.nextOwnershipToken]);
    const nextOwnershipHash = tokenHash(input.nextOwnershipToken);
    const hash = requestHash({
      operation: "authorized_takeover",
      projectId,
      identity: identityForHash(input),
      expectedRevision: input.expectedRevision,
      fence: input.fence,
      nextOwnershipTokenHash: nextOwnershipHash,
      ttlMs: input.ttlMs,
    });
    const replay = readReceipt<AuthorizedTakeoverCoordinationSessionResult>(
      db, projectId, "authorized_takeover", input.idempotencyKey, hash,
    );
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const session = requireSession(db, projectId, input);
    if (session.revision !== input.expectedRevision) {
      throw new CoordinationError("REVISION_CONFLICT", session.revision);
    }
    if (session.fence !== input.fence) throw new CoordinationError("FENCE_CONFLICT");
    if (session.state === "closed") throw new CoordinationError("SESSION_CLOSED");
    assertSafeSnapshot(parseStoredSnapshot(session.snapshot_json), [input.nextOwnershipToken]);
    const updatedAt = now();
    const nextFence = allocateFence(db, projectId, input.worktreeId, updatedAt);
    if (nextFence <= session.fence) throw new CoordinationError("COORDINATION_INTEGRITY_ERROR");
    const changed = db.prepare(
      `UPDATE coordination_sessions
       SET ownership_token_hash = ?, fence = ?, state = 'active', revision = revision + 1,
           heartbeat_at = ?, expires_at = ?, updated_at = ?
       WHERE project_id = ? AND worktree_id = ? AND session_id = ? AND incarnation = ?
         AND revision = ? AND fence = ? AND state <> 'closed'`,
    ).run(
      nextOwnershipHash, nextFence, updatedAt, expiryFrom(updatedAt, input.ttlMs), updatedAt,
      projectId, input.worktreeId, input.sessionId, input.incarnation,
      session.revision, input.fence,
    );
    if (changed.changes !== 1) throw new CoordinationError("REVISION_CONFLICT", session.revision);
    db.prepare(
      `UPDATE coordination_claims
       SET fence = ?, updated_at = ?
       WHERE project_id = ? AND coordination_session_id = ? AND state <> 'released'`,
    ).run(nextFence, updatedAt, projectId, session.id);
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

/** Atomically reserve a non-overlapping canonical claim batch in one project/worktree. */
export function claimCoordinationBatch(
  projectId: string,
  input: ClaimCoordinationBatchInput,
): CoordinationClaimMutationResult {
  assertProjectId(projectId);
  assertLeaseInput(input);
  const claims = normalizedClaimBatch(input.claims);
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation: "claim_batch",
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    claims,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(db, projectId, "claim_batch", input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const createdAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, createdAt);
    assertNoPersistedOverlap(db, projectId, input.worktreeId, claims);
    const insert = db.prepare(
      `INSERT INTO coordination_claims
       (id, project_id, coordination_session_id, worktree_id, incarnation, fence, kind, value, baseline_sha256,
        state, created_at, updated_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
    );
    const claimIds = claims.map(({ claim, baselineSha256 }) => {
      const id = randomUUID();
      const value = claim.kind === "reserved" ? claim.name : claim.path;
      insert.run(
        id, projectId, session.id, input.worktreeId, input.incarnation, input.fence,
        claim.kind, value, baselineSha256, createdAt, createdAt,
      );
      return id;
    });
    const updated = advanceActiveSession(
      db,
      projectId,
      session,
      input,
      ownershipHash,
      createdAt,
      "revision = revision + 1, updated_at = ?",
      [createdAt],
    );
    const mutation = { session: mutationResult(updated), claimIds };
    return {
      result: writeReceipt(db, projectId, "claim_batch", input.idempotencyKey, hash, mutation),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
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
  const claimIds = normalizedClaimIds(input.claimIds);
  const markState = operation === "mark_claims" ? (input as MarkCoordinationClaimsInput).state : undefined;
  const ownershipHash = tokenHash(input.ownershipToken);
  const hash = requestHash({
    operation,
    projectId,
    identity: identityForHash(input),
    expectedRevision: input.expectedRevision,
    fence: input.fence,
    ownershipTokenHash: ownershipHash,
    claimIds,
    state: markState,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const replay = readReceipt<CoordinationClaimMutationResult>(db, projectId, operation, input.idempotencyKey, hash);
    if (replay !== undefined) return { result: replay, written: false };
    requireProject(db, projectId);
    const updatedAt = now();
    const session = requireActiveLease(db, projectId, input, ownershipHash, updatedAt);
    ownedActiveClaims(db, projectId, session, claimIds);
    const placeholders = claimIds.map(() => "?").join(", ");
    const mutation = operation === "release_claims"
      ? db.prepare(
        `UPDATE coordination_claims
         SET state = 'released', released_at = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND fence = ? AND state = 'active'
           AND id IN (${placeholders})`,
      ).run(updatedAt, updatedAt, projectId, session.id, input.fence, ...claimIds)
      : db.prepare(
        `UPDATE coordination_claims
         SET state = ?, updated_at = ?
         WHERE project_id = ? AND coordination_session_id = ? AND fence = ? AND state = 'active'
           AND id IN (${placeholders})`,
      ).run(markState, updatedAt, projectId, session.id, input.fence, ...claimIds);
    if (mutation.changes !== claimIds.length) throw new CoordinationError("CLAIM_NOT_OWNED");
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
    const response = { session: mutationResult(updated), claimIds };
    return {
      result: writeReceipt(db, projectId, operation, input.idempotencyKey, hash, response),
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result.result;
}

/** Close an active session and release only its currently active claims, retaining all history. */
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
       WHERE project_id = ? AND coordination_session_id = ? AND state = 'active'`,
    ).run(closedAt, closedAt, projectId, session.id);
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

/** Read one exact session identity and at most 100 retained claims in its project/worktree. */
export function getCoordinationStatus(
  projectId: string,
  identity: CoordinationSessionIdentity,
): CoordinationStatus | undefined {
  assertProjectId(projectId);
  assertIdentity(identity);
  const db = getDb(dbPath());
  const session = storedSession(db, projectId, identity);
  if (!session) return undefined;
  const rows = db.prepare(
    `SELECT * FROM coordination_claims
     WHERE project_id = ? AND coordination_session_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  ).all(projectId, session.id, COORDINATION_STATUS_CLAIM_LIMIT + 1) as StoredClaim[];
  return {
    session: readSession(session),
    claims: rows.slice(0, COORDINATION_STATUS_CLAIM_LIMIT).map(readClaim),
    claimsTruncated: rows.length > COORDINATION_STATUS_CLAIM_LIMIT,
  };
}

function identityForHash(value: CoordinationSessionIdentity): CoordinationSessionIdentity {
  return {
    worktreeId: value.worktreeId,
    sessionId: value.sessionId,
    incarnation: value.incarnation,
  };
}
