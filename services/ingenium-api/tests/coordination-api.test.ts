import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest, tasks } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { coordinationRouter } from "../lib/routes/coordination.js";
import { compatibilityAuthHeaders } from "./http-fixtures.js";

const API_TOKEN = "a".repeat(32);
const TOKEN_A = "A".repeat(32);
const TOKEN_B = "B".repeat(32);
const TOKEN_C = "C".repeat(32);
const PROJECT_A = "coordination-api-primary";
const PROJECT_B = "coordination-api-secondary";
const IDENTITY = { worktree_id: "worktree-main", session_id: "session-main", incarnation: 1 };

let directory = "";
let databasePath = "";
let server: Server | undefined;
let origin = "";
let primaryProjectId = "";
let originalDbPath: string | undefined;
let originalHome: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

type Session = { id: string; revision: number; fence: number; state: string };
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
  } = {},
): Promise<ApiResult> {
  const query = new URLSearchParams({ project: options.project ?? PROJECT_A });
  for (const [key, value] of Object.entries(options.query ?? {})) query.set(key, String(value));
  const headers: Record<string, string> = {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.authorization === undefined ? compatibilityAuthHeaders(API_TOKEN) : { Authorization: options.authorization }),
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
  app.use("/api/v1/coordination", coordinationRouter);
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
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
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
  it("exposes every lifecycle method with the declared success statuses", async () => {
    const registered = await register();

    const initialSnapshot = await request("/snapshot", "GET", undefined, { query: IDENTITY });
    expect(initialSnapshot).toMatchObject({ response: { status: 200 }, body: { data: { claims: [], claimCount: 0, claimsTruncated: false } } });

    const updated = await request("/update", "PATCH", {
      ...lease(registered, TOKEN_A, "update-main"),
      snapshot: { phase: "working" },
      snapshot_revision: 1,
      current_task_id: null,
      current_task_revision: null,
      context_conversation_id: null,
      context_revision: null,
    });
    expect(updated.response.status).toBe(200);

    const heartbeated = await request("/heartbeat", "POST", {
      ...lease(updated.body.data.session, TOKEN_A, "heartbeat-main"),
      ttl_ms: 300_000,
    });
    expect(heartbeated.response.status).toBe(200);

    const claimed = await request("/claims/batch", "POST", {
      ...lease(heartbeated.body.data.session, TOKEN_A, "claim-main"),
      claims: [{ claim: { kind: "path", path: "services/ingenium-api/lib/routes/coordination.ts" } }],
    });
    expect(claimed).toMatchObject({ response: { status: 200 }, body: { data: { claimIds: [expect.any(String)] } } });

    const released = await request("/claims/release", "POST", {
      ...lease(claimed.body.data.session, TOKEN_A, "release-main"),
      claim_ids: claimed.body.data.claimIds,
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
      next_ownership_token: TOKEN_C,
      ttl_ms: 300_000,
      idempotency_key: "takeover-main",
    });
    expect(taken).toMatchObject({ response: { status: 200 }, body: { data: { takeoverEvidenceId: expect.any(String) } } });

    const closed = await request("/close", "POST", lease(taken.body.data.session, TOKEN_C, "close-main"));
    expect(closed).toMatchObject({ response: { status: 200 }, body: { data: { session: { state: "closed" } } } });
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
    const invalidQuery = await request("/snapshot", "GET", undefined, { query: { ...IDENTITY, sessionId: "camel-case" } });
    expect(invalidQuery).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const missingProject = await request("/register", "POST", registerBody(), { project: "not-a-project" });
    expect(missingProject).toMatchObject({ response: { status: 404 }, body: { error: { code: "PROJECT_NOT_FOUND" } } });

    const session = await register();
    const missingSession = await request("/snapshot", "GET", undefined, {
      query: { ...IDENTITY, session_id: "missing-session" },
    });
    expect(missingSession).toMatchObject({ response: { status: 404 }, body: { error: { code: "SESSION_NOT_FOUND" } } });
    const duplicate = await request("/register", "POST", registerBody({ idempotency_key: "register-duplicate" }));
    expect(duplicate).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_IDENTITY_CONFLICT" } } });
    const stale = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "stale-heartbeat", { expected_revision: 99 }),
      ttl_ms: 300_000,
    });
    expect(stale).toMatchObject({ response: { status: 409 }, body: { error: { code: "REVISION_CONFLICT", currentRevision: session.revision } } });
    const wrongFence = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "wrong-fence", { fence: session.fence + 1 }),
      ttl_ms: 300_000,
    });
    expect(wrongFence).toMatchObject({ response: { status: 409 }, body: { error: { code: "FENCE_CONFLICT" } } });
    expect(wrongFence.body.error).not.toHaveProperty("currentRevision");
    const wrongOwner = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_B, "wrong-owner"),
      ttl_ms: 300_000,
    });
    expect(wrongOwner).toMatchObject({ response: { status: 409 }, body: { error: { code: "OWNERSHIP_TOKEN_MISMATCH" } } });

    const missingClaim = await request("/claims/release", "POST", {
      ...lease(session, TOKEN_A, "missing-claim"),
      claim_ids: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(missingClaim).toMatchObject({ response: { status: 404 }, body: { error: { code: "CLAIM_NOT_FOUND" } } });
    const missingPointer = await request("/update", "PATCH", {
      ...lease(session, TOKEN_A, "missing-pointer"),
      snapshot: {},
      snapshot_revision: 1,
      current_task_id: "missing-task",
      current_task_revision: 0,
      context_conversation_id: null,
      context_revision: null,
    });
    expect(missingPointer).toMatchObject({ response: { status: 404 }, body: { error: { code: "POINTER_NOT_FOUND" } } });

    getDb(databasePath).prepare("UPDATE coordination_sessions SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", session.id);
    const expired = await request("/heartbeat", "POST", {
      ...lease(session, TOKEN_A, "expired-heartbeat"),
      ttl_ms: 300_000,
    });
    expect(expired).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_EXPIRED" } } });

    const db = getDb(databasePath);
    db.pragma("ignore_check_constraints = ON");
    db.prepare("UPDATE coordination_sessions SET snapshot_json = ? WHERE id = ?").run("not-json", session.id);
    db.pragma("ignore_check_constraints = OFF");
    const integrity = await request("/snapshot", "GET", undefined, { query: IDENTITY });
    expect(integrity).toMatchObject({ response: { status: 500 }, body: { error: { code: "COORDINATION_INTEGRITY_ERROR" } } });
  });

  it("keeps sessions project-scoped, takeover bearer-protected, and takeover input token-free", async () => {
    const session = await register();
    const absent = await request("/snapshot", "GET", undefined, {
      query: { ...IDENTITY, session_id: "missing-session" },
    });
    const foreign = await request("/snapshot", "GET", undefined, { project: PROJECT_B, query: IDENTITY });
    expect(foreign.body).toEqual(absent.body);

    const takeoverBody = {
      ...IDENTITY,
      expected_revision: session.revision,
      fence: session.fence,
      next_ownership_token: TOKEN_B,
      ttl_ms: 300_000,
      idempotency_key: "takeover-auth",
    };
    const unauthorized = await request("/takeover", "POST", takeoverBody, { authorization: "" });
    expect(unauthorized).toMatchObject({ response: { status: 401 }, body: { error: { code: "UNAUTHORIZED" } } });
    const oldTokenShape = await request("/takeover", "POST", { ...takeoverBody, ownership_token: TOKEN_A, authorized: true });
    expect(oldTokenShape).toMatchObject({ response: { status: 422 }, body: { error: { code: "INVALID_COORDINATION_INPUT" } } });
    const authorized = await request("/takeover", "POST", takeoverBody);
    expect(authorized).toMatchObject({ response: { status: 200 }, body: { data: { takeoverEvidenceId: expect.any(String) } } });
  });

  it("maps session-state, claim, and pointer-revision conflicts exactly", async () => {
    const claimedSession = await register({ idempotency_key: "claim-conflict-register" });
    const firstClaim = await request("/claims/batch", "POST", {
      ...lease(claimedSession, TOKEN_A, "claim-conflict-first"),
      claims: [{ claim: { kind: "path", path: "safe/conflict-target" } }],
    });
    const claimConflict = await request("/claims/batch", "POST", {
      ...lease(firstClaim.body.data.session, TOKEN_A, "claim-conflict-second"),
      claims: [{ claim: { kind: "path", path: "safe/conflict-target" } }],
    });
    expect(claimConflict).toMatchObject({ response: { status: 409 }, body: { error: { code: "CLAIM_CONFLICT" } } });

    const siblingIdentity = { worktree_id: "worktree-sibling", session_id: "session-sibling", incarnation: 1 };
    const sibling = await register({
      ...siblingIdentity,
      ownership_token: TOKEN_B,
      idempotency_key: "claim-owner-register",
    });
    const notOwned = await request("/claims/release", "POST", {
      ...lease(sibling, TOKEN_B, "claim-not-owned", siblingIdentity),
      claim_ids: firstClaim.body.data.claimIds,
    });
    expect(notOwned).toMatchObject({ response: { status: 409 }, body: { error: { code: "CLAIM_NOT_OWNED" } } });

    const closedIdentity = { worktree_id: "worktree-closed", session_id: "session-closed", incarnation: 1 };
    const toClose = await register({ ...closedIdentity, idempotency_key: "closed-register" });
    const closed = await request("/close", "POST", lease(toClose, TOKEN_A, "closed-close", closedIdentity));
    const closedHeartbeat = await request("/heartbeat", "POST", {
      ...lease(closed.body.data.session, TOKEN_A, "closed-heartbeat", closedIdentity),
      ttl_ms: 300_000,
    });
    expect(closedHeartbeat).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_CLOSED" } } });

    const quarantinedIdentity = { worktree_id: "worktree-quarantined", session_id: "session-quarantined", incarnation: 1 };
    const quarantined = await register({ ...quarantinedIdentity, idempotency_key: "quarantined-register" });
    getDb(databasePath).prepare("UPDATE coordination_sessions SET state = 'quarantined' WHERE id = ?").run(quarantined.id);
    const inactiveHeartbeat = await request("/heartbeat", "POST", {
      ...lease(quarantined, TOKEN_A, "quarantined-heartbeat", quarantinedIdentity),
      ttl_ms: 300_000,
    });
    expect(inactiveHeartbeat).toMatchObject({ response: { status: 409 }, body: { error: { code: "SESSION_NOT_ACTIVE" } } });

    const pointerIdentity = { worktree_id: "worktree-pointer", session_id: "session-pointer", incarnation: 1 };
    const pointerSession = await register({ ...pointerIdentity, idempotency_key: "pointer-register" });
    const task = tasks.createTask(primaryProjectId, "revised pointer task");
    getDb(databasePath).prepare("UPDATE tasks SET revision = revision + 1 WHERE id = ?").run(task.id);
    const pointerRevision = await request("/update", "PATCH", {
      ...lease(pointerSession, TOKEN_A, "pointer-revision", pointerIdentity),
      snapshot: {},
      snapshot_revision: 1,
      current_task_id: task.id,
      current_task_revision: task.revision,
      context_conversation_id: null,
      context_revision: null,
    });
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
      context_conversation_id: null,
      context_revision: null,
    });
    expect(updated.response.status).toBe(200);
    const baseline = "b".repeat(64);
    const claimed = await request("/claims/batch", "POST", {
      ...lease(updated.body.data.session, TOKEN_A, "redaction-claims"),
      claims: Array.from({ length: 101 }, (_, index) => ({
        claim: { kind: "path", path: `safe/claim-${index}` },
        baseline_sha256: baseline,
      })),
    });
    expect(claimed.response.status).toBe(200);
    const status = await request("/snapshot", "GET", undefined, { query: IDENTITY });
    expect(status).toMatchObject({ response: { status: 200 }, body: { data: { claimCount: 100, claimsTruncated: true } } });
    expect(status.body.data.claims).toHaveLength(100);
    assertRedacted(status.body, [TOKEN_A, baseline, "never disclose this prompt", "also private", "safe/claim-"]);
    expect(status.body.data.session).toMatchObject({ currentTaskId: task.id, currentTaskRevision: task.revision, snapshotRevision: 7 });
  });
});
