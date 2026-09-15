import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { chunkMarkdown } from "../lib/tools/rag-chunker.js";
import {
  ingestCanonicalSource,
  replaceSourceContent,
  searchChunks,
  deleteSource,
} from "../lib/tools/rag.js";

let tempDir: string;
let projectId: string;

const testMarkdown = `# Project Documentation

## Introduction

This project provides a robust RAG implementation for semantic search.

## Installation

Run npm install to get started with the project dependencies.

## Configuration

Set the DATABASE_URL environment variable for database configuration.

## Usage

Use the search API to query across your knowledge base.

## API Reference

The API provides endpoints for creating sources and searching chunks.`;

function getDbValue<T>(sql: string, ...params: any[]): T {
  return getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(sql).get(...params) as T;
}

const testChunks: Chunk[] = chunkMarkdown(testMarkdown);

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-rag-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  resetDbForTest();
  const project = createProject("test-rag-project");
  projectId = project.id;
});

afterAll(() => {
  resetDbForTest();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// Canonical source ingestion
// ============================================================

describe("ingestCanonicalSource", () => {
  it("creates a source record and searchable chunks", () => {
    const source = ingestCanonicalSource(projectId, "test-doc", testMarkdown, {
      sourcePath: "test-doc.md",
      metadata: { author: "test" },
    });
    expect(source).toBeDefined();
    expect(source.id).toBeTruthy();
    expect(source.title).toBe("test-doc");
    expect(source.project_id).toBe(projectId);
    expect(source.chunk_count).toBe(testChunks.length);
    expect(source.metadata).toBe(JSON.stringify({ author: "test" }));
    expect(searchChunks(projectId, "npm install")[0]?.source_id).toBe(source.id);
    expect(getDbValue<{ count: number }>(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rag_embeddings'",
    ).count).toBe(0);
  });
});

// ============================================================
// BM25 Search (uses unique query terms to avoid cross-contamination)
// ============================================================

describe("searchChunks", () => {
  beforeAll(() => {
    ingestCanonicalSource(projectId, "src-search", testMarkdown, { sourcePath: "src-search.md" });
  });

  it("returns BM25-ranked results for matching query", () => {
    const results = searchChunks(projectId, "npm install");
    expect(results.length).toBeGreaterThanOrEqual(1);

    const top = results[0] as any;
    expect(top.content.toLowerCase()).toContain("install");
  });

  it("ranks results by relevance", () => {
    const results = searchChunks(projectId, "database configuration");
    expect(results.length).toBeGreaterThan(0);

    const top = results[0] as any;
    expect(top.content.toLowerCase()).toContain("configuration");
  });

  it("returns empty array when no match", () => {
    const results = searchChunks(projectId, "xyznonexistentkeyword");
    expect(results).toEqual([]);
  });

  it("returns empty for empty query", () => {
    const results = searchChunks(projectId, "");
    expect(results).toEqual([]);
  });

  it("returns empty for whitespace-only query", () => {
    const results = searchChunks(projectId, "   ");
    expect(results).toEqual([]);
  });

  it("each result has required fields", () => {
    const results = searchChunks(projectId, "API");
    if (results.length > 0) {
      const r = results[0] as any;
      expect(r.id).toBeTruthy();
      expect(r.source_id).toBeTruthy();
      expect(r.content).toBeTruthy();
      expect(typeof r.rank).toBe("number");
      expect(typeof r.snippet).toBe("string");
    }
  });

  it("uses a total order for ranking ties, limits, and project isolation", () => {
    const first = ingestCanonicalSource(projectId, "Total order first", "totalorderneedle.", {
      sourcePath: "total-order-first.md",
    });
    const second = ingestCanonicalSource(projectId, "Total order second", "totalorderneedle!", {
      sourcePath: "total-order-second.md",
    });
    const isolatedProject = createProject("test-rag-total-order-isolated");
    const isolated = ingestCanonicalSource(isolatedProject.id, "Isolated order", "totalorderneedle?", {
      sourcePath: "total-order-isolated.md",
    });
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    db.prepare("UPDATE rag_sources SET updated_at = ? WHERE id IN (?, ?)")
      .run("2026-07-31T00:00:00.000Z", first.id, second.id);

    const expectedIds = (db.prepare(
      `SELECT chunk.id FROM rag_chunks chunk
       JOIN rag_sources source ON source.id = chunk.source_id
       WHERE source.id IN (?, ?)
       ORDER BY source.id ASC, chunk.chunk_index ASC, chunk.id ASC`,
    ).all(first.id, second.id) as Array<{ id: string }>).map((chunk) => chunk.id);
    const firstSearch = searchChunks(projectId, "totalorderneedle", 10, false);

    expect(firstSearch.map((result) => result.id)).toEqual(expectedIds);
    expect(new Set(firstSearch.map((result) => result.rank)).size).toBe(1);
    expect(searchChunks(projectId, "totalorderneedle", 10, false).map((result) => result.id)).toEqual(expectedIds);
    expect(searchChunks(projectId, "totalorderneedle", 1, false).map((result) => result.id)).toEqual(expectedIds.slice(0, 1));
    expect(firstSearch.map((result) => result.id)).not.toContain(isolated.id);
    expect(searchChunks(isolatedProject.id, "totalorderneedle", 10, false).map((result) => result.source_id)).toEqual([isolated.id]);
  });
});

// ============================================================
// Delete Source
// ============================================================

describe("deleteSource", () => {
  it("cascades to delete chunks", () => {
    const source = ingestCanonicalSource(projectId, "delete-test", testMarkdown, { sourcePath: "delete-test.md" });

    const beforeChunks = getDbValue<{ count: number }>(
      "SELECT count(*) as count FROM rag_chunks WHERE source_id = ?",
      source.id,
    );
    expect(beforeChunks.count).toBeGreaterThan(0);

    deleteSource(source.id);

    const afterChunks = getDbValue<{ count: number }>(
      "SELECT count(*) as count FROM rag_chunks WHERE source_id = ?",
      source.id,
    );
    expect(afterChunks.count).toBe(0);

    const afterSource = getDbValue<{ count: number }>(
      "SELECT count(*) as count FROM rag_sources WHERE id = ?",
      source.id,
    );
    expect(afterSource.count).toBe(0);
  });
});

// ============================================================
// Canonical replacement
// ============================================================

describe("replaceSourceContent", () => {
  it("replaces indexed chunks without changing the canonical source", () => {
    const source = ingestCanonicalSource(projectId, "replacement", "The violet lighthouse is indexed.", {
      sourcePath: "replacement.md",
    });

    expect(replaceSourceContent(source.id, "The amber beacon replaced the lighthouse.")).toBeGreaterThan(0);
    expect(searchChunks(projectId, "violet lighthouse")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source_id: source.id })]),
    );
    expect(searchChunks(projectId, "amber beacon")).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_id: source.id })]),
    );
  });
});
