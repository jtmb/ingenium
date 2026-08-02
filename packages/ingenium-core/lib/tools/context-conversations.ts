import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb, sanitizeFts5Query } from "../db.js";
import {
  appendTrustedJobEventInTransaction,
  trustedJobEventFromContextAuditEvent,
} from "./trusted-job-events.js";
import {
  AppendContextMessageInputSchema,
  AuthorizeContextMaintenanceInputSchema,
  ContextCheckpointAuditEventSchema,
  ContextConversationArchiveInputSchema,
  CONTEXT_TAGS_MAX_BYTES,
  ContextCheckpointRagSourceSchema,
  ContextCheckpointSchema,
  ContextConversationSchema,
  ContextMessageSchema,
  CreateContextCheckpointInputSchema,
  CreateContextConversationInputSchema,
  PreviewContextMaintenanceInputSchema,
  RestoreContextCheckpointInputSchema,
  isBoundedContextMetadata,
  type ContextCheckpointAuditEvent,
  type ContextCheckpoint,
  type ContextCheckpointRagSource,
  type ContextConversation,
  type ContextMaintenanceOperation,
  type ContextMessage,
} from "../schema.js";

export type ContextConversationErrorCode =
  | "INVALID_CONTEXT_INPUT"
  | "INVALID_CURSOR"
  | "CONVERSATION_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "CHECKPOINT_NOT_FOUND"
  | "NO_MESSAGES"
  | "RAG_SOURCE_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "CHECKPOINT_INTEGRITY_FAILED"
  | "CONVERSATION_ARCHIVED"
  | "CONVERSATION_ALREADY_ARCHIVED"
  | "CONVERSATION_NOT_ARCHIVED"
  | "MAINTENANCE_AUTHORIZATION_INVALID";

/** Stable, transport-safe failures. Error messages never include message content. */
export class ContextConversationError extends Error {
  constructor(
    public readonly code: ContextConversationErrorCode,
    public readonly currentRevision?: number,
  ) {
    super(code);
    this.name = "ContextConversationError";
  }
}

export interface ContextConversationSummary extends ContextConversation {
  revision: number;
  message_count: number;
  checkpoint_count: number;
  latest_message_id: string | null;
}

export type ContextMessageSummary = Omit<ContextMessage, "content">;

export interface ContextMessageSearchResult extends ContextMessageSummary {
  rank: number;
}

export interface ContextCheckpointDetail {
  checkpoint: ContextCheckpoint;
  ragSources: ContextCheckpointRagSource[];
}

export interface ContextKeysetPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ContextMessageBatch {
  messages: ContextMessage[];
  missingIds: string[];
}

export interface ContextMessageAppendResult {
  message: ContextMessage;
  revision: number;
  idempotent: boolean;
}

export interface ContextCheckpointCreateResult {
  checkpoint: ContextCheckpoint;
  revision: number;
  idempotent: boolean;
}

export interface ContextCheckpointRestoreResult {
  conversation: ContextConversationSummary;
  checkpoint: ContextCheckpoint;
  revision: number;
  idempotent: boolean;
}

export type ContextMaintenanceCandidateReason =
  | "STALE"
  | "CHECKPOINT_DIVERGED"
  | "CHECKPOINT_INTEGRITY_FAILED"
  | "MULTIPLE_ACTIVE_RESTORE_BRANCHES";

/** Content-free preview record. Candidates never expose titles, metadata, or messages. */
export interface ContextMaintenanceCandidate {
  conversationId: string;
  currentRevision: number;
  checkpointCount: number;
  lastActivityAt: string;
  archived: boolean;
  reasons: ContextMaintenanceCandidateReason[];
}

/** A short-lived, one-time capability returned only by explicit authorization. */
export interface ContextMaintenanceAuthorization {
  operation: ContextMaintenanceOperation;
  conversationId: string;
  checkpointId: string | null;
  expectedRevision: number;
  checkpointStateHash: string | null;
  confirmationToken: string;
  expiresAt: string;
}

export interface ContextConversationArchiveResult {
  archived: boolean;
  event: ContextCheckpointAuditEvent;
}

const MAINTENANCE_AUTHORIZATION_TTL_MS = 15 * 60 * 1_000;

type Db = ReturnType<typeof getDb>;

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
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function requestHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function normalizeTags(tags: string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()))].sort();
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > CONTEXT_TAGS_MAX_BYTES) {
    throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  return normalized;
}

function parseConversationInput(input: unknown) {
  const parsed = CreateContextConversationInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return { ...parsed.data, tags: normalizeTags(parsed.data.tags) };
}

function parseMessageInput(input: unknown) {
  const parsed = AppendContextMessageInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return { ...parsed.data, tags: normalizeTags(parsed.data.tags) };
}

function parseCheckpointInput(input: unknown) {
  const parsed = CreateContextCheckpointInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return { ...parsed.data, ragSourceIds: [...new Set(parsed.data.ragSourceIds)] };
}

function parseRestoreInput(input: unknown) {
  const parsed = RestoreContextCheckpointInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return parsed.data;
}

function parseMaintenancePreviewInput(input: unknown) {
  const parsed = PreviewContextMaintenanceInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return {
    ...parsed.data,
    conversationIds: parsed.data.conversationIds === undefined
      ? undefined
      : [...new Set(parsed.data.conversationIds)],
  };
}

function parseMaintenanceAuthorizationInput(input: unknown) {
  const parsed = AuthorizeContextMaintenanceInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return parsed.data;
}

function parseConversationArchiveInput(input: unknown) {
  const parsed = ContextConversationArchiveInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  return parsed.data;
}

function readConversation(row: unknown): ContextConversation {
  const parsed = ContextConversationSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted context conversation");
  return parsed.data;
}

function readMessage(row: unknown): ContextMessage {
  const parsed = ContextMessageSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted context message");
  return parsed.data;
}

function readCheckpoint(row: unknown): ContextCheckpoint {
  const parsed = ContextCheckpointSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted context checkpoint");
  return parsed.data;
}

function readCheckpointAuditEvent(row: unknown): ContextCheckpointAuditEvent {
  const parsed = ContextCheckpointAuditEventSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted context checkpoint audit event");
  return parsed.data;
}

