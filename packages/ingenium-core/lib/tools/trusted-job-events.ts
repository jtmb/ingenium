import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  TRUSTED_JOB_EVENT_PRODUCER,
  TRUSTED_JOB_EVENT_SCHEMA_VERSION,
  TrustedJobEventArchivePayloadSchema,
  TrustedJobEventRecordSchema,
  TrustedJobEventRestorePayloadSchema,
  TrustedJobEventTypeSchema,
  type ContextCheckpointAuditEvent,
  type TrustedJobEventPayload,
  type TrustedJobEventRecord,
  type TrustedJobEventType,
} from "../schema.js";

export const TRUSTED_JOB_EVENT_PAYLOAD_MAX_BYTES = 2_048;
export const TRUSTED_JOB_EVENT_PAYLOAD_MAX_DEPTH = 4;
export const TRUSTED_JOB_EVENT_PAYLOAD_MAX_NODES = 16;

export type TrustedJobEventErrorCode =
  | "INVALID_TRUSTED_JOB_EVENT"
  | "SOURCE_AUDIT_NOT_FOUND"
  | "SOURCE_AUDIT_PROJECT_CONFLICT"
  | "SOURCE_AUDIT_TYPE_CONFLICT"
  | "SOURCE_AUDIT_PROVENANCE_CONFLICT"
  | "TRUSTED_JOB_EVENT_DEDUPE_CONFLICT"
  | "INVALID_TRUSTED_JOB_EVENT_CURSOR";

/** Stable typed failures; neither payload values nor audit details are echoed. */
export class TrustedJobEventError extends Error {
  constructor(public readonly code: TrustedJobEventErrorCode) {
    super(code);
    this.name = "TrustedJobEventError";
  }
}

export interface TrustedJobEvent extends Omit<TrustedJobEventRecord, "payload"> {
  payload: TrustedJobEventPayload;
}

export interface AppendTrustedJobEventInput {
  eventType: TrustedJobEventType;
  sourceAuditEventId: string;
  payload: unknown;
}

export interface TrustedJobEventAppendResult {
  event: TrustedJobEvent;
  idempotent: boolean;
}

export interface TrustedJobEventPage {
  data: TrustedJobEvent[];
  nextCursor: string | null;
}

type Db = ReturnType<typeof getDb>;

interface SourceAuditEvent {
  id: string;
  project_id: string;
  event_type: ContextCheckpointAuditEvent["event_type"];
  conversation_id: string;
  checkpoint_id: string | null;
  target_conversation_id: string | null;
  expected_revision: number;
  archive_sequence: number | null;
  created_at: string;
  organization_id: string;
  source_actor_type: "compatibility" | "user" | "service" | "system";
  source_actor_id: string | null;
}

const DANGEROUS_PAYLOAD_KEY = /(?:authorization|cookie|content|message|password|secret|token|title|body|hash|reasoning)/i;

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
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

function serializePayload(payload: TrustedJobEventPayload): string {
  return JSON.stringify(canonicalize(payload));
}

/** Reject dangerous keys recursively before a payload can reach persistence. */
function assertBoundedSafePayload(value: unknown): void {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > TRUSTED_JOB_EVENT_PAYLOAD_MAX_NODES || depth > TRUSTED_JOB_EVENT_PAYLOAD_MAX_DEPTH) {
      throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
    }
    if (candidate === null || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
      return;
    }
    if (typeof candidate === "string") {
      if (candidate.length > 128) throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
      return;
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > 8) throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
      candidate.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
    }
    const entries = Object.entries(candidate as Record<string, unknown>);
    if (entries.length > 8) throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
    for (const [key, entry] of entries) {
      if (key.length > 64 || key === "__proto__" || key === "constructor" || key === "prototype" || DANGEROUS_PAYLOAD_KEY.test(key)) {
        throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
      }
      visit(entry, depth + 1);
    }
  };
  visit(value, 0);
}

function parsePayload(eventType: TrustedJobEventType, payload: unknown): TrustedJobEventPayload {
  assertBoundedSafePayload(payload);
  const parsed = eventType === "context.checkpoint.restored_as_new"
    ? TrustedJobEventRestorePayloadSchema.safeParse(payload)
    : TrustedJobEventArchivePayloadSchema.safeParse(payload);
  if (!parsed.success) throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
  if (Buffer.byteLength(serializePayload(parsed.data), "utf8") > TRUSTED_JOB_EVENT_PAYLOAD_MAX_BYTES) {
    throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
  }
  return parsed.data;
}

