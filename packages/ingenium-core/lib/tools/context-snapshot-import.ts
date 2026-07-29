import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  ContextConversationSchema,
  ContextMessageSchema,
  ContextConversationSnapshotUnsignedInputSchema,
  ImportContextConversationSnapshotInputSchema,
  CONTEXT_TAGS_MAX_BYTES,
  isBoundedContextMetadata,
  toBoundedContextSnapshotTimingMs,
  type ContextMetadata,
  type ContextMessage,
  type ContextSnapshotImportTiming,
} from "../schema.js";
import type { ContextConversationSummary } from "./context-conversations.js";

export type ContextSnapshotImportErrorCode =
  | "INVALID_CONTEXT_SNAPSHOT"
  | "SNAPSHOT_HASH_MISMATCH"
  | "PROJECT_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_ARCHIVED"
  | "SOURCE_KEY_REUSED"
  | "SNAPSHOT_SHORTER"
  | "SNAPSHOT_DIVERGED"
  | "SNAPSHOT_MAPPING_INTEGRITY_FAILED";

/** Snapshot-import errors never include titles, source IDs, or message content. */
export class ContextSnapshotImportError extends Error {
  constructor(public readonly code: ContextSnapshotImportErrorCode) {
    super(code);
    this.name = "ContextSnapshotImportError";
  }
}

export interface ContextConversationSnapshotImportResult {
  conversation: ContextConversationSummary;
  snapshotHash: string;
  appended: number;
  revision: number;
  created: boolean;
  adopted: boolean;
  idempotent: boolean;
  timing: ContextSnapshotImportTiming;
}

interface SnapshotEntry {
  role: "user" | "assistant";
  content: string;
  sourceMessageId?: string;
  fingerprint?: string;
  createdAt?: string;
  metadata: ContextMetadata;
}

interface SnapshotInput {
  sourceKey: string;
  sourceSessionId?: string;
  title: string;
  existingConversationId?: string;
  entries: SnapshotEntry[];
  tags: string[];
  priority: number;
  metadata: ContextMetadata;
  snapshotHash: string;
}

interface NormalizedSnapshotEntry extends SnapshotEntry {
  contentHash: string;
  sourceFingerprint: string;
}

interface NormalizedSnapshot extends Omit<SnapshotInput, "entries" | "tags" | "sourceSessionId"> {
  sourceSessionId: string | null;
  entries: NormalizedSnapshotEntry[];
  tags: string[];
}

interface SourceMapping {
  id: string;
  project_id: string;
  source_key: string;
  source_session_id: string | null;
  conversation_id: string;
  snapshot_hash: string;
  entry_count: number;
  created_at: string;
  updated_at: string;
}

interface SourceMessageEvidence {
  project_id: string;
  source_id: string;
  conversation_id: string;
  message_id: string;
  sequence: number;
  role: "user" | "assistant";
  content_hash: string;
  source_fingerprint: string;
  created_at: string;
}

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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function normalizeTags(tags: string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()))].sort();
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > CONTEXT_TAGS_MAX_BYTES) {
    throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  }
  return normalized;
}

function sourceFingerprint(sourceKey: string, entry: SnapshotEntry): string {
  if (entry.fingerprint !== undefined) return entry.fingerprint;
  if (entry.sourceMessageId === undefined) throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  return sha256(`context-conversation-snapshot-source-message-v1\u0000${sourceKey}\u0000${entry.sourceMessageId}`);
}

function normalizeUnsignedSnapshot(input: unknown): Omit<NormalizedSnapshot, "snapshotHash"> {
  const parsed = ContextConversationSnapshotUnsignedInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  const value = parsed.data as Omit<SnapshotInput, "snapshotHash">;
  const entries = value.entries.map((entry) => ({
    ...entry,
    contentHash: sha256(entry.content),
    sourceFingerprint: sourceFingerprint(value.sourceKey, entry),
  }));
  if (new Set(entries.map((entry) => entry.sourceFingerprint)).size !== entries.length) {
    throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  }
  return {
    ...value,
    sourceSessionId: value.sourceSessionId ?? null,
    tags: normalizeTags(value.tags),
    entries,
  };
}

