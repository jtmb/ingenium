import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, identity, logger, mcpCredentials, organizations, projects, resetDbForTest, runtimes } from "ingenium-core";
import {
  CONTEXT_SNAPSHOT_TIMING_MAX_MS,
  ContextSnapshotImportTimingSchema,
  ContextSnapshotIngestTimingSchema,
} from "ingenium-core/lib/schema";
import { appendContextMessage, createContextConversation, getContextConversation } from "ingenium-core/lib/tools/context-conversations";
import { calculateContextConversationSnapshotHash } from "ingenium-core/lib/tools/context-snapshot-import";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { getSetting, setSetting } from "ingenium-core/lib/tools/settings";
import { settingsRouter } from "../lib/routes/settings.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { contextRouter } from "../lib/routes/context.js";
import {
  CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE,
  CONTEXT_SNAPSHOT_INGEST_PATH,
  contextSnapshotIngestRouter,
} from "../lib/routes/context-snapshot-ingest.js";
import { closeHttpServer, compatibilityAuthHeaders, listenOnLoopback } from "./http-fixtures.js";

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
let serviceOwnerId = "";
let serviceCredential: ReturnType<typeof mcpCredentials.createMcpCredential>;

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

function serviceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${serviceCredential.token}`,
    "x-ingenium-audience": "mcp",
    "x-ingenium-workspace": serviceCredential.workspaceId,
    "x-ingenium-launcher-worktree": serviceCredential.launcherWorktree,
    ...headers,
  };
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
    ...(options.authorization === undefined
      ? {}
      : options.dashboardMarker === undefined
        ? compatibilityAuthHeaders(API_TOKEN)
        : { Authorization: options.authorization }),
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
        ...compatibilityAuthHeaders(API_TOKEN),
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

function expectIngestTiming(data: Record<string, unknown>): void {
  const parsed = ContextSnapshotIngestTimingSchema.safeParse(data.timing);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  for (const duration of Object.values(parsed.data)) {
    expect(Number.isInteger(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThanOrEqual(CONTEXT_SNAPSHOT_TIMING_MAX_MS);
  }
}

function expectCoreTiming(data: Record<string, unknown>, checkpointNotRun = false): void {
  const parsed = ContextSnapshotImportTimingSchema.safeParse(data.coreTiming);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  for (const duration of Object.values(parsed.data)) {
    expect(Number.isInteger(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThanOrEqual(CONTEXT_SNAPSHOT_TIMING_MAX_MS);
  }
  if (checkpointNotRun) expect(parsed.data.checkpointMs).toBe(0);
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
  const primaryProject = projects.createProject(primaryProjectName);
  projects.createProject(secondaryProjectName, false, primaryProject.organization_id);
  const owner = identity.createUser("context-snapshot-service@example.test", "Context Snapshot Service Owner");
  serviceOwnerId = owner.id;
  organizations.addOrganizationMember(primaryProject.organization_id, owner.id, "admin");
  runtimes.authorizeWorkspace({
    id: "context-snapshot-service-workspace",
    organizationId: primaryProject.organization_id,
    projectId: primaryProject.id,
    ownerUserId: owner.id,
    storagePath: directory,
  });
  serviceCredential = mcpCredentials.createMcpCredential({
    kind: "service",
    audience: "mcp",
    name: "Context snapshot service",
    scopes: ["projects:read"],
    organizationId: primaryProject.organization_id,
    projectId: primaryProject.id,
    workspaceId: "context-snapshot-service-workspace",
    launcherWorktree: directory,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdByUserId: owner.id,
  });

  const app = express();
  // Proves the octet-stream route bypasses the global JSON parser.
  app.use(express.json({ limit: "2mb" }));
  app.use(authMiddleware);
  app.use(authorizationMiddleware);
  app.use(CONTEXT_SNAPSHOT_INGEST_PATH, contextSnapshotIngestRouter);
  app.use("/api/v1/context", contextRouter);
  app.use("/api/v1/settings", settingsRouter);
  app.use(errorHandler);
  server = createServer(app);
  origin = await listenOnLoopback(server);
});

afterEach(async () => {
  if (server) {
    await closeHttpServer(server);
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
  it("rejects source-key-only service imports targeting private or newly reserved conversations", async () => {
    const project = projects.getProject(primaryProjectName)!;
    const privateConversation = createContextConversation(project.id, {
      title: "Mapped private conversation",
      organizationId: project.organization_id,
      ownerUserId: serviceOwnerId,
      visibility: "private",
    });
    const privateSourceKey = "mapped-private-source";
    expect((await postSnapshot(snapshot(makeEntries(1), {
      sourceKey: privateSourceKey,
      existingConversationId: privateConversation.id,
    }), { authorization: `Bearer ${API_TOKEN}` })).status).toBe(200);

    const privateResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(2), { sourceKey: privateSourceKey })),
    });
    expect(privateResponse.status).toBe(404);
    expect(await privateResponse.json()).toEqual({
      error: { code: "SNAPSHOT_TARGET_NOT_FOUND", message: "Snapshot target was not found." },
    });
    expect(getContextConversation(project.id, privateConversation.id)?.revision).toBe(1);

    const reservedConversation = createContextConversation(project.id, {
      title: "Mapped reserved coordination conversation",
      organizationId: project.organization_id,
      metadata: { kind: "coordination_operational_memory" },
      visibility: "project",
    });
    const reservedSourceKey = "mapped-reserved-source";
    expect((await postSnapshot(snapshot(makeEntries(1), {
      sourceKey: reservedSourceKey,
      existingConversationId: reservedConversation.id,
    }), { authorization: `Bearer ${API_TOKEN}` })).status).toBe(200);

    const reservedResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(2), { sourceKey: reservedSourceKey })),
    });
    expect(reservedResponse.status).toBe(404);
    expect(await reservedResponse.json()).toEqual({
      error: { code: "SNAPSHOT_TARGET_NOT_FOUND", message: "Snapshot target was not found." },
    });
    expect(getContextConversation(project.id, reservedConversation.id)?.revision).toBe(1);
  });

  it("confines an MCP service credential to project-bound import, retrieve, and archive operations", async () => {
    const importedResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(1))),
    });
    expect(importedResponse.status).toBe(201);
    const imported = (await importedResponse.json() as { data: { id: string; revision: number; conversation: { latest_message_id: string } } }).data;

    const retrieveResponse = await fetch(
      `${origin}/api/v1/context/conversations/${imported.id}/messages/${imported.conversation.latest_message_id}?project=${primaryProjectName}`,
      { headers: serviceHeaders() },
    );
    expect(retrieveResponse.status).toBe(200);
    expect((await retrieveResponse.json()).data.content).toBe("private snapshot message 0");

    const primaryProject = projects.getProject(primaryProjectName)!;
    const privateConversation = createContextConversation(primaryProject.id, {
      title: "Browser-owned private conversation",
      organizationId: primaryProject.organization_id,
      ownerUserId: serviceOwnerId,
      visibility: "private",
    });
    const privateMessage = appendContextMessage(primaryProject.id, privateConversation.id, {
      role: "user",
      content: "private browser message",
      expectedRevision: 0,
    }).message;
    const privateRetrieveResponse = await fetch(
      `${origin}/api/v1/context/conversations/${privateConversation.id}/messages/${privateMessage.id}?project=${primaryProjectName}`,
      { headers: serviceHeaders() },
    );
    expect(privateRetrieveResponse.status).toBe(404);
    const privateImportResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(1), {
        sourceKey: "private-conversation-source",
        existingConversationId: privateConversation.id,
      })),
    });
    expect(privateImportResponse.status).toBe(404);
    const coordinationConversation = createContextConversation(primaryProject.id, {
      title: "Reserved coordination memory",
      metadata: { kind: "coordination_operational_memory" },
      visibility: "project",
    });
    const coordinationImportResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(1), {
        sourceKey: "coordination-conversation-source",
        existingConversationId: coordinationConversation.id,
      })),
    });
    expect(coordinationImportResponse.status).toBe(404);

    const authorizeResponse = await fetch(
      `${origin}/api/v1/context/conversations/${imported.id}/maintenance/authorize?project=${primaryProjectName}`,
      {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ operation: "archive_conversation", expectedRevision: imported.revision }),
      },
    );
    expect(authorizeResponse.status).toBe(201);
    const confirmationToken = (await authorizeResponse.json()).data.confirmationToken;
    const archiveResponse = await fetch(
      `${origin}/api/v1/context/conversations/${imported.id}/archive?project=${primaryProjectName}`,
      {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expectedRevision: imported.revision, confirmationToken }),
      },
    );
    expect(archiveResponse.status).toBe(200);
    expect((await archiveResponse.json()).data.archived).toBe(true);

    const foreignResponse = await fetch(ingestUrl(secondaryProjectName), {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE }),
      body: JSON.stringify(snapshot(makeEntries(1), { sourceKey: "foreign-project-source" })),
    });
    expect(foreignResponse.status).toBe(404);

    const outsideContractResponse = await fetch(`${origin}/api/v1/context/conversations?project=${primaryProjectName}`, {
      method: "POST",
      headers: serviceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title: "Service-created conversation" }),
    });
    expect(outsideContractResponse.status).toBe(404);

    const dashboardMarkedResponse = await fetch(ingestUrl(), {
      method: "POST",
      headers: serviceHeaders({
        "Content-Type": CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE,
        "x-ingenium-ui": "dashboard",
      }),
      body: JSON.stringify(snapshot(makeEntries(1), { sourceKey: "dashboard-marked-source" })),
    });
    expect(dashboardMarkedResponse.status).toBe(404);
  });

  it("enforces opt-in for each batch, persists sync status and rejects invalid settings", async () => {
    const project = projects.getProject(primaryProjectName)!;
    const source = { sourceKey: "context-upload-file:ses_exact", sourceSessionId: "ses_exact", automatic: true };
    const initial = snapshot(makeEntries(1), { ...source, startSequence: 0 });
    const send = (body: unknown) => postSnapshot(body, { authorization: `Bearer ${API_TOKEN}` });
    expect((await send(initial)).status).toBe(409);
    const save = (value: string) => fetch(`${origin}/api/v1/settings?project=${primaryProjectName}`, { method: "POST",
      headers: { ...compatibilityAuthHeaders(API_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ key: "context_auto_upload_enabled", value }) });
    expect((await save("yes")).status).toBe(422);
    expect((await save("true")).status).toBe(200);
    expect((await send(initial)).status).toBe(201);
    const next = snapshot(makeEntries(1, 1), { ...source, startSequence: 1 });
    expect((await send(next)).status).toBe(200);
    expect((await (await send(initial)).json()).data).toMatchObject({ revision: 2, appended: 0, idempotent: true });
    expect(JSON.parse(getSetting(project.id, "context_upload_last_sync")!)).toMatchObject({ status: "synced", session: "ses_exact", revision: 2 });
    expect(getSetting(projects.getProject(secondaryProjectName)!.id, "context_auto_upload_enabled")).toBeUndefined();
    expect((await save("false")).status).toBe(200);
    expect((await send(snapshot(makeEntries(1, 2), { ...source, startSequence: 2 }))).status).toBe(409);
  });
  it("imports 1,001 messages in one request, replays idempotently, and appends a verified suffix", async () => {
    const initial = snapshot(makeEntries(1_001));
    const firstResponse = await postSnapshot(gzipSync(Buffer.from(JSON.stringify(initial))), {
      authorization: `Bearer ${API_TOKEN}`,
      contentEncoding: "gzip",
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
    expectIngestTiming(first);
    expectCoreTiming(first);
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
    const replay = (await replayResponse.json() as { data: Record<string, unknown> }).data;
    expect(replay).toMatchObject({
      id: first.id,
      total: 1_001,
      appended: 0,
      skipped: 1_001,
      idempotent: true,
    });
    expectIngestTiming(replay);
    expectCoreTiming(replay, true);

    const suffix = snapshot([...initial.entries, ...makeEntries(2, initial.entries.length)]);
    const suffixResponse = await postSnapshot(suffix, {
      authorization: `Bearer ${API_TOKEN}`,
    });
    expect(suffixResponse.status).toBe(200);
    const suffixBody = (await suffixResponse.json() as { data: Record<string, unknown> }).data;
    expect(suffixBody).toMatchObject({
      id: first.id,
      revision: 1_003,
      total: 1_003,
      appended: 2,
      skipped: 1_001,
      snapshotHash: suffix.snapshotHash,
      idempotent: false,
    });
    expectIngestTiming(suffixBody);
    expectCoreTiming(suffixBody);
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
    expect(dashboardTransportResponse.status).toBe(401);
    expect((await dashboardTransportResponse.json()).error.code).toBe("INVALID_TOKEN");

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
      expect(failedBody).not.toHaveProperty("timing");
      expect(failedBody).not.toHaveProperty("coreTiming");
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
