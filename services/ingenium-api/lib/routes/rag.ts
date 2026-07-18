/**
 * RAG (Retrieval-Augmented Generation) API routes — /api/v1/rag
 *
 * Endpoints:
 *   POST   /sources              — Create ingestion source
 *   GET    /sources              — List sources
 *   GET    /sources/:id          — Get source detail with chunk_count
 *   DELETE /sources/:id          — Delete source + cascade chunks
 *   POST   /sources/:id/ingest   — Ingest/re-ingest content
 *   GET    /search               — Hybrid full-text search
 *   POST   /ask                  — Natural-language Q&A (context → brokerExecute)
 *   GET    /stats                — RAG statistics
 *   POST   /export               — Export all RAG sources as JSON
 */

import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getDb, execTransaction, checkpointAfterWrite, logger, rag } from "ingenium-core";
import { executeSynthesisBroker } from "../opencode-client.js";
import { requireProject } from "../helpers.js";

export const ragRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

const SOURCE = "rag-routes";

/** Resolve format string to a valid source_type column value. */
function normalizeSourceType(format?: string): "text" | "file" | "url" {
  if (!format) return "text";
  const f = format.toLowerCase();
  if (f === "file") return "file";
  if (f === "url") return "url";
  return "text";
}

/**
 * Re-ingest: deletes all existing chunks for a source, re-chunks the content,
 * and re-inserts. Returns the new chunk count.
 */
function reingestSource(sourceId: string, content: string): number {
  return rag.replaceSourceContent(sourceId, content);
}

ragRouter.post("/ingest", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const global = getDb(dbPath()).prepare("SELECT id FROM projects WHERE is_global = 1 LIMIT 1").get() as { id: string } | undefined;
    if (!global) { res.status(409).json({ error: { code: "GLOBAL_PROJECT_MISSING", message: "A global-default project is required for repository documentation indexing" } }); return; }
    res.json({ data: rag.indexConfiguredDocs(global.id) });
  }
  catch (error) { res.status(422).json({ error: { code: "INDEX_CONFIGURATION_ERROR", message: error instanceof Error ? error.message : "Unable to index configured docs" } }); }
});

// ---------------------------------------------------------------------------
// POST /sources — Create ingestion source
// ---------------------------------------------------------------------------

ragRouter.post("/sources", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { title, sourceType, text, format } = req.body ?? {};

  if (typeof title !== "string" || !title.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "title is required" } });
    return;
  }

  const sourceTypeVal = normalizeSourceType(
    typeof sourceType === "string" && sourceType.trim() ? sourceType : format,
  );

  const metadata = JSON.stringify({
    originalFormat: format ?? "text",
    byteLength: typeof text === "string" ? text.length : 0,
  });

  const db = getDb(dbPath());
  const id = randomUUID();

  execTransaction(() => {
    db.prepare(
      `INSERT INTO rag_sources (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 0, ?, datetime('now'), datetime('now'))`,
    ).run(id, projectId, title.trim(), sourceTypeVal, typeof text === "string" ? text.length : 0, metadata);
  });
  checkpointAfterWrite();

  // If text was provided, ingest immediately
  let chunkCount = 0;
  if (typeof text === "string" && text.trim()) {
    chunkCount = reingestSource(id, text);
  }

  const row = db.prepare("SELECT * FROM rag_sources WHERE id = ?").get(id) as any;
  res.status(201).json({
    data: {
      id,
      project_id: projectId,
      title: row.title,
      source_type: row.source_type,
      chunk_count: chunkCount,
      metadata: row.metadata,
      created_at: row.created_at,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /sources/canonical — Idempotent, hash-verified logical source import
// ---------------------------------------------------------------------------

ragRouter.post("/sources/canonical", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { title, text, sourcePath, expectedHash, mimeType, metadata, priority, tags } = req.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof text !== "string" || !text.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "title and text are required" } });
    return;
  }
  if (typeof sourcePath !== "string" || sourcePath.length > 512 || !/^import:[A-Za-z0-9._:/-]+$/.test(sourcePath) || sourcePath.includes("..")) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "sourcePath must be a safe import: logical path" } });
    return;
  }
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "expectedHash must be a lowercase SHA-256 hash" } });
    return;
  }
  if (mimeType !== undefined && (typeof mimeType !== "string" || mimeType.length > 128 || !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(mimeType))) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "mimeType must be a valid media type" } });
    return;
  }
  const actualHash = createHash("sha256").update(text).digest("hex");
  if (actualHash !== expectedHash) {
    res.status(422).json({ error: { code: "HASH_MISMATCH", message: "Imported content does not match expectedHash" } });
    return;
  }
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "metadata must be an object" } });
    return;
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length > 64))) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "tags must contain strings up to 64 characters" } });
    return;
  }

  try {
    const source = rag.ingestCanonicalSource(projectId, title.trim(), text, {
      sourceType: "text",
      sourcePath,
      mimeType,
      metadata: metadata ?? {},
      priority,
      tags,
    });
    res.json({ data: source });
  } catch (error) {
    res.status(422).json({ error: { code: "IMPORT_FAILED", message: error instanceof Error ? error.message : "Canonical import failed" } });
  }
});