function snapshotHashPayload(snapshot: Omit<NormalizedSnapshot, "snapshotHash">): object {
  return {
    version: "context-conversation-snapshot-v1",
    sourceKey: snapshot.sourceKey,
    sourceSessionId: snapshot.sourceSessionId,
    title: snapshot.title,
    tags: snapshot.tags,
    priority: snapshot.priority,
    metadata: canonicalize(snapshot.metadata),
    entries: snapshot.entries.map((entry) => ({
      role: entry.role,
      contentHash: entry.contentHash,
      sourceFingerprint: entry.sourceFingerprint,
      createdAt: entry.createdAt ?? null,
      metadata: canonicalize(entry.metadata),
    })),
  };
}

function hashNormalizedSnapshot(snapshot: Omit<NormalizedSnapshot, "snapshotHash">): string {
  return sha256(canonicalJson(snapshotHashPayload(snapshot)));
}

/** Calculate the required hash without retaining a source transcript outside Context messages. */
export function calculateContextConversationSnapshotHash(input: unknown): string {
  return hashNormalizedSnapshot(normalizeUnsignedSnapshot(input));
}

function parseSnapshot(input: unknown): NormalizedSnapshot {
  const parsed = ImportContextConversationSnapshotInputSchema.safeParse(input);
  if (!parsed.success) throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  const { snapshotHash, ...unsigned } = parsed.data as SnapshotInput;
  const normalized = normalizeUnsignedSnapshot(unsigned);
  if (hashNormalizedSnapshot(normalized) !== snapshotHash) {
    throw new ContextSnapshotImportError("SNAPSHOT_HASH_MISMATCH");
  }
  return { ...normalized, snapshotHash };
}

function readMessage(row: unknown): ContextMessage {
  const parsed = ContextMessageSchema.safeParse(row);
  if (!parsed.success) throw new ContextSnapshotImportError("SNAPSHOT_MAPPING_INTEGRITY_FAILED");
  return parsed.data;
}

function conversationSummary(db: ReturnType<typeof getDb>, projectId: string, conversationId: string): ContextConversationSummary {
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
  if (!row) throw new ContextSnapshotImportError("CONVERSATION_NOT_FOUND");
  const conversation = ContextConversationSchema.safeParse(row);
  const summaryRow = row as Record<string, unknown>;
  const messageCount = summaryRow.message_count;
  const checkpointCount = summaryRow.checkpoint_count;
  const latestMessageId = summaryRow.latest_message_id;
  if (!conversation.success
    || typeof messageCount !== "number"
    || !Number.isSafeInteger(messageCount)
    || typeof checkpointCount !== "number"
    || !Number.isSafeInteger(checkpointCount)
    || messageCount < 0
    || checkpointCount < 0
    || (latestMessageId !== null && typeof latestMessageId !== "string")) {
    throw new ContextSnapshotImportError("SNAPSHOT_MAPPING_INTEGRITY_FAILED");
  }
  return {
    ...conversation.data,
    revision: messageCount,
    message_count: messageCount,
    checkpoint_count: checkpointCount,
    latest_message_id: latestMessageId as string | null,
  };
}

function requireProject(db: ReturnType<typeof getDb>, projectId: string): void {
  if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) {
    throw new ContextSnapshotImportError("PROJECT_NOT_FOUND");
  }
}

function isArchived(db: ReturnType<typeof getDb>, projectId: string, conversationId: string): boolean {
  const row = db.prepare(
    `SELECT event_type FROM context_checkpoint_audit_events
     WHERE project_id = ? AND conversation_id = ? AND archive_sequence IS NOT NULL
     ORDER BY archive_sequence DESC LIMIT 1`,
  ).get(projectId, conversationId) as { event_type?: string } | undefined;
  return row?.event_type === "conversation_archived";
}

