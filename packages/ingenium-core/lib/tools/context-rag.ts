import { createHash, randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import {
  CONTEXT_METADATA_MAX_BYTES,
  CONTEXT_TAGS_MAX_BYTES,
  isBoundedContextMetadata,
  type ContextMetadata,
  type RagSearchResult,
  type RagSource,
} from "../schema.js";
import {
  ingestCanonicalSourceInTransaction,
  searchChunksBySourceIds,
  searchContextUploadChunks,
} from "./rag.js";

export const CONTEXT_RAG_DIRECT_UPLOAD_MAX_BYTES = 1_048_576;
export const CONTEXT_RAG_CHUNK_UPLOAD_MAX_BYTES = 2_097_152;
export const CONTEXT_RAG_CHUNK_MAX_BYTES = 65_536;
export const CONTEXT_RAG_CHUNK_MAX_COUNT = 32;
export const CONTEXT_RAG_ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "application/json",
  "application/x-ndjson",
] as const;

export type ContextRagProvenance =
  | "direct_upload"
  | "chunked_upload"
  | "opencode_session"
  | "learning_snapshot";

export type ContextRagErrorCode =
  | "INVALID_CONTEXT_RAG_INPUT"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_NOT_PENDING"
  | "UPLOAD_CHUNK_CONFLICT"
  | "UPLOAD_INCOMPLETE"
  | "UPLOAD_HASH_MISMATCH"
  | "UPLOAD_SIZE_MISMATCH"
  | "IDEMPOTENCY_KEY_REUSED"
  | "CHECKPOINT_RAG_SOURCE_NOT_FOUND"
  | "LEARNING_NO_INPUT";

/** Stable errors that intentionally never interpolate uploaded content. */
export class ContextRagError extends Error {
  constructor(public readonly code: ContextRagErrorCode) {
    super(code);
    this.name = "ContextRagError";
  }
}

export interface ContextRagDocumentInput {
  title: string;
  content: string;
  mimeType?: string;
  priority?: number;
  tags?: string[];
  metadata?: ContextMetadata;
  sourceReference?: string;
}

export interface CreateContextRagUploadSessionInput {
  title: string;
  expectedHash: string;
  expectedBytes: number;
  chunkCount: number;
  mimeType?: string;
  priority?: number;
  tags?: string[];
  metadata?: ContextMetadata;
  idempotencyKey?: string;
}

export interface ContextRagUpload {
  id: string;
  project_id: string;
  rag_source_id: string;
  content_hash: string;
  provenance: ContextRagProvenance;
  source_reference: string | null;
  created_at: string;
}

export interface ContextRagUploadResult {
  upload: ContextRagUpload;
  source: RagSource;
  deduplicated: boolean;
}

export interface ContextRagUploadSession {
  id: string;
  project_id: string;
  title: string;
  expected_hash: string;
  expected_bytes: number;
  chunk_count: number;
  mime_type: string;
  priority: number;
  tags: string;
  metadata: string;
  status: "pending" | "completed" | "deduplicated";
  rag_source_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ContextRagUploadSessionResult {
  session: ContextRagUploadSession | null;
  upload: ContextRagUpload | null;
  source: RagSource | null;
  deduplicated: boolean;
}

export interface ContextRagCitation {
  sourceId: string;
  title: string;
  sourceHash: string | null;
  sourcePath: string | null;
  sourceType: string;
  mimeType: string | null;
  provenance: string;
  sourceReference: string | null;
  chunkIndex: number;
  heading: string | null;
  snippet: string;
  score: number;
  createdAt: string;
}

export interface CurrentLearningContext {
  observations: Array<{
    id: number;
    observation_type: string;
    content: string;
    importance: number;
    source: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  traits: Array<{
    id: number;
    trait_type: string;
    trait_value: string;
    display_label: string | null;
    confidence: number;
    source: string;
    created_at: string;
    updated_at: string;
  }>;
  latestInputAt: string | null;
  latestTraitAt: string | null;
}

type Db = ReturnType<typeof getDb>;

interface NormalizedDocument {
  title: string;
  content: string;
  contentHash: string;
  byteSize: number;
  mimeType: (typeof CONTEXT_RAG_ALLOWED_MIME_TYPES)[number];
  priority: number;
  tags: string[];
  metadata: ContextMetadata;
  sourceReference: string | null;
}

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
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

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64 || value.some((tag) => typeof tag !== "string")) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const tags = [...new Set(value.map((tag) => tag.trim()))].sort();
  if (tags.some((tag) => tag.length === 0 || tag.length > 64)
    || Buffer.byteLength(JSON.stringify(tags), "utf8") > CONTEXT_TAGS_MAX_BYTES) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return tags;
}

