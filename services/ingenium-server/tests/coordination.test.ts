import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mockApi = {
  get: vi.fn(),
  getCoordinationSnapshot: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: { settled: mockApi } }));

const coordination = await import("../lib/tools/coordination.js");

const PROJECT = "coordination-project";
const TOKEN = "A".repeat(32);
const NEXT_TOKEN = "B".repeat(32);
const CLIENT_CLAIM_KEY = "C".repeat(32);
const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const CLAIM_ID = "00000000-0000-4000-8000-000000000002";
const TIMESTAMP = "2026-08-01T00:00:00.000Z";

const session = {
  actorId: `actor-${"a".repeat(64)}`,
  revision: 3,
  fence: 1,
  state: "active",
  heartbeatAt: TIMESTAMP,
  expiresAt: "2026-08-01T00:05:00.000Z",
  snapshotRevision: 2,
  currentTaskId: null,
  currentTaskRevision: null,
  contextConversationId: null,
  contextRevision: null,
  updatedAt: TIMESTAMP,
};

function success(data: unknown = { session }) {
  return { ok: true, status: 200, data };
}

function text(result: { content: [{ text: string }] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const lease = {
  worktree_id: "worktree-main",
  session_id: "session-main",
  incarnation: 1,
  expected_revision: 3,
  fence: 1,
  ownership_token: TOKEN,
  idempotency_key: "coordination-1",
};
const handoffEvent = {
  sequence: 1,
  eventId: CLAIM_ID,
  operation: "edit",
  path: "services/ingenium-server/lib/tools/coordination.ts",
  baselineSha256: null,
  sourceActorId: `actor-${"b".repeat(64)}`,
  sourceIncarnation: 2,
  sourceRevision: 4,
  currentTaskId: null,
  currentTaskRevision: null,
  contextConversationId: null,
  contextRevision: null,
  timestamp: TIMESTAMP,
};

describe("coordination MCP transport adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.post.mockResolvedValue(success());
    mockApi.patch.mockResolvedValue(success());
    mockApi.getCoordinationSnapshot.mockResolvedValue(success({
      session: { ...session, worktreeId: "worktree-main", incarnation: 1, createdAt: TIMESTAMP },
      claims: [{ kind: "path", state: "active", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, releasedAt: null }],
      claimCount: 1,
      claimsTruncated: false,
      peers: [],
    }));
  });

  it("GETs the exact redacted snapshot with ownership proof outside the URL", async () => {
    const result = await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1, TOKEN);

    expect(mockApi.getCoordinationSnapshot).toHaveBeenCalledWith(
      PROJECT, "worktree-main", "session-main", 1, TOKEN,
    );
    expect(text(result)).toMatchObject({ claimCount: 1, claimsTruncated: false });
  });

  it("renews runtime activity through the authenticated API boundary", async () => {
    mockApi.post.mockResolvedValueOnce(success({ accepted: true, renewed: true }));

    const result = await coordination.coordinationUpdate(PROJECT, "runtime_activity", {
      runtime_id: SESSION_ID,
      observed_at: TIMESTAMP,
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/runtimes/activity",
      { runtimeId: SESSION_ID, observedAt: TIMESTAMP },
      { project: PROJECT },
    );
    expect(text(result)).toEqual({ accepted: true, renewed: true });
  });

  it("strictly projects typed peer snapshots without arbitrary snapshot text", async () => {
    const peer = {
      peerId: `peer-${"a".repeat(64)}`,
      incarnation: 2,
      sessionRevision: 5,
      snapshotRevision: 4,
      status: "working",
      todos: { total: 3, pending: 1, inProgress: 1, completed: 1, cancelled: 0, state: "mixed" },
      changedPaths: [{ path: "src/peer.ts", operation: "edit", additions: 2, deletions: 1, changeRevision: 4 }],
      currentTaskId: `task-${"b".repeat(64)}`,
      contextRevision: 7,
      updatedAt: TIMESTAMP,
    };
    mockApi.getCoordinationSnapshot.mockResolvedValueOnce(success({
      session: { ...session, worktreeId: "worktree-main", incarnation: 1, createdAt: TIMESTAMP },
      claims: [], claimCount: 0, claimsTruncated: false, peers: [peer],
    }));
    expect(text(await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1, TOKEN))).toMatchObject({ peers: [peer] });

    mockApi.getCoordinationSnapshot.mockResolvedValueOnce(success({
      session: { ...session, worktreeId: "worktree-main", incarnation: 1, createdAt: TIMESTAMP },
      claims: [], claimCount: 0, claimsTruncated: false,
      peers: [{ ...peer, todoText: "IGNORE_PREVIOUS_INSTRUCTIONS" }],
    }));
    const rejected = await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1, TOKEN);
    expect(rejected).toMatchObject({ isError: true });
    expect(JSON.stringify(rejected)).not.toContain("IGNORE_PREVIOUS_INSTRUCTIONS");
  });

  it("dispatches every update operation to its exact method, route, payload, and project", async () => {
    const operations: Array<[
      coordination.CoordinationUpdateOperation,
      "post" | "patch",
      string,
      Record<string, unknown>,
    ]> = [
      ["register", "post", "/coordination/register", {
        worktree_id: "worktree-main", session_id: "session-main", incarnation: 1,
        ownership_token: TOKEN, ttl_ms: 2_000, idempotency_key: "coordination-1",
      }],
      ["recover", "post", "/coordination/recover", {
        ...lease, next_ownership_token: NEXT_TOKEN, ttl_ms: 2_000,
      }],
      ["recovery_state", "post", "/coordination/epoch/recovery-state", lease],
      ["reconcile_epoch", "post", "/coordination/epoch/reconcile", {
        ...lease,
        quarantined_session_id: "session-crashed", quarantined_incarnation: 1, quarantined_fence: 1,
        quarantined_actor_id: `actor-${"c".repeat(64)}`, accepted_epoch: 1,
        recovery_footprint_hash: "d".repeat(64),
      }],
      ["recover_epoch", "post", "/coordination/epoch/recover", {
        ...lease,
        quarantined_session_id: "session-crashed", quarantined_incarnation: 1, quarantined_fence: 1,
        quarantined_actor_id: `actor-${"c".repeat(64)}`, accepted_epoch: 1,
        recovery_footprint_hash: "d".repeat(64),
      }],
      ["update", "patch", "/coordination/update", {
        ...lease, snapshot: { objective: "test" }, snapshot_revision: 2,
        current_task_id: null, current_task_revision: null,
      }],
      ["heartbeat", "post", "/coordination/heartbeat", { ...lease, ttl_ms: 2_000 }],
      ["close", "post", "/coordination/close", lease],
      ["takeover", "post", "/coordination/takeover", {
        ...lease,
        next_ownership_token: NEXT_TOKEN, ttl_ms: 2_000,
      }],
    ];

    for (const [operation, method, path, payload] of operations) {
      await coordination.coordinationUpdate(PROJECT, operation, {
        ...lease,
        operation,
        ownership_token: TOKEN,
        next_ownership_token: NEXT_TOKEN,
        ttl_ms: 2_000,
        snapshot: { objective: "test" },
        snapshot_revision: 2,
        current_task_id: null,
        current_task_revision: null,
        context_conversation_id: null,
        context_revision: null,
        quarantined_session_id: "session-crashed",
        quarantined_incarnation: 1,
        quarantined_fence: 1,
        quarantined_actor_id: `actor-${"c".repeat(64)}`,
        accepted_epoch: 1,
        recovery_footprint_hash: "d".repeat(64),
      });
      expect(mockApi[method]).toHaveBeenLastCalledWith(path, payload, { project: PROJECT });
    }
    expect(mockApi.post).toHaveBeenCalledTimes(8);
    expect(mockApi.patch).toHaveBeenCalledTimes(1);
  });

  it("POSTs exact batch claim and release payloads without echoing request fields", async () => {
    await coordination.coordinationClaim(PROJECT, {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [
        { claim: { kind: "path", path: "services/ingenium-server/lib/tools/coordination.ts" }, baseline_sha256: "a".repeat(64) },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    });
    expect(mockApi.post).toHaveBeenNthCalledWith(1, "/coordination/claims/batch", {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [
        { claim: { kind: "path", path: "services/ingenium-server/lib/tools/coordination.ts" }, baseline_sha256: "a".repeat(64) },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    }, { project: PROJECT });

    await coordination.coordinationRelease(PROJECT, { ...lease, client_claim_key: CLIENT_CLAIM_KEY });
    expect(mockApi.post).toHaveBeenNthCalledWith(2, "/coordination/claims/release", {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
    }, { project: PROJECT });

    const serialized = JSON.stringify(text(await coordination.coordinationClaim(PROJECT, {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    })));
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(CLIENT_CLAIM_KEY);
    expect(serialized).not.toContain("safe/file.ts");
  });

  it("preserves valid redacted mutation DTO variants exactly", async () => {
    const claimResponse = { session, acceptedEpoch: 1, manifestGeneration: 0 };
    mockApi.post.mockResolvedValueOnce(success(claimResponse));
    await expect(coordination.coordinationClaim(PROJECT, {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    })).resolves.toMatchObject({ content: [{ text: JSON.stringify(claimResponse) }] });

    const takeoverResponse = { session, takeoverEvidenceId: CLAIM_ID };
    mockApi.post.mockResolvedValueOnce(success(takeoverResponse));
    await expect(coordination.coordinationUpdate(PROJECT, "takeover", {
      worktree_id: lease.worktree_id,
      session_id: lease.session_id,
      incarnation: lease.incarnation,
      expected_revision: lease.expected_revision,
       ownership_token: TOKEN,
      next_ownership_token: NEXT_TOKEN,
      ttl_ms: 2_000,
      idempotency_key: lease.idempotency_key,
    })).resolves.toMatchObject({ content: [{ text: JSON.stringify(takeoverResponse) }] });
  });

  it("POSTs and strictly projects publish, read, acknowledge, and consume handoff operations", async () => {
    mockApi.post.mockResolvedValueOnce(success({ session, event: handoffEvent }));
    const published = await coordination.coordinationHandoff(PROJECT, "publish", {
      ...lease,
      operation_kind: "edit",
      path: handoffEvent.path,
      baseline_sha256: null,
    });
    expect(mockApi.post).toHaveBeenNthCalledWith(1, "/coordination/handoffs/publish", {
      ...lease,
      operation: "edit",
      path: handoffEvent.path,
      baseline_sha256: null,
    }, { project: PROJECT });
    expect(text(published)).toEqual({ session, event: handoffEvent });

    const readResponse = { session, events: [handoffEvent], throughSequence: 1, acknowledgementRequired: true };
    mockApi.post.mockResolvedValueOnce(success(readResponse));
    const read = await coordination.coordinationHandoff(PROJECT, "read", { ...lease, limit: 32 });
    expect(mockApi.post).toHaveBeenNthCalledWith(2, "/coordination/handoffs/read", {
      ...lease,
      limit: 32,
    }, { project: PROJECT });
    expect(text(read)).toEqual(readResponse);

    mockApi.post.mockResolvedValueOnce(success({ session }));
    const acknowledged = await coordination.coordinationHandoff(PROJECT, "ack", { ...lease, through_sequence: 1 });
    expect(mockApi.post).toHaveBeenNthCalledWith(3, "/coordination/handoffs/ack", {
      ...lease,
      through_sequence: 1,
    }, { project: PROJECT });
    expect(text(acknowledged)).toEqual({ session });

    mockApi.post.mockResolvedValueOnce(success({ session, events: [handoffEvent] }));
    const consumed = await coordination.coordinationHandoff(PROJECT, "consume", { ...lease, limit: 32 });
    expect(mockApi.post).toHaveBeenNthCalledWith(4, "/coordination/handoffs/consume", {
      ...lease,
      limit: 32,
    }, { project: PROJECT });
    expect(text(consumed)).toEqual({ session, events: [handoffEvent] });

    mockApi.post.mockResolvedValueOnce(success({ session, event: { ...handoffEvent, prompt: TOKEN } }));
    const rejected = await coordination.coordinationHandoff(PROJECT, "publish", {
      ...lease, operation_kind: "edit", path: handoffEvent.path,
    });
    expect(rejected).toMatchObject({ isError: true });
    expect(JSON.stringify(rejected)).not.toContain(TOKEN);
  });

  it("POSTs and strictly projects typed operational memory", async () => {
    const inputEntry = {
      status: "idle",
      actions: [{ kind: "edit", result: "succeeded", pathSegments: ["c3Jj", "c2FmZS50cw"], targetHash: null }],
      checks: [{ kind: "typecheck", result: "passed", targetHash: "a".repeat(64) }],
      todos: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, state: "none" },
      currentTaskId: null,
      changedPaths: [],
      nextWork: { kind: "none", referenceHash: null },
    };
    const storedEntry = {
      version: 1,
      type: "operational",
      entryId: SESSION_ID,
      actorId: session.actorId,
      sourceRevision: 4,
      contextRevision: 0,
      timestamp: TIMESTAMP,
      ...inputEntry,
    };
    const response = {
      session,
      memory: { conversationId: SESSION_ID, revision: 1, entry: storedEntry },
    };
    mockApi.post.mockResolvedValueOnce(success(response));

    const result = await coordination.coordinationHandoff(PROJECT, "memory", {
      ...lease,
      memory_entry: inputEntry,
    });

    expect(mockApi.post).toHaveBeenCalledWith("/coordination/memory/publish", {
      ...lease,
      entry: inputEntry,
    }, { project: PROJECT });
    expect(text(result)).toEqual(response);

    mockApi.post.mockResolvedValueOnce(success({
      ...response,
      memory: { ...response.memory, entry: { ...storedEntry, contextRevision: null } },
    }));
    const rejected = await coordination.coordinationHandoff(PROJECT, "memory", {
      ...lease,
      memory_entry: inputEntry,
    });
    expect(rejected).toMatchObject({ isError: true });

    const window = {
      session,
      memory: {
        conversationId: SESSION_ID,
        revision: 1,
        entries: [storedEntry],
        throughRevision: 1,
        acknowledgementRequired: true,
      },
    };
    mockApi.post.mockResolvedValueOnce(success(window));
    const read = await coordination.coordinationHandoff(PROJECT, "memory_read", { ...lease, limit: 8 });
    expect(mockApi.post).toHaveBeenLastCalledWith("/coordination/memory/read", { ...lease, limit: 8 }, { project: PROJECT });
    expect(text(read)).toEqual(window);

    mockApi.post.mockResolvedValueOnce(success({ session }));
    const acknowledged = await coordination.coordinationHandoff(PROJECT, "memory_ack", { ...lease, through_revision: 1 });
    expect(mockApi.post).toHaveBeenLastCalledWith("/coordination/memory/ack", {
      ...lease,
      through_revision: 1,
    }, { project: PROJECT });
    expect(text(acknowledged)).toEqual({ session });
  });

  it("returns only allowlisted API error fields and a fixed message", async () => {
    mockApi.post.mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        error: {
          code: "REVISION_CONFLICT",
          currentRevision: 9,
          message: `upstream secret ${TOKEN}`,
          token: TOKEN,
          path: "/private",
        },
      },
    });

    const result = await coordination.coordinationUpdate(PROJECT, "heartbeat", {
      ...lease,
      ttl_ms: 2_000,
    });

    expect(result).toMatchObject({ isError: true });
    expect(text(result)).toEqual({
      error: {
        code: "REVISION_CONFLICT",
        message: "The coordination request failed.",
        currentRevision: 9,
      },
    });
  });

  it("does not disclose claim ownership or unbounded conflict metadata", async () => {
    mockApi.post.mockResolvedValue({
      ok: false,
      status: 409,
      data: {
        error: {
          code: "CLAIM_CONFLICT",
          message: TOKEN,
          owner: "foreign-session",
          worktree: "/private/worktree",
          retryAfterMs: Number.MAX_SAFE_INTEGER,
        },
      },
    });

    const result = await coordination.coordinationClaim(PROJECT, {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });

    expect(text(result)).toEqual({ error: { code: "CLAIM_CONFLICT", message: "The coordination request failed." } });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${TOKEN}|foreign-session|private/worktree|retryAfterMs`));
  });

  it("preserves only the fixed rate-limit code", async () => {
    mockApi.post.mockResolvedValue({
      ok: false,
      status: 429,
      data: { error: { code: "RATE_LIMITED", message: TOKEN, retryAfter: TOKEN } },
    });

    const result = await coordination.coordinationUpdate(PROJECT, "heartbeat", { ...lease, ttl_ms: 2_000 });

    expect(text(result)).toEqual({ error: { code: "RATE_LIMITED", message: "The coordination request failed." } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("rejects malformed successful API DTOs without exposing forbidden fields", async () => {
    mockApi.getCoordinationSnapshot.mockResolvedValue(success({
      session: {
        ...session,
        worktreeId: "worktree-main",
        sessionId: "session-main",
        incarnation: 1,
        createdAt: TIMESTAMP,
        snapshot: { token: TOKEN },
        token: TOKEN,
        hash: "private-hash",
      },
      claims: [{
        id: CLAIM_ID,
        kind: "path",
        state: "active",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        releasedAt: null,
        value: TOKEN,
        baseline: "private-baseline",
        path: "private/path",
      }],
      claimCount: 1,
      claimsTruncated: false,
      requestArguments: { ownership_token: TOKEN },
    }));

    const result = await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1, TOKEN);
    expect(result).toMatchObject({ isError: true });
    expect(text(result)).toEqual({
      error: {
        code: "COORDINATION_INVALID_RESPONSE",
        message: "The coordination response is invalid.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("rejects recursive malicious DTOs for every response variant", async () => {
    const invalid = (result: { isError?: boolean; content: [{ text: string }] }) => {
      expect(result).toMatchObject({ isError: true });
      expect(text(result)).toEqual({
        error: {
          code: "COORDINATION_INVALID_RESPONSE",
          message: "The coordination response is invalid.",
        },
      });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    };

    mockApi.post.mockResolvedValueOnce(success({
      session: { ...session, id: { token: TOKEN } },
    }));
    invalid(await coordination.coordinationUpdate(PROJECT, "heartbeat", { ...lease, ttl_ms: 2_000 }));

    mockApi.post.mockResolvedValueOnce(success({
      session,
      takeoverEvidenceId: { nested: { token: TOKEN } },
    }));
    invalid(await coordination.coordinationUpdate(PROJECT, "takeover", {
      worktree_id: lease.worktree_id,
      session_id: lease.session_id,
      incarnation: lease.incarnation,
      expected_revision: lease.expected_revision,
      ownership_token: TOKEN,
      next_ownership_token: NEXT_TOKEN,
      ttl_ms: 2_000,
      idempotency_key: lease.idempotency_key,
    }));

    mockApi.post.mockResolvedValueOnce(success({
      session,
      internalClaims: [{ nested: { path: TOKEN } }],
    }));
    invalid(await coordination.coordinationClaim(PROJECT, {
      ...lease,
      client_claim_key: CLIENT_CLAIM_KEY,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    }));

    mockApi.getCoordinationSnapshot.mockResolvedValueOnce(success({
      session: {
        ...session,
        worktreeId: "worktree-main",
        sessionId: "session-main",
        incarnation: 1,
        createdAt: TIMESTAMP,
        currentTaskId: { nested: { value: TOKEN } },
      },
      claims: [{
        id: CLAIM_ID,
        kind: "path",
        state: "active",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        releasedAt: null,
        nested: { hash: TOKEN },
      }],
      claimCount: 1,
      claimsTruncated: false,
    }));
    invalid(await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1, TOKEN));
  });

  it("uses fixed unavailable output after network or retry exhaustion", async () => {
    mockApi.post.mockRejectedValue(new Error(`network details ${TOKEN}`));

    const result = await coordination.coordinationUpdate(PROJECT, "close", lease);

    expect(result).toMatchObject({ isError: true });
    expect(text(result)).toEqual({
      error: {
        code: "COORDINATION_UNAVAILABLE",
        message: "The coordination service is unavailable.",
      },
    });
  });

  it("registers exactly the five coordination transport tools", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
    const names = [...source.matchAll(/server\.registerTool\(\s*"(coordination_[a-z]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([
      "coordination_status",
      "coordination_update",
      "coordination_claim",
      "coordination_release",
      "coordination_handoff",
    ]);
  });
});
