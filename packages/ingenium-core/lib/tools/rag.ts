/**
 * RAG (Retrieval-Augmented Generation) — manage sources, chunks, and search.
 *
 * Uses the established schema:
 * - rag_sources: id, project_id, title, source_type, source_path, ...
 * - rag_chunks: id (UUID), source_id, chunk_index, content, token_count, heading_path, ...
 * - rag_chunks_fts: FTS5 index
 * - rag_embeddings: chunk_id, embedding, model_id, dimensions
 */

import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import type { RagSource, RagSearchResult } from "../schema.js";
import type { Chunk } from "./rag-chunker.js";
import { chunkText } from "./rag-chunker.js";

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

/**
 * Minimal source view returned by createSource/ingestSource.
 * Maps DB field `title` to the public `name` for backward compat.
 */
export interface Source {
  id: string;
  project_id: string;
  name: string;        // maps from DB title
  chunk_count: number;
  metadata: string;
  created_at: string;
}

export interface RagPage<T> { data: T[]; total: number; limit: number; offset: number; }
export interface IngestSourceOptions { sourceType?: "file" | "text" | "url"; sourcePath?: string; mimeType?: string; metadata?: Record<string, unknown>; priority?: number; tags?: string[]; }

function sha256(content: string | Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function now(): string { return new Date().toISOString(); }

function rowToSource(row: RagSource): Source {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.title,
    chunk_count: row.chunk_count,
    metadata: row.metadata,
    created_at: row.created_at,
  };
}

// ---- Source CRUD ----

/**
 * Create a new RAG source.
 * Returns a Source object with chunk_count = 0.
 */
export function createSource(projectId: string, title: string, metadata = "{}"): Source {
  const id = randomUUID();
  const db = getDb(dbPath());
  execTransaction(() => {
    db.prepare(
      `INSERT INTO rag_sources (id, project_id, title, source_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'text', ?, datetime('now'), datetime('now'))`,
    ).run(id, projectId, title, metadata);
  });
  checkpointAfterWrite();
  const row = db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(id) as RagSource;
  return rowToSource(row);
}

/**
 * Ingest chunks into a source.
 * Returns the number of chunks stored.
 */
