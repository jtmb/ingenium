import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coordination, getDb, projects, resetDbForTest, tasks } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { coordinationRouter } from "../lib/routes/coordination.js";
import { contextRouter } from "../lib/routes/context.js";
import { closeHttpServer, compatibilityAuthHeaders, listenOnLoopback } from "./http-fixtures.js";

const API_TOKEN = "a".repeat(32);
const TOKEN_A = "A".repeat(32);
const TOKEN_B = "B".repeat(32);
const TOKEN_C = "C".repeat(32);
const PROJECT_A = "coordination-api-primary";
const PROJECT_B = "coordination-api-secondary";

function storageMappingHash(workspaceId: string, launcherWorktree: string): string {
  return createHash("sha256").update(`${workspaceId}\0${launcherWorktree}`).digest("hex");
}

function claimKey(label: string): string {
  return createHash("sha256").update(label).digest("base64url");
}

const MAIN_BINDING = {
  workspaceId: "coordination-workspace-main",
  launcherWorktree: "/fixtures/coordination-main",
  storageMappingHash: storageMappingHash("coordination-workspace-main", "/fixtures/coordination-main"),
};
const IDENTITY = {
  worktree_id: coordination.coordinationWorktreeId(MAIN_BINDING.workspaceId, MAIN_BINDING.storageMappingHash),
  session_id: "session-main",
  incarnation: 1,
};

function boundIdentity(label: string, sessionId: string) {
  const workspaceId = `coordination-workspace-${label}`;
  const launcherWorktree = `/fixtures/coordination-${label}`;
  const binding = { workspaceId, launcherWorktree, storageMappingHash: storageMappingHash(workspaceId, launcherWorktree) };
  return {
    binding,
    identity: {
      worktree_id: coordination.coordinationWorktreeId(binding.workspaceId, binding.storageMappingHash),
      session_id: sessionId,
      incarnation: 1,
    },
  };
}

let directory = "";
let databasePath = "";
let server: Server | undefined;
let origin = "";
let primaryProjectId = "";
let originalDbPath: string | undefined;
let originalHome: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

type Session = { actorId: string; revision: number; fence: number; state: string };
type ApiResult = { response: Response; body: any };

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    ...IDENTITY,
    ownership_token: TOKEN_A,
    ttl_ms: 300_000,
    idempotency_key: "register-main",
    ...overrides,
  };
}

function lease(session: Session, token: string, idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  return {
    ...IDENTITY,
    expected_revision: session.revision,
    fence: session.fence,
    ownership_token: token,
    idempotency_key: idempotencyKey,
    ...overrides,
  };
}

