/**
 * rag-api.test.ts — RAG API integration tests.
 *
 * Tests the RAG API contract (POST/GET/DELETE /sources, GET /search,
 * POST /ask, POST /import/thread, GET /import/thread/status, POST /export,
 * GET /stats) using the core rag tools via inline Express routes with a
 * temporary database.
 *
 * Pattern: Express + fetch with temp DB (mirrors backups-api.test.ts).
 * brokerExecute is mocked via vi.spyOn for per-test isolation.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getDb,
  execTransaction,
  checkpointAfterWrite,
  projects,
  rag,
  ragChunker,
} from "ingenium-core";

// ── Test isolation — override DB path before any module init ─────────────────

const tempDir = mkdtempSync(join(tmpdir(), "ingenium-rag-api-"));
const coreDbPath = join(tempDir, "data.db");

process.env.INGENIUM_CORE_DB_PATH = coreDbPath;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a URL for the RAG API. Handles paths that already contain a query string
 * by switching from `?` to `&` for the project parameter.
 */
function url(path: string): string {
  const hasQuery = path.includes("?");
  return `${baseUrl}/api/v1/rag${path}${hasQuery ? "&" : "?"}project=${projectName}`;
}

function urlNoProject(path: string): string {
  return `${baseUrl}/api/v1/rag${path}`;
}

// ── Inline RAG routes ───────────────────────────────────────────────────────