export function ingestChunks(sourceId: string, chunks: Chunk[]): number {
  const db = getDb(dbPath());
  execTransaction(() => {
    const insert = db.prepare(
      `INSERT INTO rag_chunks (id, source_id, chunk_index, content, token_count, heading_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertEmbedding = db.prepare(
      `INSERT INTO rag_embeddings (chunk_id, embedding, model_id, dimensions, created_at)
       VALUES (?, ?, 'ingenium-ngram-v1', 384, datetime('now'))
       ON CONFLICT(chunk_id) DO UPDATE SET
         embedding = excluded.embedding,
         model_id = excluded.model_id,
         dimensions = excluded.dimensions,
         created_at = excluded.created_at`,
    );
    for (const chunk of chunks) {
      const chunkId = randomUUID();
      insert.run(chunkId, sourceId, chunk.id, chunk.content, chunk.tokens, chunk.heading ?? null);
      insertEmbedding.run(chunkId, embeddingBuffer(generateEmbedding(chunk.content)));
    }
    db.prepare(
      `UPDATE rag_sources
       SET chunk_count = (SELECT count(*) FROM rag_chunks WHERE source_id = ?),
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(sourceId, sourceId);
  });
  checkpointAfterWrite();
  return chunks.length;
}

/** Atomically replace a source's chunks and lifecycle state. No partially-indexed source is visible. */
export function replaceSourceContent(sourceId: string, content: string, options: Pick<IngestSourceOptions, "priority" | "tags"> = {}): number {
  const db = getDb(dbPath());
  const chunks = chunkText(content);
  execTransaction(() => {
    replaceSourceContentInTransaction(db, sourceId, content, chunks, options);
  });
  checkpointAfterWrite();
  return chunks.length;
}

function replaceSourceContentInTransaction(db: ReturnType<typeof getDb>, sourceId: string, content: string, chunks: Chunk[], options: Pick<IngestSourceOptions, "priority" | "tags">): void {
  const priority = options.priority ?? 5;
  const tags = JSON.stringify(options.tags ?? []);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10) throw new Error("priority must be an integer between 0 and 10");
  db.prepare("INSERT INTO rag_ingestion_state (source_id, status, progress_pct, started_at) VALUES (?, 'in_progress', 0, ?) ON CONFLICT(source_id) DO UPDATE SET status = 'in_progress', progress_pct = 0, error_message = NULL, started_at = excluded.started_at, completed_at = NULL").run(sourceId, now());
  db.prepare("DELETE FROM rag_chunks WHERE source_id = ?").run(sourceId);
  const insert = db.prepare("INSERT INTO rag_chunks (id, source_id, chunk_index, content, token_count, heading_path, priority, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const embedding = db.prepare("INSERT INTO rag_embeddings (chunk_id, embedding, model_id, dimensions, created_at) VALUES (?, ?, 'ingenium-ngram-v1', 384, ?) ON CONFLICT(chunk_id) DO UPDATE SET embedding = excluded.embedding, model_id = excluded.model_id, dimensions = excluded.dimensions, created_at = excluded.created_at");
  for (const chunk of chunks) {
    const id = randomUUID();
    insert.run(id, sourceId, chunk.id, chunk.content, chunk.tokens, chunk.heading ?? null, priority, tags);
    embedding.run(id, embeddingBuffer(generateEmbedding(chunk.content)), now());
  }
  db.prepare("UPDATE rag_sources SET chunk_count = ?, source_hash = ?, byte_size = ?, updated_at = ? WHERE id = ?").run(chunks.length, sha256(content), Buffer.byteLength(content), now(), sourceId);
  db.prepare("UPDATE rag_ingestion_state SET status = 'completed', progress_pct = 100, completed_at = ? WHERE source_id = ?").run(now(), sourceId);
}

/** Idempotently create or replace a canonical source. */
export function ingestCanonicalSource(projectId: string, title: string, content: string, options: IngestSourceOptions = {}): RagSource {
  const db = getDb(dbPath());
  const sourcePath = options.sourcePath ?? null;
  const hash = sha256(content);
  const existing = sourcePath ? db.prepare("SELECT * FROM rag_sources WHERE project_id = ? AND source_path = ?").get(projectId, sourcePath) as RagSource | undefined : undefined;
  if (existing && existing.source_hash === hash) return existing;
  const id = existing?.id ?? randomUUID();
  const chunks = chunkText(content);
  execTransaction(() => {
    if (existing) {
      db.prepare("UPDATE rag_sources SET title = ?, source_type = ?, mime_type = ?, metadata = ?, updated_at = ? WHERE id = ?").run(title, options.sourceType ?? "text", options.mimeType ?? null, JSON.stringify(options.metadata ?? {}), now(), id);
    } else {
      db.prepare("INSERT INTO rag_sources (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)").run(id, projectId, title, options.sourceType ?? "text", sourcePath, options.mimeType ?? null, JSON.stringify(options.metadata ?? {}), now(), now());
    }
    replaceSourceContentInTransaction(db, id, content, chunks, options);
  });
  checkpointAfterWrite();
  return db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(id) as RagSource;
}

/**
 * BM25 full-text search across all sources in a project.
 */
export function searchChunks(projectId: string, query: string, limit = 20, includeGlobal = true): RagSearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  return getDb(dbPath()).prepare(
    `SELECT c.rowid AS _rowid, c.id, c.source_id, c.chunk_index, c.content, c.token_count,
            c.heading_path, c.priority, c.tags, c.created_at,
             s.title AS source_name, s.source_path, s.source_type, s.project_id,
            bm25(rag_chunks_fts) AS rank,
            snippet(rag_chunks_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
      WHERE (s.project_id = ? OR (? = 1 AND s.project_id = (SELECT id FROM projects WHERE is_global = 1 LIMIT 1))) AND rag_chunks_fts MATCH ?
      ORDER BY c.priority DESC, rank, s.updated_at DESC, c.chunk_index ASC
      LIMIT ?`,
  ).all(projectId, includeGlobal ? 1 : 0, sanitized, Math.max(1, limit)) as RagSearchResult[];
}

/**
 * Delete a source and cascade-delete all chunks + FTS entries.
 */
export function deleteSource(sourceId: string): void {
  execTransaction(() => {
    getDb(dbPath()).prepare("DELETE FROM rag_sources WHERE id = ?").run(sourceId);
  });
  checkpointAfterWrite();
}

/**
 * Full pipeline: chunk text, create source, ingest chunks.
 * Returns the updated Source (with chunk_count).
 */
export function ingestSource(projectId: string, name: string, content: string): Source {
  return rowToSource(ingestCanonicalSource(projectId, name, content));
}

/**
 * List all sources for a project.
 */
