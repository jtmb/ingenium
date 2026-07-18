import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest } from "ingenium-core";
import { ragRouter } from "../lib/routes/rag.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-rag-api-"));
const databasePath = join(directory, "data.db");
const projectName = "rag-api-test";
let server: Server;
let baseUrl: string;
let sourceId: string;

function url(path: string): string {
  return `${baseUrl}/api/v1/rag${path}${path.includes("?") ? "&" : "?"}project=${projectName}`;
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  projects.createProject(projectName);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/rag", ragRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

  it("imports canonical JSONL idempotently without dropping legacy entry fields", async () => {
    const text = [
      JSON.stringify({ kind: "legacy_thread_manifest", marker: "legacy-thread-session-42", entryCount: 1 }),
      JSON.stringify({
        kind: "legacy_thread_entry",
        entry: {
          id: 99,
          session_id: 42,
          content: "The copper observatory preserves this entry.",
          priority: 8,
          tags: "archive,test",
          created_at: "2024-01-02T03:04:05Z",
          updated_at: "2024-02-03T04:05:06Z",
        },
      }),
    ].join("\n") + "\n";
    const expectedHash = createHash("sha256").update(text).digest("hex");
    const body = {
      title: "Thread: canonical test",
      text,
      sourcePath: "import:legacy-thread/session/42",
      expectedHash,
      mimeType: "application/x-ndjson",
      priority: 7,
      tags: ["legacy-thread", "thread-session-42"],
      metadata: { kind: "legacy_thread_session", entryCount: 1 },
    };

    const imported = await fetch(url("/sources/canonical"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(imported.status).toBe(200);
    const first = (await imported.json()).data;
    expect(first.source_hash).toBe(expectedHash);
    expect(first.mime_type).toBe("application/x-ndjson");
    expect(first.chunk_count).toBe(2);

    const repeated = await fetch(url("/sources/canonical"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data.id).toBe(first.id);

    const searched = await fetch(url("/search?q=copper observatory"));
    expect(searched.status).toBe(200);
    const chunk = (await searched.json()).data.find((result: { source_id: string }) => result.source_id === first.id);
    expect(chunk.content).toContain('"id":99');
    expect(chunk.content).toContain('"priority":8');
    expect(chunk.content).toContain('"created_at":"2024-01-02T03:04:05Z"');

    const mismatch = await fetch(url("/sources/canonical"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expectedHash: "0".repeat(64) }),
    });
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).error.code).toBe("HASH_MISMATCH");
  });
});