function createRagRouter(): express.Router {
  const router = express.Router();

  // ── POST /sources — create source + ingest ──────────────────────────────
  router.post("/sources", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const { title, content } = req.body as { title?: string; content?: string };
      if (!title || !content) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "title and content are required" },
        });
        return;
      }
      const source = rag.ingestSource(project.id, title, content);
      res.status(201).json({ data: source });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── GET /sources — list sources ─────────────────────────────────────────
  router.get("/sources", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const sources = rag.listSources(project.id);
      res.json({ data: sources, total: sources.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── GET /sources/:id — source detail ────────────────────────────────────
  router.get("/sources/:id", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const db = getDb(coreDbPath);
      const row = db
        .prepare("SELECT * FROM rag_sources WHERE id = ? AND project_id = ?")
        .get(req.params.id, project.id) as any;
      if (!row) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Source not found" },
        });
        return;
      }
      res.json({
        data: {
          id: row.id,
          project_id: row.project_id,
          name: row.title,
          source_type: row.source_type,
          chunk_count: row.chunk_count,
          metadata: row.metadata,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── DELETE /sources/:id — cascade delete ────────────────────────────────
  router.delete("/sources/:id", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const db = getDb(coreDbPath);
      const row = db
        .prepare("SELECT id FROM rag_sources WHERE id = ? AND project_id = ?")
        .get(req.params.id, project.id) as any;
      if (!row) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Source not found" },
        });
        return;
      }
      rag.deleteSource(req.params.id);
      res.json({ data: { deleted: true, id: req.params.id } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── GET /search — BM25 search with snippets ────────────────────────────
  router.get("/search", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const q = req.query.q as string | undefined;
      if (!q) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "q query parameter is required" },
        });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const results = rag.searchChunks(project.id, q, limit);
      res.json({ data: results, total: results.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── POST /ask — LLM-powered answer with citations ──────────────────────
  router.post("/ask", async (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const { question } = req.body as { question?: string };
      if (!question) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "question is required" },
        });
        return;
      }

      // Search for relevant chunks
      const chunks = rag.searchChunks(project.id, question, 5);

      if (chunks.length === 0) {
        res.json({
          data: {
            answer: "No relevant context found to answer this question.",
            citations: [],
            source: "no_context",
          },
        });
        return;
      }

      // Build context from chunks
      const context = chunks
        .map((c) => `[${c.source_name}] ${c.content}`)
        .join("\n\n---\n\n");

      const citations = chunks.map((c) => ({
        source_id: c.source_id,
        source_name: c.source_name,
        snippet: c.snippet,
        rank: c.rank,
      }));

      try {
        // Attempt brokerExecute — mocked in tests
        const { brokerExecute } = await import("../lib/opencode-client.js");
        const answerResult = await brokerExecute({
          providerID: "lmstudio",
          modelID: "qwen2.5-7b-instruct",
          system: `You are a documentation assistant. Answer the user's question based ONLY on the following context. If the context does not contain the answer, say "No relevant context found."\n\nContext:\n${context}`,
          user: question,
          timeoutMs: 15_000,
        });

        if (answerResult.ok) {
          res.json({
            data: {
              answer: answerResult.content,
              citations,
              source: "llm",
            },
          });
        } else {
          // Fallback to context-only answer
          res.json({
            data: {
              answer: `Based on available context:\n\n${chunks.map((c) => c.content).join("\n\n")}`,
              citations,
              source: "context_only",
            },
          });
        }
      } catch {
        // Fallback when broker is unavailable
        res.json({
          data: {
            answer: `Based on available context:\n\n${chunks.map((c) => c.content).join("\n\n")}`,
            citations,
            source: "context_only",
          },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── POST /import/thread — import Thread JSON (multi-session) ──────────
  router.post("/import/thread", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }

      const { sessions } = req.body as {
        sessions?: Array<{
          name: string;
          description?: string;
          entries?: Array<{ content: string; priority?: number; tags?: string[] }>;
        }>;
      };

      if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "sessions is required (non-empty array)" },
        });
        return;
      }

      // Validate session names
      for (const s of sessions) {
        if (typeof s.name !== "string" || !s.name.trim()) {
          res.status(422).json({
            error: { code: "VALIDATION_ERROR", message: "Each session requires a non-empty name" },
          });
          return;
        }
      }

      const db = getDb(coreDbPath);
      let importedSessions = 0;
      let importedEntries = 0;
      const errors: Array<{ session: string; error: string }> = [];

      for (const session of sessions) {
        const sessionName = session.name.trim();
        const entries = Array.isArray(session.entries) ? session.entries : [];

        try {
          // Check existing import
          const existingImport = db.prepare(
            `SELECT ti.* FROM rag_thread_imports ti
             JOIN rag_sources s ON s.id = ti.source_id
             WHERE ti.thread_session_name = ? AND s.project_id = ?`,
          ).get(sessionName, project.id) as any;

          if (existingImport && existingImport.completed === 1) {
            importedSessions++;
            continue;
          }

          let sourceId: string;
          let lastEntryIdx = -1;

          if (existingImport && existingImport.completed === 0) {
            sourceId = existingImport.source_id;
            lastEntryIdx = typeof existingImport.last_entry_id === "number" ? existingImport.last_entry_id : -1;
          } else {
            sourceId = randomUUID();
            execTransaction(() => {
              db.prepare(
                `INSERT INTO rag_sources (id, project_id, title, source_type, chunk_count, metadata, created_at, updated_at)
                 VALUES (?, ?, ?, 'thread_import', 0, '{}', datetime('now'), datetime('now'))`,
              ).run(sourceId, project.id, `Thread: ${sessionName}`);
            });
            checkpointAfterWrite();
            execTransaction(() => {
              db.prepare(
                `INSERT INTO rag_thread_imports (source_id, thread_session_name, entries_total, entries_imported, last_entry_id, completed, created_at)
                 VALUES (?, ?, ?, 0, NULL, 0, datetime('now'))`,
              ).run(sourceId, sessionName, entries.length);
            });
            checkpointAfterWrite();
          }

          if (entries.length > 0) {
            const insertChunk = db.prepare(
              `INSERT INTO rag_chunks (id, source_id, chunk_index, content, token_count, heading_path, priority, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            );

            const entriesProcessed = execTransaction(() => {
              const maxIdx = db.prepare(
                "SELECT COALESCE(MAX(chunk_index), -1) as max_idx FROM rag_chunks WHERE source_id = ?",
              ).get(sourceId) as { max_idx: number };
              let chunkIdx = maxIdx.max_idx + 1;
              let count = 0;

              for (let i = 0; i < entries.length; i++) {
                if (i <= lastEntryIdx) continue;
                const entry = entries[i]!;
                if (!entry.content || !entry.content.trim()) continue;

                const priority = typeof entry.priority === "number"
                  ? Math.max(0, Math.min(10, Math.round(entry.priority)))
                  : 5;
                const tags = Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : "[]";

                const chunks = ragChunker.chunkText(entry.content, { source: sourceId });
                for (const chunk of chunks) {
                  insertChunk.run(randomUUID(), sourceId, chunkIdx++, chunk.content, chunk.tokens, chunk.heading ?? null, priority, tags);
                }
                db.prepare("UPDATE rag_thread_imports SET entries_imported = entries_imported + 1, last_entry_id = ? WHERE source_id = ?").run(i, sourceId);
                count++;
              }
              db.prepare("UPDATE rag_sources SET chunk_count = ?, updated_at = datetime('now') WHERE id = ?").run(chunkIdx, sourceId);
              return count;
            });
            checkpointAfterWrite();
            importedEntries += entriesProcessed;
          }

          execTransaction(() => {
            db.prepare("UPDATE rag_thread_imports SET completed = 1 WHERE source_id = ?").run(sourceId);
          });
          checkpointAfterWrite();
          importedSessions++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ session: sessionName, error: msg });
        }
      }

      res.status(201).json({ imported_sessions: importedSessions, imported_entries: importedEntries, errors });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── GET /import/thread/status — import checkpoints ─────────────────────
  router.get("/import/thread/status", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const db = getDb(coreDbPath);
      const imports = db.prepare(
        `SELECT ti.*, s.title as source_title
         FROM rag_thread_imports ti
         JOIN rag_sources s ON s.id = ti.source_id
         WHERE s.project_id = ?
         ORDER BY ti.created_at DESC`,
      ).all(project.id) as any[];
      res.json({
        data: imports.map((i: any) => ({
          id: i.id,
          source_id: i.source_id,
          source_title: i.source_title,
          thread_session_name: i.thread_session_name,
          entries_total: i.entries_total,
          entries_imported: i.entries_imported,
          last_entry_id: i.last_entry_id,
          completed: i.completed === 1,
          created_at: i.created_at,
        })),
        total: imports.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── POST /export — export all RAG sources as JSON ──────────────────────
  router.post("/export", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const db = getDb(coreDbPath);
      const sources = db.prepare(
        "SELECT * FROM rag_sources WHERE project_id = ? ORDER BY created_at DESC",
      ).all(project.id) as any[];

      const exportData = sources.map((s: any) => {
        const chunks = db.prepare(
          "SELECT * FROM rag_chunks WHERE source_id = ? ORDER BY chunk_index",
        ).all(s.id) as any[];
        return {
          id: s.id,
          title: s.title,
          source_type: s.source_type,
          metadata: s.metadata,
          byte_size: s.byte_size,
          created_at: s.created_at,
          updated_at: s.updated_at,
          chunks: chunks.map((c: any) => ({
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
          project_id: project.id,
          exported_at: new Date().toISOString(),
          sources: exportData,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  // ── GET /stats — source and chunk counts ─────────────────────────────────
  router.get("/stats", (req, res) => {
    try {
      const projectName = req.query.project as string | undefined;
      if (!projectName) {
        res.status(400).json({
          error: { code: "BAD_REQUEST", message: "project query parameter is required" },
        });
        return;
      }
      const project = projects.getProject(projectName);
      if (!project) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: `Project '${projectName}' not found` },
        });
        return;
      }
      const db = getDb(coreDbPath);
      const sourceCount = (
        db
          .prepare("SELECT count(*) as c FROM rag_sources WHERE project_id = ?")
          .get(project.id) as { c: number }
      ).c;
      const chunkCount = (
        db.prepare(`
          SELECT count(*) as c FROM rag_chunks rc
          INNER JOIN rag_sources rs ON rs.id = rc.source_id
          WHERE rs.project_id = ?
        `).get(project.id) as { c: number }
      ).c;
      res.json({
        data: {
          source_count: sourceCount,
          chunk_count: chunkCount,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: msg } });
    }
  });

  return router;
}

// ── Test server setup ───────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;
const projectName = "rag-api-test";
let projectId: string;

beforeAll(async () => {
  // Initialize DB and create the test project
  getDb(coreDbPath);
  projectId = projects.createProject(projectName).id;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/rag", createRagRouter());
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.INGENIUM_CORE_DB_PATH;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /sources — creates source + ingests", () => {
  it("creates a source with content and returns 201 with chunk_count", async () => {
    const res = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test Document",
        content: "RAG (Retrieval-Augmented Generation) is a technique that combines retrieval from a knowledge base with text generation. It grounds LLM responses in factual data retrieved from indexed documents.",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.id).toBeTruthy();
    expect(body.data.name).toBe("Test Document");
    expect(body.data.chunk_count).toBeGreaterThan(0);
    expect(body.data.created_at).toBeTruthy();
  });

  it("returns 422 when title is missing", async () => {
    const res = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "some content" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 when content is missing", async () => {
    const res = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No Content" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when project parameter is missing", async () => {
    const res = await fetch(urlNoProject("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X", content: "Some content" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rag/sources?project=nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X", content: "Some content" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /sources — lists sources", () => {
  it("returns an array of sources", async () => {
    const res = await fetch(url("/sources"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0].id).toBeTruthy();
    expect(body.data[0].title).toBeDefined();
    expect(body.data[0].chunk_count).toBeDefined();
  });

  it("returns 404 for nonexistent project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rag/sources?project=nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe("GET /sources/:id — returns detail with chunk_count", () => {
  let sourceId: string;

  beforeAll(async () => {
    const res = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Detail Test",
        content: "This is a test document for detail retrieval.",
      }),
    });
    const body = await res.json();
    sourceId = body.data.id;
  });

  it("returns a single source with chunk_count", async () => {
    const res = await fetch(url(`/sources/${sourceId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(sourceId);
    expect(body.data.name).toBe("Detail Test");
    expect(body.data.chunk_count).toBeGreaterThanOrEqual(0);
    expect(body.data.source_type).toBe("text");
    expect(body.data.created_at).toBeTruthy();
  });

  it("returns 404 for non-existent source", async () => {
    const res = await fetch(url(`/sources/${randomUUID()}`));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /sources/:id — cascades", () => {
  let sourceId: string;
  const MARKDOWN_CONTENT = `## Introduction
This is the introduction section with key concepts about RAG retrieval.

## Methodology
The methodology section describes how RAG integrates with semantic search.

## Results
The results show significant improvement in answer accuracy.`;

  beforeAll(async () => {
    const res = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "To Delete", content: MARKDOWN_CONTENT }),
    });
    const body = await res.json();
    sourceId = body.data.id;
  });

  it("deletes a source and confirms cascade", async () => {
    // Verify source and chunks exist first
    const detailRes = await fetch(url(`/sources/${sourceId}`));
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json();
    expect(detailBody.data.chunk_count).toBeGreaterThan(0);

    // Delete
    const delRes = await fetch(url(`/sources/${sourceId}`), { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.data.deleted).toBe(true);
    expect(delBody.data.id).toBe(sourceId);

    // Verify source is gone
    const getRes = await fetch(url(`/sources/${sourceId}`));
    expect(getRes.status).toBe(404);

    // Verify chunks cleaned up (check via DB directly)
    const db = getDb(coreDbPath);
    const orphanChunks = db
      .prepare("SELECT count(*) as c FROM rag_chunks WHERE source_id = ?")
      .get(sourceId) as { c: number };
    expect(orphanChunks.c).toBe(0);

    // Verify FTS entries cleaned up
    const ftsEntries = db
      .prepare("SELECT count(*) as c FROM rag_chunks_fts WHERE source_id = ?")
      .get(sourceId) as { c: number };
    expect(ftsEntries.c).toBe(0);
  });

  it("returns 404 when deleting a non-existent source", async () => {
    const res = await fetch(url(`/sources/${randomUUID()}`), { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("GET /search — BM25 results with snippets", () => {
  beforeAll(async () => {
    // Ensure we have indexed content with a unique searchable term
    await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Search Test Doc",
        content:
          "Vector databases store embeddings for semantic search. They enable similarity matching across large document collections. BM25 is a traditional bag-of-words ranking function used in information retrieval.",
      }),
    });
  });

  it("returns BM25 results with snippets on matching query", async () => {
    // Use a term that appears verbatim in the content; sanitizeFts5Query wraps
    // in double quotes (exact phrase), so single tokens match reliably.
    const res = await fetch(url("/search?q=BM25"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);

    const result = body.data[0];
    expect(result.id).toBeTruthy();
    expect(result.source_id).toBeTruthy();
    expect(result.source_name).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(typeof result.rank).toBe("number");
    expect(result.snippet).toBeTruthy();
    // Snippet should contain the matching terms (may be wrapped in <mark> tags)
    expect(result.snippet).toMatch(/BM25|<mark>/i);
  });

  it("returns empty array on no match", async () => {
    const res = await fetch(url("/search?q=xyznonexistent12345"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(0);
    expect(body.total).toBe(0);
  });

  it("returns 422 when q parameter is missing", async () => {
    const res = await fetch(url("/search"));
    expect(res.status).toBe(422);
  });
});

describe("POST /ask — returns answer with citations (mocked brokerExecute)", () => {
  beforeAll(async () => {
    // Ensure searchable content exists
    await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "RAG Architecture",
        content:
          "Retrieval-Augmented Generation (RAG) combines a retrieval step with a text generation model. The retriever finds relevant documents from a knowledge base, and the generator produces an answer conditioned on those documents. This approach reduces hallucinations and improves factual accuracy.",
      }),
    });
  });

  it("returns answer with citations when brokerExecute succeeds", async () => {
    // Spy on brokerExecute to return a successful response
    const opencodeClient = await import("../lib/opencode-client.js");
    const spy = vi.spyOn(opencodeClient, "brokerExecute").mockResolvedValue({
      ok: true,
      content: "RAG combines retrieval with generation to ground LLM responses in factual data.",
    });

    const res = await fetch(url("/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "RAG" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.answer).toBeTruthy();
    // The answer (mocked) or fallback should reference RAG content
    expect(body.data.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data.citations)).toBe(true);
    expect(body.data.citations.length).toBeGreaterThan(0);
    expect(body.data.citations[0].source_id).toBeTruthy();
    expect(body.data.citations[0].source_name).toBeTruthy();
    expect(body.data.citations[0].snippet).toBeTruthy();
    expect(body.data.source).toBe("llm");

    spy.mockRestore();
  });

  it("returns fallback answer with citations when broker is unavailable", async () => {
    // Spy on brokerExecute to fail
    const opencodeClient = await import("../lib/opencode-client.js");
    const spy = vi.spyOn(opencodeClient, "brokerExecute").mockResolvedValue({
      ok: false,
      content: "",
      error: "Broker unavailable",
    });

    const res = await fetch(url("/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "RAG" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.answer).toBeTruthy();
    expect(Array.isArray(body.data.citations)).toBe(true);
    // Should use context-only fallback (broker mock returns ok:false)
    expect(body.data.source).toBe("context_only");

    spy.mockRestore();
  });
});

describe("POST /ask — 'no context' when nothing relevant", () => {
  it("returns no-context answer when search returns nothing", async () => {
    // Use a query that won't match anything
    const res = await fetch(url("/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "xyznonexistent12345 query" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.answer).toBe("No relevant context found to answer this question.");
    expect(body.data.citations).toEqual([]);
    expect(body.data.source).toBe("no_context");
  });
});

describe("POST /import/thread — imports Thread JSON with multi-session format", () => {
  it("imports multiple sessions and returns 201 with counts", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [
          {
            name: "project-planning",
            description: "Tech stack decisions",
            entries: [
              { content: "We need to decide on the tech stack for Q3.", priority: 8 },
              { content: "The team prefers TypeScript with React for the frontend.", tags: ["frontend", "typescript"] },
              { content: "PostgreSQL is the preferred database.", priority: 9 },
            ],
          },
          {
            name: "sprint-retro",
            entries: [
              { content: "The team completed 85% of sprint goals." },
              { content: "We should improve code review turnaround time.", priority: 7 },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported_sessions).toBe(2);
    expect(body.imported_entries).toBe(5);
    expect(body.errors).toEqual([]);
  });

  it("imports a session with entries that have no content", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [
          {
            name: "mixed-content",
            entries: [
              { content: "Valid entry here.", priority: 3 },
              { content: "" },
              { content: "Another valid entry.", tags: ["valid"] },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported_sessions).toBe(1);
    // Only 2 entries have content
    expect(body.imported_entries).toBe(2);
  });

  it("returns 422 when sessions is missing", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when sessions is empty", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: [] }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when session name is missing", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: [{ entries: [{ content: "test" }] }] }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when sessions is not an array", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: "not-an-array" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 400 when project parameter is missing", async () => {
    const res = await fetch(urlNoProject("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [{ name: "test", entries: [{ content: "hello" }] }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("skips already-completed sessions (idempotent re-import)", async () => {
    // First import
    const res1 = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [{ name: "idempotent-test", entries: [{ content: "First import." }] }],
      }),
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.imported_sessions).toBe(1);
    expect(body1.imported_entries).toBe(1);

    // Second import — same session: should skip
    const res2 = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [{ name: "idempotent-test", entries: [{ content: "Re-import attempt." }] }],
      }),
    });
    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    // Session already completed, so it counts as imported (not re-ingested)
    expect(body2.imported_sessions).toBe(1);
    expect(body2.imported_entries).toBe(0);
  });

  it("creates a rag_thread_imports checkpoint record", async () => {
    const res = await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [{ name: "checkpoint-test", entries: [{ content: "Checkpoint entry." }] }],
      }),
    });
    expect(res.status).toBe(201);

    const db = getDb(coreDbPath);
    const import_ = db
      .prepare("SELECT * FROM rag_thread_imports WHERE thread_session_name = ?")
      .get("checkpoint-test") as any;
    expect(import_).toBeTruthy();
    expect(import_.entries_total).toBe(1);
    expect(import_.entries_imported).toBe(1);
    expect(import_.completed).toBe(1);
    expect(import_.source_id).toBeTruthy();
  });
});