function normalizeMetadata(value: unknown): ContextMetadata {
  const metadata = value === undefined ? {} : value;
  if (!isBoundedContextMetadata(metadata)
    || Buffer.byteLength(JSON.stringify(metadata), "utf8") > CONTEXT_METADATA_MAX_BYTES) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return metadata;
}

function normalizeMimeType(value: unknown): (typeof CONTEXT_RAG_ALLOWED_MIME_TYPES)[number] {
  const mimeType = value === undefined ? "text/plain" : value;
  if (typeof mimeType !== "string" || !CONTEXT_RAG_ALLOWED_MIME_TYPES.includes(mimeType as never)) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return mimeType as (typeof CONTEXT_RAG_ALLOWED_MIME_TYPES)[number];
}

function normalizePriority(value: unknown): number {
  const priority = value === undefined ? 5 : value;
  if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 10) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return priority as number;
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string") throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  const title = value.trim();
  if (title.length === 0 || title.length > 256) throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  return title;
}

function normalizeSourceReference(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return value;
}

function normalizeDocument(input: unknown, maxBytes: number): NormalizedDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const byteSize = Buffer.byteLength(value.content, "utf8");
  if (byteSize > maxBytes) throw new ContextRagError("UPLOAD_SIZE_MISMATCH");
  return {
    title: normalizeTitle(value.title),
    content: value.content,
    contentHash: sha256(value.content),
    byteSize,
    mimeType: normalizeMimeType(value.mimeType),
    priority: normalizePriority(value.priority),
    tags: normalizeTags(value.tags),
    metadata: normalizeMetadata(value.metadata),
    sourceReference: normalizeSourceReference(value.sourceReference),
  };
}

function parseUpload(row: unknown): ContextRagUpload {
  const value = row as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.project_id !== "string"
    || typeof value.rag_source_id !== "string" || typeof value.content_hash !== "string"
    || typeof value.provenance !== "string" || typeof value.created_at !== "string") {
    throw new Error("Invalid persisted context RAG upload");
  }
  if (![
    "direct_upload", "chunked_upload", "opencode_session", "learning_snapshot",
  ].includes(value.provenance)) throw new Error("Invalid persisted context RAG upload provenance");
  return {
    id: value.id,
    project_id: value.project_id,
    rag_source_id: value.rag_source_id,
    content_hash: value.content_hash,
    provenance: value.provenance as ContextRagProvenance,
    source_reference: value.source_reference === null ? null : String(value.source_reference),
    created_at: value.created_at,
  };
}

function parseSession(row: unknown): ContextRagUploadSession {
  const value = row as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.project_id !== "string"
    || typeof value.title !== "string" || typeof value.expected_hash !== "string"
    || typeof value.expected_bytes !== "number" || typeof value.chunk_count !== "number"
    || typeof value.mime_type !== "string" || typeof value.priority !== "number"
    || typeof value.tags !== "string" || typeof value.metadata !== "string"
    || typeof value.status !== "string" || typeof value.created_at !== "string") {
    throw new Error("Invalid persisted context RAG upload session");
  }
  if (!["pending", "completed", "deduplicated"].includes(value.status)) {
    throw new Error("Invalid persisted context RAG upload session status");
  }
  return {
    id: value.id,
    project_id: value.project_id,
    title: value.title,
    expected_hash: value.expected_hash,
    expected_bytes: value.expected_bytes,
    chunk_count: value.chunk_count,
    mime_type: value.mime_type,
    priority: value.priority,
    tags: value.tags,
    metadata: value.metadata,
    status: value.status as ContextRagUploadSession["status"],
    rag_source_id: value.rag_source_id === null ? null : String(value.rag_source_id),
    created_at: value.created_at,
    completed_at: value.completed_at === null ? null : String(value.completed_at),
  };
}

