import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
  getSession: vi.fn(),
  getMessages: vi.fn(),
}));

vi.mock("../lib/opencode-client.js", () => ({
  executeSynthesisBroker: mocks.executeSynthesisBroker,
  isOpenCodeError: (result: unknown) => Boolean(result && typeof result === "object" && "error" in result),
  opencodeClient: {
    getSession: mocks.getSession,
    getMessages: mocks.getMessages,
  },
}));

import { observations, projects, resetDbForTest } from "ingenium-core";
import { contextRouter } from "../lib/routes/context.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-context-rag-api-"));
const databasePath = join(directory, "data.db");
const projectName = "context-rag-api";
const secondProjectName = "context-rag-api-other";
let server: Server;
let baseUrl: string;

function url(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/context${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

function textMessage(
  sessionId: string,
  messageId: string,
  role: "user" | "assistant",
  created: number,
  text: string,
) {
  return {
    info: { id: messageId, sessionID: sessionId, role, time: { created } },
    parts: [{ id: `${messageId}-text`, sessionID: sessionId, messageID: messageId, type: "text", text }],
  };
}

async function uploadTotal(): Promise<number> {
  const response = await fetch(url("/uploads"));
  expect(response.status).toBe(200);
  return (await response.json()).total as number;
}

async function importOpenCodeSession(body: Record<string, unknown>) {
  return fetch(url("/imports/opencode-session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  projects.createProject(projectName);
  projects.createProject(secondProjectName);
  mocks.executeSynthesisBroker.mockResolvedValue({ ok: true, content: "The imported source requires an immutable handoff. [1]" });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/context", contextRouter);
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

    const repeated = await fetch(url("/uploads"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Different title", content: "The violet lighthouse handoff needs a source attribution." }),
    });
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data).toMatchObject({ source: { id: sourceId }, deduplicated: true });

    const search = await fetch(url("/rag/search?q=violet%20lighthouse"));
    expect(search.status).toBe(200);
    expect((await search.json()).data).toMatchObject([
      { sourceId, provenance: "direct_upload", snippet: expect.any(String) },
    ]);
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
      { sourceId, provenance: "direct_upload", sourceHash: directBody.data.source.sourceHash },
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
      }),
    });
    expect(chunked.status).toBe(201);
    const uploadId = (await chunked.json()).data.session.id as string;
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
    expect((await completed.json()).data).toMatchObject({ upload: { provenance: "chunked_upload" } });
  });

  it("imports a safely project-bound OpenCode session without logging or exposing raw text in list responses", async () => {
    const sessionId = "session-ctx-003";
    const directory = "/workspaces/context-rag-api";
    mocks.getSession.mockResolvedValue({ id: sessionId, directory, title: "Imported session" });
    mocks.getMessages.mockResolvedValue([
      textMessage(sessionId, "msg-user", "user", 1_700_000_000_000, "The bronze observatory needs durable context."),
      textMessage(sessionId, "msg-assistant", "assistant", 1_700_000_010_000, "I will retain a source citation."),
    ]);
    const imported = await importOpenCodeSession({ sessionId, directory, title: "Imported OpenCode session" });
    expect(imported.status).toBe(201);
    const importedBody = await imported.json();
    expect(importedBody.data).toMatchObject({
      upload: { provenance: "opencode_session", sourceReference: `opencode-session:${sessionId}` },
      importedMessages: 2,
    });
    expect(JSON.stringify(importedBody)).not.toContain("bronze observatory");
    expect(mocks.getMessages).toHaveBeenCalledWith(sessionId, 100, undefined, directory);

    const listed = await fetch(url("/uploads"));
    const listedBody = await listed.json();
    expect(JSON.stringify(listedBody)).not.toContain("bronze observatory");

    const unsafe = await importOpenCodeSession({ sessionId, directory: "/workspaces/not-this-project" });
    expect(unsafe.status).toBe(422);
  });

  it("rejects hostile session imports before RAG writes and never reflects untrusted data", async () => {
    const directory = "/workspaces/context-rag-api";
    const before = await uploadTotal();

    mocks.getSession.mockClear();
    const dotAlias = await importOpenCodeSession({ sessionId: "session-dot-alias", directory: "/workspaces/context-rag-api/./" });
    expect(dotAlias.status).toBe(422);
    expect(mocks.getSession).not.toHaveBeenCalled();

    const ownershipId = "session-ownership-mismatch";
    mocks.getSession.mockResolvedValue({ id: ownershipId, directory: "/workspaces/not-context-rag-api" });
    mocks.getMessages.mockClear();
    const ownership = await importOpenCodeSession({ sessionId: ownershipId, directory });
    expect(ownership.status).toBe(409);
    expect(mocks.getMessages).not.toHaveBeenCalled();

    const hostileCases: Array<{ label: string; messages: unknown[] }> = [
      {
        label: "cross-session envelope",
        messages: [{ ...textMessage("other-session", "msg-other-session", "user", 1_700_000_000_000, "must not persist"), info: { ...textMessage("other-session", "msg-other-session", "user", 1_700_000_000_000, "must not persist").info, sessionID: "other-session" } }],
      },
      {
        label: "cross-message part",
        messages: [{ ...textMessage("session-placeholder", "msg-cross-message", "user", 1_700_000_000_000, "must not persist"), parts: [{ ...textMessage("session-placeholder", "msg-cross-message", "user", 1_700_000_000_000, "must not persist").parts[0], messageID: "different-message" }] }],
      },
      {
        label: "synthetic text",
        messages: [{ ...textMessage("session-placeholder", "msg-synthetic", "user", 1_700_000_000_000, "must not persist"), parts: [{ ...textMessage("session-placeholder", "msg-synthetic", "user", 1_700_000_000_000, "must not persist").parts[0], synthetic: true }] }],
      },
      {
        label: "ignored text",
        messages: [{ ...textMessage("session-placeholder", "msg-ignored", "user", 1_700_000_000_000, "must not persist"), parts: [{ ...textMessage("session-placeholder", "msg-ignored", "user", 1_700_000_000_000, "must not persist").parts[0], ignored: true }] }],
      },
      {
        label: "non-finite timestamp",
        messages: [textMessage("session-placeholder", "msg-nonfinite", "user", Number.POSITIVE_INFINITY, "must not persist")],
      },
      {
        label: "out-of-order timestamp",
        messages: [
          textMessage("session-placeholder", "msg-later", "user", 1_700_000_000_001, "must not persist"),
          textMessage("session-placeholder", "msg-earlier", "assistant", 1_700_000_000_000, "must not persist"),
        ],
      },
      {
        label: "oversized text part",
        messages: [textMessage("session-placeholder", "msg-oversized", "user", 1_700_000_000_000, "x".repeat(65_537))],
      },
      {
        label: "too many parts",
        messages: [{
          ...textMessage("session-placeholder", "msg-many-parts", "user", 1_700_000_000_000, "must not persist"),
          parts: Array.from({ length: 257 }, (_, index) => ({
            id: `part-${index}`,
            sessionID: "session-placeholder",
            messageID: "msg-many-parts",
            type: "text",
            text: "x",
          })),
        }],
      },
      {
        label: "aggregate text limit",
        messages: [{
          ...textMessage("session-placeholder", "msg-aggregate", "user", 1_700_000_000_000, "must not persist"),
          parts: Array.from({ length: 17 }, (_, index) => ({
            id: `aggregate-part-${index}`,
            sessionID: "session-placeholder",
            messageID: "msg-aggregate",
            type: "text",
            text: "x".repeat(65_536),
          })),
        }],
      },
    ];
    for (const type of ["reasoning", "tool", "file", "step-start", "step-finish"]) {
      hostileCases.push({
        label: `${type} part`,
        messages: [{
          ...textMessage("session-placeholder", `msg-${type}`, "user", 1_700_000_000_000, "must not persist"),
          parts: [{ id: `part-${type}`, sessionID: "session-placeholder", messageID: `msg-${type}`, type, text: "must not persist" }],
        }],
      });
    }

    for (const [index, hostile] of hostileCases.entries()) {
      const sessionId = `session-hostile-${index}`;
      mocks.getSession.mockResolvedValue({ id: sessionId, directory });
      mocks.getMessages.mockResolvedValue(hostile.messages.map((message) => JSON.parse(JSON.stringify(message).replaceAll("session-placeholder", sessionId))));
      const response = await importOpenCodeSession({ sessionId, directory });
      expect(response.status, hostile.label).toBe(422);
      expect(JSON.stringify(await response.json()), hostile.label).not.toContain("must not persist");
    }
    expect(await uploadTotal()).toBe(before);
  });

  it("deduplicates validated OpenCode session replays by content hash", async () => {
    const sessionId = "session-replay-safe";
    const directory = "/workspaces/context-rag-api";
    mocks.getSession.mockResolvedValue({ id: sessionId, directory });
    mocks.getMessages.mockResolvedValue([
      textMessage(sessionId, "msg-replay-user", "user", 1_700_100_000_000, "The replay-safe source has stable text."),
      textMessage(sessionId, "msg-replay-assistant", "assistant", 1_700_100_001_000, "It should retain one canonical RAG upload."),
    ]);
    const before = await uploadTotal();
    const first = await importOpenCodeSession({ sessionId, directory, title: "First replay title" });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const replay = await importOpenCodeSession({ sessionId, directory, title: "Second replay title" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toMatchObject({
      deduplicated: true,
      source: { id: firstBody.data.source.id },
      upload: { contentHash: firstBody.data.upload.contentHash },
    });
    expect(await uploadTotal()).toBe(before + 1);
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
});