function readCheckpointRagSource(row: unknown): ContextCheckpointRagSource {
  const parsed = ContextCheckpointRagSourceSchema.safeParse(row);
  if (!parsed.success) throw new Error("Invalid persisted context checkpoint RAG source");
  return parsed.data;
}

function numberField(row: unknown, field: string): number {
  const value = (row as Record<string, unknown>)[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid persisted context ${field}`);
  }
  return value;
}

function nullableStringField(row: unknown, field: string): string | null {
  const value = (row as Record<string, unknown>)[field];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Invalid persisted context ${field}`);
  return value;
}

function readConversationSummary(row: unknown): ContextConversationSummary {
  return {
    ...readConversation(row),
    revision: numberField(row, "message_count"),
    message_count: numberField(row, "message_count"),
    checkpoint_count: numberField(row, "checkpoint_count"),
    latest_message_id: nullableStringField(row, "latest_message_id"),
  };
}

/** Explicit list/search projections never expose message content. */
export function toContextMessageSummary(message: ContextMessage): ContextMessageSummary {
  const { content: _content, ...summary } = message;
  return summary;
}

function requireConversation(db: Db, projectId: string, conversationId: string): ContextConversation {
  const row = db.prepare(
    "SELECT * FROM context_conversations WHERE project_id = ? AND id = ?",
  ).get(projectId, conversationId);
  if (!row) throw new ContextConversationError("CONVERSATION_NOT_FOUND");
  return readConversation(row);
}

function requireCheckpoint(
  db: Db,
  projectId: string,
  conversationId: string,
  checkpointId: string,
): ContextCheckpoint {
  const row = db.prepare(
    `SELECT * FROM context_checkpoints
     WHERE project_id = ? AND conversation_id = ? AND id = ?`,
  ).get(projectId, conversationId, checkpointId);
  if (!row) throw new ContextConversationError("CHECKPOINT_NOT_FOUND");
  return readCheckpoint(row);
}

function isConversationArchived(db: Db, projectId: string, conversationId: string): boolean {
  const row = db.prepare(
    `SELECT event_type FROM context_checkpoint_audit_events
     WHERE project_id = ? AND conversation_id = ? AND archive_sequence IS NOT NULL
     ORDER BY archive_sequence DESC LIMIT 1`,
  ).get(projectId, conversationId) as { event_type?: string } | undefined;
  return row?.event_type === "conversation_archived";
}

function requireActiveConversation(db: Db, projectId: string, conversationId: string): ContextConversation {
  const conversation = requireConversation(db, projectId, conversationId);
  if (isConversationArchived(db, projectId, conversationId)) {
    throw new ContextConversationError("CONVERSATION_ARCHIVED");
  }
  return conversation;
}

function nextArchiveSequence(db: Db, projectId: string, conversationId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(archive_sequence), -1) + 1 AS sequence
     FROM context_checkpoint_audit_events
     WHERE project_id = ? AND conversation_id = ?`,
  ).get(projectId, conversationId) as { sequence: number };
  return row.sequence;
}

function consumeMaintenanceAuthorization(
  db: Db,
  projectId: string,
  operation: ContextMaintenanceOperation,
  conversationId: string,
  checkpointId: string | null,
  expectedRevision: number,
  confirmationToken: string,
): string {
  const consumedAt = now();
  const checkpointClause = checkpointId === null ? "checkpoint_id IS NULL" : "checkpoint_id = ?";
  const parameters = checkpointId === null
    ? [consumedAt, projectId, sha256(confirmationToken), operation, conversationId, expectedRevision, consumedAt]
    : [consumedAt, projectId, sha256(confirmationToken), operation, conversationId, checkpointId, expectedRevision, consumedAt];
  const result = db.prepare(
    `UPDATE context_checkpoint_maintenance_authorizations
     SET consumed_at = ?
     WHERE project_id = ?
       AND confirmation_hash = ?
       AND operation = ?
       AND conversation_id = ?
       AND ${checkpointClause}
       AND expected_revision = ?
       AND consumed_at IS NULL
       AND expires_at > ?`,
  ).run(...parameters);
  if (result.changes !== 1) {
    throw new ContextConversationError("MAINTENANCE_AUTHORIZATION_INVALID");
  }
  const authorization = db.prepare(
    `SELECT id FROM context_checkpoint_maintenance_authorizations
     WHERE project_id = ? AND confirmation_hash = ?`,
  ).get(projectId, sha256(confirmationToken)) as { id: string } | undefined;
  if (!authorization) throw new ContextConversationError("MAINTENANCE_AUTHORIZATION_INVALID");
  return authorization.id;
}

function insertCheckpointAuditEvent(
  db: Db,
  input: {
    projectId: string;
    eventType: ContextCheckpointAuditEvent["event_type"];
    conversationId: string;
    checkpointId: string | null;
    targetConversationId: string | null;
    expectedRevision: number;
    checkpointStateHash: string | null;
    authorizationId: string;
    archiveSequence: number | null;
    createdAt: string;
  },
): ContextCheckpointAuditEvent {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO context_checkpoint_audit_events
     (id, project_id, event_type, conversation_id, checkpoint_id, target_conversation_id,
      expected_revision, checkpoint_state_hash, authorization_id, archive_sequence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.projectId, input.eventType, input.conversationId, input.checkpointId,
    input.targetConversationId, input.expectedRevision, input.checkpointStateHash,
    input.authorizationId, input.archiveSequence, input.createdAt,
  );
  const event = readCheckpointAuditEvent(db.prepare(
    `SELECT id, project_id, event_type, conversation_id, checkpoint_id, target_conversation_id,
            expected_revision, checkpoint_state_hash, archive_sequence, created_at
     FROM context_checkpoint_audit_events WHERE project_id = ? AND id = ?`,
  ).get(input.projectId, id));
  appendTrustedJobEventInTransaction(db, input.projectId, trustedJobEventFromContextAuditEvent(event));
  return event;
}

function currentRevision(db: Db, projectId: string, conversationId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(sequence) + 1, 0) AS revision
     FROM context_messages
     WHERE project_id = ? AND conversation_id = ?`,
  ).get(projectId, conversationId) as { revision: number };
  return row.revision;
}

function requireExpectedRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new ContextConversationError("REVISION_CONFLICT", actual);
}

type ContextMessageState = Pick<
  ContextMessage,
  "sequence" | "role" | "content_hash" | "tags" | "priority" | "metadata"
