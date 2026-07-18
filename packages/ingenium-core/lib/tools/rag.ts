/**
 * RAG (Retrieval-Augmented Generation) — manage sources, chunks, and search.
 *
 * Uses the established schema:
 * - rag_sources: id, project_id, title, source_type, source_path, ...
 * - rag_chunks: id (UUID), source_id, chunk_index, content, token_count, heading_path, ...
 * - rag_chunks_fts: FTS5 index
 * - rag_embeddings: chunk_id, embedding, model_id, dimensions
 */

import { randomUUID } from "node:crypto";
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

/**
 * BM25 full-text search across all sources in a project.
 */
export function searchChunks(projectId: string, query: string, limit = 20): RagSearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  return getDb(dbPath()).prepare(
    `SELECT c.rowid AS _rowid, c.id, c.source_id, c.chunk_index, c.content, c.token_count,
            c.heading_path, c.priority, c.tags, c.created_at,
            s.title AS source_name, s.project_id,
            bm25(rag_chunks_fts) AS rank,
            snippet(rag_chunks_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ? AND rag_chunks_fts MATCH ?
     ORDER BY rank, c.priority DESC
     LIMIT ?`,
  ).all(projectId, sanitized, Math.max(1, limit)) as RagSearchResult[];
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
  const source = createSource(projectId, name);
  const db = getDb(dbPath());
  const chunks = chunkText(content);
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
      insert.run(chunkId, source.id, chunk.id, chunk.content, chunk.tokens, chunk.heading ?? null);
      insertEmbedding.run(chunkId, embeddingBuffer(generateEmbedding(chunk.content)));
    }
    db.prepare(
      `UPDATE rag_sources
       SET chunk_count = (SELECT count(*) FROM rag_chunks WHERE source_id = ?),
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(source.id, source.id);
  });
  checkpointAfterWrite();
  const row = db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(source.id) as RagSource;
  return rowToSource(row);
}

/**
 * List all sources for a project.
 */
export function listSources(projectId: string): RagSource[] {
  return getDb(dbPath()).prepare(
    "SELECT * FROM rag_sources WHERE project_id = ? ORDER BY created_at DESC",
  ).all(projectId) as RagSource[];
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