export function listSources(projectId: string, limit = 50, offset = 0): RagPage<RagSource> {
  const db = getDb(dbPath()); const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100); const safeOffset = Math.max(Math.trunc(offset), 0);
  const total = (db.prepare("SELECT count(*) AS total FROM rag_sources WHERE project_id = ?").get(projectId) as { total: number }).total;
  const data = db.prepare("SELECT * FROM rag_sources WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?").all(projectId, safeLimit, safeOffset) as RagSource[];
  return { data, total, limit: safeLimit, offset: safeOffset };
}

/** Index configured repository Markdown files without following symlinks outside the root. */
export function indexConfiguredDocs(globalProjectId: string, root = process.env.INGENIUM_DOCS_ROOT): { indexed: number; unchanged: number; deleted: number } {
  if (!root) throw new Error("INGENIUM_DOCS_ROOT must be configured");
  const rootReal = realpathSync(root);
  const docsRoot = realpathSync(resolve(rootReal, "docs"));
  if (!docsRoot.startsWith(`${rootReal}${sep}`)) throw new Error("configured docs root escapes repository root");
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = resolve(directory, entry.name);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(candidate);
      else if (stat.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(candidate);
    }
  };
  walk(docsRoot);
  let indexed = 0, unchanged = 0;
  const active = new Set<string>();
  for (const file of files.sort()) {
    const real = realpathSync(file);
    if (!real.startsWith(`${docsRoot}${sep}`) && real !== docsRoot) continue;
    const path = `docs/${relative(docsRoot, real).split(sep).join("/")}`;
    active.add(path);
    const content = readFileSync(real, "utf8");
    const old = getDb(dbPath()).prepare("SELECT source_hash FROM rag_sources WHERE project_id = ? AND source_path = ?").get(globalProjectId, path) as { source_hash: string | null } | undefined;
    if (old?.source_hash === sha256(content)) { unchanged++; continue; }
    ingestCanonicalSource(globalProjectId, basename(file), content, { sourceType: "file", sourcePath: path, metadata: { kind: "file", repositoryPath: path, provenance: "configured-docs-root" } }); indexed++;
  }
  const stale = getDb(dbPath()).prepare("SELECT id, source_path FROM rag_sources WHERE project_id = ? AND source_type = 'file' AND source_path LIKE 'docs/%'").all(globalProjectId) as Array<{ id: string; source_path: string }>;
  let deleted = 0; for (const source of stale) if (!active.has(source.source_path)) { deleteSource(source.id); deleted++; }
  return { indexed, unchanged, deleted };
}

/** Keep a published Docs Workspace page synchronized at its lifecycle boundary. */
export function indexPublishedDoc(page: { id: number; title: string; slug: string; content: string; status: string }): void {
  const db = getDb(dbPath());
  const global = db.prepare("SELECT id FROM projects WHERE is_global = 1 LIMIT 1").get() as { id: string } | undefined;
  if (!global) return;
  const sourcePath = `docs-page:${page.id}`;
  if (page.status !== "published") {
    const source = db.prepare("SELECT id FROM rag_sources WHERE project_id = ? AND source_path = ?").get(global.id, sourcePath) as { id: string } | undefined;
    if (source) deleteSource(source.id);
    return;
  }
  ingestCanonicalSource(global.id, page.title, page.content, { sourceType: "text", sourcePath, metadata: { kind: "docs_page", pageId: page.id, slug: page.slug, provenance: "docs-workspace" } });
}

// ---- Embedding utilities ----

/**
 * Generate a deterministic 384-dimensional embedding vector.
 */
export function generateEmbedding(text: string): number[] {
  const dims = 384;
  const embedding = new Array(dims).fill(0);

  const normalized = `  ${text.toLowerCase().replace(/\s+/g, " ").trim()}  `;
  for (let i = 0; i <= normalized.length - 3; i++) {
    const gram = normalized.slice(i, i + 3);
    let hash = 2166136261;
    for (const char of gram) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    const index = (hash >>> 0) % dims;
    embedding[index]! += (hash & 1) === 0 ? 1 : -1;
  }

  let sumSq = 0;
  for (let i = 0; i < dims; i++) sumSq += embedding[i]! * embedding[i]!;
  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 0) {
    for (let i = 0; i < dims; i++) embedding[i] = embedding[i]! / magnitude;
  }

  return embedding;
}

function embeddingBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Store a chunk's embedding in the rag_embeddings table.
 */