function requireActiveConversation(db: ReturnType<typeof getDb>, projectId: string, conversationId: string): void {
  conversationSummary(db, projectId, conversationId);
  if (isArchived(db, projectId, conversationId)) {
    throw new ContextSnapshotImportError("CONVERSATION_ARCHIVED");
  }
}

function readMapping(row: unknown): SourceMapping {
  const value = row as Partial<SourceMapping> | undefined;
  const entryCount = value?.entry_count;
  if (!value
    || typeof value.id !== "string"
    || typeof value.project_id !== "string"
    || typeof value.source_key !== "string"
    || (value.source_session_id !== null && typeof value.source_session_id !== "string")
    || typeof value.conversation_id !== "string"
    || !/^[0-9a-f]{64}$/.test(value.snapshot_hash ?? "")
    || typeof entryCount !== "number"
    || !Number.isSafeInteger(entryCount)
    || entryCount < 1
    || typeof value.created_at !== "string"
    || typeof value.updated_at !== "string") {
    throw new ContextSnapshotImportError("SNAPSHOT_MAPPING_INTEGRITY_FAILED");
  }
  return value as SourceMapping;
}

function readSourceEvidence(row: unknown): SourceMessageEvidence {
  const value = row as Partial<SourceMessageEvidence> | undefined;
  const sequence = value?.sequence;
  if (!value
    || typeof value.project_id !== "string"
    || typeof value.source_id !== "string"
    || typeof value.conversation_id !== "string"
    || typeof value.message_id !== "string"
    || typeof sequence !== "number"
    || !Number.isSafeInteger(sequence)
    || sequence < 0
    || (value.role !== "user" && value.role !== "assistant")
    || !/^[0-9a-f]{64}$/.test(value.content_hash ?? "")
    || !/^[0-9a-f]{64}$/.test(value.source_fingerprint ?? "")
    || typeof value.created_at !== "string") {
    throw new ContextSnapshotImportError("SNAPSHOT_MAPPING_INTEGRITY_FAILED");
  }
  return value as SourceMessageEvidence;
}

function conversationMessages(
  db: ReturnType<typeof getDb>,
  projectId: string,
  conversationId: string,
): ContextMessage[] {
  const messages = db.prepare(
    `SELECT * FROM context_messages
     WHERE project_id = ? AND conversation_id = ?
     ORDER BY sequence ASC`,
  ).all(projectId, conversationId).map(readMessage);
  if (messages.some((message, sequence) => message.sequence !== sequence)) {
    throw new ContextSnapshotImportError("SNAPSHOT_DIVERGED");
  }
  return messages;
}

function sourceEvidence(
  db: ReturnType<typeof getDb>,
  projectId: string,
  sourceId: string,
): SourceMessageEvidence[] {
  return db.prepare(
    `SELECT project_id, source_id, conversation_id, message_id, sequence, role,
            content_hash, source_fingerprint, created_at
     FROM context_conversation_source_messages
     WHERE project_id = ? AND source_id = ?
     ORDER BY sequence ASC`,
  ).all(projectId, sourceId).map(readSourceEvidence);
}

function verifyAdoptionPrefix(messages: ContextMessage[], entries: NormalizedSnapshotEntry[]): void {
  if (entries.length < messages.length) throw new ContextSnapshotImportError("SNAPSHOT_SHORTER");
  for (let sequence = 0; sequence < messages.length; sequence += 1) {
    const message = messages[sequence]!;
    const entry = entries[sequence]!;
    if (message.role !== entry.role || message.content_hash !== entry.contentHash) {
      throw new ContextSnapshotImportError("SNAPSHOT_DIVERGED");
    }
  }
}