// ---------------------------------------------------------------------------
// GET /sources — List sources
// ---------------------------------------------------------------------------

ragRouter.get("/sources", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const sources = rag.listSources(projectId, Number(req.query.limit) || 50, Number(req.query.offset) || 0);
  res.json({
    data: sources.data.map((s) => ({
      id: s.id,
      project_id: s.project_id,
      title: s.title,
      source_type: s.source_type,
      source_path: s.source_path,
      source_hash: s.source_hash,
      chunk_count: s.chunk_count,
      metadata: s.metadata,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })), total: sources.total, limit: sources.limit, offset: sources.offset,
  });
});

// ---------------------------------------------------------------------------
// GET /sources/:id — Get source detail
// ---------------------------------------------------------------------------

ragRouter.get("/sources/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());
  const source = db.prepare(
    "SELECT * FROM rag_sources WHERE id = ? AND project_id = ?",
  ).get(req.params.id!, projectId) as any;

  if (!source) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Source not found" } });
    return;
  }

  res.json({
    data: {
      id: source.id,
      project_id: source.project_id,
      title: source.title,
      source_type: source.source_type,
      chunk_count: source.chunk_count,
       source_path: source.source_path, source_hash: source.source_hash, byte_size: source.byte_size,
      metadata: source.metadata,
      created_at: source.created_at,
      updated_at: source.updated_at,
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /sources/:id — Delete source + cascade chunks
// ---------------------------------------------------------------------------

ragRouter.delete("/sources/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());
  const existing = db.prepare(
    "SELECT 1 FROM rag_sources WHERE id = ? AND project_id = ?",
  ).get(req.params.id!, projectId);

  if (!existing) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Source not found" } });
    return;
  }

  rag.deleteSource(req.params.id!);

  logger.info(SOURCE, `Deleted RAG source ${req.params.id!}`, { projectId });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /sources/:id/ingest — Ingest/re-ingest content
// ---------------------------------------------------------------------------

ragRouter.post("/sources/:id/ingest", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());
  const source = db.prepare(
    "SELECT * FROM rag_sources WHERE id = ? AND project_id = ?",
  ).get(req.params.id!, projectId) as any;

  if (!source) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Source not found" } });
    return;
  }

  const { text, format } = req.body ?? {};

  if (typeof text !== "string" || !text.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "text is required" } });
    return;
  }

  // Update source_type if format was provided
  if (format) {
    const sourceType = normalizeSourceType(format);
    db.prepare(
      "UPDATE rag_sources SET source_type = ?, byte_size = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(sourceType, text.length, source.id);
  } else {
    db.prepare(
      "UPDATE rag_sources SET byte_size = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(text.length, source.id);
  }

  const chunkCount = reingestSource(source.id, text);

  logger.info(SOURCE, `Re-ingested source ${source.id}`, { chunkCount, projectId });

  res.json({
    data: {
      id: source.id,
      project_id: source.project_id,
      title: source.title,
      source_type: format ? normalizeSourceType(format) : source.source_type,
      chunk_count: chunkCount,
      metadata: source.metadata,
      created_at: source.created_at,
      updated_at: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /search — Hybrid full-text search
// ---------------------------------------------------------------------------

ragRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const q = (req.query.q as string ?? "").trim();
  if (!q) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "q query parameter is required" } });
    return;
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string ?? "20", 10) || 20, 1), 100);

  try {
    const results = rag.searchChunks(projectId, q, limit, true);

    res.json({
      data: results.map((r, i) => ({
        index: i + 1, id: r.id,
        chunk_id: r.id,
        source_id: r.source_id,
        source_title: r.source_name, source_path: r.source_path, source_type: r.source_type,
        chunk_index: r.chunk_index,
        content: r.content,
        heading_path: r.heading_path,
        snippet: r.snippet,
        rank: r.rank,
        score: -r.rank,
      })), total: results.length,
    });
  } catch (err: any) {
    logger.error(SOURCE, `Search failed: ${err.message}`, { projectId, query: q.slice(0, 80) });
    res.status(500).json({ error: { code: "SEARCH_FAILED", message: "Search query failed" } });
  }
});