function parseJsonObject(value: string): ContextMetadata {
  try {
    const parsed = JSON.parse(value);
    if (isBoundedContextMetadata(parsed)) return parsed;
  } catch {
    // The persisted row is validated below without surfacing its data.
  }
  throw new Error("Invalid persisted context RAG metadata");
}

function getUploadByHash(db: Db, projectId: string, contentHash: string): ContextRagUpload | undefined {
  const row = db.prepare(
    `SELECT * FROM context_rag_uploads
     WHERE project_id = ? AND content_hash = ?`,
  ).get(projectId, contentHash);
  return row ? parseUpload(row) : undefined;
}

function getUploadById(db: Db, projectId: string, uploadId: string): ContextRagUpload | undefined {
  const row = db.prepare(
    `SELECT * FROM context_rag_uploads
     WHERE project_id = ? AND id = ?`,
  ).get(projectId, uploadId);
  return row ? parseUpload(row) : undefined;
}

function requireSource(db: Db, projectId: string, sourceId: string): RagSource {
  const row = db.prepare(
    "SELECT * FROM rag_sources WHERE project_id = ? AND id = ?",
  ).get(projectId, sourceId) as RagSource | undefined;
  if (!row) throw new ContextRagError("CHECKPOINT_RAG_SOURCE_NOT_FOUND");
  return row;
}