function verifyMappedPrefix(
  messages: ContextMessage[],
  evidence: SourceMessageEvidence[],
  mapping: SourceMapping,
  entries: NormalizedSnapshotEntry[],
): void {
  if (messages.length !== mapping.entry_count || evidence.length !== mapping.entry_count) {
    throw new ContextSnapshotImportError("SNAPSHOT_DIVERGED");
  }
  if (entries.length < mapping.entry_count) throw new ContextSnapshotImportError("SNAPSHOT_SHORTER");
  for (let sequence = 0; sequence < mapping.entry_count; sequence += 1) {
    const message = messages[sequence];
    const source = evidence[sequence];
    const entry = entries[sequence];
    if (!message || !source || !entry
      || source.sequence !== sequence
      || source.conversation_id !== mapping.conversation_id
      || source.message_id !== message.id
      || source.role !== message.role
      || source.content_hash !== message.content_hash
      || source.role !== entry.role
      || source.content_hash !== entry.contentHash
      || source.source_fingerprint !== entry.sourceFingerprint) {
      throw new ContextSnapshotImportError("SNAPSHOT_DIVERGED");
    }
  }
}

function conversationMetadata(snapshot: NormalizedSnapshot): string {
  const metadata = {
    ...snapshot.metadata,
    contextSnapshot: {
      version: 1,
      sourceKeyHash: sha256(snapshot.sourceKey),
      sourceSessionHash: snapshot.sourceSessionId === null ? null : sha256(snapshot.sourceSessionId),
      initialSnapshotHash: snapshot.snapshotHash,
    },
  };
  if (!isBoundedContextMetadata(metadata)) throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  return canonicalJson(metadata);
}

function messageMetadata(
  snapshot: NormalizedSnapshot,
  entry: NormalizedSnapshotEntry,
  sequence: number,
): string {
  const metadata = {
    ...entry.metadata,
    contextSnapshot: {
      version: 1,
      sourceKeyHash: sha256(snapshot.sourceKey),
      sourceSessionHash: snapshot.sourceSessionId === null ? null : sha256(snapshot.sourceSessionId),
      sourceFingerprint: entry.sourceFingerprint,
      sequence,
      snapshotHash: snapshot.snapshotHash,
    },
  };
  if (!isBoundedContextMetadata(metadata)) throw new ContextSnapshotImportError("INVALID_CONTEXT_SNAPSHOT");
  return canonicalJson(metadata);
}

function conversationRequestHash(snapshot: NormalizedSnapshot, metadata: string): string {
  return sha256(canonicalJson({
    version: "context-conversation-snapshot-v1",
    sourceKeyHash: sha256(snapshot.sourceKey),
    sourceSessionHash: snapshot.sourceSessionId === null ? null : sha256(snapshot.sourceSessionId),
    title: snapshot.title,
    tags: snapshot.tags,
    priority: snapshot.priority,
    metadata: JSON.parse(metadata),
    snapshotHash: snapshot.snapshotHash,
  }));
}

function messageRequestHash(
  snapshot: NormalizedSnapshot,
  entry: NormalizedSnapshotEntry,
  sequence: number,
  metadata: string,
): string {
  return sha256(canonicalJson({
    version: "context-conversation-snapshot-message-v1",
    sourceKeyHash: sha256(snapshot.sourceKey),
    sourceSessionHash: snapshot.sourceSessionId === null ? null : sha256(snapshot.sourceSessionId),
    sourceFingerprint: entry.sourceFingerprint,
    role: entry.role,
    contentHash: entry.contentHash,
    sequence,
    createdAt: entry.createdAt ?? null,
    metadata: JSON.parse(metadata),
  }));
}

function deterministicConversationIdempotencyKey(projectId: string, sourceKey: string): string {
  return sha256(`context-conversation-snapshot-conversation-idempotency-v1\u0000${projectId}\u0000${sourceKey}`);
}

function deterministicMessageIdempotencyKey(
  projectId: string,
  sourceKey: string,
  sourceFingerprintValue: string,
): string {
  return sha256(
    `context-conversation-snapshot-message-idempotency-v1\u0000${projectId}\u0000${sourceKey}\u0000${sourceFingerprintValue}`,
  );
}

