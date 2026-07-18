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
 *   POST   /import/thread        — Import Thread JSON export
 *   GET    /import/thread/status — Import checkpoints
 *   POST   /export               — Export all RAG sources as JSON
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getDb, execTransaction, checkpointAfterWrite, logger, rag, ragChunker } from "ingenium-core";
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
function normalizeSourceType(format?: string): "text" | "file" | "thread_import" | "url" {
  if (!format) return "text";
  const f = format.toLowerCase();
  if (f === "thread_import" || f === "thread") return "thread_import";
  if (f === "file") return "file";
  if (f === "url") return "url";
  return "text";
}

/**
 * Re-ingest: deletes all existing chunks for a source, re-chunks the content,
 * and re-inserts. Returns the new chunk count.
 */
function reingestSource(sourceId: string, content: string): number {
  const db = getDb(dbPath());
  const chunks = ragChunker.chunkText(content, { source: sourceId });

  execTransaction(() => {
    db.prepare("DELETE FROM rag_chunks WHERE source_id = ?").run(sourceId);
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
      insertEmbedding.run(chunkId, Buffer.from(new Float32Array(rag.generateEmbedding(chunk.content)).buffer));
    }
    db.prepare(
      `UPDATE rag_sources
       SET chunk_count = (SELECT count(*) FROM rag_chunks WHERE source_id = ?),
           byte_size = COALESCE(?, byte_size),
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(sourceId, content.length, sourceId);
  });
  checkpointAfterWrite();

  return chunks.length;
}

function syncPublishedDocs(projectId: string): { ingested: number; failed: number } {
  const db = getDb(dbPath());
  const pages = db.prepare(
    "SELECT id, title, slug, content FROM docs_pages WHERE status = 'published' ORDER BY id",
  ).all() as Array<{ id: number; title: string; slug: string; content: string }>;
  let ingested = 0;
  let failed = 0;
  const activePaths = new Set<string>();

  for (const page of pages) {
    const sourcePath = `docs-page:${page.id}`;
    activePaths.add(sourcePath);
    try {
      let source = db.prepare(
        "SELECT id FROM rag_sources WHERE project_id = ? AND source_path = ?",
      ).get(projectId, sourcePath) as { id: string } | undefined;
      if (!source) {
        const id = randomUUID();
        execTransaction(() => {
          db.prepare(
            `INSERT INTO rag_sources
             (id, project_id, title, source_type, source_path, byte_size, metadata, created_at, updated_at)
             VALUES (?, ?, ?, 'text', ?, ?, ?, datetime('now'), datetime('now'))`,
          ).run(id, projectId, page.title, sourcePath, page.content.length, JSON.stringify({ pageId: page.id, slug: page.slug }));
        });
        checkpointAfterWrite();
        source = { id };
      } else {
        execTransaction(() => {
          db.prepare(
            "UPDATE rag_sources SET title = ?, byte_size = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(page.title, page.content.length, JSON.stringify({ pageId: page.id, slug: page.slug }), source!.id);
        });
        checkpointAfterWrite();
      }
      reingestSource(source.id, page.content);
      ingested++;
    } catch (error) {
      failed++;
      logger.warn(SOURCE, "Failed to index Docs page", {
        pageId: page.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const staleSources = db.prepare(
    "SELECT id, source_path FROM rag_sources WHERE project_id = ? AND source_path LIKE 'docs-page:%'",
  ).all(projectId) as Array<{ id: string; source_path: string }>;
  for (const source of staleSources) {
    if (!activePaths.has(source.source_path)) rag.deleteSource(source.id);
  }
  return { ingested, failed };
}

ragRouter.post("/ingest", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const result = syncPublishedDocs(projectId);
  res.json({ data: result });
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

  const sourceTypeVal = (typeof sourceType === "string" && sourceType.trim())
    ? sourceType.trim()
    : normalizeSourceType(format);

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
// GET /sources — List sources
// ---------------------------------------------------------------------------

ragRouter.get("/sources", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const sources = rag.listSources(projectId);
  res.json({
    data: sources.map((s) => ({
      id: s.id,
      project_id: s.project_id,
      title: s.title,
      source_type: s.source_type,
      chunk_count: s.chunk_count,
      metadata: s.metadata,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
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
      byte_size: source.byte_size,
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
    const results = rag.hybridSearch(projectId, q).slice(0, limit);

    res.json({
      data: results.map((r, i) => ({
        index: i + 1,
        chunk_id: r.chunk_id,
        source_id: r.source_id,
        source_title: r.source_name,
        chunk_index: r.chunk_id,
        content: r.content,
        heading_path: r.heading,
        snippet: r.content.slice(0, 240),
        rank: r.rank,
        score: r.combined_score,
      })),
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
  const results = rag.hybridSearch(projectId, question).slice(0, 10);

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
      const heading = r.heading ? ` [Section: ${r.heading}]` : "";
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
    const citations: Array<{ id: string; title: string; score: number }> = [];

    for (const r of results) {
      const srcId = r.source_id;
      const srcTitle = r.source_name;
      if (!seenSources.has(srcId)) {
        seenSources.add(srcId);
        citations.push({ id: srcId, title: srcTitle, score: r.combined_score });
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
    },
  });
});

// ---------------------------------------------------------------------------
// POST /import/thread — Import Thread JSON export
//
// Accepts: { sessions: [{ name, description, entries: [{ content, priority, tags, created_at }] }] }
// Returns: { imported_sessions, imported_entries, errors }
// Supports resume via rag_thread_imports checkpoints.
// ---------------------------------------------------------------------------

interface ThreadEntry {
  content: string;
  priority?: number;
  tags?: string[];
  created_at?: string;
}

ragRouter.post("/import/thread", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { sessions } = req.body ?? {};

  if (!Array.isArray(sessions) || sessions.length === 0) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "sessions is required (non-empty array)" },
    });
    return;
  }

  // Validate session structure
  for (const s of sessions) {
    if (typeof s.name !== "string" || !s.name.trim()) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "Each session requires a non-empty name" },
      });
      return;
    }
    if (s.entries !== undefined && !Array.isArray(s.entries)) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: `Session '${s.name}' entries must be an array` },
      });
      return;
    }
  }

  const db = getDb(dbPath());
  let importedSessions = 0;
  let importedEntries = 0;
  const errors: Array<{ session: string; error: string }> = [];

  for (const session of sessions) {
    const sessionName = session.name.trim();
    const entries = Array.isArray(session.entries) ? session.entries : [];
    const description = typeof session.description === "string" ? session.description : null;

    try {
      // Check for existing import checkpoint
      const existingImport = db.prepare(
        `SELECT ti.*, s.title as source_title
         FROM rag_thread_imports ti
         JOIN rag_sources s ON s.id = ti.source_id
         WHERE ti.thread_session_name = ? AND s.project_id = ?
         ORDER BY ti.created_at DESC LIMIT 1`,
      ).get(sessionName, projectId) as any;

      if (existingImport && existingImport.completed === 1) {
        // Already fully imported — skip
        importedSessions++;
        continue;
      }

      let sourceId: string;
      let lastEntryIdx = -1; // 0-based index of last successfully imported entry

      if (existingImport && existingImport.completed === 0) {
        // Resume an incomplete import
        sourceId = existingImport.source_id;
        lastEntryIdx = typeof existingImport.last_entry_id === "number" ? existingImport.last_entry_id : -1;
        logger.info(SOURCE, `Resuming Thread import for session '${sessionName}'`, {
          sourceId,
          lastEntryIdx,
          projectId,
        });
      } else {
        // Create a new source for this session
        sourceId = randomUUID();
        const sourceTitle = `Thread: ${sessionName}`;
        const metadata = JSON.stringify({
          source: "thread_import",
          sessionName,
          description: description || "",
          entryCount: entries.length,
        });

        execTransaction(() => {
          db.prepare(
            `INSERT INTO rag_sources (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at)
             VALUES (?, ?, ?, 'thread_import', NULL, NULL, NULL, 0, 0, ?, datetime('now'), datetime('now'))`,
          ).run(sourceId, projectId, sourceTitle, metadata);
        });
        checkpointAfterWrite();

        // Create import tracking record
        execTransaction(() => {
          db.prepare(
            `INSERT INTO rag_thread_imports (source_id, thread_session_name, entries_total, entries_imported, last_entry_id, completed, created_at)
             VALUES (?, ?, ?, 0, NULL, 0, datetime('now'))`,
          ).run(sourceId, sessionName, entries.length);
        });
        checkpointAfterWrite();

        logger.info(SOURCE, `Created Thread import source for session '${sessionName}'`, {
          sourceId,
          entryCount: entries.length,
          projectId,
        });
      }

      // Process entries
      if (entries.length > 0) {
        const insertChunk = db.prepare(
          `INSERT INTO rag_chunks (id, source_id, chunk_index, content, token_count, heading_path, priority, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        let entriesProcessed = 0;

        execTransaction(() => {
          // Get current max chunk_index for this source
          const maxIdx = db.prepare(
            "SELECT COALESCE(MAX(chunk_index), -1) as max_idx FROM rag_chunks WHERE source_id = ?",
          ).get(sourceId) as { max_idx: number };
          let chunkIdx = maxIdx.max_idx + 1;

          for (let i = 0; i < entries.length; i++) {
            // Skip already-imported entries (using entry array index)
            if (i <= lastEntryIdx) continue;

            const entry = entries[i]!;
            if (!entry.content || typeof entry.content !== "string" || !entry.content.trim()) {
              continue;
            }

            // Clamp priority to valid range [0, 10]
            const priority = typeof entry.priority === "number"
              ? Math.max(0, Math.min(10, Math.round(entry.priority)))
              : 5;
            const tags = Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : "[]";

            // Chunk the entry content
            const chunks = ragChunker.chunkText(entry.content, { source: sourceId });

            for (const chunk of chunks) {
              insertChunk.run(
                randomUUID(),
                sourceId,
                chunkIdx++,
                chunk.content,
                chunk.tokens,
                chunk.heading ?? null,
                priority,
                tags,
              );
            }

            // Update progress after each entry
            db.prepare(
              `UPDATE rag_thread_imports
               SET entries_imported = entries_imported + 1,
                   last_entry_id = ?
               WHERE source_id = ?`,
            ).run(i, sourceId);

            entriesProcessed++;
            importedEntries++;
          }

          // Update source byte_size and chunk_count
          const totalChunkCount = chunkIdx;
          let totalBytes = 0;
          entries.forEach((e: ThreadEntry) => {
            if (e.content && typeof e.content === "string") totalBytes += e.content.length;
          });

          db.prepare(
            `UPDATE rag_sources
             SET chunk_count = ?,
                 byte_size = COALESCE(byte_size, 0) + ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
          ).run(totalChunkCount, totalBytes, sourceId);
        });
        checkpointAfterWrite();

        const totalImported = existingImport
          ? (existingImport.entries_imported || 0) + entriesProcessed
          : entriesProcessed;

        logger.info(SOURCE, `Processed ${entriesProcessed} entries for session '${sessionName}'`, {
          sourceId,
          totalImported,
          projectId,
        });
      }

      // Mark import as complete
      execTransaction(() => {
        db.prepare(
          `UPDATE rag_thread_imports
           SET completed = 1
           WHERE source_id = ?`,
        ).run(sourceId);
      });
      checkpointAfterWrite();

      importedSessions++;

      // Audit log
      logger.info("rag-audit", `Thread import completed: session='${sessionName}' source=${sourceId} entries=${entries.length}`, {
        projectId,
        sessionName,
        sourceId,
        entryCount: entries.length,
      });
    } catch (err: any) {
      logger.error(SOURCE, `Failed to import session '${sessionName}': ${err.message}`, { projectId });
      errors.push({ session: sessionName, error: err.message || "Unknown error" });

      // Mark import as failed so it can be resumed later
      try {
        execTransaction(() => {
          db.prepare(
            `UPDATE rag_thread_imports
             SET completed = 0
             WHERE thread_session_name = ?`,
          ).run(sessionName);
        });
        checkpointAfterWrite();
      } catch (_) {
        // Best-effort
      }
    }
  }

  res.status(201).json({
    imported_sessions: importedSessions,
    imported_entries: importedEntries,
    errors,
  });
});

// ---------------------------------------------------------------------------
// GET /import/thread/status — Import checkpoints
// ---------------------------------------------------------------------------

ragRouter.get("/import/thread/status", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = getDb(dbPath());

  const imports = db.prepare(
    `SELECT ti.*, s.title as source_title, s.created_at as source_created_at
     FROM rag_thread_imports ti
     JOIN rag_sources s ON s.id = ti.source_id
     WHERE s.project_id = ?
     ORDER BY ti.created_at DESC`,
  ).all(projectId) as any[];

  res.json({
    data: imports.map((imp) => ({
      id: imp.id,
      source_id: imp.source_id,
      source_title: imp.source_title,
      thread_session_name: imp.thread_session_name,
      entries_total: imp.entries_total,
      entries_imported: imp.entries_imported,
      last_entry_id: imp.last_entry_id,
      completed: imp.completed === 1,
      created_at: imp.created_at,
      source_created_at: imp.source_created_at,
    })),
    total: imports.length,
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

  // Also export thread import checkpoints
  const threadImports = db.prepare(
    `SELECT ti.* FROM rag_thread_imports ti
     JOIN rag_sources s ON s.id = ti.source_id
     WHERE s.project_id = ?
     ORDER BY ti.created_at DESC`,
  ).all(projectId) as any[];

  res.json({
    data: {
      version: 1,
      project_id: projectId,
      exported_at: new Date().toISOString(),
      sources: exportData,
      thread_imports: threadImports.map((ti) => ({
        id: ti.id,
        source_id: ti.source_id,
        thread_session_name: ti.thread_session_name,
        entries_total: ti.entries_total,
        entries_imported: ti.entries_imported,
        last_entry_id: ti.last_entry_id,
        completed: ti.completed === 1,
        created_at: ti.created_at,
      })),
    },
  });
});
