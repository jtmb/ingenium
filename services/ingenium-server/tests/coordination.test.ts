import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: { settled: mockApi } }));

const coordination = await import("../lib/tools/coordination.js");

const PROJECT = "coordination-project";
const TOKEN = "A".repeat(32);
const NEXT_TOKEN = "B".repeat(32);
const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const CLAIM_ID = "00000000-0000-4000-8000-000000000002";
const TIMESTAMP = "2026-08-01T00:00:00.000Z";

const session = {
  id: SESSION_ID,
  revision: 3,
  fence: 4,
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
  fence: 4,
  ownership_token: TOKEN,
  idempotency_key: "coordination-1",
};

describe("coordination MCP transport adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.post.mockResolvedValue(success());
    mockApi.patch.mockResolvedValue(success());
    mockApi.get.mockResolvedValue(success({
      session: { ...session, worktreeId: "worktree-main", sessionId: "session-main", incarnation: 1, createdAt: TIMESTAMP },
      claims: [{ id: CLAIM_ID, kind: "path", state: "active", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, releasedAt: null }],
      claimCount: 1,
      claimsTruncated: false,
    }));
  });

  it("GETs the exact redacted snapshot query with explicit project scope", async () => {
    const result = await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1);

    expect(mockApi.get).toHaveBeenCalledWith("/coordination/snapshot", {
      project: PROJECT,
      worktree_id: "worktree-main",
      session_id: "session-main",
      incarnation: "1",
    });
    expect(text(result)).toMatchObject({ claimCount: 1, claimsTruncated: false });
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
      ["update", "patch", "/coordination/update", {
        ...lease, snapshot: { objective: "test" }, snapshot_revision: 2,
        current_task_id: null, current_task_revision: null,
        context_conversation_id: null, context_revision: null,
      }],
      ["heartbeat", "post", "/coordination/heartbeat", { ...lease, ttl_ms: 2_000 }],
      ["close", "post", "/coordination/close", lease],
      ["takeover", "post", "/coordination/takeover", {
        worktree_id: "worktree-main", session_id: "session-main", incarnation: 1,
        expected_revision: 3, fence: 4, idempotency_key: "coordination-1",
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
      });
      expect(mockApi[method]).toHaveBeenLastCalledWith(path, payload, { project: PROJECT });
    }
    expect(mockApi.post).toHaveBeenCalledTimes(5);
    expect(mockApi.patch).toHaveBeenCalledTimes(1);
  });

  it("POSTs exact batch claim and release payloads without echoing request fields", async () => {
    await coordination.coordinationClaim(PROJECT, {
      ...lease,
      claims: [
        { claim: { kind: "path", path: "services/ingenium-server/lib/tools/coordination.ts" }, baseline_sha256: "a".repeat(64) },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    });
    expect(mockApi.post).toHaveBeenNthCalledWith(1, "/coordination/claims/batch", {
      ...lease,
      claims: [
        { claim: { kind: "path", path: "services/ingenium-server/lib/tools/coordination.ts" }, baseline_sha256: "a".repeat(64) },
        { claim: { kind: "reserved", name: "@build" } },
      ],
    }, { project: PROJECT });

    await coordination.coordinationRelease(PROJECT, { ...lease, claim_ids: [CLAIM_ID] });
    expect(mockApi.post).toHaveBeenNthCalledWith(2, "/coordination/claims/release", {
      ...lease,
      claim_ids: [CLAIM_ID],
    }, { project: PROJECT });

    const serialized = JSON.stringify(text(await coordination.coordinationClaim(PROJECT, {
      ...lease,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    })));
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("safe/file.ts");
  });

  it("preserves valid redacted mutation DTO variants exactly", async () => {
    const claimResponse = { session, claimIds: [CLAIM_ID] };
    mockApi.post.mockResolvedValueOnce(success(claimResponse));
    await expect(coordination.coordinationClaim(PROJECT, {
      ...lease,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    })).resolves.toMatchObject({ content: [{ text: JSON.stringify(claimResponse) }] });

    const takeoverResponse = { session, takeoverEvidenceId: CLAIM_ID };
    mockApi.post.mockResolvedValueOnce(success(takeoverResponse));
    await expect(coordination.coordinationUpdate(PROJECT, "takeover", {
      worktree_id: lease.worktree_id,
      session_id: lease.session_id,
      incarnation: lease.incarnation,
      expected_revision: lease.expected_revision,
      fence: lease.fence,
      next_ownership_token: NEXT_TOKEN,
      ttl_ms: 2_000,
      idempotency_key: lease.idempotency_key,
    })).resolves.toMatchObject({ content: [{ text: JSON.stringify(takeoverResponse) }] });
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

  it("rejects malformed successful API DTOs without exposing forbidden fields", async () => {
    mockApi.get.mockResolvedValue(success({
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

    const result = await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1);
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
      fence: lease.fence,
      next_ownership_token: NEXT_TOKEN,
      ttl_ms: 2_000,
      idempotency_key: lease.idempotency_key,
    }));

    mockApi.post.mockResolvedValueOnce(success({
      session,
      claimIds: [{ nested: { path: TOKEN } }],
    }));
    invalid(await coordination.coordinationClaim(PROJECT, {
      ...lease,
      claims: [{ claim: { kind: "path", path: "safe/file.ts" } }],
    }));

    mockApi.get.mockResolvedValueOnce(success({
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
    invalid(await coordination.coordinationStatus(PROJECT, "worktree-main", "session-main", 1));
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

  it("registers exactly the four coordination transport tools", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
    const names = [...source.matchAll(/server\.registerTool\(\s*"(coordination_[a-z]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([
      "coordination_status",
      "coordination_update",
      "coordination_claim",
      "coordination_release",
    ]);
  });
});