>;

function checkpointStateHash(messages: ContextMessageState[]): string {
  return sha256(JSON.stringify(messages.map((message) => ({
    sequence: message.sequence,
    role: message.role,
    content_hash: message.content_hash,
    tags: message.tags,
    priority: message.priority,
    metadata: message.metadata,
  }))));
}

function hasCheckpointIntegrityFailure(db: Db, projectId: string, conversationId: string): boolean {
  const checkpoints = db.prepare(
    `SELECT id, through_message_id, message_count, state_hash
     FROM context_checkpoints
     WHERE project_id = ? AND conversation_id = ?
     ORDER BY sequence ASC`,
  ).all(projectId, conversationId) as Array<{
    id: string;
    through_message_id: string;
    message_count: number;
    state_hash: string;
  }>;
  const messagesStatement = db.prepare(
    `SELECT id, sequence, role, content_hash, tags, priority, metadata
     FROM context_messages
     WHERE project_id = ? AND conversation_id = ? AND sequence < ?
     ORDER BY sequence ASC`,
  );
  for (const checkpoint of checkpoints) {
    const messages = messagesStatement.all(projectId, conversationId, checkpoint.message_count) as Array<
      ContextMessageState & { id: string }
    >;
    const tail = messages[messages.length - 1];
    if (
      messages.length !== checkpoint.message_count
      || !tail
      || tail.id !== checkpoint.through_message_id
      || checkpointStateHash(messages) !== checkpoint.state_hash
    ) {
      return true;
    }
  }
  return false;
}

function hasCheckpointDivergence(db: Db, projectId: string, conversationId: string, revision: number): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM context_checkpoints
     WHERE project_id = ? AND conversation_id = ? AND message_count < ?
     LIMIT 1`,
  ).get(projectId, conversationId, revision));
}

function hasMultipleActiveRestoreBranches(db: Db, projectId: string, conversationId: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1
     FROM context_checkpoint_audit_events restored
     WHERE restored.project_id = ?
       AND restored.conversation_id = ?
       AND restored.event_type = 'checkpoint_restored_as_new'
       AND COALESCE((
         SELECT archive_state.event_type
         FROM context_checkpoint_audit_events archive_state
         WHERE archive_state.project_id = restored.project_id
           AND archive_state.conversation_id = restored.target_conversation_id
           AND archive_state.archive_sequence IS NOT NULL
         ORDER BY archive_state.archive_sequence DESC
         LIMIT 1
       ), 'conversation_unarchived') <> 'conversation_archived'
     GROUP BY restored.checkpoint_id
     HAVING count(*) > 1
     LIMIT 1`,
  ).get(projectId, conversationId));
}

function conversationSummaryRow(db: Db, projectId: string, conversationId: string): ContextConversationSummary | undefined {
  const row = db.prepare(
    `SELECT c.*,
       (SELECT count(*) FROM context_messages m
        WHERE m.project_id = c.project_id AND m.conversation_id = c.id) AS message_count,
       (SELECT count(*) FROM context_checkpoints cp
        WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id) AS checkpoint_count,
       (SELECT id FROM context_messages m
        WHERE m.project_id = c.project_id AND m.conversation_id = c.id
        ORDER BY m.sequence DESC LIMIT 1) AS latest_message_id
     FROM context_conversations c
     WHERE c.project_id = ? AND c.id = ?`,
  ).get(projectId, conversationId);
  if (!row) return undefined;
  const summary = readConversationSummary(row);
  return { ...summary, revision: summary.message_count };
}

function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512) {
    throw new ContextConversationError("INVALID_CURSOR");
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("invalid cursor");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ContextConversationError("INVALID_CURSOR");
  }
}

function conversationCursor(cursor: string | undefined): { createdAt: string; id: string } | undefined {
  const parsed = decodeCursor(cursor);
  if (!parsed) return undefined;
  if (parsed.v !== 1 || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
    throw new ContextConversationError("INVALID_CURSOR");
  }
  return { createdAt: parsed.createdAt, id: parsed.id };
}

function sequenceCursor(cursor: string | undefined): number | undefined {
  const parsed = decodeCursor(cursor);
  if (!parsed) return undefined;
  if (parsed.v !== 1 || typeof parsed.sequence !== "number" || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0) {
    throw new ContextConversationError("INVALID_CURSOR");
  }
  return parsed.sequence;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  return limit;
}

function idempotencyRow(
  db: Db,
  table: "context_conversations" | "context_messages" | "context_checkpoints",
  projectId: string,
  idempotencyKey: string | undefined,
  conversationId?: string,
): { id: string; request_hash: string } | undefined {
  if (!idempotencyKey) return undefined;
  const conversationClause = conversationId === undefined ? "" : " AND conversation_id = ?";
  const parameters = conversationId === undefined
    ? [projectId, idempotencyKey]
    : [projectId, conversationId, idempotencyKey];
  return db.prepare(
    `SELECT id, request_hash FROM ${table}
     WHERE project_id = ?${conversationClause} AND idempotency_key = ?`,
  ).get(...parameters) as { id: string; request_hash: string } | undefined;
}

function requireMatchingIdempotency(row: { request_hash: string }, hash: string): void {
  if (row.request_hash !== hash) throw new ContextConversationError("IDEMPOTENCY_KEY_REUSED");
}