function parseInput(input: AppendTrustedJobEventInput): {
  eventType: TrustedJobEventType;
  sourceAuditEventId: string;
  payload: TrustedJobEventPayload;
} {
  const eventType = TrustedJobEventTypeSchema.safeParse(input.eventType);
  if (!eventType.success || typeof input.sourceAuditEventId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.sourceAuditEventId)) {
    throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
  }
  return {
    eventType: eventType.data,
    sourceAuditEventId: input.sourceAuditEventId,
    payload: parsePayload(eventType.data, input.payload),
  };
}

function readEvent(row: unknown): TrustedJobEvent {
  const persisted = row as Record<string, unknown>;
  const record = TrustedJobEventRecordSchema.safeParse({
    id: persisted.id,
    project_id: persisted.project_id,
    event_type: persisted.event_type,
    schema_version: persisted.schema_version,
    producer: persisted.producer,
    source_audit_event_id: persisted.source_audit_event_id,
    dedupe_key: persisted.dedupe_key,
    payload: persisted.payload,
    created_at: persisted.created_at,
  });
  if (!record.success) throw new Error("Invalid persisted trusted job event");
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(record.data.payload);
  } catch {
    throw new Error("Invalid persisted trusted job event payload");
  }
  return { ...record.data, payload: parsePayload(record.data.event_type, rawPayload) };
}

function sourceAuditEvent(db: Db, sourceAuditEventId: string): SourceAuditEvent {
  const source = db.prepare(
    `SELECT audit.id, audit.project_id, audit.event_type, audit.conversation_id, audit.checkpoint_id,
            audit.target_conversation_id, audit.expected_revision, audit.archive_sequence, audit.created_at,
            audit.organization_id, audit.source_actor_type, audit.source_actor_id
     FROM context_checkpoint_audit_events audit
     JOIN context_conversations conversation ON conversation.project_id = audit.project_id AND conversation.id = audit.conversation_id
     WHERE audit.id = ?`,
  ).get(sourceAuditEventId) as SourceAuditEvent | undefined;
  if (!source) throw new TrustedJobEventError("SOURCE_AUDIT_NOT_FOUND");
  return source;
}

function expectedFromSource(source: SourceAuditEvent): {
  eventType: TrustedJobEventType;
  payload: TrustedJobEventPayload;
} {
  switch (source.event_type) {
    case "conversation_archived":
      if (source.archive_sequence === null) break;
      return {
        eventType: "context.conversation.archived",
        payload: {
          conversationId: source.conversation_id,
          expectedRevision: source.expected_revision,
          archiveSequence: source.archive_sequence,
        },
      };
    case "conversation_unarchived":
      if (source.archive_sequence === null) break;
      return {
        eventType: "context.conversation.unarchived",
        payload: {
          conversationId: source.conversation_id,
          expectedRevision: source.expected_revision,
          archiveSequence: source.archive_sequence,
        },
      };
    case "checkpoint_restored_as_new":
      if (source.checkpoint_id === null || source.target_conversation_id === null) break;
      return {
        eventType: "context.checkpoint.restored_as_new",
        payload: {
          sourceConversationId: source.conversation_id,
          sourceCheckpointId: source.checkpoint_id,
          targetConversationId: source.target_conversation_id,
          expectedRevision: source.expected_revision,
        },
      };
  }
  throw new TrustedJobEventError("SOURCE_AUDIT_PROVENANCE_CONFLICT");
}

function samePayload(left: TrustedJobEventPayload, right: TrustedJobEventPayload): boolean {
  return serializePayload(left) === serializePayload(right);
}

/** Map a Context audit record to the sole trusted producer input shape. */
export function trustedJobEventFromContextAuditEvent(audit: ContextCheckpointAuditEvent): AppendTrustedJobEventInput {
  const source: SourceAuditEvent = {
    id: audit.id,
    project_id: audit.project_id,
    event_type: audit.event_type,
    conversation_id: audit.conversation_id,
    checkpoint_id: audit.checkpoint_id,
    target_conversation_id: audit.target_conversation_id,
    expected_revision: audit.expected_revision,
    archive_sequence: audit.archive_sequence,
    created_at: audit.created_at,
    organization_id: audit.organization_id,
    source_actor_type: audit.source_actor_type,
    source_actor_id: audit.source_actor_id,
  };
  const expected = expectedFromSource(source);
  return { eventType: expected.eventType, sourceAuditEventId: audit.id, payload: expected.payload };
}

/**
 * Append inside a caller-owned transaction. It never checkpoints or opens a
 * nested transaction, so Context maintenance can atomically write audit/event.
 */