function insertUploadAndSourceInTransaction(
  db: Db,
  projectId: string,
  document: NormalizedDocument,
  provenance: ContextRagProvenance,
  uploadId: string,
  createdAt: string,
): ContextRagUploadResult {
  const existing = getUploadByHash(db, projectId, document.contentHash);
  if (existing) {
    return {
      upload: existing,
      source: requireSource(db, projectId, existing.rag_source_id),
      deduplicated: true,
    };
  }
  const sourceMetadata: ContextMetadata = {
    kind: "context_upload",
    provenance,
    uploadId,
    contentHash: document.contentHash,
    ...(document.sourceReference === null ? {} : { sourceReference: document.sourceReference }),
    contextMetadata: document.metadata,
  };
  const sourceResult = ingestCanonicalSourceInTransaction(
    db,
    projectId,
    document.title,
    document.content,
    {
      sourceType: "text",
      sourcePath: `context-upload:${uploadId}`,
      mimeType: document.mimeType,
      priority: document.priority,
      tags: document.tags,
      metadata: sourceMetadata,
    },
  );
  if (!sourceResult.changed) throw new Error("Unexpected context RAG source deduplication state");
  db.prepare(
    `INSERT INTO context_rag_uploads
     (id, project_id, rag_source_id, content_hash, provenance, source_reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uploadId,
    projectId,
    sourceResult.source.id,
    document.contentHash,
    provenance,
    document.sourceReference,
    createdAt,
  );
  return {
    upload: getUploadById(db, projectId, uploadId)!,
    source: sourceResult.source,
    deduplicated: false,
  };
}

/** Ingest one bounded direct document and create a durable project-owned RAG source. */
export function ingestContextRagDocument(
  projectId: string,
  input: ContextRagDocumentInput,
  provenance: ContextRagProvenance = "direct_upload",
): ContextRagUploadResult {
  const document = normalizeDocument(input, CONTEXT_RAG_DIRECT_UPLOAD_MAX_BYTES);
  const result = execTransaction(() => insertUploadAndSourceInTransaction(
    getDb(dbPath()), projectId, document, provenance, randomUUID(), now(),
  ));
  if (!result.deduplicated) checkpointAfterWrite();
  return result;
}

function normalizeSessionInput(input: unknown): {
  title: string;
  expectedHash: string;
  expectedBytes: number;
  chunkCount: number;
  mimeType: (typeof CONTEXT_RAG_ALLOWED_MIME_TYPES)[number];
  priority: number;
  tags: string[];
  metadata: ContextMetadata;
  idempotencyKey: string | null;
  requestHash: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedHash)
    || !Number.isInteger(value.expectedBytes) || (value.expectedBytes as number) < 1
    || (value.expectedBytes as number) > CONTEXT_RAG_CHUNK_UPLOAD_MAX_BYTES
    || !Number.isInteger(value.chunkCount) || (value.chunkCount as number) < 1
    || (value.chunkCount as number) > CONTEXT_RAG_CHUNK_MAX_COUNT) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const idempotencyKey = value.idempotencyKey === undefined ? null : value.idempotencyKey;
  if (idempotencyKey !== null && (typeof idempotencyKey !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey))) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const normalized = {
    title: normalizeTitle(value.title),
    expectedHash: value.expectedHash,
    expectedBytes: value.expectedBytes as number,
    chunkCount: value.chunkCount as number,
    mimeType: normalizeMimeType(value.mimeType),
    priority: normalizePriority(value.priority),
    tags: normalizeTags(value.tags),
    metadata: normalizeMetadata(value.metadata),
    idempotencyKey,
  };
  return {
    ...normalized,
    requestHash: requestHash({
      title: normalized.title,
      expectedHash: normalized.expectedHash,
      expectedBytes: normalized.expectedBytes,
      chunkCount: normalized.chunkCount,
      mimeType: normalized.mimeType,
      priority: normalized.priority,
      tags: normalized.tags,
      metadata: normalized.metadata,
    }),
  };
}

/** Open a bounded chunked upload or return its same-request idempotent state. */
export function createContextRagUploadSession(
  projectId: string,
  input: unknown,
): ContextRagUploadSessionResult {
  const value = normalizeSessionInput(input);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    if (value.idempotencyKey) {
      const matching = db.prepare(
        `SELECT * FROM context_rag_upload_sessions
         WHERE project_id = ? AND idempotency_key = ?`,
      ).get(projectId, value.idempotencyKey);
      if (matching) {
        const session = parseSession(matching);
        const raw = matching as { request_hash: string };
        if (raw.request_hash !== value.requestHash) throw new ContextRagError("IDEMPOTENCY_KEY_REUSED");
        if (session.rag_source_id) {
          const upload = getUploadByHash(db, projectId, session.expected_hash);
          return {
            session,
            upload: upload ?? null,
            source: upload ? requireSource(db, projectId, upload.rag_source_id) : null,
            deduplicated: session.status === "deduplicated",
            written: false,
          };
        }
        return { session, upload: null, source: null, deduplicated: false, written: false };
      }
    }
    const duplicate = getUploadByHash(db, projectId, value.expectedHash);
    if (duplicate) {
      return {
        session: null,
        upload: duplicate,
        source: requireSource(db, projectId, duplicate.rag_source_id),
        deduplicated: true,
        written: false,
      };
    }
    const id = randomUUID();
    const createdAt = now();
    db.prepare(
      `INSERT INTO context_rag_upload_sessions
       (id, project_id, title, expected_hash, expected_bytes, chunk_count, mime_type,
        priority, tags, metadata, request_hash, idempotency_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id, projectId, value.title, value.expectedHash, value.expectedBytes, value.chunkCount,
      value.mimeType, value.priority, JSON.stringify(value.tags), JSON.stringify(value.metadata),
      value.requestHash, value.idempotencyKey, createdAt,
    );
    return {
      session: parseSession(db.prepare(
        "SELECT * FROM context_rag_upload_sessions WHERE project_id = ? AND id = ?",
      ).get(projectId, id)),
      upload: null,
      source: null,
      deduplicated: false,
      written: true,
    };
  });
  if (result.written) checkpointAfterWrite();
  return result;
}

