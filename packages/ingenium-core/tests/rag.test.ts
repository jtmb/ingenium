import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { chunkMarkdown } from "../lib/tools/rag-chunker.js";
import type { Chunk } from "../lib/tools/rag-chunker.js";
import {
  createSource,
  ingestChunks,
  searchChunks,
  deleteSource,
  ingestSource,
  generateEmbedding,
  cosineSimilarity,
  hybridSearch,
  updateChunkEmbedding,
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
// Source CRUD
// ============================================================

describe("createSource", () => {
  it("creates a source record", () => {
    const source = createSource(projectId, "test-doc");
    expect(source).toBeDefined();
    expect(source.id).toBeTruthy();
    expect(source.name).toBe("test-doc");
    expect(source.project_id).toBe(projectId);
    expect(source.chunk_count).toBe(0);
  });

  it("returns a source with custom metadata", () => {
    const source = createSource(projectId, "meta-doc", '{"author": "test"}');
    expect(source.metadata).toBe('{"author": "test"}');
  });
});

// ============================================================
// Chunk Ingestion
// ============================================================

describe("ingestChunks", () => {
  it("stores chunks and updates chunk count", () => {
    const source = createSource(projectId, "ingest-test");
    const count = ingestChunks(source.id, testChunks);
    expect(count).toBe(testChunks.length);

    const updated = getDbValue<{ chunk_count: number }>(
      "SELECT chunk_count FROM rag_sources WHERE id = ?",
      source.id,
    );
    expect(updated.chunk_count).toBe(testChunks.length);
  });
});

// ============================================================
// BM25 Search (uses unique query terms to avoid cross-contamination)
// ============================================================

describe("searchChunks", () => {
  beforeAll(() => {
    const src = createSource(projectId, "src-search");
    ingestChunks(src.id, testChunks);
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
});

// ============================================================
// Delete Source
// ============================================================

describe("deleteSource", () => {
  it("cascades to delete chunks", () => {
    const source = createSource(projectId, "delete-test");
    ingestChunks(source.id, testChunks);

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
// Ingest Source (pipeline)
// ============================================================

describe("ingestSource", () => {
  it("creates source and ingests chunks in one call", () => {
    const source = ingestSource(projectId, "pipeline-test", testMarkdown);
    expect(source.chunk_count).toBe(testChunks.length);

    const results = searchChunks(projectId, "robust RAG implementation");
    expect(results.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Embedding Generation (no DB needed)
// ============================================================

describe("generateEmbedding", () => {
  it("produces a 384-dimensional vector", () => {
    const vec = generateEmbedding("test text");
    expect(vec.length).toBe(384);
  });

  it("produces consistent results for the same text", () => {
    const a = generateEmbedding("hello world");
    const b = generateEmbedding("hello world");
    expect(a).toEqual(b);
  });

  it("produces different vectors for different text", () => {
    const a = generateEmbedding("hello world");
    const b = generateEmbedding("goodbye world");
    const isDifferent = a.some((v, i) => v !== b[i]);
    expect(isDifferent).toBe(true);
  });

  it("produces a unit vector (normalized)", () => {
    const vec = generateEmbedding("test");
    let sumSq = 0;
    for (const v of vec) sumSq += v * v;
    expect(Math.abs(sumSq - 1)).toBeLessThan(0.01);
  });

  it("handles empty text", () => {
    const vec = generateEmbedding("");
    expect(vec.length).toBe(384);
    vec.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
});

// ============================================================
// Cosine Similarity (no DB needed)
// ============================================================

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const vec = [1, 0, 0];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("handles zero vectors", () => {
    const a = [0, 0];
    const b = [1, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles vectors of different lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

// ============================================================
// Hybrid Search
// ============================================================

describe("hybridSearch", () => {
  it("creates and uses embeddings during ingestion", () => {
    const src = createSource(projectId, "hybrid-no-emb");
    ingestChunks(src.id, testChunks);

    const results = hybridSearch(projectId, "database configuration");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.vector_score > 0)).toBe(true);
  });

  it("fuses FTS and vector results", () => {
    const source = createSource(projectId, "hybrid-fts-vec");
    // Use unique content so this source's chunks are the only matches
    const uniqueContent = `# Hybrid Test Doc\n\n## RAG Fusion\n\nRAG fusion XKCD unique content that appears nowhere else in this test suite.`;
    const uniqueChunks = chunkMarkdown(uniqueContent);
    ingestChunks(source.id, uniqueChunks);

    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const chunks = db.prepare(
      "SELECT chunk_index, content FROM rag_chunks WHERE source_id = ?",
    ).all(source.id) as Array<{ chunk_index: number; content: string }>;

    for (const c of chunks) {
      const emb = generateEmbedding(c.content);
      updateChunkEmbedding(c.chunk_index, emb, source.id);
    }

    const results = hybridSearch(projectId, "XKCD");
    expect(results.length).toBeGreaterThan(0);

    const top = results[0]!;
    expect(top.chunk_id).toBeGreaterThanOrEqual(0);
    expect(top.combined_score).toBeGreaterThan(0);
    expect(top.fts_score).toBeGreaterThan(0);
    // Vector score is clamped to [0, 1]
    expect(top.vector_score).toBeGreaterThanOrEqual(0);
    expect(top.rank).toBe(1);
  });

  it("returns results sorted by combined score descending", () => {
    const src = createSource(projectId, "hybrid-sorted");
    // Multi-section content so we get multiple results
    const multiContent = `# Sorted Doc\n\n## Alpha\n\nAlpha content about API endpoints and references.\n\n## Beta\n\nBeta content also mentions API reference documentation.\n\n## Gamma\n\nGamma content with more API reference details.`;
    ingestChunks(src.id, chunkMarkdown(multiContent));

    const results = hybridSearch(projectId, "API reference");
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.combined_score).toBeLessThanOrEqual(results[i - 1]!.combined_score);
      }
    }
  });

  it("returns empty for empty query", () => {
    const results = hybridSearch(projectId, "");
    expect(results).toEqual([]);
  });
});