export function updateChunkEmbedding(chunkId: number, embedding: number[], sourceId?: string): void {
  const db = getDb(dbPath());
  const buffer = embeddingBuffer(embedding);
  // Find the UUID by chunk_index (filtered by source_id if provided)
  let chunk: { id: string } | undefined;
  if (sourceId) {
    chunk = db.prepare("SELECT id FROM rag_chunks WHERE chunk_index = ? AND source_id = ?").get(chunkId, sourceId) as { id: string } | undefined;
  } else {
    chunk = db.prepare("SELECT id FROM rag_chunks WHERE chunk_index = ?").get(chunkId) as { id: string } | undefined;
  }
  if (!chunk) return;
  db.prepare(
    `INSERT INTO rag_embeddings (chunk_id, embedding, model_id, dimensions, created_at)
     VALUES (?, ?, 'ingenium-ngram-v1', ?, datetime('now'))
     ON CONFLICT(chunk_id) DO UPDATE SET
       embedding = excluded.embedding,
       model_id = excluded.model_id,
       dimensions = excluded.dimensions,
       created_at = excluded.created_at`,
  ).run(chunk.id, buffer, embedding.length);
}

/**
 * Hybrid search: fuses BM25 FTS scores with vector similarity.
 * Falls back to FTS-only when no embeddings are stored.
 */
export function hybridSearch(projectId: string, query: string): Array<{
  chunk_id: number;
  source_id: string;
  source_name: string;
  content: string;
  heading: string | null;
  fts_score: number;
  vector_score: number;
  combined_score: number;
  rank: number;
}> {
  if (!query.trim()) return [];
  const db = getDb(dbPath());
  const sanitized = sanitizeFts5Query(query);

  // Get FTS results
  const ftsResults = sanitized ? db.prepare(
    `SELECT c.id AS chunk_uuid, c.chunk_index, c.source_id, c.content, c.heading_path,
            s.title AS source_name, s.project_id,
            bm25(rag_chunks_fts) AS rank
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ? AND rag_chunks_fts MATCH ?
     ORDER BY rank
     LIMIT 20`,
  ).all(projectId, sanitized) as Array<{
    chunk_uuid: string;
    chunk_index: number;
    source_id: string;
    content: string;
    heading_path: string | null;
    source_name: string;
    project_id: string;
    rank: number;
  }> : [];

  const queryEmb = generateEmbedding(query);
  let maxRank = 1;
  for (const r of ftsResults) {
    if (Math.abs(r.rank) > maxRank) maxRank = Math.abs(r.rank);
  }

  const candidates = db.prepare(
    `SELECT c.id AS chunk_uuid, c.chunk_index, c.source_id, c.content, c.heading_path,
            s.title AS source_name, e.embedding
     FROM rag_embeddings e
     INNER JOIN rag_chunks c ON c.id = e.chunk_id
     INNER JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ?`,
  ).all(projectId) as Array<{
    chunk_uuid: string;
    chunk_index: number;
    source_id: string;
    content: string;
    heading_path: string | null;
    source_name: string;
    embedding: Buffer;
  }>;

  const ftsById = new Map(ftsResults.map((result) => [result.chunk_uuid, result]));
  const combined = candidates.map((candidate) => {
    const stored = Array.from(new Float32Array(
      candidate.embedding.buffer,
      candidate.embedding.byteOffset,
      candidate.embedding.byteLength / 4,
    ));
    const vectorScore = Math.max(0, cosineSimilarity(queryEmb, stored));
    const fts = ftsById.get(candidate.chunk_uuid);
    const ftsScore = fts && maxRank > 0
      ? Math.max(0, 1 - (Math.abs(fts.rank) / (maxRank * 1.01)))
      : 0;
    return {
      chunk_id: candidate.chunk_index,
      source_id: candidate.source_id,
      source_name: candidate.source_name,
      content: candidate.content,
      heading: candidate.heading_path,
      fts_score: ftsScore,
      vector_score: vectorScore,
      combined_score: 0.7 * ftsScore + 0.3 * vectorScore,
      rank: 0,
    };
  }).filter((result) => result.fts_score > 0 || result.vector_score >= 0.08);

  const embeddedIds = new Set(candidates.map((candidate) => candidate.chunk_uuid));
  for (const result of ftsResults) {
    if (embeddedIds.has(result.chunk_uuid)) continue;
    const ftsScore = maxRank > 0
      ? Math.max(0, 1 - (Math.abs(result.rank) / (maxRank * 1.01)))
      : 1;
    combined.push({
      chunk_id: result.chunk_index,
      source_id: result.source_id,
      source_name: result.source_name,
      content: result.content,
      heading: result.heading_path,
      fts_score: ftsScore,
      vector_score: 0,
      combined_score: 0.7 * ftsScore,
      rank: 0,
    });
  }

  combined.sort((a, b) => b.combined_score - a.combined_score);
  combined.forEach((r, i) => { r.rank = i + 1; });
  return combined;
}