/** Add exactly one immutable chunk; identical retries are safe and idempotent. */
export function appendContextRagUploadChunk(
  projectId: string,
  uploadId: string,
  input: { ordinal: number; content: string },
): { session: ContextRagUploadSession; idempotent: boolean } {
  if (!input || !Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal >= CONTEXT_RAG_CHUNK_MAX_COUNT
    || typeof input.content !== "string" || input.content.length === 0) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const byteSize = Buffer.byteLength(input.content, "utf8");
  if (byteSize > CONTEXT_RAG_CHUNK_MAX_BYTES) throw new ContextRagError("UPLOAD_SIZE_MISMATCH");
  const contentHash = sha256(input.content);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const row = db.prepare(
      "SELECT * FROM context_rag_upload_sessions WHERE project_id = ? AND id = ?",
    ).get(projectId, uploadId);
    if (!row) throw new ContextRagError("UPLOAD_NOT_FOUND");
    const session = parseSession(row);
    if (session.status !== "pending") throw new ContextRagError("UPLOAD_NOT_PENDING");
    if (input.ordinal >= session.chunk_count) throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
    const existing = db.prepare(
      `SELECT content_hash, byte_size FROM context_rag_upload_chunks
       WHERE project_id = ? AND upload_id = ? AND ordinal = ?`,
    ).get(projectId, uploadId, input.ordinal) as { content_hash: string; byte_size: number } | undefined;
    if (existing) {
      if (existing.content_hash !== contentHash || existing.byte_size !== byteSize) {
        throw new ContextRagError("UPLOAD_CHUNK_CONFLICT");
      }
      return { session, idempotent: true, written: false };
    }
    const total = db.prepare(
      `SELECT COALESCE(SUM(byte_size), 0) AS total FROM context_rag_upload_chunks
       WHERE project_id = ? AND upload_id = ?`,
    ).get(projectId, uploadId) as { total: number };
    if (total.total + byteSize > session.expected_bytes) throw new ContextRagError("UPLOAD_SIZE_MISMATCH");
    db.prepare(
      `INSERT INTO context_rag_upload_chunks
       (project_id, upload_id, ordinal, content, content_hash, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(projectId, uploadId, input.ordinal, input.content, contentHash, byteSize, now());
    return { session, idempotent: false, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return { session: result.session, idempotent: result.idempotent };
}

/** Finalize a chunked upload: source, chunks, embeddings, and state commit together. */
export function completeContextRagUpload(
  projectId: string,
  uploadId: string,
): ContextRagUploadResult {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const row = db.prepare(
      "SELECT * FROM context_rag_upload_sessions WHERE project_id = ? AND id = ?",
    ).get(projectId, uploadId);
    if (!row) throw new ContextRagError("UPLOAD_NOT_FOUND");
    const session = parseSession(row);
    if (session.status !== "pending") {
      if (!session.rag_source_id) throw new ContextRagError("UPLOAD_NOT_PENDING");
      const upload = getUploadByHash(db, projectId, session.expected_hash);
      if (!upload) throw new ContextRagError("UPLOAD_NOT_PENDING");
      return { upload, source: requireSource(db, projectId, upload.rag_source_id), deduplicated: session.status === "deduplicated", written: false };
    }
    const chunks = db.prepare(
      `SELECT ordinal, content, byte_size FROM context_rag_upload_chunks
       WHERE project_id = ? AND upload_id = ? ORDER BY ordinal ASC`,
    ).all(projectId, uploadId) as Array<{ ordinal: number; content: string; byte_size: number }>;
    if (chunks.length !== session.chunk_count || chunks.some((chunk, index) => chunk.ordinal !== index)) {
      throw new ContextRagError("UPLOAD_INCOMPLETE");
    }
    const content = chunks.map((chunk) => chunk.content).join("");
    if (Buffer.byteLength(content, "utf8") !== session.expected_bytes) {
      throw new ContextRagError("UPLOAD_SIZE_MISMATCH");
    }
    if (sha256(content) !== session.expected_hash) throw new ContextRagError("UPLOAD_HASH_MISMATCH");
    const duplicate = getUploadByHash(db, projectId, session.expected_hash);
    const completedAt = now();
    if (duplicate) {
      db.prepare(
        `UPDATE context_rag_upload_sessions
         SET status = 'deduplicated', rag_source_id = ?, completed_at = ?
         WHERE project_id = ? AND id = ?`,
      ).run(duplicate.rag_source_id, completedAt, projectId, uploadId);
      db.prepare(
        "DELETE FROM context_rag_upload_chunks WHERE project_id = ? AND upload_id = ?",
      ).run(projectId, uploadId);
      return {
        upload: duplicate,
        source: requireSource(db, projectId, duplicate.rag_source_id),
        deduplicated: true,
        written: true,
      };
    }
    const document: NormalizedDocument = {
      title: session.title,
      content,
      contentHash: session.expected_hash,
      byteSize: session.expected_bytes,
      mimeType: normalizeMimeType(session.mime_type),
      priority: session.priority,
      tags: normalizeTags(JSON.parse(session.tags)),
      metadata: parseJsonObject(session.metadata),
      sourceReference: null,
    };
    const created = insertUploadAndSourceInTransaction(
      db, projectId, document, "chunked_upload", uploadId, completedAt,
    );
    db.prepare(
      `UPDATE context_rag_upload_sessions
       SET status = 'completed', rag_source_id = ?, completed_at = ?
       WHERE project_id = ? AND id = ?`,
    ).run(created.source.id, completedAt, projectId, uploadId);
    db.prepare(
      "DELETE FROM context_rag_upload_chunks WHERE project_id = ? AND upload_id = ?",
    ).run(projectId, uploadId);
    return { ...created, written: true };
  });
  if (result.written) checkpointAfterWrite();
  return { upload: result.upload, source: result.source, deduplicated: result.deduplicated };
}

/** Browse durable, project-owned context RAG sources without returning document bodies. */
export function listContextRagUploads(
  projectId: string,
  limit = 20,
  offset = 0,
): { data: ContextRagUploadResult[]; total: number; limit: number; offset: number } {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  const db = getDb(dbPath());
  const total = (db.prepare(
    "SELECT count(*) AS total FROM context_rag_uploads WHERE project_id = ?",
  ).get(projectId) as { total: number }).total;
  const uploads = db.prepare(
    `SELECT * FROM context_rag_uploads WHERE project_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(projectId, safeLimit, safeOffset).map(parseUpload);
  return {
    data: uploads.map((upload) => ({
      upload,
      source: requireSource(db, projectId, upload.rag_source_id),
      deduplicated: false,
    })),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

function sourceMetadata(db: Db, projectId: string, sourceId: string): {
  source_hash: string | null;
  mime_type: string | null;
  provenance: string;
  source_reference: string | null;
} {
  const row = db.prepare(
    `SELECT source.source_hash, source.mime_type, upload.provenance, upload.source_reference
     FROM rag_sources source
     LEFT JOIN context_rag_uploads upload
       ON upload.project_id = source.project_id AND upload.rag_source_id = source.id
     WHERE source.project_id = ? AND source.id = ?`,
  ).get(projectId, sourceId) as {
    source_hash: string | null;
    mime_type: string | null;
    provenance: string | null;
    source_reference: string | null;
  } | undefined;
  if (!row) throw new ContextRagError("CHECKPOINT_RAG_SOURCE_NOT_FOUND");
  return {
    source_hash: row.source_hash,
    mime_type: row.mime_type,
    provenance: row.provenance ?? "rag_source",
    source_reference: row.source_reference,
  };
}

function citationsFromResults(
  projectId: string,
  results: RagSearchResult[],
  checkpointId?: string,
): ContextRagCitation[] {
  const db = getDb(dbPath());
  return results.map((result) => {
    const snapshot = checkpointId === undefined ? undefined : db.prepare(
      `SELECT source_hash, title, source_path, source_type, mime_type, byte_size,
              provenance, source_reference, created_at
       FROM context_checkpoint_rag_source_snapshots
       WHERE project_id = ? AND checkpoint_id = ? AND rag_source_id = ?`,
    ).get(projectId, checkpointId, result.source_id) as {
      source_hash: string | null;
      title: string;
      source_path: string | null;
      source_type: string;
      mime_type: string | null;
      provenance: string;
      source_reference: string | null;
      created_at: string;
    } | undefined;
    const metadata = snapshot ?? sourceMetadata(db, projectId, result.source_id);
    return {
      sourceId: result.source_id,
      title: snapshot?.title ?? result.source_name,
      sourceHash: metadata.source_hash,
      sourcePath: snapshot?.source_path ?? result.source_path,
      sourceType: snapshot?.source_type ?? result.source_type,
      mimeType: metadata.mime_type,
      provenance: metadata.provenance,
      sourceReference: metadata.source_reference,
      chunkIndex: result.chunk_index,
      heading: result.heading_path,
      snippet: result.snippet,
      score: -result.rank,
      createdAt: snapshot?.created_at ?? result.created_at,
    };
  });
}

/**
 * Preserve literal FTS safety for the full query, then fall back to bounded
 * individual terms when a natural-language question is not itself a document
 * phrase. This makes `/ask` useful without widening the corpus or accepting
 * FTS operators from callers.
 */
function boundedRelevanceSearch(
  query: string,
  limit: number,
  search: (candidate: string, candidateLimit: number) => RagSearchResult[],
): RagSearchResult[] {
  const initial = search(query, limit);
  if (initial.length > 0) return initial;
  const terms = [...new Set((query.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])
    .map((term) => term.toLowerCase())
    .filter((term) => !new Set(["what", "when", "where", "which", "does", "that", "this", "with", "from", "have", "need", "about", "please", "would", "could"]).has(term)))]
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
  const results: RagSearchResult[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    for (const result of search(term, limit)) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      results.push(result);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function normalizeSearchLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  return limit;
}

/** Search only the current project's context-upload corpus; global RAG is never consulted. */
export function searchContextRag(
  projectId: string,
  query: string,
  limit = 20,
): { results: RagSearchResult[]; citations: ContextRagCitation[] } {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 512) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const safeLimit = normalizeSearchLimit(limit);
  const results = boundedRelevanceSearch(
    query,
    safeLimit,
    (candidate, candidateLimit) => searchContextUploadChunks(projectId, candidate, candidateLimit),
  );
  return { results, citations: citationsFromResults(projectId, results) };
}

/** Search the immutable source set cited by one checkpoint. */
export function searchContextCheckpointRag(
  projectId: string,
  checkpointId: string,
  query: string,
  limit = 20,
): { results: RagSearchResult[]; citations: ContextRagCitation[] } {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 512) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const safeLimit = normalizeSearchLimit(limit);
  const db = getDb(dbPath());
  const sourceIds = db.prepare(
    `SELECT rag_source_id FROM context_checkpoint_rag_sources
     WHERE project_id = ? AND checkpoint_id = ? ORDER BY ordinal ASC`,
  ).all(projectId, checkpointId).map((row) => (row as { rag_source_id: string }).rag_source_id);
  const results = boundedRelevanceSearch(
    query,
    safeLimit,
    (candidate, candidateLimit) => searchChunksBySourceIds(projectId, sourceIds, candidate, candidateLimit),
  );
  return { results, citations: citationsFromResults(projectId, results, checkpointId) };
}

/** Retrieve bounded current observations and traits with source timestamps. */
export function getCurrentLearningContext(projectId: string, limit = 20): CurrentLearningContext {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const db = getDb(dbPath());
  const observations = db.prepare(
    `SELECT id, observation_type, content, importance, source, status, created_at, updated_at
     FROM observations WHERE project_id = ?
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).all(projectId, safeLimit) as CurrentLearningContext["observations"];
  const traits = db.prepare(
    `SELECT id, trait_type, trait_value, display_label, confidence, source, created_at, updated_at
     FROM personality_traits WHERE project_id = ? AND is_active = 1
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).all(projectId, safeLimit) as CurrentLearningContext["traits"];
  const latestInput = db.prepare(
    "SELECT MAX(updated_at) AS latest FROM observations WHERE project_id = ?",
  ).get(projectId) as { latest: string | null };
  const latestTrait = db.prepare(
    "SELECT MAX(updated_at) AS latest FROM personality_traits WHERE project_id = ?",
  ).get(projectId) as { latest: string | null };
  return {
    observations,
    traits,
    latestInputAt: latestInput.latest,
    latestTraitAt: latestTrait.latest,
  };
}

/**
 * Explicitly snapshot current learning into RAG. Nothing is auto-exported: raw
 * observations become retrievable only after this project-scoped operation.
 */
export function ingestCurrentLearningContext(
  projectId: string,
  input: { observationIds?: number[]; title?: string } = {},
): { noOp: boolean; reason?: "NO_CURRENT_LEARNING"; learning: CurrentLearningContext; result?: ContextRagUploadResult } {
  if (input.observationIds !== undefined && (!Array.isArray(input.observationIds)
    || input.observationIds.length === 0 || input.observationIds.length > 50
    || input.observationIds.some((id) => !Number.isSafeInteger(id) || id < 1))) {
    throw new ContextRagError("INVALID_CONTEXT_RAG_INPUT");
  }
  const db = getDb(dbPath());
  const ids = input.observationIds === undefined ? undefined : [...new Set(input.observationIds)];
  const observations = ids === undefined
    ? db.prepare(
      `SELECT id, observation_type, content, importance, source, status, created_at, updated_at
       FROM observations WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT 50`,
    ).all(projectId) as CurrentLearningContext["observations"]
    : db.prepare(
      `SELECT id, observation_type, content, importance, source, status, created_at, updated_at
       FROM observations WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})
       ORDER BY updated_at DESC, id DESC`,
    ).all(projectId, ...ids) as CurrentLearningContext["observations"];
  const learning = getCurrentLearningContext(projectId, 50);
  if (observations.length === 0 && learning.traits.length === 0) {
    return { noOp: true, reason: "NO_CURRENT_LEARNING", learning };
  }
  const content = [
    "# Current learning snapshot",
    ...observations.map((observation) => [
      `## Observation ${observation.id} (${observation.observation_type})`,
      `- Source: ${observation.source}`,
      `- Updated: ${observation.updated_at}`,
      "",
      observation.content,
    ].join("\n")),
    ...learning.traits.map((trait) => [
      `## Trait ${trait.id} (${trait.trait_type})`,
      `- Confidence: ${trait.confidence}`,
      `- Updated: ${trait.updated_at}`,
      "",
      trait.trait_value,
    ].join("\n")),
  ].join("\n\n");
  const result = ingestContextRagDocument(projectId, {
    title: input.title ?? "Current learning snapshot",
    content,
    mimeType: "text/markdown",
    metadata: {
      observationIds: observations.map((observation) => observation.id),
      traitIds: learning.traits.map((trait) => trait.id),
      latestInputAt: learning.latestInputAt,
      latestTraitAt: learning.latestTraitAt,
    },
    sourceReference: `learning:${learning.latestInputAt ?? "none"}`,
  }, "learning_snapshot");
  return { noOp: false, learning, result };
}
