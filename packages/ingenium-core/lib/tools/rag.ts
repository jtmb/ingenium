/**
 * RAG (Retrieval-Augmented Generation) — manage sources, chunks, and search.
 *
 * Uses the established schema:
 * - rag_sources: id, project_id, title, source_type, source_path, ...
 * - rag_chunks: id (UUID), source_id, chunk_index, content, token_count, heading_path, ...
 * - rag_chunks_fts: FTS5 index
 */

import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import type { RagSource, RagSearchResult } from "../schema.js";
import type { Chunk } from "./rag-chunker.js";
import { chunkText } from "./rag-chunker.js";
import { getGlobalProject } from "./projects.js";

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

export interface RagPage<T> { data: T[]; total: number; limit: number; offset: number; }
export interface IngestSourceOptions { sourceType?: "file" | "text" | "url"; sourcePath?: string; mimeType?: string; metadata?: Record<string, unknown>; priority?: number; tags?: string[]; }

/** Raised when Context history has made a source immutable. */
export class RagSourceImmutableError extends Error {
  constructor() {
    super("RAG source is part of immutable Context history");
    this.name = "RagSourceImmutableError";
  }
}

export interface TransactionalRagIngestResult {
  source: RagSource;
  changed: boolean;
}

function sha256(content: string | Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function now(): string { return new Date().toISOString(); }

/** Stable tags applied to every repository-authoritative Markdown source. */
export const REPOSITORY_DOC_RAG_TAGS = ["repository-managed", "repository-doc"] as const;

/**
 * A repository source uses the immutable page identity rather than its mutable
 * repository path. The current path remains in source metadata and the managed
 * page record, while a rename keeps the same RAG source row and chunks.
 */
export function repositoryDocRagSourcePath(projectId: string, pageId: number): string {
  return `repository-doc:${projectId}:${pageId}`;
}

export interface RepositoryDocRagSourceInput {
  sourceId?: string | null;
  projectId: string;
  pageId: number;
  title: string;
  sourcePath: string;
  content: string;
  sourceHash: string;
  metadata: Record<string, unknown>;
}

export interface RepositoryDocRagSourceResult {
  sourceId: string;
  reindexed: boolean;
  created: boolean;
}

/**
 * Context upload and checkpoint provenance must keep pointing at the exact
 * indexed document. The database trigger is the final authority; this
 * preflight gives API callers a stable error before a write is attempted.
 */
function assertSourceMutable(db: ReturnType<typeof getDb>, sourceId: string): void {
  if (sourceIsImmutable(db, sourceId)) throw new RagSourceImmutableError();
}

function sourceIsImmutable(db: ReturnType<typeof getDb>, sourceId: string): boolean {
  const row = db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM context_rag_uploads WHERE rag_source_id = ?
     ) OR EXISTS(
       SELECT 1 FROM context_checkpoint_rag_sources WHERE rag_source_id = ?
     ) AS immutable`,
  ).get(sourceId, sourceId) as { immutable: number };
  return row.immutable === 1;
}

/** Return whether a source is part of immutable Context history. */
export function isSourceImmutable(sourceId: string): boolean {
  return sourceIsImmutable(getDb(dbPath()), sourceId);
}

/** Atomically replace a source's chunks and lifecycle state. No partially-indexed source is visible. */
export function replaceSourceContent(sourceId: string, content: string, options: Pick<IngestSourceOptions, "priority" | "tags" | "sourceType"> = {}): number {
  const db = getDb(dbPath());
  const chunks = chunkText(content);
  execTransaction(() => {
    assertSourceMutable(db, sourceId);
    replaceSourceContentInTransaction(db, sourceId, content, chunks, options);
  });
  checkpointAfterWrite();
  return chunks.length;
}

function replaceSourceContentInTransaction(db: ReturnType<typeof getDb>, sourceId: string, content: string, chunks: Chunk[], options: Pick<IngestSourceOptions, "priority" | "tags" | "sourceType">): void {
  const priority = options.priority ?? 5;
  const tags = JSON.stringify(options.tags ?? []);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10) throw new Error("priority must be an integer between 0 and 10");
  if (options.sourceType) {
    db.prepare("UPDATE rag_sources SET source_type = ? WHERE id = ?").run(options.sourceType, sourceId);
  }
  db.prepare("INSERT INTO rag_ingestion_state (source_id, status, progress_pct, started_at) VALUES (?, 'in_progress', 0, ?) ON CONFLICT(source_id) DO UPDATE SET status = 'in_progress', progress_pct = 0, error_message = NULL, started_at = excluded.started_at, completed_at = NULL").run(sourceId, now());
  db.prepare("DELETE FROM rag_chunks WHERE source_id = ?").run(sourceId);
  const insert = db.prepare("INSERT INTO rag_chunks (id, source_id, chunk_index, content, token_count, heading_path, priority, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const chunk of chunks) {
    const id = randomUUID();
    insert.run(id, sourceId, chunk.id, chunk.content, chunk.tokens, chunk.heading ?? null, priority, tags);
  }
  db.prepare("UPDATE rag_sources SET chunk_count = ?, source_hash = ?, byte_size = ?, updated_at = ? WHERE id = ?").run(chunks.length, sha256(content), Buffer.byteLength(content), now(), sourceId);
  db.prepare("UPDATE rag_ingestion_state SET status = 'completed', progress_pct = 100, completed_at = ? WHERE source_id = ?").run(now(), sourceId);
}

/**
 * Create or synchronize a repository-managed source as part of a caller-owned
 * transaction. Keeping this operation transactional with the Docs page avoids
 * exposing a page without its canonical source (or vice versa).
 */
export function upsertRepositoryDocSourceInTransaction(
  db: ReturnType<typeof getDb>,
  input: RepositoryDocRagSourceInput,
): RepositoryDocRagSourceResult {
  const sourceId = input.sourceId ?? randomUUID();
  const existing = db.prepare("SELECT id, project_id, source_hash FROM rag_sources WHERE id = ?")
    .get(sourceId) as Pick<RagSource, "id" | "project_id" | "source_hash"> | undefined;

  if (existing && existing.project_id !== input.projectId) {
    throw new Error("Repository source project ownership mismatch");
  }

  const sourcePath = repositoryDocRagSourcePath(input.projectId, input.pageId);
  const metadata = JSON.stringify(input.metadata);
  const created = !existing;
  const reindexed = !existing || existing.source_hash !== input.sourceHash;

  if (existing) {
    db.prepare(
      `UPDATE rag_sources
       SET title = ?, source_type = 'file', source_path = ?, mime_type = 'text/markdown', metadata = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.title, sourcePath, metadata, now(), sourceId);
  } else {
    db.prepare(
      `INSERT INTO rag_sources
       (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'file', ?, NULL, 'text/markdown', 0, ?, ?, ?)`,
    ).run(sourceId, input.projectId, input.title, sourcePath, metadata, now(), now());
  }

  if (reindexed) {
    replaceSourceContentInTransaction(db, sourceId, input.content, chunkText(input.content), {
      tags: [...REPOSITORY_DOC_RAG_TAGS],
    });
  }

  return { sourceId, reindexed, created };
}