// ---------------------------------------------------------------------------
// POST /ask — Natural-language Q&A
// ---------------------------------------------------------------------------

ragRouter.post("/ask", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { question } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "question is required" } });
    return;
  }

  // Step 1: Search for relevant chunks
  const results = rag.searchChunks(projectId, question, 10, true);

  if (results.length === 0) {
    res.json({
      data: {
        answer: "I don't have enough context to answer that question.",
        citations: [],
      },
    });
    return;
  }

  // Step 2: Build context from chunks
  const chunksText = results
    .map((r, i) => {
      const srcTitle = r.source_name || `Source ${r.source_id.slice(0, 8)}`;
       const heading = r.heading_path ? ` [Section: ${r.heading_path}]` : "";
      return `[${i + 1}] (${srcTitle}${heading}): ${r.content}`;
    })
    .join("\n\n");

  const userPrompt = `Context:\n${chunksText}\n\nQuestion: ${question}\n\nAnswer with citations like [1], [2].`;

  // Step 3: Call OpenCode LLM broker
  try {
    const result = await executeSynthesisBroker({
      projectId,
      system: "You answer questions based on provided context. Cite sources.",
      user: userPrompt,
      timeoutMs: 30_000,
    });

    if (!result.ok) {
      logger.warn(SOURCE, "Broker execution failed", { projectId, outcome: "failed" });
      res.status(502).json({
        error: { code: "LLM_FAILED", message: "Unable to generate an answer right now. Please try again." },
      });
      return;
    }

    // Build unique source list
    const seenSources = new Set<string>();
     const citations: Array<{ id: string; title: string; path: string | null; heading: string | null; snippet: string; kind: string; score: number }> = [];

    for (const r of results) {
      const srcId = r.source_id;
      const srcTitle = r.source_name;
      if (!seenSources.has(srcId)) {
        seenSources.add(srcId);
        citations.push({ id: srcId, title: srcTitle, path: r.source_path, heading: r.heading_path, snippet: r.snippet, kind: r.source_type, score: -r.rank });
      }
    }

    res.json({
      data: {
        answer: result.content,
        citations,
      },
    });
  } catch (err: unknown) {
    logger.error(SOURCE, "Ask failed", {
      projectId,
      outcome: "exception",
    });
    res.status(500).json({
      error: { code: "ASK_FAILED", message: "Q&A request failed" },
    });
  }
});

// ---------------------------------------------------------------------------
// GET /stats — RAG statistics
// ---------------------------------------------------------------------------

ragRouter.get("/stats", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());

  const sourceCount = (db.prepare(
    "SELECT count(*) as c FROM rag_sources WHERE project_id = ?",
  ).get(projectId) as { c: number }).c;

  const chunkCount = (db.prepare(
    `SELECT count(*) as c FROM rag_chunks c
     JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ?`,
  ).get(projectId) as { c: number }).c;

  const embeddingCount = (db.prepare(
    `SELECT count(*) as c FROM rag_embeddings e
     JOIN rag_chunks c ON c.id = e.chunk_id
     JOIN rag_sources s ON s.id = c.source_id
     WHERE s.project_id = ?`,
  ).get(projectId) as { c: number }).c;

  res.json({
    data: {
      total_sources: sourceCount,
      total_chunks: chunkCount,
      total_embeddings: embeddingCount,
      vector_capability: { available: true, provider: "deterministic-n-gram", semantic: false },
    },
  });
});

// ---------------------------------------------------------------------------
// POST /export — Export all RAG sources as JSON (backup/migration)
// ---------------------------------------------------------------------------

ragRouter.post("/export", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());

  const sources = db.prepare(
    "SELECT * FROM rag_sources WHERE project_id = ? ORDER BY created_at DESC",
  ).all(projectId) as any[];

  const exportData = sources.map((source) => {
    const chunks = db.prepare(
      "SELECT * FROM rag_chunks WHERE source_id = ? ORDER BY chunk_index",
    ).all(source.id) as any[];

    return {
      id: source.id,
      title: source.title,
      source_type: source.source_type,
      metadata: source.metadata,
      byte_size: source.byte_size,
      created_at: source.created_at,
      updated_at: source.updated_at,
      chunks: chunks.map((c) => ({
        id: c.id,
        chunk_index: c.chunk_index,
        content: c.content,
        token_count: c.token_count,
        heading_path: c.heading_path,
        priority: c.priority,
        tags: c.tags,
        created_at: c.created_at,
      })),
    };
  });

  res.json({
    data: {
      version: 1,
      project_id: projectId,
      exported_at: new Date().toISOString(),
      sources: exportData,
    },
  });
});