function appendSnapshotEntries(
  db: ReturnType<typeof getDb>,
  projectId: string,
  sourceId: string,
  conversationId: string,
  snapshot: NormalizedSnapshot,
  startSequence: number,
  importedAt: string,
): void {
  const insertMessage = db.prepare(
    `INSERT INTO context_messages
     (id, project_id, conversation_id, sequence, role, content, content_hash, request_hash,
      idempotency_key, tags, priority, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
  );
  const insertEvidence = db.prepare(
    `INSERT INTO context_conversation_source_messages
     (project_id, source_id, conversation_id, message_id, sequence, role, content_hash,
      source_fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let sequence = startSequence; sequence < snapshot.entries.length; sequence += 1) {
    const entry = snapshot.entries[sequence]!;
    const messageId = randomUUID();
    const metadata = messageMetadata(snapshot, entry, sequence);
    const createdAt = entry.createdAt ?? importedAt;
    insertMessage.run(
      messageId,
      projectId,
      conversationId,
      sequence,
      entry.role,
      entry.content,
      entry.contentHash,
      messageRequestHash(snapshot, entry, sequence, metadata),
      deterministicMessageIdempotencyKey(projectId, snapshot.sourceKey, entry.sourceFingerprint),
      snapshot.priority,
      metadata,
      createdAt,
    );
    insertEvidence.run(
      projectId,
      sourceId,
      conversationId,
      messageId,
      sequence,
      entry.role,
      entry.contentHash,
      entry.sourceFingerprint,
      createdAt,
    );
  }
}

function addAdoptedEvidence(
  db: ReturnType<typeof getDb>,
  projectId: string,
  sourceId: string,
  conversationId: string,
  messages: ContextMessage[],
  entries: NormalizedSnapshotEntry[],
  importedAt: string,
): void {
  const insertEvidence = db.prepare(
    `INSERT INTO context_conversation_source_messages
     (project_id, source_id, conversation_id, message_id, sequence, role, content_hash,
      source_fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let sequence = 0; sequence < messages.length; sequence += 1) {
    const message = messages[sequence]!;
    const entry = entries[sequence]!;
    insertEvidence.run(
      projectId,
      sourceId,
      conversationId,
      message.id,
      sequence,
      entry.role,
      entry.contentHash,
      entry.sourceFingerprint,
      entry.createdAt ?? importedAt,
    );
  }
}

/**
 * Import a complete ordered snapshot into one project-scoped immutable Context
 * conversation. Replays are read-only; only a verified longer prefix appends.
 */
export function importContextConversationSnapshot(
  projectId: string,
  input: unknown,
): ContextConversationSnapshotImportResult {
  const validationStartedAt = performance.now();
  const snapshot = parseSnapshot(input);
  const validationMs = toBoundedContextSnapshotTimingMs(performance.now() - validationStartedAt);
  let prefixQueryMs = 0;
  const transactionStartedAt = performance.now();
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const prefixQueryStartedAt = performance.now();
    const finishPrefixQueryTiming = (): void => {
      prefixQueryMs = toBoundedContextSnapshotTimingMs(performance.now() - prefixQueryStartedAt);
    };
    requireProject(db, projectId);
    const existingMappingRow = db.prepare(
      `SELECT * FROM context_conversation_sources
       WHERE project_id = ? AND source_key = ?`,
    ).get(projectId, snapshot.sourceKey);
    const importedAt = now();

    if (existingMappingRow) {
      const mapping = readMapping(existingMappingRow);
      if (mapping.source_session_id !== snapshot.sourceSessionId
        || (snapshot.existingConversationId !== undefined && snapshot.existingConversationId !== mapping.conversation_id)) {
        throw new ContextSnapshotImportError("SOURCE_KEY_REUSED");
      }
      const messages = conversationMessages(db, projectId, mapping.conversation_id);
      const evidence = sourceEvidence(db, projectId, mapping.id);
      verifyMappedPrefix(messages, evidence, mapping, snapshot.entries);
      if (snapshot.entries.length === mapping.entry_count) {
        if (mapping.snapshot_hash !== snapshot.snapshotHash) {
          throw new ContextSnapshotImportError("SNAPSHOT_HASH_MISMATCH");
        }
        finishPrefixQueryTiming();
        return {
          conversation: conversationSummary(db, projectId, mapping.conversation_id),
          snapshotHash: snapshot.snapshotHash,
          appended: 0,
          revision: mapping.entry_count,
          created: false,
          adopted: false,
          idempotent: true,
          written: false,
        };
      }

      requireActiveConversation(db, projectId, mapping.conversation_id);
      finishPrefixQueryTiming();
      appendSnapshotEntries(
        db,
        projectId,
        mapping.id,
        mapping.conversation_id,
        snapshot,
        mapping.entry_count,
        importedAt,
      );
      db.prepare(
        `UPDATE context_conversation_sources
         SET snapshot_hash = ?, entry_count = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(snapshot.snapshotHash, snapshot.entries.length, importedAt, projectId, mapping.id);
      return {
        conversation: conversationSummary(db, projectId, mapping.conversation_id),
        snapshotHash: snapshot.snapshotHash,
        appended: snapshot.entries.length - mapping.entry_count,
        revision: snapshot.entries.length,
        created: false,
        adopted: false,
        idempotent: false,
        written: true,
      };
    }

    let conversationId: string;
    let existingMessages: ContextMessage[] = [];
    let created = false;
    const adopted = snapshot.existingConversationId !== undefined;
    if (snapshot.existingConversationId !== undefined) {
      conversationId = snapshot.existingConversationId;
      requireActiveConversation(db, projectId, conversationId);
      existingMessages = conversationMessages(db, projectId, conversationId);
      verifyAdoptionPrefix(existingMessages, snapshot.entries);
    } else {
      conversationId = randomUUID();
      created = true;
    }

    finishPrefixQueryTiming();
    if (created) {
      const metadata = conversationMetadata(snapshot);
      db.prepare(
        `INSERT INTO context_conversations
         (id, project_id, title, request_hash, idempotency_key, tags, priority, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        projectId,
        snapshot.title,
        conversationRequestHash(snapshot, metadata),
        deterministicConversationIdempotencyKey(projectId, snapshot.sourceKey),
        canonicalJson(snapshot.tags),
        snapshot.priority,
        metadata,
        importedAt,
      );
    }

    if (db.prepare(
      `SELECT 1 FROM context_conversation_sources
       WHERE project_id = ? AND conversation_id = ?`,
    ).get(projectId, conversationId)) {
      throw new ContextSnapshotImportError("SOURCE_KEY_REUSED");
    }

    const sourceId = randomUUID();
    db.prepare(
      `INSERT INTO context_conversation_sources
       (id, project_id, source_key, source_session_id, conversation_id, snapshot_hash,
        entry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sourceId,
      projectId,
      snapshot.sourceKey,
      snapshot.sourceSessionId,
      conversationId,
      snapshot.snapshotHash,
      snapshot.entries.length,
      importedAt,
      importedAt,
    );
    if (existingMessages.length > 0) {
      addAdoptedEvidence(
        db,
        projectId,
        sourceId,
        conversationId,
        existingMessages,
        snapshot.entries,
        importedAt,
      );
    }
    appendSnapshotEntries(
      db,
      projectId,
      sourceId,
      conversationId,
      snapshot,
      existingMessages.length,
      importedAt,
    );
    return {
      conversation: conversationSummary(db, projectId, conversationId),
      snapshotHash: snapshot.snapshotHash,
      appended: snapshot.entries.length - existingMessages.length,
      revision: snapshot.entries.length,
      created,
      adopted,
      idempotent: false,
      written: true,
    };
  });
  const transactionMs = toBoundedContextSnapshotTimingMs(performance.now() - transactionStartedAt);
  let checkpointMs = 0;
  if (result.written) {
    const checkpointStartedAt = performance.now();
    checkpointAfterWrite();
    checkpointMs = toBoundedContextSnapshotTimingMs(performance.now() - checkpointStartedAt);
  }
  return {
    conversation: result.conversation,
    snapshotHash: result.snapshotHash,
    appended: result.appended,
    revision: result.revision,
    created: result.created,
    adopted: result.adopted,
    idempotent: result.idempotent,
    timing: {
      validationMs,
      prefixQueryMs,
      transactionMs,
      checkpointMs,
    },
  };
}