describe("GET /import/thread/status — returns import checkpoints", () => {
  beforeAll(async () => {
    // Ensure at least one import exists
    await fetch(url("/import/thread"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessions: [{ name: "status-test", entries: [{ content: "Status check entry." }] }],
      }),
    });
  });

  it("returns an array of import checkpoints", async () => {
    const res = await fetch(url("/import/thread/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const checkpoint = body.data.find((i: any) => i.thread_session_name === "status-test");
    expect(checkpoint).toBeTruthy();
    expect(checkpoint.source_id).toBeTruthy();
    expect(checkpoint.entries_total).toBe(1);
    expect(checkpoint.entries_imported).toBe(1);
    expect(checkpoint.completed).toBe(true);
    expect(checkpoint.created_at).toBeTruthy();
  });

  it("returns 404 for nonexistent project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rag/import/thread/status?project=nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe("POST /export — exports all RAG sources as JSON", () => {
  it("exports sources with chunks", async () => {
    const res = await fetch(url("/export"), { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.version).toBe(1);
    expect(body.data.project_id).toBeTruthy();
    expect(body.data.exported_at).toBeTruthy();
    expect(Array.isArray(body.data.sources)).toBe(true);
    expect(body.data.sources.length).toBeGreaterThanOrEqual(1);

    const source = body.data.sources[0];
    expect(source.id).toBeTruthy();
    expect(source.title).toBeTruthy();
    expect(source.source_type).toBeTruthy();
    expect(Array.isArray(source.chunks)).toBe(true);
    expect(source.chunks.length).toBeGreaterThanOrEqual(0);

    if (source.chunks.length > 0) {
      const chunk = source.chunks[0];
      expect(chunk.id).toBeTruthy();
      expect(chunk.chunk_index).toBeGreaterThanOrEqual(0);
      expect(chunk.content).toBeTruthy();
      expect(chunk.token_count).toBeGreaterThanOrEqual(0);
      expect(typeof chunk.priority).toBe("number");
    }
  });

  it("returns 404 for nonexistent project", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rag/export?project=nonexistent`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /stats — returns counts", () => {
  it("returns source_count and chunk_count", async () => {
    const res = await fetch(url("/stats"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.source_count).toBe("number");
    expect(typeof body.data.chunk_count).toBe("number");
    expect(body.data.source_count).toBeGreaterThanOrEqual(0);
    expect(body.data.chunk_count).toBeGreaterThanOrEqual(0);
  });

  it("reflects newly ingested sources", async () => {
    // Get baseline
    const before = await (await fetch(url("/stats"))).json();
    const beforeCount = before.data.source_count;

    // Add a source
    await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Stats Increment",
        content: "This document is used to verify that stats counts increment correctly.",
      }),
    });

    // Verify count increased
    const after = await (await fetch(url("/stats"))).json();
    expect(after.data.source_count).toBe(beforeCount + 1);
  });
});