async function request(
  path: string,
  method: string,
  body?: unknown,
  options: {
    project?: string;
    query?: Record<string, string | number>;
    authorization?: string | undefined;
    headers?: Record<string, string>;
    principal?: "service" | "compatibility" | "user";
    serviceBinding?: typeof MAIN_BINDING;
  } = {},
): Promise<ApiResult> {
  const query = new URLSearchParams({ project: options.project ?? PROJECT_A });
  for (const [key, value] of Object.entries(options.query ?? {})) query.set(key, String(value));
  const headers: Record<string, string> = {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.authorization === undefined ? compatibilityAuthHeaders(API_TOKEN) : { Authorization: options.authorization }),
    "x-test-principal": options.principal ?? "service",
    "x-test-workspace": (options.serviceBinding ?? MAIN_BINDING).workspaceId,
    "x-test-worktree": (options.serviceBinding ?? MAIN_BINDING).launcherWorktree,
    "x-test-storage-mapping": (options.serviceBinding ?? MAIN_BINDING).storageMappingHash,
    ...options.headers,
  };
  const response = await fetch(`${origin}/api/v1/coordination${path}?${query}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

async function register(overrides: Record<string, unknown> = {}, options: Parameters<typeof request>[3] = {}) {
  const result = await request("/register", "POST", registerBody(overrides), options);
  expect(result.response.status).toBe(201);
  return result.body.data.session as Session;
}

async function contextRequest(path: string, method = "GET", body?: unknown): Promise<ApiResult> {
  const response = await fetch(`${origin}/api/v1/context${path}${path.includes("?") ? "&" : "?"}project=${PROJECT_A}`, {
    method,
    headers: {
      ...compatibilityAuthHeaders(API_TOKEN),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "x-test-principal": "service",
      "x-test-workspace": MAIN_BINDING.workspaceId,
      "x-test-worktree": MAIN_BINDING.launcherWorktree,
      "x-test-storage-mapping": MAIN_BINDING.storageMappingHash,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

function assertRedacted(value: unknown, forbiddenValues: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertRedacted(entry, forbiddenValues));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") forbiddenValues.forEach((forbidden) => expect(value).not.toContain(forbidden));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    expect([
      "ownershipToken",
      "ownership_token",
      "ownershipTokenHash",
      "ownership_token_hash",
      "snapshot",
      "value",
      "path",
      "baselineSha256",
      "baseline_sha256",
      "projectId",
      "project_id",
      "prompt",
      "credential",
    ]).not.toContain(key);
    assertRedacted(entry, forbiddenValues);
  }
}

function snapshotOptions(
  identity: Record<string, string | number> = IDENTITY,
  ownershipToken = TOKEN_A,
  options: Parameters<typeof request>[3] = {},
): Parameters<typeof request>[3] {
  return {
    ...options,
    query: identity,
    headers: {
      "x-ingenium-coordination-ownership": ownershipToken,
      ...options.headers,
    },
  };
}

beforeEach(async () => {
  originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
  originalHome = process.env.INGENIUM_HOME;
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  directory = mkdtempSync(join(tmpdir(), "ingenium-coordination-api-"));
  databasePath = join(directory, "data.db");
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  process.env.INGENIUM_HOME = join(directory, "home");
  process.env.INGENIUM_API_TOKEN = API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  resetDbForTest();
  primaryProjectId = projects.createProject(PROJECT_A).id;
  projects.createProject(PROJECT_B);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use((req, _res, next) => {
    const principal = req.get("x-test-principal");
    if (principal === "service") {
      req.principal = {
        type: "service",
        id: "coordination-test-service",
        scopes: ["coordination:write", "coordination:read"],
        tokenId: "coordination-test-token",
        organizationId: null,
        projectId: primaryProjectId,
        workspaceId: req.get("x-test-workspace")!,
        launcherWorktree: req.get("x-test-worktree")!,
        storageMappingHash: req.get("x-test-storage-mapping")!,
      };
    } else if (principal === "user") {
      req.principal = { type: "user", id: "coordination-test-user", scopes: ["user:*"] };
    }
    next();
  });
  app.use("/api/v1/coordination", coordinationRouter);
  app.use("/api/v1/context", contextRouter);
  app.use(errorHandler);
  server = createServer(app);
  origin = await listenOnLoopback(server);
});

afterEach(async () => {
  if (server) await closeHttpServer(server);
  server = undefined;
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
});

describe("COORD-102 coordination API", () => {
  it("publishes exact-schema operational memory and replays it without public ownership identifiers", async () => {
    const registered = await request("/register", "POST", registerBody({ idempotency_key: "memory-register" }));
    const session = registered.body.data.session as Session;
    expect(registered.body.data.memory).toMatchObject({ revision: 0, entries: [] });
    expect(session.actorId).toMatch(/^actor-[0-9a-f]{64}$/);
    expect(session).not.toHaveProperty("id");
    expect(session).not.toHaveProperty("sessionId");
    expect(session.fence).toBeGreaterThan(0);
    const receiverIdentity = { ...IDENTITY, session_id: "memory-receiver" };
    const receiver = await request("/register", "POST", registerBody({
      ...receiverIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "memory-receiver-register",
    }));
    expect(receiver.body.data.memory).toMatchObject({ revision: 0, entries: [], acknowledgementRequired: false });

    const entry = {
      status: "idle",
      actions: [{
        kind: "edit",
        result: "succeeded",
        pathSegments: [Buffer.from("src").toString("base64url"), Buffer.from("safe.ts").toString("base64url")],
        targetHash: null,
      }],
      checks: [{ kind: "typecheck", result: "passed", targetHash: "a".repeat(64) }],
      todos: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, state: "none" },
      currentTaskId: null,
      changedPaths: [],
      nextWork: { kind: "none", referenceHash: null },
    };
    const published = await request("/memory/publish", "POST", {
      ...lease(session, TOKEN_A, "memory-publish"),
      entry,
    });
    expect(published).toMatchObject({
      response: { status: 201 },
      body: { data: { memory: { revision: 1, entry: {
        version: 1, type: "operational", contextRevision: 0, ...entry,
      } } } },
    });

    const live = await request("/memory/read", "POST", {
      ...lease(receiver.body.data.session, TOKEN_B, "memory-live-read", receiverIdentity),
      limit: 8,
    });
    expect(live).toMatchObject({ response: { status: 200 }, body: { data: { memory: {
      revision: 1, throughRevision: 1, acknowledgementRequired: true,
      entries: [{ status: "idle", contextRevision: 0 }],
    } } } });
    const acknowledged = await request("/memory/ack", "POST", {
      ...lease(live.body.data.session, TOKEN_B, "memory-live-ack", receiverIdentity),
      through_revision: live.body.data.memory.throughRevision,
    });
    expect(acknowledged.response.status).toBe(200);
    const empty = await request("/memory/read", "POST", {
      ...lease(acknowledged.body.data.session, TOKEN_B, "memory-live-empty", receiverIdentity), limit: 8,
    });
    expect(empty.body.data.memory).toMatchObject({ revision: 1, entries: [], acknowledgementRequired: false });
    const registrationReplay = await request("/register", "POST", registerBody({
      ...receiverIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "memory-receiver-register",
    }));
    expect(registrationReplay).toMatchObject({
      response: { status: 201 },
      body: { data: { session: { revision: acknowledged.body.data.session.revision }, memory: { entries: [] } } },
    });
    assertRedacted({ published: published.body, receiver: receiver.body }, [IDENTITY.session_id, receiverIdentity.session_id, TOKEN_A, TOKEN_B]);

    const forbidden = await request("/memory/publish", "POST", {
      ...lease(published.body.data.session, TOKEN_A, "memory-forbidden"),
      entry: { ...entry, rawCommand: "never persist this" },
    });
    expect(forbidden).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const callerRevision = await request("/memory/publish", "POST", {
      ...lease(published.body.data.session, TOKEN_A, "memory-caller-revision"),
      entry: { ...entry, contextRevision: null },
    });
    expect(callerRevision).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
  });

  it("keeps coordination memory inaccessible through generic Context routes", async () => {
    const registered = await request("/register", "POST", registerBody({ idempotency_key: "private-context-register" }));
    const conversationId = registered.body.data.session.contextConversationId as string;

    const listed = await contextRequest("/conversations");
    expect(listed.response.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(conversationId);
    expect((await contextRequest(`/conversations/${conversationId}`)).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/messages`)).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/messages/search?q=operational`)).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/messages`, "POST", {
      role: "user", content: "generic write denied", expectedRevision: 0, idempotencyKey: "generic-memory-write",
    })).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/messages/batch`, "POST", {
      messageIds: [conversationId],
    })).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/maintenance/authorize`, "POST", {
      operation: "archive_conversation", expectedRevision: 0,
    })).response.status).toBe(404);
    expect((await contextRequest(`/conversations/${conversationId}/archive`, "POST", {})).response.status).toBe(404);
    const maintenance = await contextRequest("/conversations/maintenance/preview", "POST", {
      conversationIds: [conversationId], staleBefore: "2099-01-01T00:00:00.000Z",
    });
    expect(maintenance).toMatchObject({ response: { status: 200 }, body: { data: [] } });
    const forged = await contextRequest("/conversations", "POST", {
      title: "forged coordination memory",
      metadata: { kind: "coordination_operational_memory", version: 1, worktreeId: IDENTITY.worktree_id },
    });
    expect(forged.response.status).toBe(422);
  });

  it("exposes every lifecycle method with the declared success statuses", async () => {
    const registered = await register();
    expect(registered).toMatchObject({ contextConversationId: expect.any(String), contextRevision: 0 });

    const initialSnapshot = await request("/snapshot", "GET", undefined, snapshotOptions());
    expect(initialSnapshot).toMatchObject({ response: { status: 200 }, body: { data: { claims: [], claimCount: 0, claimsTruncated: false } } });

    const updated = await request("/update", "PATCH", {
      ...lease(registered, TOKEN_A, "update-main"),
      snapshot: { phase: "working" },
      snapshot_revision: 1,
      current_task_id: null,
      current_task_revision: null,
    });
    expect(updated.response.status).toBe(200);

    const heartbeated = await request("/heartbeat", "POST", {
      ...lease(updated.body.data.session, TOKEN_A, "heartbeat-main"),
      ttl_ms: 300_000,
    });
    expect(heartbeated.response.status).toBe(200);

    const claimed = await request("/claims/batch", "POST", {
      ...lease(heartbeated.body.data.session, TOKEN_A, "claim-main"),
      client_claim_key: claimKey("claim-main"),
      claims: [{ claim: { kind: "path", path: "services/ingenium-api/lib/routes/coordination.ts" } }],
    });
    expect(claimed).toMatchObject({ response: { status: 200 }, body: { data: { session: expect.any(Object) } } });
    expect(Object.keys(claimed.body.data)).toEqual(["session", "acceptedEpoch", "manifestGeneration"]);

    const released = await request("/claims/release", "POST", {
      ...lease(claimed.body.data.session, TOKEN_A, "release-main"),
      client_claim_key: claimKey("claim-main"),
    });
    expect(released.response.status).toBe(200);

    const recovered = await request("/recover", "POST", {
      ...lease(released.body.data.session, TOKEN_A, "recover-main"),
      next_ownership_token: TOKEN_B,
      ttl_ms: 300_000,
    });
    expect(recovered.response.status).toBe(200);

    const taken = await request("/takeover", "POST", {
      ...IDENTITY,
      expected_revision: recovered.body.data.session.revision,
      fence: recovered.body.data.session.fence,
      ownership_token: TOKEN_B,
      next_ownership_token: TOKEN_C,
      ttl_ms: 300_000,
      idempotency_key: "takeover-main",
    });
    expect(taken).toMatchObject({ response: { status: 200 }, body: { data: { takeoverEvidenceId: expect.any(String) } } });

    const closed = await request("/close", "POST", lease(taken.body.data.session, TOKEN_C, "close-main"));
    expect(closed).toMatchObject({ response: { status: 200 }, body: { data: { session: { state: "closed" } } } });
  });

  it("transports ordered sanitized peer handoffs once without cross-project visibility", async () => {
    const source = await register({ idempotency_key: "handoff-source-register" });
    const peerIdentity = { ...IDENTITY, session_id: "session-peer" };
    const peer = await register({
      ...peerIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "handoff-peer-register",
    });
    const published = await request("/handoffs/publish", "POST", {
      ...lease(source, TOKEN_A, "handoff-publish"),
      operation: "edit",
      path: "services/ingenium-api/lib/routes/coordination.ts",
      baseline_sha256: "c".repeat(64),
    });
    expect(published).toMatchObject({
      response: { status: 201 },
      body: { data: { event: {
        sequence: 1,
        operation: "edit",
        path: "services/ingenium-api/lib/routes/coordination.ts",
        sourceActorId: expect.stringMatching(/^actor-[0-9a-f]{64}$/),
        sourceRevision: 1,
      } } },
    });
    expect(JSON.stringify(published.body)).not.toContain(TOKEN_A);

    const read = await request("/handoffs/read", "POST", {
      ...lease(peer, TOKEN_B, "handoff-read", peerIdentity),
      limit: 32,
    });
    expect(read).toMatchObject({
      response: { status: 200 },
      body: { data: { events: [published.body.data.event], acknowledgementRequired: true, throughSequence: 1 } },
    });
    const unread = await request("/handoffs/read", "POST", {
      ...lease(peer, TOKEN_B, "handoff-read-again", peerIdentity),
    });
    expect(unread.body.data.events).toEqual([published.body.data.event]);
    const acknowledged = await request("/handoffs/ack", "POST", {
      ...lease(peer, TOKEN_B, "handoff-ack", peerIdentity),
      through_sequence: read.body.data.throughSequence,
    });
    expect(acknowledged.response.status).toBe(200);
    const empty = await request("/handoffs/read", "POST", {
      ...lease(acknowledged.body.data.session, TOKEN_B, "handoff-read-empty", peerIdentity),
    });
    expect(empty.body.data).toMatchObject({ events: [], acknowledgementRequired: false });

    const foreign = await request("/handoffs/consume", "POST", {
      ...lease(peer, TOKEN_B, "handoff-consume-foreign", peerIdentity),
    }, { project: PROJECT_B });
    expect(foreign).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
    const unsafe = await request("/handoffs/publish", "POST", {
      ...lease(published.body.data.session, TOKEN_A, "handoff-unsafe"),
      operation: "write",
      path: "/absolute/private.ts",
      prompt: "must not persist",
    });
    expect(unsafe).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
  });

  it("reclaims expired claims only for the credential-attested worktree without ownership disclosure", async () => {
    const owner = await register({ idempotency_key: "reap-owner-register" });
    const owned = await request("/claims/batch", "POST", {
      ...lease(owner, TOKEN_A, "reap-owner-claim"),
      client_claim_key: claimKey("reap-owner-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expect(owned.response.status).toBe(200);

    const contenderIdentity = { ...IDENTITY, session_id: "session-contender" };
    const contender = await register({
      ...contenderIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "reap-contender-register",
    });
    const conflict = await request("/claims/batch", "POST", {
      ...lease(contender, TOKEN_B, "reap-live-conflict", contenderIdentity),
      client_claim_key: claimKey("reap-live-conflict"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expect(conflict).toMatchObject({
      response: { status: 409 },
      body: { error: { code: "CLAIM_CONFLICT", message: "Coordination claim conflicts with current state" } },
    });
    expect(Object.keys(conflict.body.error).sort()).toEqual(["code", "message"]);
    expect(JSON.stringify(conflict.body)).not.toMatch(/session|incarnation|fence|owner|token/i);

    getDb(databasePath).prepare("UPDATE coordination_sessions SET expires_at = ? WHERE session_id = ?")
      .run("2000-01-01T00:00:00.000Z", IDENTITY.session_id);
    const reclaimed = await request("/claims/batch", "POST", {
      ...lease(contender, TOKEN_B, "reap-expired-owner", contenderIdentity),
      client_claim_key: claimKey("reap-expired-owner"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    expect(reclaimed).toMatchObject({ response: { status: 200 }, body: { data: { session: expect.any(Object) } } });
    expect(getDb(databasePath).prepare(
      "SELECT state FROM coordination_claims WHERE coordination_session_id = (SELECT id FROM coordination_sessions WHERE session_id = ?) AND value = ?",
    ).get(IDENTITY.session_id, "@repository"))
      .toEqual({ state: "released" });

    const wrongBinding = await request("/claims/release", "POST", {
      ...lease(reclaimed.body.data.session, TOKEN_B, "reap-wrong-binding-release", contenderIdentity),
      client_claim_key: claimKey("reap-expired-owner"),
    }, { serviceBinding: {
      workspaceId: "foreign-workspace",
      launcherWorktree: "/fixtures/foreign-worktree",
      storageMappingHash: storageMappingHash("foreign-workspace", "/fixtures/foreign-worktree"),
    } });
    expect(wrongBinding).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
    expect(JSON.stringify(wrongBinding.body)).not.toContain(claimKey("reap-expired-owner"));
  });

  it("atomically assigns unique monotonic internal fences without exposing them", async () => {
    const registrations = await Promise.all(Array.from({ length: 6 }, (_, index) => request("/register", "POST", registerBody({
      session_id: `concurrent-session-${index}`,
      ownership_token: String.fromCharCode(68 + index).repeat(32),
      idempotency_key: `concurrent-register-${index}`,
    }))));

    expect(registrations.map(({ response }) => response.status)).toEqual(Array(6).fill(201));
    registrations.forEach(({ body }) => expect(body.data.session.fence).toBeGreaterThan(0));
    const fences = (getDb(databasePath).prepare(
      "SELECT fence FROM coordination_sessions WHERE session_id LIKE 'concurrent-session-%' ORDER BY fence",
    ).all() as Array<{ fence: number }>).map(({ fence }) => fence);
    expect(fences).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(fences).size).toBe(fences.length);
  });

  it("gives a stale contender an internal fence beyond the expired owner", async () => {
    const contenderIdentity = { ...IDENTITY, session_id: "stale-contender" };
    const contender = await register({
      ...contenderIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "stale-contender-register",
    });
    const owner = await register({ idempotency_key: "newer-owner-register" });
    const owned = await request("/claims/batch", "POST", {
      ...lease(owner, TOKEN_A, "newer-owner-claim"),
      client_claim_key: claimKey("newer-owner-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    const internalFence = (sessionId: string) => (getDb(databasePath).prepare(
      "SELECT fence FROM coordination_sessions WHERE session_id = ?",
    ).get(sessionId) as { fence: number }).fence;
    expect(internalFence(contenderIdentity.session_id)).toBe(1);
    expect(internalFence(IDENTITY.session_id)).toBe(2);
    getDb(databasePath).prepare("UPDATE coordination_sessions SET expires_at = ? WHERE session_id = ?")
      .run("2000-01-01T00:00:00.000Z", IDENTITY.session_id);

    const winner = await request("/claims/batch", "POST", {
      ...lease(contender, TOKEN_B, "stale-contender-claim", contenderIdentity),
      client_claim_key: claimKey("stale-contender-claim"),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });

    expect(winner.response.status, JSON.stringify(winner.body)).toBe(200);
    expect(winner.body.data.session.fence).toBeGreaterThan(0);
    expect(internalFence(contenderIdentity.session_id)).toBeGreaterThan(2);
    expect(getDb(databasePath).prepare(
      "SELECT fence FROM coordination_claims WHERE coordination_session_id = (SELECT id FROM coordination_sessions WHERE session_id = ?) AND value = ?",
    ).get(contenderIdentity.session_id, "@repository")).toEqual({ fence: internalFence(contenderIdentity.session_id) });
    expect(getDb(databasePath).prepare(
      "SELECT state FROM coordination_claims WHERE coordination_session_id = (SELECT id FROM coordination_sessions WHERE session_id = ?) AND value = ?",
    ).get(IDENTITY.session_id, "@repository")).toEqual({ state: "released" });
  });

  it("requires credential-attested worktree identity for registration, consume, and snapshot", async () => {
    const serviceSession = await register({ idempotency_key: "attested-register" });
    const positiveSnapshot = await request("/snapshot", "GET", undefined, snapshotOptions());
    expect(positiveSnapshot).toMatchObject({ response: { status: 200 }, body: { data: { peers: [] } } });
    const positiveConsume = await request("/handoffs/consume", "POST", lease(serviceSession, TOKEN_A, "attested-consume"));
    expect(positiveConsume).toMatchObject({ response: { status: 200 }, body: { data: { events: [] } } });

    for (const principal of ["compatibility", "user"] as const) {
      const registration = await request("/register", "POST", registerBody({
        session_id: `foreign-${principal}`,
        idempotency_key: `foreign-${principal}-register`,
      }), { principal });
      expect(registration).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });

      const consumed = await request("/handoffs/consume", "POST", {
        ...lease(positiveConsume.body.data.session, TOKEN_A, `foreign-${principal}-consume`),
      }, { principal });
      expect(consumed).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });

      const snapshot = await request("/snapshot", "GET", undefined, snapshotOptions(IDENTITY, TOKEN_A, { principal }));
      expect(snapshot).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
    }

    const mismatchedService = await request("/snapshot", "GET", undefined, snapshotOptions(IDENTITY, TOKEN_A, {
      serviceBinding: {
        workspaceId: "foreign-workspace",
        launcherWorktree: "/fixtures/foreign-worktree",
        storageMappingHash: storageMappingHash("foreign-workspace", "/fixtures/foreign-worktree"),
      },
    }));
    expect(mismatchedService).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
  });

  it("projects only typed active peer snapshot status, todo counts, path metadata, task hash, and context revision", async () => {
    const source = await register({ idempotency_key: "snapshot-source-register" });
    const updated = await request("/update", "PATCH", {
      ...lease(source, TOKEN_A, "snapshot-source-update"),
      snapshot: {
        version: 1,
        status: "working",
        todos: { pending: 2, inProgress: 1, completed: 3, cancelled: 0 },
        changedPaths: [{
          path: "src/peer.ts",
          operation: "edit",
          additions: 4,
          deletions: 2,
          changeRevision: 1,
        }],
        currentTaskId: `task-${"a".repeat(64)}`,
        contextRevision: 12,
      },
      snapshot_revision: 1,
      current_task_id: null,
      current_task_revision: null,
    });
    expect(updated.response.status).toBe(200);
    const receiverIdentity = { ...IDENTITY, session_id: "snapshot-receiver" };
    await register({ ...receiverIdentity, ownership_token: TOKEN_B, idempotency_key: "snapshot-receiver-register" });

    const status = await request("/snapshot", "GET", undefined, snapshotOptions(receiverIdentity, TOKEN_B));
    expect(status).toMatchObject({ response: { status: 200 }, body: { data: { peers: [{
      peerId: expect.stringMatching(/^peer-[0-9a-f]{64}$/),
      status: "working",
      snapshotRevision: 1,
      todos: { total: 6, pending: 2, inProgress: 1, completed: 3, cancelled: 0, state: "mixed" },
      changedPaths: [{ path: "src/peer.ts", operation: "edit", additions: 4, deletions: 2, changeRevision: 1 }],
      currentTaskId: `task-${"a".repeat(64)}`,
      contextRevision: 12,
    }] } } });
    expect(JSON.stringify(status.body)).not.toContain(IDENTITY.session_id);
    expect(JSON.stringify(status.body)).not.toContain("todo text");
  });

  it("uses exact request hashes for replays and rejects idempotency-key disagreement", async () => {
    const first = await request("/register", "POST", registerBody());
    const replay = await request("/register", "POST", registerBody());
    expect(replay).toMatchObject({ response: { status: 201 }, body: { data: first.body.data } });

    const changed = await request("/register", "POST", registerBody({ ttl_ms: 299_999 }));
    expect(changed).toMatchObject({ response: { status: 409 }, body: { error: { code: "IDEMPOTENCY_KEY_REUSED" } } });
    expect(changed.body.error).not.toHaveProperty("currentRevision");

    const disagreement = await request("/register", "POST", registerBody(), {
      headers: { "Idempotency-Key": "different-header-key" },
    });
    expect(disagreement).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
  });

  it("maps invalid, missing, conflict, expiry, and integrity errors without disclosure", async () => {
    const malformed = await request("/register", "POST", { worktree_id: "only-one-field" });
    expect(malformed).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const malformedJson = await request("/register", "POST", "{", {
      headers: { "Content-Type": "application/json" },
    });
    expect(malformedJson).toMatchObject({ response: { status: 400 }, body: { error: { code: "MALFORMED_JSON" } } });
    const invalidQuery = await request("/snapshot", "GET", undefined, snapshotOptions({ ...IDENTITY, sessionId: "camel-case" }));
    expect(invalidQuery).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const missingProject = await request("/register", "POST", registerBody(), { project: "not-a-project" });
    expect(missingProject).toMatchObject({ response: { status: 404 }, body: { error: { code: "PROJECT_NOT_FOUND" } } });

    const session = await register();
    const missingSession = await request("/snapshot", "GET", undefined, snapshotOptions({ ...IDENTITY, session_id: "missing-session" }));
    expect(missingSession).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
    const duplicate = await request("/register", "POST", registerBody({ idempotency_key: "register-duplicate" }));
    expect(duplicate).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_IDENTITY_CONFLICT" } } });
    const stale = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "stale-heartbeat", { expected_revision: 99 }),
      ttl_ms: 300_000,
    });
    expect(stale).toMatchObject({ response: { status: 409 }, body: { error: { code: "REVISION_CONFLICT", currentRevision: session.revision } } });
    const suppliedFence = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "supplied-fence", { fence: 999 }),
      ttl_ms: 300_000,
    });
    expect(suppliedFence).toMatchObject({ response: { status: 409 }, body: { error: { code: "FENCE_CONFLICT" } } });
    const wrongOwner = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_B, "wrong-owner"),
      ttl_ms: 300_000,
    });
    expect(wrongOwner).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });

    const missingClaim = await request("/claims/release", "POST", {
      ...lease(session, TOKEN_A, "missing-claim"),
      client_claim_key: claimKey("missing-claim"),
    });
    expect(missingClaim).toMatchObject({ response: { status: 404 }, body: { error: { code: "CLAIM_NOT_FOUND" } } });
    const missingPointer = await request("/update", "PATCH", {
      ...lease(session, TOKEN_A, "missing-pointer"),
      snapshot: {},
      snapshot_revision: 1,
      current_task_id: "missing-task",
      current_task_revision: 0,
    });
    expect(missingPointer).toMatchObject({ response: { status: 404 }, body: { error: { code: "POINTER_NOT_FOUND" } } });

    getDb(databasePath).prepare("UPDATE coordination_sessions SET expires_at = ? WHERE session_id = ?")
      .run("2000-01-01T00:00:00.000Z", IDENTITY.session_id);
    const expired = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "expired-heartbeat"),
      ttl_ms: 300_000,
    });
    expect(expired).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_EXPIRED" } } });

    const db = getDb(databasePath);
    db.pragma("ignore_check_constraints = ON");
    db.prepare("UPDATE coordination_sessions SET snapshot_json = ? WHERE session_id = ?").run("not-json", IDENTITY.session_id);
    db.pragma("ignore_check_constraints = OFF");
    const integrity = await request("/snapshot", "GET", undefined, snapshotOptions());
    expect(integrity).toMatchObject({ response: { status: 500 }, body: { error: { code: "COORDINATION_INTEGRITY_ERROR" } } });
  });

  it("keeps sessions project-scoped and requires bearer plus ownership proof for takeover", async () => {
    const session = await register();
    const absent = await request("/snapshot", "GET", undefined, snapshotOptions({ ...IDENTITY, session_id: "missing-session" }));
    const foreign = await request("/snapshot", "GET", undefined, snapshotOptions(IDENTITY, TOKEN_A, { project: PROJECT_B }));
    expect(foreign.body).toEqual(absent.body);

    const takeoverBody = {
      ...IDENTITY,
      expected_revision: session.revision,
      fence: session.fence,
      ownership_token: TOKEN_A,
      next_ownership_token: TOKEN_B,
      ttl_ms: 300_000,
      idempotency_key: "takeover-auth",
    };
    const unauthorized = await request("/takeover", "POST", takeoverBody, { authorization: "" });
    expect(unauthorized).toMatchObject({ response: { status: 401 }, body: { error: { code: "UNAUTHORIZED" } } });
    const { ownership_token: _ownershipToken, ...missingOwnership } = takeoverBody;
    const missingProof = await request("/takeover", "POST", missingOwnership);
    expect(missingProof).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const authorized = await request("/takeover", "POST", takeoverBody);
    expect(authorized).toMatchObject({ response: { status: 200 }, body: { data: { takeoverEvidenceId: expect.any(String) } } });
  });

  it("denies same-worktree siblings without disclosing claims or changing the victim", async () => {
    const victim = await register({ idempotency_key: "victim-register" });
    const claimed = await request("/claims/batch", "POST", {
      ...lease(victim, TOKEN_A, "victim-claim"),
      client_claim_key: claimKey("victim-claim"),
      claims: [{ claim: { kind: "path", path: "victim/protected" } }],
    });
    const internalClaim = getDb(databasePath).prepare(
      "SELECT id, client_claim_key_hash FROM coordination_claims WHERE value = ?",
    ).get("victim/protected") as { id: string; client_claim_key_hash: string };
    expect(JSON.stringify(claimed.body)).not.toMatch(
      new RegExp(`${internalClaim.id}|${claimKey("victim-claim")}|${internalClaim.client_claim_key_hash}`),
    );
    const wrongKeyRelease = await request("/claims/release", "POST", {
      ...lease(claimed.body.data.session, TOKEN_A, "victim-wrong-key"),
      client_claim_key: claimKey("victim-wrong-key"),
    });
    expect(wrongKeyRelease).toMatchObject({ response: { status: 404 }, body: { error: { code: "CLAIM_NOT_FOUND" } } });
    expect(JSON.stringify(wrongKeyRelease.body)).not.toContain(internalClaim.id);
    await register({
      session_id: "same-worktree-sibling",
      ownership_token: TOKEN_B,
      idempotency_key: "sibling-register",
    });

    const siblingStatus = await request("/snapshot", "GET", undefined, snapshotOptions(IDENTITY, TOKEN_B));
    const missingProof = await request("/snapshot", "GET", undefined, { query: IDENTITY });
    const siblingTakeover = await request("/takeover", "POST", {
      ...lease(claimed.body.data.session, TOKEN_B, "sibling-takeover"),
      next_ownership_token: TOKEN_C,
      ttl_ms: 300_000,
    });
    const siblingRelease = await request("/claims/release", "POST", {
      ...lease(claimed.body.data.session, TOKEN_B, "sibling-release"),
      client_claim_key: claimKey("victim-claim"),
    });

    for (const denied of [siblingStatus, missingProof, siblingTakeover, siblingRelease]) {
      expect(denied).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
      expect(JSON.stringify(denied.body)).not.toMatch(
        new RegExp(`${claimKey("victim-claim")}|${TOKEN_A}|${TOKEN_B}|${TOKEN_C}`),
      );
    }
    const ownerStatus = await request("/snapshot", "GET", undefined, snapshotOptions());
    expect(ownerStatus).toMatchObject({
      response: { status: 200 },
      body: { data: { session: { state: "active" }, claims: [{ state: "active" }] } },
    });

    const releaseBody = {
      ...lease(claimed.body.data.session, TOKEN_A, "owner-release"),
      client_claim_key: claimKey("victim-claim"),
    };
    const released = await request("/claims/release", "POST", releaseBody);
    expect((await request("/claims/release", "POST", releaseBody)).body).toEqual(released.body);
    const closeBody = lease(released.body.data.session, TOKEN_A, "owner-close");
    const closed = await request("/close", "POST", closeBody);
    expect((await request("/close", "POST", closeBody)).body).toEqual(closed.body);
    expect(JSON.stringify({ released: released.body, closed: closed.body })).not.toContain(TOKEN_A);
  });

  it("atomically gives exactly one reconciled successor the recovered epoch", async () => {
    const crashed = await register({ idempotency_key: "epoch-crashed-register" });
    const crashedKey = claimKey("epoch-crashed-claim");
    const claimed = await request("/claims/batch", "POST", {
      ...lease(crashed, TOKEN_A, "epoch-crashed-claim"),
      client_claim_key: crashedKey,
      claims: [
        { claim: { kind: "path", path: "src/epoch-crashed.ts" } },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    });
    const quarantined = await request("/claims/quarantine", "POST", {
      ...lease(claimed.body.data.session, TOKEN_A, "epoch-crashed-quarantine"),
      client_claim_key: crashedKey,
      accepted_epoch: claimed.body.data.acceptedEpoch,
      code: "uncertain_apply",
    });
    expect(quarantined.body.data.session.state).toBe("quarantined");

    const successorIdentity = { ...IDENTITY, session_id: "epoch-successor" };
    const successor = await register({
      ...successorIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "epoch-successor-register",
    });
    const recoveryState = await request("/epoch/recovery-state", "POST", {
      ...lease(successor, TOKEN_B, "epoch-recovery-state", successorIdentity),
    });
    expect(recoveryState).toMatchObject({
      response: { status: 200 },
      body: { data: { quarantineCode: "uncertain_apply", reconciliationRecorded: false } },
    });
    const recoveryProof = {
      quarantined_session_id: recoveryState.body.data.quarantinedSessionId,
      quarantined_incarnation: recoveryState.body.data.quarantinedIncarnation,
      quarantined_fence: recoveryState.body.data.quarantinedFence,
      quarantined_actor_id: recoveryState.body.data.quarantinedActorId,
      accepted_epoch: recoveryState.body.data.acceptedEpoch,
      recovery_footprint_hash: "e".repeat(64),
    };
    const reconciled = await request("/epoch/reconcile", "POST", {
      ...lease(successor, TOKEN_B, "epoch-reconcile", successorIdentity),
      ...recoveryProof,
    });
    expect(reconciled).toMatchObject({
      response: { status: 200 },
      body: { data: { acceptedEpoch: claimed.body.data.acceptedEpoch } },
    });

    const attempts = await Promise.all(["epoch-recover-a", "epoch-recover-b"].map((idempotencyKey) => (
      request("/epoch/recover", "POST", {
        ...lease(reconciled.body.data.session, TOKEN_B, idempotencyKey, successorIdentity),
        ...recoveryProof,
      })
    )));
    expect(attempts.map((attempt) => attempt.response.status).sort()).toEqual([200, 409]);
    const winner = attempts.find((attempt) => attempt.response.status === 200)!;
    const loser = attempts.find((attempt) => attempt.response.status === 409)!;
    expect(winner.body.data.acceptedEpoch).toBe(claimed.body.data.acceptedEpoch + 1);
    expect(["REVISION_CONFLICT", "CLAIM_CONFLICT"]).toContain(loser.body.error.code);

    const successorClaim = await request("/claims/batch", "POST", {
      ...lease(winner.body.data.session, TOKEN_B, "epoch-successor-claim", successorIdentity),
      client_claim_key: claimKey("epoch-successor-claim"),
      claims: [{ claim: { kind: "reserved", name: "@build" } }],
    });
    expect(successorClaim).toMatchObject({
      response: { status: 200 },
      body: { data: { acceptedEpoch: winner.body.data.acceptedEpoch } },
    });
    assertRedacted({ reconciled: reconciled.body, winner: winner.body, loser: loser.body }, [TOKEN_A, TOKEN_B, crashedKey]);
  });

  it("maps session-state, claim, and pointer-revision conflicts exactly", async () => {
    const claimedSession = await register({ idempotency_key: "claim-conflict-register" });
    const firstClaim = await request("/claims/batch", "POST", {
      ...lease(claimedSession, TOKEN_A, "claim-conflict-first"),
      client_claim_key: claimKey("claim-conflict-first"),
      claims: [{ claim: { kind: "path", path: "safe/conflict-target" } }],
    });
    const claimConflict = await request("/claims/batch", "POST", {
      ...lease(firstClaim.body.data.session, TOKEN_A, "claim-conflict-second"),
      client_claim_key: claimKey("claim-conflict-second"),
      claims: [{ claim: { kind: "path", path: "safe/conflict-target" } }],
    });
    expect(claimConflict).toMatchObject({ response: { status: 409 }, body: { error: { code: "CLAIM_CONFLICT" } } });

    const siblingFixture = boundIdentity("sibling", "session-sibling");
    const siblingIdentity = siblingFixture.identity;
    const sibling = await register({
      ...siblingIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "claim-owner-register",
    }, { serviceBinding: siblingFixture.binding });
    const notOwned = await request("/claims/release", "POST", {
      ...lease(sibling, TOKEN_B, "claim-not-owned", siblingIdentity),
      client_claim_key: claimKey("claim-conflict-first"),
    }, { serviceBinding: siblingFixture.binding });
    expect(notOwned).toMatchObject({ response: { status: 404 }, body: { error: { code: "CLAIM_NOT_FOUND" } } });

    const closedFixture = boundIdentity("closed", "session-closed");
    const closedIdentity = closedFixture.identity;
    const toClose = await register({ ...closedIdentity, idempotency_key: "closed-register" }, { serviceBinding: closedFixture.binding });
    const closed = await request("/close", "POST", lease(toClose, TOKEN_A, "closed-close", closedIdentity), { serviceBinding: closedFixture.binding });
    const closedHeartbeat = await request("/heartbeat", "POST", {
      ...lease(closed.body.data.session, TOKEN_A, "closed-heartbeat", closedIdentity),
      ttl_ms: 300_000,
    }, { serviceBinding: closedFixture.binding });
    expect(closedHeartbeat).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_CLOSED" } } });

    const quarantinedFixture = boundIdentity("quarantined", "session-quarantined");
    const quarantinedIdentity = quarantinedFixture.identity;
    const quarantined = await register({ ...quarantinedIdentity, idempotency_key: "quarantined-register" }, { serviceBinding: quarantinedFixture.binding });
    getDb(databasePath).prepare("UPDATE coordination_sessions SET state = 'quarantined' WHERE session_id = ?")
      .run(quarantinedIdentity.session_id);
    const inactiveHeartbeat = await request("/heartbeat", "POST", {
      ...lease(quarantined, TOKEN_A, "quarantined-heartbeat", quarantinedIdentity),
      ttl_ms: 300_000,
    }, { serviceBinding: quarantinedFixture.binding });
    expect(inactiveHeartbeat).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_NOT_ACTIVE" } } });

    const pointerFixture = boundIdentity("pointer", "session-pointer");
    const pointerIdentity = pointerFixture.identity;
    const pointerSession = await register({ ...pointerIdentity, idempotency_key: "pointer-register" }, { serviceBinding: pointerFixture.binding });
    const task = tasks.createTask(primaryProjectId, "revised pointer task");
    getDb(databasePath).prepare("UPDATE tasks SET revision = revision + 1 WHERE id = ?").run(task.id);
    const pointerRevision = await request("/update", "PATCH", {
      ...lease(pointerSession, TOKEN_A, "pointer-revision", pointerIdentity),
      snapshot: {},
      snapshot_revision: 1,
      current_task_id: task.id,
      current_task_revision: task.revision,
    }, { serviceBinding: pointerFixture.binding });
    expect(pointerRevision).toMatchObject({ response: { status: 409 }, body: { error: { code: "POINTER_REVISION_CONFLICT" } } });
  });

  it("redacts nested snapshot and claim data and bounds status claims to 100", async () => {
    const session = await register();
    const task = tasks.createTask(primaryProjectId, "pointer task");
    const updated = await request("/update", "PATCH", {
      ...lease(session, TOKEN_A, "redaction-update"),
      snapshot: { prompt: "never disclose this prompt", nested: { operator_note: "also private" } },
      snapshot_revision: 7,
      current_task_id: task.id,
      current_task_revision: task.revision,
    });
    expect(updated.response.status).toBe(200);
    const baseline = "b".repeat(64);
    const claimed = await request("/claims/batch", "POST", {
      ...lease(updated.body.data.session, TOKEN_A, "redaction-claims"),
      client_claim_key: claimKey("redaction-claims"),
      claims: Array.from({ length: 101 }, (_, index) => ({
        claim: { kind: "path", path: `safe/claim-${index}` },
        baseline_sha256: baseline,
      })),
    });
    expect(claimed.response.status).toBe(200);
    const status = await request("/snapshot", "GET", undefined, snapshotOptions());
    expect(status).toMatchObject({ response: { status: 200 }, body: { data: { claimCount: 100, claimsTruncated: true } } });
    expect(status.body.data.claims).toHaveLength(100);
    assertRedacted(status.body, [TOKEN_A, baseline, "never disclose this prompt", "also private", "safe/claim-"]);
    expect(status.body.data.session).toMatchObject({
      currentTaskId: `task-${createHash("sha256").update(task.id).digest("hex")}`,
      currentTaskRevision: task.revision,
      snapshotRevision: 7,
    });
  });
});