/**
 * Idempotently create or replace a source within a caller-owned transaction.
 * This lets context uploads make source metadata, chunks, and
 * their upload state visible atomically.
 */
export function ingestCanonicalSourceInTransaction(
  db: ReturnType<typeof getDb>,
  projectId: string,
  title: string,
  content: string,
  options: IngestSourceOptions = {},
): TransactionalRagIngestResult {
  const sourcePath = options.sourcePath ?? null;
  const hash = sha256(content);
  const existing = sourcePath ? db.prepare("SELECT * FROM rag_sources WHERE project_id = ? AND source_path = ?").get(projectId, sourcePath) as RagSource | undefined : undefined;
  if (existing && existing.source_hash === hash) return { source: existing, changed: false };
  const id = existing?.id ?? randomUUID();
  const chunks = chunkText(content);
  if (existing) {
    assertSourceMutable(db, id);
    db.prepare("UPDATE rag_sources SET title = ?, source_type = ?, mime_type = ?, metadata = ?, updated_at = ? WHERE id = ?").run(title, options.sourceType ?? "text", options.mimeType ?? null, JSON.stringify(options.metadata ?? {}), now(), id);
  } else {
    db.prepare("INSERT INTO rag_sources (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)").run(id, projectId, title, options.sourceType ?? "text", sourcePath, options.mimeType ?? null, JSON.stringify(options.metadata ?? {}), now(), now());
  }
  replaceSourceContentInTransaction(db, id, content, chunks, options);
  return {
    source: db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(id) as RagSource,
    changed: true,
  };
}

/** Idempotently create or replace a canonical source. */
export function ingestCanonicalSource(projectId: string, title: string, content: string, options: IngestSourceOptions = {}): RagSource {
  const db = getDb(dbPath());
  const result = execTransaction(() => ingestCanonicalSourceInTransaction(db, projectId, title, content, options));
  if (result.changed) checkpointAfterWrite();
  return result.source;
}

/**
 * BM25 full-text search across all sources in a project.
 */
export function searchChunks(projectId: string, query: string, limit = 20, includeGlobal = true): RagSearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  const globalProjectId = includeGlobal ? getGlobalProject()?.id ?? null : null;

  return getDb(dbPath()).prepare(
    `SELECT c.rowid AS _rowid, c.id, c.source_id, c.chunk_index, c.content, c.token_count,
            c.heading_path, c.priority, c.tags, c.created_at,
             s.title AS source_name, s.source_path, s.source_type, s.project_id,
            bm25(rag_chunks_fts) AS rank,
            snippet(rag_chunks_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
       WHERE (s.project_id = ? OR (? IS NOT NULL AND s.project_id = ?)) AND rag_chunks_fts MATCH ?
       ORDER BY c.priority DESC, rank ASC, s.updated_at DESC, s.id ASC, c.chunk_index ASC, c.id ASC
      LIMIT ?`,
   ).all(projectId, globalProjectId, globalProjectId, sanitized, Math.max(1, limit)) as RagSearchResult[];
}