export function appendTrustedJobEventInTransaction(
  db: Db,
  projectId: string,
  input: AppendTrustedJobEventInput,
): TrustedJobEventAppendResult {
  const value = parseInput(input);
  const source = sourceAuditEvent(db, value.sourceAuditEventId);
  if (source.project_id !== projectId) throw new TrustedJobEventError("SOURCE_AUDIT_PROJECT_CONFLICT");
  const expected = expectedFromSource(source);
  if (expected.eventType !== value.eventType) throw new TrustedJobEventError("SOURCE_AUDIT_TYPE_CONFLICT");

  const existingRow = db.prepare(
    "SELECT * FROM trusted_job_events WHERE project_id = ? AND source_audit_event_id = ?",
  ).get(projectId, value.sourceAuditEventId);
  if (existingRow) {
    const event = readEvent(existingRow);
    if (event.event_type !== value.eventType || !samePayload(event.payload, value.payload)) {
      throw new TrustedJobEventError("TRUSTED_JOB_EVENT_DEDUPE_CONFLICT");
    }
    return { event, idempotent: true };
  }
  if (!samePayload(expected.payload, value.payload)) {
    throw new TrustedJobEventError("SOURCE_AUDIT_PROVENANCE_CONFLICT");
  }

  const id = randomUUID();
  const payload = serializePayload(value.payload);
  const inserted = db.prepare(
    `INSERT INTO trusted_job_events
     (id, project_id, organization_id, source_actor_type, source_actor_id,
      event_type, schema_version, producer, source_audit_event_id, dedupe_key, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, source_audit_event_id) DO NOTHING`,
  ).run(
    id,
    projectId,
    source.organization_id,
    source.source_actor_type,
    source.source_actor_id,
    value.eventType,
    TRUSTED_JOB_EVENT_SCHEMA_VERSION,
    TRUSTED_JOB_EVENT_PRODUCER,
    value.sourceAuditEventId,
    value.sourceAuditEventId,
    payload,
    source.created_at,
  );
  if (inserted.changes === 0) {
    const concurrent = db.prepare(
      "SELECT * FROM trusted_job_events WHERE project_id = ? AND source_audit_event_id = ?",
    ).get(projectId, value.sourceAuditEventId);
    if (!concurrent) throw new Error("Trusted job event idempotency lookup failed");
    const event = readEvent(concurrent);
    if (event.event_type !== value.eventType || !samePayload(event.payload, value.payload)) {
      throw new TrustedJobEventError("TRUSTED_JOB_EVENT_DEDUPE_CONFLICT");
    }
    return { event, idempotent: true };
  }
  return {
    event: readEvent(db.prepare("SELECT * FROM trusted_job_events WHERE project_id = ? AND id = ?").get(projectId, id)),
    idempotent: false,
  };
}

/** Public append wrapper for future internal producers; checkpoint is post-commit. */
export function appendTrustedJobEvent(
  projectId: string,
  input: AppendTrustedJobEventInput,
): TrustedJobEventAppendResult {
  const result = execTransaction(() => {
    return appendTrustedJobEventInTransaction(getDb(dbPath()), projectId, input);
  });
  if (!result.idempotent) checkpointAfterWrite();
  return result;
}

export function getTrustedJobEvent(projectId: string, eventId: string): TrustedJobEvent | undefined {
  const row = getDb(dbPath()).prepare(
    "SELECT * FROM trusted_job_events WHERE project_id = ? AND id = ?",
  ).get(projectId, eventId);
  return row ? readEvent(row) : undefined;
}

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 512) {
    throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT_CURSOR");
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || parsed.v !== 1 || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT_CURSOR");
  }
}

/** Bounded project-scoped keyset list retained indefinitely for JOB-101. */
export function listTrustedJobEvents(
  projectId: string,
  options: { limit?: number; cursor?: string } = {},
): TrustedJobEventPage {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TrustedJobEventError("INVALID_TRUSTED_JOB_EVENT");
  }
  const cursor = decodeCursor(options.cursor);
  const db = getDb(dbPath());
  const rows = cursor
    ? db.prepare(
      `SELECT * FROM trusted_job_events
       WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(projectId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db.prepare(
      "SELECT * FROM trusted_job_events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    ).all(projectId, limit + 1);
  const data = rows.slice(0, limit).map(readEvent);
  const tail = data[data.length - 1];
  return {
    data,
    nextCursor: rows.length > limit && tail
      ? Buffer.from(JSON.stringify({ v: 1, createdAt: tail.created_at, id: tail.id }), "utf8").toString("base64url")
      : null,
  };
}
