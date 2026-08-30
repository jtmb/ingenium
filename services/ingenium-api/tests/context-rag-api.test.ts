import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
}));

vi.mock("../lib/opencode-client.js", () => ({
  executeSynthesisBroker: mocks.executeSynthesisBroker,
}));

import { getDb, observations, projects, resetDbForTest } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-context-rag-api-"));
const databasePath = join(directory, "data.db");
const projectName = "context-rag-api";
const secondProjectName = "context-rag-api-other";
let server: Server;
let baseUrl: string;

function url(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/context${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  projects.createProject(projectName);
  projects.createProject(secondProjectName);
  mocks.executeSynthesisBroker.mockResolvedValue({ ok: true, content: "The current source requires an immutable handoff. [1]" });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/projects", projectsRouter);
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

describe("context RAG API", () => {
  it("ingests direct and chunked context documents, serves scoped citations, and preserves checkpoint history", async () => {
    const direct = await fetch(url("/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fresh handoff",
        content: "The violet lighthouse handoff needs a source attribution.",
        mimeType: "text/markdown",
        metadata: { ticket: "CTX-003" },
      }),
    });
    expect(direct.status).toBe(201);
    const directBody = await direct.json();
    const sourceId = directBody.data.source.id as string;
    expect(directBody.data).toMatchObject({
      upload: { provenance: "direct_upload" },
      source: { sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), chunkCount: expect.any(Number) },
      deduplicated: false,
    });

    const createdSource = await fetch(url("/sources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Source workspace entry",
        content: "## First\nSaffron observatory keeps source metadata intact.\n\n## Second\nSaffron observatory is indexed separately.",
        mimeType: "text/markdown",
        priority: 8,
        tags: ["ctx-100", "ctx-100"],
        metadata: { ticket: "CTX-100" },
        sourceReference: "work-item:CTX-100",
      }),
    });
    expect(createdSource.status).toBe(201);
    const createdSourceBody = await createdSource.json();
    const createdSourceId = createdSourceBody.data.id as string;
    expect(createdSourceBody.data).toMatchObject({
      id: createdSourceId,
      provenance: "direct_upload",
      sourceReference: "work-item:CTX-100",
      priority: 8,
      tags: ["ctx-100"],
      metadata: { ticket: "CTX-100" },
    });
    expect(createdSourceBody.data).not.toHaveProperty("content");

    const foreignSource = await fetch(url("/sources", secondProjectName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Foreign source", content: "This belongs to another project." }),
    });
    expect(foreignSource.status).toBe(201);
    const foreignSourceId = (await foreignSource.json()).data.id as string;

    const summaryPage = await fetch(url("/sources/summary?limit=1&offset=0"));
    expect(summaryPage.status).toBe(200);
    const summaryBody = await summaryPage.json();
    expect(summaryBody).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(summaryBody.data).toHaveLength(1);
    expect(Object.keys(summaryBody.data[0]).sort()).toEqual(["createdAt", "id", "provenance", "title"]);
    expect(summaryBody.data[0]).not.toHaveProperty("metadata");
    expect(summaryBody.data[0]).not.toHaveProperty("tags");
    expect(summaryBody.data[0]).not.toHaveProperty("priority");
    expect(summaryBody.data[0]).not.toHaveProperty("sourceReference");
    expect(summaryBody.data[0]).not.toHaveProperty("sourceHash");
    expect(summaryBody.data[0]).not.toHaveProperty("sourcePath");
    expect(summaryBody.data[0]).not.toHaveProperty("content");
    expect(summaryBody.data[0].provenance).toBe("direct_upload");
    expect(summaryBody.data[0].id).not.toBe(foreignSourceId);

    const secondSummaryPage = await fetch(url("/sources/summary?limit=1&offset=1"));
    expect(secondSummaryPage.status).toBe(200);
    const secondSummaryBody = await secondSummaryPage.json();
    expect(secondSummaryBody).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(secondSummaryBody.data).toHaveLength(1);
    expect(secondSummaryBody.data[0].id).not.toBe(summaryBody.data[0].id);

    const foreignSummary = await fetch(url("/sources/summary", secondProjectName));
    expect(foreignSummary.status).toBe(200);
    expect((await foreignSummary.json()).data).toEqual([
      expect.objectContaining({ id: foreignSourceId, title: "Foreign source" }),
    ]);

    const listedSources = await fetch(url("/sources"));
    expect(listedSources.status).toBe(200);
    expect((await listedSources.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdSourceId, sourceReference: "work-item:CTX-100" }),
    ]));

    const readSource = await fetch(url(`/sources/${createdSourceId}`));
    expect(readSource.status).toBe(200);
    const readSourceBody = await readSource.json();
    expect(readSourceBody.data).toMatchObject({
      id: createdSourceId,
      provenance: "direct_upload",
      sourceReference: "work-item:CTX-100",
      tags: ["ctx-100"],
      priority: 8,
      metadata: { ticket: "CTX-100" },
    });
    expect(readSourceBody.data).not.toHaveProperty("content");

    const sourceSearch = await fetch(url("/sources/search?q=saffron%20observatory"));
    expect(sourceSearch.status).toBe(200);
    const sourceSearchBody = await sourceSearch.json();
    expect(sourceSearchBody.data).toHaveLength(1);
    expect(sourceSearchBody.data).toMatchObject([
      {
        id: createdSourceId,
        provenance: "direct_upload",
        sourceReference: "work-item:CTX-100",
        tags: ["ctx-100"],
        priority: 8,
        metadata: { ticket: "CTX-100" },
      },
    ]);
    for (const field of ["snippet", "heading", "content", "sourcePath", "chunkIndex"]) {
      expect(sourceSearchBody.data[0]).not.toHaveProperty(field);
    }

    for (const path of [
      url(`/sources/${createdSourceId}`, secondProjectName),
      url("/sources/not-a-context-source"),
    ]) {
      const absent = await fetch(path);
      expect(absent.status).toBe(404);
      expect((await absent.json()).error.code).toBe("CONTEXT_SOURCE_NOT_FOUND");
    }

    const repeated = await fetch(url("/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Different title", content: "The violet lighthouse handoff needs a source attribution." }),
    });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data).toMatchObject({ source: { id: sourceId }, deduplicated: true });

    const search = await fetch(url("/rag/search?q=violet%20lighthouse"));
    expect(search.status).toBe(200);
    const expectedCitationId = (getDb(databasePath).prepare(
      "SELECT id FROM rag_chunks WHERE source_id = ? ORDER BY chunk_index ASC, id ASC LIMIT 1",
    ).get(sourceId) as { id: string }).id;
    const searchBody = await search.json();
    expect(searchBody.data).toMatchObject([
      {
        citationId: expectedCitationId,
        sourceId,
        sourceHash: directBody.data.source.sourceHash,
        chunkIndex: 0,
        availability: "available",
        provenance: "direct_upload",
        snippet: expect.any(String),
      },
    ]);
    const repeatedSearch = await fetch(url("/rag/search?q=violet%20lighthouse"));
    expect((await repeatedSearch.json()).data.map((citation: { citationId: string }) => citation.citationId))
      .toEqual(searchBody.data.map((citation: { citationId: string }) => citation.citationId));
    const crossProject = await fetch(url("/rag/search?q=violet%20lighthouse", secondProjectName));
    expect((await crossProject.json()).data).toEqual([]);

    const ask = await fetch(url("/rag/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What does the handoff need?" }),
    });
    expect(ask.status).toBe(200);
    expect((await ask.json()).data).toMatchObject({
      answer: expect.stringContaining("immutable handoff"),
      citations: [{ sourceId, provenance: "direct_upload" }],
    });

    const conversation = await fetch(url("/conversations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "RAG checkpoint" }),
    });
    const conversationId = (await conversation.json()).data.id as string;
    const message = await fetch(url(`/conversations/${conversationId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "Freeze this handoff source.", expectedRevision: 0 }),
    });
    expect(message.status).toBe(201);
    const checkpointResponse = await fetch(url(`/conversations/${conversationId}/checkpoints`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 1, ragSourceIds: [sourceId] }),
    });
    const checkpointId = (await checkpointResponse.json()).data.checkpoint.id as string;
    const historical = await fetch(url(`/conversations/${conversationId}/checkpoints/${checkpointId}/rag/search?q=violet%20lighthouse`));
    expect(historical.status).toBe(200);
    expect((await historical.json()).data).toMatchObject([
      {
        citationId: expectedCitationId,
        sourceId,
        provenance: "direct_upload",
        sourceHash: directBody.data.source.sourceHash,
        chunkIndex: 0,
        availability: "available",
      },
    ]);

    const content = "Chunk alpha.\n\nChunk beta contains the copper observatory.";
    const split = content.indexOf("\n\n") + 2;
    const chunked = await fetch(url("/uploads/chunked"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "context-rag-api-chunked" },
      body: JSON.stringify({
        title: "Chunked document",
        expectedHash: createHash("sha256").update(content).digest("hex"),
        expectedBytes: Buffer.byteLength(content, "utf8"),
        chunkCount: 2,
        mimeType: "text/plain",
        priority: 7,
        tags: ["chunked"],
        metadata: { ticket: "CTX-100" },
        sourceReference: "upload:chunked-api",
      }),
    });
    expect(chunked.status).toBe(201);
    const chunkedBody = await chunked.json();
    expect(chunkedBody.data.session.sourceReference).toBe("upload:chunked-api");
    const uploadId = chunkedBody.data.session.id as string;
    for (const [ordinal, chunk] of [content.slice(0, split), content.slice(split)].entries()) {
      const appended = await fetch(url(`/uploads/${uploadId}/chunks`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordinal, content: chunk }),
      });
      expect(appended.status).toBe(201);
    }
    const completed = await fetch(url(`/uploads/${uploadId}/complete`), { method: "POST" });
    expect(completed.status).toBe(200);
    const completedBody = await completed.json();
    expect(completedBody.data).toMatchObject({
      upload: { provenance: "chunked_upload", sourceReference: "upload:chunked-api" },
      source: {
        provenance: "chunked_upload",
        sourceReference: "upload:chunked-api",
        priority: 7,
        tags: ["chunked"],
        metadata: { ticket: "CTX-100" },
      },
    });
  });

  it("rejects unsafe, unsupported, oversized, and malformed source uploads", async () => {
    const valid = { title: "Rejected source", content: "bounded content" };
    const secretCanary = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    for (const [body, status] of [
      [{ ...valid, path: "/tmp/context.md" }, 422],
      [{ ...valid, file: "context.md" }, 422],
      [{ ...valid, sourcePath: "docs/context.md" }, 422],
      [{ ...valid, filePath: "docs/context.md" }, 422],
      [{ ...valid, mimeType: "application/pdf" }, 422],
      [{ ...valid, metadata: [] }, 422],
      [{ ...valid, metadata: { nested: { filePath: "docs/context.md" } } }, 422],
      [{ ...valid, metadata: { nested: [{ apiKey: "redacted" }] } }, 422],
      [{ ...valid, metadata: { credentials: "redacted" } }, 422],
      [{ ...valid, sourceReference: "folder/context.md" }, 422],
      [{ ...valid, sourceReference: "token:redacted" }, 422],
      [{ ...valid, sourceReference: "apiKey:redacted" }, 422],
      [{ ...valid, metadata: { note: secretCanary } }, 422],
      [{ ...valid, sourceReference: secretCanary }, 422],
      [{ ...valid, content: "x".repeat(1_048_577) }, 413],
    ] as const) {
      const response = await fetch(url("/sources"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(status);
    }

    const chunked = await fetch(url("/uploads/chunked"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Rejected chunked source",
        expectedHash: createHash("sha256").update("bounded content").digest("hex"),
        expectedBytes: Buffer.byteLength("bounded content", "utf8"),
        chunkCount: 1,
        source_path: "docs/context.md",
      }),
    });
    expect(chunked.status).toBe(422);
  });

  it("normalizes source and upload list pagination before SQLite", async () => {
    const infinite = await fetch(url("/uploads?limit=Infinity&offset=Infinity"));
    expect(infinite.status).toBe(200);
    expect(await infinite.json()).toMatchObject({ limit: 20, offset: 0 });

    const fractional = await fetch(url("/sources?limit=2.8&offset=1.8"));
    expect(fractional.status).toBe(200);
    expect(await fractional.json()).toMatchObject({ limit: 2, offset: 1 });

    const negative = await fetch(url("/sources?limit=-3&offset=-2"));
    expect(negative.status).toBe(200);
    expect(await negative.json()).toMatchObject({ limit: 1, offset: 0 });
  });

  it("reports timestamped current learning and creates a project-scoped explicit learning snapshot", async () => {
    const project = projects.getProject(projectName)!;
    observations.storeObservation(project.id, "preference", "User prefers cited, current context.", 8, "import");
    const current = await fetch(url("/learning/current"));
    expect(current.status).toBe(200);
    expect((await current.json()).data).toMatchObject({
      observations: [{ content: "User prefers cited, current context.", source: "import" }],
      latestInputAt: expect.any(String),
    });
    const ingested = await fetch(url("/learning/ingest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Latest learning" }),
    });
    expect(ingested.status).toBe(201);
    expect((await ingested.json()).data).toMatchObject({
      noOp: false,
      upload: { provenance: "learning_snapshot" },
    });
    const other = await fetch(url("/learning/ingest", secondProjectName), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect((await other.json()).data).toMatchObject({ noOp: true, reason: "NO_CURRENT_LEARNING" });
  });

  it("rejects Context RAG after its validated project is archived without returning source content", async () => {
    const archivedProject = "context-rag-archived";
    projects.createProject(archivedProject);
    const sourceContent = "archive-race context content must never be returned";
    const uploaded = await fetch(url("/uploads", archivedProject), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Archive race", content: sourceContent }),
    });
    expect(uploaded.status).toBe(201);

    const beforeArchive = await fetch(url("/rag/search?q=archive-race", archivedProject));
    expect(beforeArchive.status).toBe(200);
    expect((await beforeArchive.json()).data).toHaveLength(1);

    const archived = await fetch(`${baseUrl}/api/v1/projects/${encodeURIComponent(archivedProject)}`, {
      method: "DELETE",
    });
    expect(archived.status).toBe(200);

    const afterArchive = await fetch(url("/rag/search?q=archive-race", archivedProject));
    expect(afterArchive.status).toBe(404);
    const body = await afterArchive.json();
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(body).not.toHaveProperty("data");
    expect(JSON.stringify(body)).not.toContain(sourceContent);
  });
});
