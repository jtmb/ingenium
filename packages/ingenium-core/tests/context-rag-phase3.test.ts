import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createContext, deleteContext, getContextBatch, listContext, searchContext, updateContext } from "../lib/tools/context.js";
import { indexConfiguredDocs, ingestCanonicalSource, searchChunks } from "../lib/tools/rag.js";
import { getCatalogMap } from "../lib/tools/mcp-tool-catalog.js";

let directory: string;
let projectId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-phase3-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projectId = createProject("phase3-project").id;
});

afterEach(() => { resetDbForTest(); delete process.env.INGENIUM_CORE_DB_PATH; delete process.env.INGENIUM_DOCS_ROOT; rmSync(directory, { recursive: true, force: true }); });

describe("canonical context memory", () => {
  it("validates, pages, updates, batch reads, and deletes project-isolated memory", () => {
    const first = createContext(projectId, { content: "retain architecture decision", tags: ["architecture", "decision"], priority: 9, source: "agent", metadata: { ticket: "P3" } });
    const second = createContext(projectId, { content: "low priority note", priority: 1 });
    expect(() => createContext(projectId, { content: "bad", priority: 11 })).toThrow("priority");
    expect(() => createContext(projectId, { content: "bad source", source: "invalid" as any })).toThrow("source");
    expect(() => createContext(projectId, { content: "long session", sessionId: "a".repeat(129) })).toThrow("sessionId");
    expect(listContext(projectId, 1, 0)).toMatchObject({ total: 2, data: [{ id: first.id }] });
    expect(searchContext(projectId, "architecture")[0]?.id).toBe(first.id);
    expect(updateContext(projectId, first.id, { tags: ["updated"], priority: 10 })?.priority).toBe(10);
    expect(getContextBatch(projectId, [second.id, first.id]).map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(deleteContext(projectId, second.id)).toBe(true);
  });
});

describe("canonical source ingestion", () => {
  it("rolls back source metadata and chunk replacement together when chunk ingestion fails", () => {
    const original = ingestCanonicalSource(projectId, "Original title", "original atomic content", { sourcePath: "atomic.md", metadata: { version: 1 } });
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const originalChunkCount = (db.prepare("SELECT count(*) AS count FROM rag_chunks WHERE source_id = ?").get(original.id) as { count: number }).count;
    db.exec("CREATE TRIGGER fail_rag_chunk_insert BEFORE INSERT ON rag_chunks BEGIN SELECT RAISE(ABORT, 'forced chunk failure'); END");

    expect(() => ingestCanonicalSource(projectId, "Replacement title", "replacement atomic content", { sourcePath: "atomic.md", metadata: { version: 2 } })).toThrow("forced chunk failure");

    const persisted = db.prepare("SELECT title, metadata, chunk_count FROM rag_sources WHERE id = ?").get(original.id) as { title: string; metadata: string; chunk_count: number };
    const persistedChunkCount = (db.prepare("SELECT count(*) AS count FROM rag_chunks WHERE source_id = ?").get(original.id) as { count: number }).count;
    expect(persisted).toEqual({ title: "Original title", metadata: JSON.stringify({ version: 1 }), chunk_count: originalChunkCount });
    expect(persistedChunkCount).toBe(originalChunkCount);
  });
});

describe("configured repository docs indexing", () => {
  it("is hash-idempotent, removes stale files, and ignores symlink escapes", () => {
    const docs = join(directory, "repo", "docs");
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "guide.md"), "# Guide\n\nThe violet lighthouse is indexed.");
    writeFileSync(join(directory, "outside.md"), "This must never be indexed.");
    symlinkSync(join(directory, "outside.md"), join(docs, "escape.md"));
    process.env.INGENIUM_DOCS_ROOT = join(directory, "repo");
    const global = createProject("global-default", true);
    expect(indexConfiguredDocs(global.id)).toEqual({ indexed: 1, unchanged: 0, deleted: 0 });
    expect(indexConfiguredDocs(global.id)).toEqual({ indexed: 0, unchanged: 1, deleted: 0 });
    expect(searchChunks(projectId, "violet lighthouse", 10, true)[0]).toMatchObject({ source_type: "file", source_path: "docs/guide.md" });
    rmSync(join(docs, "guide.md"));
    expect(indexConfiguredDocs(global.id)).toEqual({ indexed: 0, unchanged: 0, deleted: 1 });
    expect((getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT count(*) AS c FROM rag_sources").get() as { c: number }).c).toBe(0);
  });
});

it("catalogues every Phase 3 context and RAG MCP transport contract", () => {
  const catalog = getCatalogMap();
  for (const name of ["ingenium_context_get", "ingenium_context_update", "ingenium_context_delete", "ingenium_context_batch_get", "ingenium_docs_search_semantic", "ingenium_docs_ask", "ingenium_docs_ingest", "ingenium_docs_rag_sources_list", "ingenium_docs_rag_source_get", "ingenium_docs_rag_source_delete", "ingenium_docs_rag_reingest", "ingenium_docs_rag_stats"]) {
    expect(catalog.get(name)?.defaultEnabled).toBe(true);
  }
});