function insertCheckpointRagSources(
  db: Db,
  projectId: string,
  checkpointId: string,
  ragSources: Array<Pick<ContextCheckpointRagSource, "rag_source_id" | "ordinal" | "metadata">>,
  createdAt: string,
): void {
  const insert = db.prepare(
    `INSERT INTO context_checkpoint_rag_sources
     (project_id, checkpoint_id, rag_source_id, ordinal, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectSource = db.prepare(
    `SELECT source.id, source.source_hash, source.title, source.source_path,
            source.source_type, source.mime_type, source.byte_size,
            upload.provenance, upload.source_reference
     FROM rag_sources source
     LEFT JOIN context_rag_uploads upload
       ON upload.project_id = source.project_id AND upload.rag_source_id = source.id
     WHERE source.project_id = ? AND source.id = ?`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO context_checkpoint_rag_source_snapshots
     (project_id, checkpoint_id, rag_source_id, source_hash, title, source_path,
      source_type, mime_type, byte_size, provenance, source_reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const source of ragSources) {
    insert.run(projectId, checkpointId, source.rag_source_id, source.ordinal, source.metadata, createdAt);
    const persisted = selectSource.get(projectId, source.rag_source_id) as {
      id: string;
      source_hash: string | null;
      title: string;
      source_path: string | null;
      source_type: string;
      mime_type: string | null;
      byte_size: number | null;
      provenance: string | null;
      source_reference: string | null;
    } | undefined;
    if (!persisted) throw new ContextConversationError("RAG_SOURCE_NOT_FOUND");
    insertSnapshot.run(
      projectId,
      checkpointId,
      persisted.id,
      persisted.source_hash,
      persisted.title,
      persisted.source_path,
      persisted.source_type,
      persisted.mime_type,
      persisted.byte_size,
      persisted.provenance ?? "rag_source",
      persisted.source_reference,
      createdAt,
    );
  }
}

/** Create immutable conversation metadata. Its initial revision is always zero. */
export function createContextConversation(
  projectId: string,
  input: unknown,
): ContextConversationSummary {
  const value = parseConversationInput(input);
  const hash = requestHash({
    title: value.title,
    tags: value.tags,
    priority: value.priority,
    metadata: value.metadata,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = idempotencyRow(db, "context_conversations", projectId, value.idempotencyKey);
    if (existing) {
      requireMatchingIdempotency(existing, hash);
      return { conversation: conversationSummaryRow(db, projectId, existing.id)!, written: false };
    }

    const id = randomUUID();
    const createdAt = now();
    const inserted = db.prepare(
      `INSERT INTO context_conversations
       (id, project_id, title, request_hash, idempotency_key, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, idempotency_key) DO NOTHING`,
    ).run(
      id, projectId, value.title, hash, value.idempotencyKey ?? null,
      JSON.stringify(value.tags), value.priority, JSON.stringify(value.metadata), createdAt,
    );
    if (inserted.changes === 0 && value.idempotencyKey) {
      const concurrent = idempotencyRow(db, "context_conversations", projectId, value.idempotencyKey);
      if (!concurrent) throw new Error("Context conversation idempotency lookup failed");
      requireMatchingIdempotency(concurrent, hash);
      return { conversation: conversationSummaryRow(db, projectId, concurrent.id)!, written: false };
    }
    return { conversation: conversationSummaryRow(db, projectId, id)!, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return result.conversation;
}

/** Append one immutable message only when the caller's observed revision is current. */
export function appendContextMessage(
  projectId: string,
  conversationId: string,
  input: unknown,
): ContextMessageAppendResult {
  const value = parseMessageInput(input);
  const contentHash = sha256(value.content);
  const hash = requestHash({
    role: value.role,
    contentHash,
    tags: value.tags,
    priority: value.priority,
    metadata: value.metadata,
    expectedRevision: value.expectedRevision,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    requireConversation(db, projectId, conversationId);
    const existing = idempotencyRow(db, "context_messages", projectId, value.idempotencyKey, conversationId);
    if (existing) {
      requireMatchingIdempotency(existing, hash);
      const message = readMessage(db.prepare(
        "SELECT * FROM context_messages WHERE project_id = ? AND conversation_id = ? AND id = ?",
      ).get(projectId, conversationId, existing.id));
      return { message, revision: currentRevision(db, projectId, conversationId), idempotent: true, written: false };
    }

    requireActiveConversation(db, projectId, conversationId);
    const revision = currentRevision(db, projectId, conversationId);
    requireExpectedRevision(revision, value.expectedRevision);
    const id = randomUUID();
    const createdAt = now();
    const inserted = db.prepare(
      `INSERT INTO context_messages
       (id, project_id, conversation_id, sequence, role, content, content_hash, request_hash, idempotency_key, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, conversation_id, idempotency_key) DO NOTHING`,
    ).run(
      id, projectId, conversationId, revision, value.role, value.content, contentHash, hash,
      value.idempotencyKey ?? null, JSON.stringify(value.tags), value.priority, JSON.stringify(value.metadata), createdAt,
    );
    if (inserted.changes === 0 && value.idempotencyKey) {
      const concurrent = idempotencyRow(db, "context_messages", projectId, value.idempotencyKey, conversationId);
      if (!concurrent) throw new Error("Context message idempotency lookup failed");
      requireMatchingIdempotency(concurrent, hash);
      const message = readMessage(db.prepare(
        "SELECT * FROM context_messages WHERE project_id = ? AND conversation_id = ? AND id = ?",
      ).get(projectId, conversationId, concurrent.id));
      return { message, revision: currentRevision(db, projectId, conversationId), idempotent: true, written: false };
    }
    const message = readMessage(db.prepare("SELECT * FROM context_messages WHERE id = ?").get(id));
    return { message, revision: revision + 1, idempotent: false, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return { message: result.message, revision: result.revision, idempotent: result.idempotent };
}

/** Record a hash-addressed snapshot of the full stream visible at expectedRevision. */
export function createContextCheckpoint(
  projectId: string,
  conversationId: string,
  input: unknown,
): ContextCheckpointCreateResult {
  const value = parseCheckpointInput(input);
  const hash = requestHash({
    ragSourceIds: value.ragSourceIds,
    metadata: value.metadata,
    expectedRevision: value.expectedRevision,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    requireConversation(db, projectId, conversationId);
    const existing = idempotencyRow(db, "context_checkpoints", projectId, value.idempotencyKey, conversationId);
    if (existing) {
      requireMatchingIdempotency(existing, hash);
      const checkpoint = requireCheckpoint(db, projectId, conversationId, existing.id);
      return { checkpoint, revision: currentRevision(db, projectId, conversationId), idempotent: true, written: false };
    }

    requireActiveConversation(db, projectId, conversationId);
    const revision = currentRevision(db, projectId, conversationId);
    requireExpectedRevision(revision, value.expectedRevision);
    if (revision === 0) throw new ContextConversationError("NO_MESSAGES");
    const messages = db.prepare(
      `SELECT * FROM context_messages
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY sequence ASC`,
    ).all(projectId, conversationId).map(readMessage);

    if (value.ragSourceIds.length > 0) {
      const placeholders = value.ragSourceIds.map(() => "?").join(",");
      const owned = db.prepare(
        `SELECT id FROM rag_sources WHERE project_id = ? AND id IN (${placeholders})`,
      ).all(projectId, ...value.ragSourceIds) as Array<{ id: string }>;
      if (owned.length !== value.ragSourceIds.length) {
        throw new ContextConversationError("RAG_SOURCE_NOT_FOUND");
      }
    }

    const sequence = (db.prepare(
      `SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence
       FROM context_checkpoints
       WHERE project_id = ? AND conversation_id = ?`,
    ).get(projectId, conversationId) as { sequence: number }).sequence;
    const id = randomUUID();
    const createdAt = now();
    const throughMessage = messages[messages.length - 1]!;
    const inserted = db.prepare(
      `INSERT INTO context_checkpoints
       (id, project_id, conversation_id, sequence, through_message_id, message_count, state_hash, request_hash, idempotency_key, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, conversation_id, idempotency_key) DO NOTHING`,
    ).run(
      id, projectId, conversationId, sequence, throughMessage.id, messages.length,
      checkpointStateHash(messages), hash, value.idempotencyKey ?? null, JSON.stringify(value.metadata), createdAt,
    );
    if (inserted.changes === 0 && value.idempotencyKey) {
      const concurrent = idempotencyRow(db, "context_checkpoints", projectId, value.idempotencyKey, conversationId);
      if (!concurrent) throw new Error("Context checkpoint idempotency lookup failed");
      requireMatchingIdempotency(concurrent, hash);
      return {
        checkpoint: requireCheckpoint(db, projectId, conversationId, concurrent.id),
        revision: currentRevision(db, projectId, conversationId),
        idempotent: true,
        written: false,
      };
    }
    insertCheckpointRagSources(
      db,
      projectId,
      id,
      value.ragSourceIds.map((rag_source_id, ordinal) => ({ rag_source_id, ordinal, metadata: "{}" })),
      createdAt,
    );
    return { checkpoint: requireCheckpoint(db, projectId, conversationId, id), revision, idempotent: false, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return { checkpoint: result.checkpoint, revision: result.revision, idempotent: result.idempotent };
}

/**
 * Return a bounded, content-free review set. There is deliberately no automatic
 * retention rule: callers must supply a stale cutoff when requesting staleness.
 */
export function previewContextMaintenance(
  projectId: string,
  input: unknown,
): ContextMaintenanceCandidate[] {
  const value = parseMaintenancePreviewInput(input);
  const db = getDb(dbPath());
  const selectedIds = value.conversationIds?.slice(0, value.limit);
  const selected = selectedIds !== undefined;
  const placeholders = selectedIds?.map(() => "?").join(",");
  const rows = selected
    ? db.prepare(
      `SELECT c.id,
         (SELECT count(*) FROM context_messages m
          WHERE m.project_id = c.project_id AND m.conversation_id = c.id) AS message_count,
         (SELECT count(*) FROM context_checkpoints cp
          WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id) AS checkpoint_count,
         COALESCE((SELECT created_at FROM context_messages m
          WHERE m.project_id = c.project_id AND m.conversation_id = c.id
          ORDER BY m.sequence DESC LIMIT 1), c.created_at) AS last_activity_at
       FROM context_conversations c
       WHERE c.project_id = ? AND c.id IN (${placeholders})`,
    ).all(projectId, ...selectedIds!)
    : db.prepare(
      `SELECT c.id,
         (SELECT count(*) FROM context_messages m
          WHERE m.project_id = c.project_id AND m.conversation_id = c.id) AS message_count,
         (SELECT count(*) FROM context_checkpoints cp
          WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id) AS checkpoint_count,
         COALESCE((SELECT created_at FROM context_messages m
          WHERE m.project_id = c.project_id AND m.conversation_id = c.id
          ORDER BY m.sequence DESC LIMIT 1), c.created_at) AS last_activity_at
       FROM context_conversations c
       WHERE c.project_id = ?
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ?`,
    ).all(projectId, value.limit);

  const staleBefore = value.staleBefore === undefined ? undefined : Date.parse(value.staleBefore);
  if (staleBefore !== undefined && Number.isNaN(staleBefore)) {
    throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  const candidates = new Map<string, ContextMaintenanceCandidate>();
  for (const row of rows as Array<{
    id: string;
    message_count: number;
    checkpoint_count: number;
    last_activity_at: string;
  }>) {
    const archived = isConversationArchived(db, projectId, row.id);
    if (!value.includeArchived && archived) continue;
    const reasons: ContextMaintenanceCandidateReason[] = [];
    if (staleBefore !== undefined && Date.parse(row.last_activity_at) < staleBefore) reasons.push("STALE");
    if (value.includeConflicts && hasCheckpointDivergence(db, projectId, row.id, row.message_count)) {
      reasons.push("CHECKPOINT_DIVERGED");
    }
    if (value.includeConflicts && hasMultipleActiveRestoreBranches(db, projectId, row.id)) {
      reasons.push("MULTIPLE_ACTIVE_RESTORE_BRANCHES");
    }
    if (value.includeInvalid && hasCheckpointIntegrityFailure(db, projectId, row.id)) {
      reasons.push("CHECKPOINT_INTEGRITY_FAILED");
    }
    if (selected || reasons.length > 0) {
      candidates.set(row.id, {
        conversationId: row.id,
        currentRevision: row.message_count,
        checkpointCount: row.checkpoint_count,
        lastActivityAt: row.last_activity_at,
        archived,
        reasons,
      });
    }
  }
  return selectedIds === undefined
    ? [...candidates.values()]
    : selectedIds.flatMap((id) => candidates.get(id) ? [candidates.get(id)!] : []);
}

/** Issue a one-time, short-lived confirmation token after checking ownership and revision. */
export function authorizeContextMaintenanceAction(
  projectId: string,
  conversationId: string,
  input: unknown,
): ContextMaintenanceAuthorization {
  const value = parseMaintenanceAuthorizationInput(input);
  const confirmationToken = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + MAINTENANCE_AUTHORIZATION_TTL_MS).toISOString();
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    requireConversation(db, projectId, conversationId);
    const revision = currentRevision(db, projectId, conversationId);
    requireExpectedRevision(revision, value.expectedRevision);
    const archived = isConversationArchived(db, projectId, conversationId);
    if (value.operation === "archive_conversation" && archived) {
      throw new ContextConversationError("CONVERSATION_ALREADY_ARCHIVED");
    }
    if (value.operation === "unarchive_conversation" && !archived) {
      throw new ContextConversationError("CONVERSATION_NOT_ARCHIVED");
    }
    const checkpoint = value.checkpointId === undefined
      ? undefined
      : requireCheckpoint(db, projectId, conversationId, value.checkpointId);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO context_checkpoint_maintenance_authorizations
       (id, project_id, operation, conversation_id, checkpoint_id, expected_revision,
        confirmation_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, projectId, value.operation, conversationId, value.checkpointId ?? null,
      value.expectedRevision, sha256(confirmationToken), expiresAt, createdAt,
    );
    return {
      operation: value.operation,
      conversationId,
      checkpointId: value.checkpointId ?? null,
      expectedRevision: value.expectedRevision,
      checkpointStateHash: checkpoint?.state_hash ?? null,
      confirmationToken,
      expiresAt,
    };
  });
  checkpointAfterWrite();
  return result;
}

function transitionConversationArchive(
  projectId: string,
  conversationId: string,
  input: unknown,
  operation: "archive_conversation" | "unarchive_conversation",
): ContextConversationArchiveResult {
  const value = parseConversationArchiveInput(input);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    requireConversation(db, projectId, conversationId);
    const revision = currentRevision(db, projectId, conversationId);
    requireExpectedRevision(revision, value.expectedRevision);
    const archived = isConversationArchived(db, projectId, conversationId);
    if (operation === "archive_conversation" && archived) {
      throw new ContextConversationError("CONVERSATION_ALREADY_ARCHIVED");
    }
    if (operation === "unarchive_conversation" && !archived) {
      throw new ContextConversationError("CONVERSATION_NOT_ARCHIVED");
    }
    const authorizationId = consumeMaintenanceAuthorization(
      db, projectId, operation, conversationId, null, value.expectedRevision, value.confirmationToken,
    );
    const event = insertCheckpointAuditEvent(db, {
      projectId,
      eventType: operation === "archive_conversation" ? "conversation_archived" : "conversation_unarchived",
      conversationId,
      checkpointId: null,
      targetConversationId: null,
      expectedRevision: value.expectedRevision,
      checkpointStateHash: null,
      authorizationId,
      archiveSequence: nextArchiveSequence(db, projectId, conversationId),
      createdAt: now(),
    });
    return { archived: operation === "archive_conversation", event };
  });
  checkpointAfterWrite();
  return result;
}

/** Archive is an append-only visibility state; conversations and checkpoints remain intact. */
export function archiveContextConversation(
  projectId: string,
  conversationId: string,
  input: unknown,
): ContextConversationArchiveResult {
  return transitionConversationArchive(projectId, conversationId, input, "archive_conversation");
}

/** Reverses an archive by appending a new audit event; no historical row is changed. */
export function unarchiveContextConversation(
  projectId: string,
  conversationId: string,
  input: unknown,
): ContextConversationArchiveResult {
  return transitionConversationArchive(projectId, conversationId, input, "unarchive_conversation");
}

/** Bounded, content-free audit history. Confirmation tokens and metadata are never returned. */
export function listContextCheckpointAuditEvents(
  projectId: string,
  options: { conversationId?: string; limit?: number } = {},
): ContextCheckpointAuditEvent[] {
  const limit = boundedLimit(options.limit);
  const db = getDb(dbPath());
  if (options.conversationId !== undefined) {
    requireConversation(db, projectId, options.conversationId);
  }
  const rows = options.conversationId === undefined
    ? db.prepare(
      `SELECT id, project_id, event_type, conversation_id, checkpoint_id, target_conversation_id,
              expected_revision, checkpoint_state_hash, archive_sequence, created_at
       FROM context_checkpoint_audit_events
       WHERE project_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(projectId, limit)
    : db.prepare(
      `SELECT id, project_id, event_type, conversation_id, checkpoint_id, target_conversation_id,
              expected_revision, checkpoint_state_hash, archive_sequence, created_at
       FROM context_checkpoint_audit_events
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(projectId, options.conversationId, limit);
  return rows.map(readCheckpointAuditEvent);
}

/** Get immutable metadata for one project-owned conversation. */
export function getContextConversation(
  projectId: string,
  conversationId: string,
): ContextConversationSummary | undefined {
  return conversationSummaryRow(getDb(dbPath()), projectId, conversationId);
}

/** Keyset-paginated conversation browsing; never performs an unbounded scan. */
export function listContextConversations(
  projectId: string,
  options: { limit?: number; cursor?: string } = {},
): ContextKeysetPage<ContextConversationSummary> {
  const limit = boundedLimit(options.limit);
  const cursor = conversationCursor(options.cursor);
  const db = getDb(dbPath());
  const rows = cursor
    ? db.prepare(
      `SELECT c.*,
         (SELECT count(*) FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id) AS message_count,
         (SELECT count(*) FROM context_checkpoints cp WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id) AS checkpoint_count,
         (SELECT id FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id ORDER BY m.sequence DESC LIMIT 1) AS latest_message_id
       FROM context_conversations c
        WHERE c.project_id = ?
          AND COALESCE((
            SELECT event_type FROM context_checkpoint_audit_events audit
            WHERE audit.project_id = c.project_id AND audit.conversation_id = c.id
              AND audit.archive_sequence IS NOT NULL
            ORDER BY audit.archive_sequence DESC LIMIT 1
          ), 'conversation_unarchived') <> 'conversation_archived'
          AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))
       ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    ).all(projectId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db.prepare(
      `SELECT c.*,
         (SELECT count(*) FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id) AS message_count,
         (SELECT count(*) FROM context_checkpoints cp WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id) AS checkpoint_count,
         (SELECT id FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id ORDER BY m.sequence DESC LIMIT 1) AS latest_message_id
       FROM context_conversations c
        WHERE c.project_id = ?
          AND COALESCE((
            SELECT event_type FROM context_checkpoint_audit_events audit
            WHERE audit.project_id = c.project_id AND audit.conversation_id = c.id
              AND audit.archive_sequence IS NOT NULL
            ORDER BY audit.archive_sequence DESC LIMIT 1
          ), 'conversation_unarchived') <> 'conversation_archived'
       ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    ).all(projectId, limit + 1);
  const data = rows.slice(0, limit).map(readConversationSummary).map((summary) => ({ ...summary, revision: summary.message_count }));
  const tail = data[data.length - 1];
  return {
    data,
    nextCursor: rows.length > limit && tail
      ? encodeCursor({ v: 1, createdAt: tail.created_at, id: tail.id })
      : null,
  };
}

/** Keyset-paginated message summaries. Content is available only from retrieve/batch APIs. */
export function listContextMessages(
  projectId: string,
  conversationId: string,
  options: { limit?: number; cursor?: string } = {},
): ContextKeysetPage<ContextMessageSummary> {
  const limit = boundedLimit(options.limit);
  const cursor = sequenceCursor(options.cursor);
  const db = getDb(dbPath());
  requireConversation(db, projectId, conversationId);
  const rows = cursor === undefined
    ? db.prepare(
      `SELECT * FROM context_messages
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY sequence ASC LIMIT ?`,
    ).all(projectId, conversationId, limit + 1)
    : db.prepare(
      `SELECT * FROM context_messages
       WHERE project_id = ? AND conversation_id = ? AND sequence > ?
       ORDER BY sequence ASC LIMIT ?`,
    ).all(projectId, conversationId, cursor, limit + 1);
  const data = rows.slice(0, limit).map(readMessage).map(toContextMessageSummary);
  const tail = data[data.length - 1];
  return { data, nextCursor: rows.length > limit && tail ? encodeCursor({ v: 1, sequence: tail.sequence }) : null };
}

/** Explicit retrieval is the only single-message API that returns message content. */
export function getContextMessage(
  projectId: string,
  conversationId: string,
  messageId: string,
): ContextMessage | undefined {
  const row = getDb(dbPath()).prepare(
    `SELECT * FROM context_messages
     WHERE project_id = ? AND conversation_id = ? AND id = ?`,
  ).get(projectId, conversationId, messageId);
  return row ? readMessage(row) : undefined;
}

/** Bounded relevance search returns summaries, never matched content. */
export function searchContextMessages(
  projectId: string,
  conversationId: string,
  query: string,
  limit?: number,
): ContextMessageSearchResult[] {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 512) {
    throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  const safeLimit = boundedLimit(limit);
  const db = getDb(dbPath());
  requireConversation(db, projectId, conversationId);
  const sanitized = sanitizeFts5Query(query);
  const rows = db.prepare(
    `SELECT m.*, bm25(context_messages_fts) AS rank
     FROM context_messages_fts
     INNER JOIN context_messages m ON m.rowid = context_messages_fts.rowid
     WHERE context_messages_fts MATCH ?
       AND m.project_id = ? AND m.conversation_id = ?
     ORDER BY bm25(context_messages_fts), m.sequence DESC, m.id DESC
     LIMIT ?`,
  ).all(sanitized, projectId, conversationId, safeLimit) as Array<ContextMessage & { rank: number }>;
  return rows.map((row) => ({ ...toContextMessageSummary(readMessage(row)), rank: row.rank }));
}

/** Requested IDs are preserved exactly; missing IDs are reported without cross-project probing. */
export function retrieveContextMessages(
  projectId: string,
  conversationId: string,
  messageIds: string[],
): ContextMessageBatch {
  if (!Array.isArray(messageIds) || messageIds.length === 0 || messageIds.length > 100
    || messageIds.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) {
    throw new ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  const db = getDb(dbPath());
  requireConversation(db, projectId, conversationId);
  const uniqueIds = [...new Set(messageIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM context_messages
     WHERE project_id = ? AND conversation_id = ? AND id IN (${placeholders})`,
  ).all(projectId, conversationId, ...uniqueIds).map(readMessage);
  const found = new Map(rows.map((message) => [message.id, message]));
  const missingIds: string[] = [];
  for (const id of uniqueIds) if (!found.has(id)) missingIds.push(id);
  return {
    messages: messageIds.flatMap((id) => {
      const message = found.get(id);
      return message ? [message] : [];
    }),
    missingIds,
  };
}

