import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, logger, resetDbForTest } from "ingenium-core";
import { appendContextMessage, createContextConversation } from "ingenium-core/lib/tools/context-conversations";
import { calculateContextConversationSnapshotHash } from "ingenium-core/lib/tools/context-snapshot-import";
import { projects } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import {
  CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE,
  CONTEXT_SNAPSHOT_INGEST_PATH,
  contextSnapshotIngestRouter,
} from "../lib/routes/context-snapshot-ingest.js";

const API_TOKEN = "a".repeat(32);
const primaryProjectName = "snapshot-ingest-primary";
const secondaryProjectName = "snapshot-ingest-secondary";

let directory = "";
let databasePath = "";
let server: Server | undefined;
let origin = "";
let originalDbPath: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

type Entry = {
  role: "user" | "assistant";
  content: string;
  sourceMessageId: string;
  metadata?: Record<string, unknown>;
};

function makeEntries(count: number, start = 0): Entry[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset;
    return {
      role: index % 2 === 0 ? "user" : "assistant",
      content: `private snapshot message ${index}`,
      sourceMessageId: `mcp-message-${index}`,
      metadata: { ordinal: index },
    };
  });
}

function snapshot(entries: Entry[], overrides: Record<string, unknown> = {}) {
  const unsigned = {
    sourceKey: "mcp-context-source",
    sourceSessionId: "mcp-session-20260729",
    title: "Private MCP conversation title",
    tags: ["mcp", "snapshot"],
    priority: 6,
    metadata: { importer: "mcp" },
    entries,
    ...overrides,
  };
  return {
    ...unsigned,
    snapshotHash: calculateContextConversationSnapshotHash(unsigned),
  };
}

function ingestUrl(project = primaryProjectName): string {
  return `${origin}${CONTEXT_SNAPSHOT_INGEST_PATH}?project=${encodeURIComponent(project)}`;
}