/** Search only an explicit, project-owned set of sources. Never includes global data. */
export function searchChunksBySourceIds(
  projectId: string,
  sourceIds: string[],
  query: string,
  limit = 20,
): RagSearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  const uniqueIds = [...new Set(sourceIds)];
  if (!sanitized || uniqueIds.length === 0) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const placeholders = uniqueIds.map(() => "?").join(",");
  return getDb(dbPath()).prepare(
    `SELECT c.rowid AS _rowid, c.id, c.source_id, c.chunk_index, c.content, c.token_count,
            c.heading_path, c.priority, c.tags, c.created_at,
            s.title AS source_name, s.source_path, s.source_type, s.project_id,
            bm25(rag_chunks_fts) AS rank,
            snippet(rag_chunks_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ? AND s.id IN (${placeholders}) AND rag_chunks_fts MATCH ?
      ORDER BY c.priority DESC, rank ASC, s.updated_at DESC, s.id ASC, c.chunk_index ASC, c.id ASC
     LIMIT ?`,
  ).all(projectId, ...uniqueIds, sanitized, safeLimit) as RagSearchResult[];
}

/** Search all context-upload sources owned by one project. Never includes globals. */
export function searchContextUploadChunks(
  projectId: string,
  query: string,
  limit = 20,
): RagSearchResult[] {
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return getDb(dbPath()).prepare(
    `SELECT c.rowid AS _rowid, c.id, c.source_id, c.chunk_index, c.content, c.token_count,
            c.heading_path, c.priority, c.tags, c.created_at,
            s.title AS source_name, s.source_path, s.source_type, s.project_id,
            bm25(rag_chunks_fts) AS rank,
            snippet(rag_chunks_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
     FROM rag_chunks_fts
     INNER JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid
     INNER JOIN rag_sources s ON s.id = c.source_id
     INNER JOIN context_rag_uploads upload
       ON upload.project_id = s.project_id AND upload.rag_source_id = s.id
     WHERE s.project_id = ? AND rag_chunks_fts MATCH ?
      ORDER BY c.priority DESC, rank ASC, s.updated_at DESC, s.id ASC, c.chunk_index ASC, c.id ASC
     LIMIT ?`,
  ).all(projectId, sanitized, safeLimit) as RagSearchResult[];
}

/**
 * Delete a source and cascade-delete all chunks + FTS entries.
 */
export function deleteSource(sourceId: string): void {
  execTransaction(() => {
    const db = getDb(dbPath());
    assertSourceMutable(db, sourceId);
    db.prepare("DELETE FROM rag_sources WHERE id = ?").run(sourceId);
  });
  checkpointAfterWrite();
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
  const managedPaths = new Set((getDb(dbPath()).prepare(
    "SELECT source_path FROM docs_repository_pages WHERE project_id = ?",
  ).all(globalProjectId) as Array<{ source_path: string }>).map((row) => row.source_path));
  for (const file of files.sort()) {
    const real = realpathSync(file);
    if (!real.startsWith(`${docsRoot}${sep}`) && real !== docsRoot) continue;
    const path = `docs/${relative(docsRoot, real).split(sep).join("/")}`;
    active.add(path);
    // Repository-manifest onboarding owns this path and already maintains an
    // immutable page-backed source identity. Do not make a second file source.
    if (managedPaths.has(path)) continue;
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
  const managed = db.prepare(
    "SELECT rag_source_id FROM docs_repository_pages WHERE page_id = ?",
  ).get(page.id) as { rag_source_id: string | null } | undefined;
  if (managed) {
    // Managed repository pages own a canonical source created by the manifest
    // transaction. Bypass the generic docs-page source to prevent duplicates.
    // A manual archive still removes the canonical source and clears its FK.
    if (page.status !== "published" && managed.rag_source_id) deleteSource(managed.rag_source_id);
    return;
  }
  const global = getGlobalProject();
  if (!global) return;
  const sourcePath = `docs-page:${page.id}`;
  if (page.status !== "published") {
    const source = db.prepare("SELECT id FROM rag_sources WHERE project_id = ? AND source_path = ?").get(global.id, sourcePath) as { id: string } | undefined;
    if (source) deleteSource(source.id);
    return;
  }
  ingestCanonicalSource(global.id, page.title, page.content, { sourceType: "text", sourcePath, metadata: { kind: "docs_page", pageId: page.id, slug: page.slug, provenance: "docs-workspace" } });
}