export function getContextCheckpoint(
  projectId: string,
  conversationId: string,
  checkpointId: string,
): ContextCheckpointDetail | undefined {
  const db = getDb(dbPath());
  const row = db.prepare(
    `SELECT * FROM context_checkpoints
     WHERE project_id = ? AND conversation_id = ? AND id = ?`,
  ).get(projectId, conversationId, checkpointId);
  if (!row) return undefined;
  return {
    checkpoint: readCheckpoint(row),
    ragSources: listContextCheckpointRagSources(projectId, checkpointId),
  };
}

/** Checkpoint history is descending by immutable checkpoint version. */
export function listContextCheckpoints(
  projectId: string,
  conversationId: string,
  options: { limit?: number; cursor?: string } = {},
): ContextKeysetPage<ContextCheckpoint> {
  const limit = boundedLimit(options.limit);
  const cursor = sequenceCursor(options.cursor);
  const db = getDb(dbPath());
  requireConversation(db, projectId, conversationId);
  const rows = cursor === undefined
    ? db.prepare(
      `SELECT * FROM context_checkpoints
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY sequence DESC LIMIT ?`,
    ).all(projectId, conversationId, limit + 1)
    : db.prepare(
      `SELECT * FROM context_checkpoints
       WHERE project_id = ? AND conversation_id = ? AND sequence < ?
       ORDER BY sequence DESC LIMIT ?`,
    ).all(projectId, conversationId, cursor, limit + 1);
  const data = rows.slice(0, limit).map(readCheckpoint);
  const tail = data[data.length - 1];
  return { data, nextCursor: rows.length > limit && tail ? encodeCursor({ v: 1, sequence: tail.sequence }) : null };
}