async function postSnapshot(
  body: unknown,
  options: {
    project?: string;
    authorization?: string | undefined;
    contentType?: string;
    contentEncoding?: string;
    dashboardMarker?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE,
    ...(options.authorization === undefined ? {} : { Authorization: options.authorization }),
    ...(options.contentEncoding === undefined ? {} : { "Content-Encoding": options.contentEncoding }),
    ...(options.dashboardMarker === undefined ? {} : { "x-ingenium-ui": options.dashboardMarker }),
  };
  return fetch(ingestUrl(options.project), {
    method: "POST",
    headers,
    body: body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function postWithoutContentLength(): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(ingestUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE,
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    // A streamed body makes Node use Transfer-Encoding: chunked rather than
    // synthesizing Content-Length: 0, exercising the required-header guard.
    request.write("{}");
    request.end();
  });
}

beforeEach(async () => {
  originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  directory = mkdtempSync(join(tmpdir(), "ingenium-context-snapshot-ingest-api-"));
  databasePath = join(directory, "data.db");
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  process.env.INGENIUM_API_TOKEN = API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  resetDbForTest();
  projects.createProject(primaryProjectName);
  projects.createProject(secondaryProjectName);

  const app = express();
  // Proves the octet-stream route bypasses the global JSON parser.
  app.use(express.json({ limit: "2mb" }));
  app.use(authMiddleware);
  app.use(CONTEXT_SNAPSHOT_INGEST_PATH, contextSnapshotIngestRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
});

describe("protected context snapshot ingest API", () => {
  it("imports 1,001 messages in one request, replays idempotently, and appends a verified suffix", async () => {
    const initial = snapshot(makeEntries(1_001));
    const firstResponse = await postSnapshot(initial, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json() as { data: Record<string, unknown> }).data;
    expect(first).toMatchObject({
      revision: 1_001,
      total: 1_001,
      appended: 1_001,
      skipped: 0,
      snapshotHash: initial.snapshotHash,
      idempotent: false,
      conversation: { id: expect.any(String), revision: 1_001, message_count: 1_001 },
    });
    expect(first.id).toBe(first.conversation && (first.conversation as { id: string }).id);
    expect(JSON.stringify(first)).not.toContain(initial.entries[0]!.content);
    expect(JSON.stringify(first)).not.toContain(initial.title);

    const primary = projects.getProject(primaryProjectName)!;
    const db = getDb(databasePath);
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(primary.id))
      .toEqual({ count: 1_001 });

    const replayResponse = await postSnapshot(initial, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json()).data).toMatchObject({
      id: first.id,
      total: 1_001,
      appended: 0,
      skipped: 1_001,
      idempotent: true,
    });

    const suffix = snapshot([...initial.entries, ...makeEntries(2, initial.entries.length)]);
    const suffixResponse = await postSnapshot(suffix, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(suffixResponse.status).toBe(200);
    expect((await suffixResponse.json()).data).toMatchObject({
      id: first.id,
      revision: 1_003,
      total: 1_003,
      appended: 2,
      skipped: 1_001,
      snapshotHash: suffix.snapshotHash,
      idempotent: false,
    });
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(primary.id))
      .toEqual({ count: 1_003 });
  });

  it("adopts an existing project-owned conversation without returning message content", async () => {
    const primary = projects.getProject(primaryProjectName)!;
    const existing = createContextConversation(primary.id, { title: "Existing private conversation" });
    const entries = makeEntries(3).map((entry, index) => {
      appendContextMessage(primary.id, existing.id, {
        role: entry.role,
        content: entry.content,
        expectedRevision: index,
      });
      return entry;
    });
    const adopted = snapshot(entries, {
      sourceKey: "mcp-adopted-source",
      existingConversationId: existing.id,
    });

    const response = await postSnapshot(adopted, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json() as { data: Record<string, unknown> }).data;
    expect(body).toMatchObject({
      id: existing.id,
      revision: 3,
      total: 3,
      appended: 0,
      skipped: 3,
      idempotent: false,
      conversation: { id: existing.id, message_count: 3 },
    });
    expect(JSON.stringify(body)).not.toContain(entries[0]!.content);
  });

  it("rejects shorter, divergent, and cross-project snapshots without partial writes", async () => {
    const initial = snapshot(makeEntries(3));
    const imported = await postSnapshot(initial, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    const importedBody = (await imported.json() as { data: { id: string } }).data;
    const primary = projects.getProject(primaryProjectName)!;
    const db = getDb(databasePath);

    const shorter = snapshot(initial.entries.slice(0, 2));
    const shorterResponse = await postSnapshot(shorter, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(shorterResponse.status).toBe(409);
    expect(await shorterResponse.json()).toEqual({
      error: { code: "SNAPSHOT_SHORTER", message: "Snapshot cannot remove previously imported entries." },
    });

    const divergent = snapshot([
      { ...initial.entries[0]!, content: "private divergent body" },
      ...initial.entries.slice(1),
    ]);
    const divergentResponse = await postSnapshot(divergent, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    const divergentBody = await divergentResponse.json();
    expect(divergentResponse.status).toBe(409);
    expect(divergentBody).toMatchObject({ error: { code: "SNAPSHOT_DIVERGED" } });
    expect(JSON.stringify(divergentBody)).not.toContain("private divergent body");

    const crossProject = snapshot(makeEntries(1), {
      sourceKey: "mcp-cross-project-source",
      existingConversationId: importedBody.id,
    });
    const crossProjectResponse = await postSnapshot(crossProject, {
      project: secondaryProjectName,
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(crossProjectResponse.status).toBe(404);
    expect(await crossProjectResponse.json()).toEqual({
      error: { code: "SNAPSHOT_TARGET_NOT_FOUND", message: "Snapshot target was not found." },
    });
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(primary.id))
      .toEqual({ count: 3 });
    const secondary = projects.getProject(secondaryProjectName)!;
    expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(secondary.id))
      .toEqual({ count: 0 });
  });

  it("rejects malformed, oversized, wrong-content-type, unauthenticated, and incomplete transport requests", async () => {
    const privateMarker = "PRIVATE_SNAPSHOT_WIRE_CONTENT";
    const malformedResponse = await postSnapshot(`{"private":"${privateMarker}"`, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(malformedResponse.status).toBe(400);
    const malformedBody = await malformedResponse.json();
    expect(malformedBody).toMatchObject({ error: { code: "MALFORMED_SNAPSHOT" } });
    expect(JSON.stringify(malformedBody)).not.toContain(privateMarker);

    const wrongTypeResponse = await postSnapshot(snapshot(makeEntries(1)), {
      authorization: `Bearer ${API_TOKEN}`,
      contentType: "application/json",
    });
    expect(wrongTypeResponse.status).toBe(415);
    expect((await wrongTypeResponse.json()).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const compressedOversizedBody = gzipSync(Buffer.from(JSON.stringify({
      sourceKey: "mcp-compressed-oversized-source",
      title: "Compressed oversized snapshot",
      entries: Array.from({ length: 33 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(262_144),
        sourceMessageId: `compressed-${index}`,
      })),
      tags: [],
      priority: 1,
      metadata: {},
      snapshotHash: "a".repeat(64),
    })));
    const oversizedResponse = await postSnapshot(compressedOversizedBody, {
      authorization: `Bearer ${API_TOKEN}`,
      contentEncoding: "gzip",
    });
    expect(oversizedResponse.status).toBe(413);
    expect((await oversizedResponse.json()).error.code).toBe("SNAPSHOT_PAYLOAD_TOO_LARGE");

    const noAuthResponse = await postSnapshot(snapshot(makeEntries(1)));
    expect(noAuthResponse.status).toBe(401);
    expect((await noAuthResponse.json()).error.code).toBe("UNAUTHORIZED");

    const dashboardTransportResponse = await postSnapshot(snapshot(makeEntries(1)), {
      authorization: `Bearer ${API_TOKEN}`,
      dashboardMarker: "dashboard",
    });
    expect(dashboardTransportResponse.status).toBe(404);
    expect((await dashboardTransportResponse.json()).error.code).toBe("NOT_FOUND");

    const noLength = await postWithoutContentLength();
    expect(noLength.status).toBe(411);
    expect(JSON.parse(noLength.body)).toMatchObject({ error: { code: "CONTENT_LENGTH_REQUIRED" } });
  });

  it("rolls back failed imports and never logs or returns snapshot content", async () => {
    const primary = projects.getProject(primaryProjectName)!;
    const db = getDb(databasePath);
    const privateMarker = `PRIVATE_ROLLBACK_${randomUUID()}`;
    const logCount = logger.getLogs({ limit: 2_000 }).length;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.exec(`
      CREATE TRIGGER fail_snapshot_evidence
      BEFORE INSERT ON context_conversation_source_messages
      BEGIN
        SELECT RAISE(ABORT, '${privateMarker}');
      END;
    `);

    try {
      const failed = await postSnapshot(snapshot([
        { role: "user", content: privateMarker, sourceMessageId: "rollback-message" },
      ], { sourceKey: "mcp-rollback-source", title: privateMarker }), {
        authorization: `Bearer ${API_TOKEN}`,
      });
      expect(failed.status).toBe(500);
      const failedBody = await failed.json();
      expect(failedBody).toEqual({
        error: { code: "SNAPSHOT_INGEST_FAILED", message: "Snapshot ingest failed." },
      });
      expect(JSON.stringify(failedBody)).not.toContain(privateMarker);
      expect(JSON.stringify(logger.getLogs({ limit: 2_000 }).slice(logCount))).not.toContain(privateMarker);
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(privateMarker);
      expect(db.prepare("SELECT count(*) AS count FROM context_conversations WHERE project_id = ?").get(primary.id))
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT count(*) AS count FROM context_messages WHERE project_id = ?").get(primary.id))
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT count(*) AS count FROM context_conversation_sources WHERE project_id = ?").get(primary.id))
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT count(*) AS count FROM context_conversation_source_messages WHERE project_id = ?").get(primary.id))
        .toEqual({ count: 0 });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
