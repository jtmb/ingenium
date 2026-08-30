import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";
import { ragRouter } from "../lib/routes/rag.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-rag-api-"));
const databasePath = join(directory, "data.db");
const projectName = "rag-api-test";
const otherProjectName = "rag-api-test-other";
let server: Server;
let baseUrl: string;
let sourceId: string;

function url(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/rag${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

function contextUrl(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/context${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  projects.createProject(projectName);
  projects.createProject(otherProjectName);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/rag", ragRouter);
  app.use("/api/v1/context", contextRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("RAG source CRUD", () => {
  it("creates, lists, re-ingests, searches, exports, and deletes generic sources", async () => {
    const created = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Generic RAG source",
        sourceType: "file",
        text: "The violet lighthouse is indexed for generic RAG search.",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    sourceId = createdBody.data.id;
    expect(createdBody.data.source_type).toBe("file");
    expect(createdBody.data.chunk_count).toBeGreaterThan(0);

    const stats = await fetch(url("/stats"));
    expect(stats.status).toBe(200);
    const statsBody = await stats.json();
    expect(statsBody).toEqual({
      data: expect.objectContaining({ total_sources: 1, total_chunks: expect.any(Number) }),
    });
    expect(statsBody.data).not.toHaveProperty("total_embeddings");
    expect(statsBody.data).not.toHaveProperty("vector_capability");

    const listed = await fetch(url("/sources"));
    expect(listed.status).toBe(200);
    expect((await listed.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceId, source_type: "file" }),
    ]));

    const reingested = await fetch(url(`/sources/${sourceId}/ingest`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "The amber beacon replaced the lighthouse.", format: "url" }),
    });
    expect(reingested.status).toBe(200);
    expect((await reingested.json()).data.source_type).toBe("url");

    const searched = await fetch(url("/search?q=amber beacon"));
    expect(searched.status).toBe(200);
    expect((await searched.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: sourceId }),
    ]));

    const exported = await fetch(url("/export"), { method: "POST" });
    expect(exported.status).toBe(200);
    expect((await exported.json()).data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceId, source_type: "url" }),
    ]));

    const deleted = await fetch(url(`/sources/${sourceId}`), { method: "DELETE" });
    expect(deleted.status).toBe(204);
  });

  it("rejects generic mutation of immutable Context sources without changing their citation", async () => {
    const created = await fetch(contextUrl("/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Immutable Context source",
        content: "The immutable citation remains reproducible.",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const immutableSourceId = createdBody.data.source.id as string;

    const citationResponse = await fetch(contextUrl("/rag/search?q=immutable%20citation"));
    const citation = (await citationResponse.json()).data[0];
    expect(citation).toMatchObject({
      sourceId: immutableSourceId,
      citationId: expect.any(String),
      sourceHash: expect.any(String),
      chunkIndex: 0,
      availability: "available",
    });
    const beforeSource = (await (await fetch(url(`/sources/${immutableSourceId}`))).json()).data;

    for (const response of [
      await fetch(url(`/sources/${immutableSourceId}`), { method: "DELETE" }),
      await fetch(url(`/sources/${immutableSourceId}/ingest`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "This replacement must be rejected.", format: "url" }),
      }),
    ]) {
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("RAG_SOURCE_IMMUTABLE");
    }

    const afterSource = (await (await fetch(url(`/sources/${immutableSourceId}`))).json()).data;
    expect(afterSource).toMatchObject({
      source_hash: beforeSource.source_hash,
      chunk_count: beforeSource.chunk_count,
      updated_at: beforeSource.updated_at,
    });
    const repeatedCitation = (await (await fetch(contextUrl("/rag/search?q=immutable%20citation"))).json()).data[0];
    expect(repeatedCitation).toMatchObject({
      citationId: citation.citationId,
      sourceHash: citation.sourceHash,
      chunkIndex: citation.chunkIndex,
      availability: "available",
    });

    const foreign = await fetch(url("/sources", otherProjectName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Foreign source", text: "Foreign source remains absent." }),
    });
    const foreignId = (await foreign.json()).data.id as string;
    for (const response of [
      await fetch(url(`/sources/${foreignId}`, projectName), { method: "DELETE" }),
      await fetch(url(`/sources/${foreignId}/ingest`, projectName), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Absent source must stay neutral." }),
      }),
    ]) {
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("NOT_FOUND");
    }
  });
});