export function listContextCheckpointRagSources(
  projectId: string,
  checkpointId: string,
): ContextCheckpointRagSource[] {
  return getDb(dbPath()).prepare(
    `SELECT * FROM context_checkpoint_rag_sources
     WHERE project_id = ? AND checkpoint_id = ?
     ORDER BY ordinal ASC`,
  ).all(projectId, checkpointId).map(readCheckpointRagSource);
}

/**
 * Restore a checkpoint by branching it into a new immutable conversation. The
 * source conversation and its current state are never changed or deleted.
 */
export function restoreContextCheckpoint(
  projectId: string,
  conversationId: string,
  checkpointId: string,
  input: unknown,
): ContextCheckpointRestoreResult {
  const value = parseRestoreInput(input);
  const hash = requestHash({
    conversationId,
    checkpointId,
    expectedRevision: value.expectedRevision,
    title: value.title ?? null,
    metadata: value.metadata,
  });
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const sourceConversation = requireConversation(db, projectId, conversationId);
    const existing = idempotencyRow(db, "context_conversations", projectId, value.idempotencyKey);
    if (existing) {
      requireMatchingIdempotency(existing, hash);
      const checkpoint = requireCheckpoint(db, projectId, existing.id, (
        db.prepare(
          `SELECT id FROM context_checkpoints
           WHERE project_id = ? AND conversation_id = ? ORDER BY sequence ASC LIMIT 1`,
        ).get(projectId, existing.id) as { id: string } | undefined
      )?.id ?? "");
      return {
        conversation: conversationSummaryRow(db, projectId, existing.id)!,
        checkpoint,
        revision: currentRevision(db, projectId, existing.id),
        idempotent: true,
        written: false,
      };
    }

    const sourceRevision = currentRevision(db, projectId, conversationId);
    requireExpectedRevision(sourceRevision, value.expectedRevision);
    const sourceCheckpoint = requireCheckpoint(db, projectId, conversationId, checkpointId);
    const sourceMessages = db.prepare(
      `SELECT * FROM context_messages
       WHERE project_id = ? AND conversation_id = ? AND sequence < ?
       ORDER BY sequence ASC`,
    ).all(projectId, conversationId, sourceCheckpoint.message_count).map(readMessage);
    const sourceTail = sourceMessages[sourceMessages.length - 1];
    if (sourceMessages.length !== sourceCheckpoint.message_count
      || !sourceTail
      || sourceTail.id !== sourceCheckpoint.through_message_id
      || checkpointStateHash(sourceMessages) !== sourceCheckpoint.state_hash) {
      throw new ContextConversationError("CHECKPOINT_INTEGRITY_FAILED");
    }

    const authorizationId = consumeMaintenanceAuthorization(
      db,
      projectId,
      "restore_checkpoint",
      conversationId,
      checkpointId,
      value.expectedRevision,
      value.confirmationToken,
    );

    if (!isBoundedContextMetadata(value.metadata)) {
      throw new ContextConversationError("INVALID_CONTEXT_INPUT");
    }
    const restoredMetadata = {
      ...value.metadata,
      restoredFrom: {
        conversationId,
        checkpointId,
        revision: sourceCheckpoint.message_count,
        stateHash: sourceCheckpoint.state_hash,
      },
    };
    if (!isBoundedContextMetadata(restoredMetadata)) {
      throw new ContextConversationError("INVALID_CONTEXT_INPUT");
    }
    const restoredId = randomUUID();
    const restoredTitle = value.title ?? `Restored ${sourceConversation.title}`.slice(0, 256);
    const createdAt = now();
    const insertedConversation = db.prepare(
      `INSERT INTO context_conversations
       (id, project_id, title, request_hash, idempotency_key, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, idempotency_key) DO NOTHING`,
    ).run(
      restoredId, projectId, restoredTitle, hash, value.idempotencyKey ?? null,
      sourceConversation.tags, sourceConversation.priority, JSON.stringify(restoredMetadata), createdAt,
    );
    if (insertedConversation.changes === 0 && value.idempotencyKey) {
      const concurrent = idempotencyRow(db, "context_conversations", projectId, value.idempotencyKey);
      if (!concurrent) throw new Error("Context restore idempotency lookup failed");
      requireMatchingIdempotency(concurrent, hash);
      const checkpointRow = db.prepare(
        `SELECT * FROM context_checkpoints
         WHERE project_id = ? AND conversation_id = ? ORDER BY sequence ASC LIMIT 1`,
      ).get(projectId, concurrent.id);
      if (!checkpointRow) throw new ContextConversationError("CHECKPOINT_INTEGRITY_FAILED");
      return {
        conversation: conversationSummaryRow(db, projectId, concurrent.id)!,
        checkpoint: readCheckpoint(checkpointRow),
        revision: currentRevision(db, projectId, concurrent.id),
        idempotent: true,
        written: false,
      };
    }

    const insertMessage = db.prepare(
      `INSERT INTO context_messages
       (id, project_id, conversation_id, sequence, role, content, content_hash, request_hash, idempotency_key, tags, priority, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    );
    const restoredMessages = sourceMessages.map((message) => {
      const id = randomUUID();
      insertMessage.run(
        id, projectId, restoredId, message.sequence, message.role, message.content,
        message.content_hash, requestHash({ restore: checkpointId, sourceMessageId: message.id }),
        message.tags, message.priority, message.metadata, createdAt,
      );
      return { ...message, id, project_id: projectId, conversation_id: restoredId, created_at: createdAt };
    });
    const restoredTail = restoredMessages[restoredMessages.length - 1]!;
    const restoredCheckpointId = randomUUID();
    db.prepare(
      `INSERT INTO context_checkpoints
       (id, project_id, conversation_id, sequence, through_message_id, message_count, state_hash, request_hash, idempotency_key, metadata, created_at)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      restoredCheckpointId, projectId, restoredId, restoredTail.id, restoredMessages.length,
      checkpointStateHash(restoredMessages), hash, JSON.stringify(restoredMetadata), createdAt,
    );
    const sourceRagSources = listContextCheckpointRagSources(projectId, checkpointId);
    insertCheckpointRagSources(db, projectId, restoredCheckpointId, sourceRagSources, createdAt);
    insertCheckpointAuditEvent(db, {
      projectId,
      eventType: "checkpoint_restored_as_new",
      conversationId,
      checkpointId,
      targetConversationId: restoredId,
      expectedRevision: value.expectedRevision,
      checkpointStateHash: sourceCheckpoint.state_hash,
      authorizationId,
      archiveSequence: null,
      createdAt,
    });
    return {
      conversation: conversationSummaryRow(db, projectId, restoredId)!,
      checkpoint: requireCheckpoint(db, projectId, restoredId, restoredCheckpointId),
      revision: restoredMessages.length,
      idempotent: false,
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return {
    conversation: result.conversation,
    checkpoint: result.checkpoint,
    revision: result.revision,
    idempotent: result.idempotent,
  };
}
