import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const contextTools = await import("../lib/tools/context.js");

const project = "context-server-test";
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const checkpointId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function apiSuccess(data: unknown = { ok: true }) {
  return { ok: true, status: 200, data };
}

describe("immutable context MCP handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the canonical conversation paths and carries idempotency/revisions", async () => {
    mockApi.post.mockResolvedValue(apiSuccess({ id: conversationId }));
    await contextTools.contextConversationCreate(project, "Immutable context", ["ctx"], 7, { ticket: "CTX-002" }, "create-key");
    expect(mockApi.post).toHaveBeenCalledWith(
      "/context/conversations",
      { title: "Immutable context", tags: ["ctx"], priority: 7, metadata: { ticket: "CTX-002" }, idempotencyKey: "create-key" },
      { project },
    );

    mockApi.post.mockResolvedValue(apiSuccess({ revision: 1 }));
    await contextTools.contextMessageAppend(project, conversationId, "user", "bounded content", 0, undefined, undefined, undefined, "message-key");
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/messages`,
      {
        role: "user",
        content: "bounded content",
        expectedRevision: 0,
        tags: undefined,
        priority: undefined,
        metadata: undefined,
        idempotencyKey: "message-key",
      },
      { project },
    );

    mockApi.post.mockResolvedValue(apiSuccess({ checkpoint: { id: checkpointId } }));
    await contextTools.contextCheckpointCreate(project, conversationId, 1, undefined, { reason: "handoff" }, "checkpoint-key");
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/checkpoints`,
      { expectedRevision: 1, ragSourceIds: undefined, metadata: { reason: "handoff" }, idempotencyKey: "checkpoint-key" },
      { project },
    );
  });

  it("keeps summary lists separate from deliberate content retrieval and uses encoded IDs", async () => {
    mockApi.get.mockResolvedValue(apiSuccess({ data: [], nextCursor: null }));
    await contextTools.contextConversationList(project, 20, "cursor-value");
    expect(mockApi.get).toHaveBeenCalledWith("/context/conversations", { project, limit: "20", cursor: "cursor-value" });

    await contextTools.contextMessageList(project, conversationId, 10, "message-cursor");
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/messages`,
      { project, limit: "10", cursor: "message-cursor" },
    );

    await contextTools.contextMessageSearch(project, conversationId, "violet lighthouse", 5);
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/messages/search`,
      { project, q: "violet lighthouse", limit: "5" },
    );

    await contextTools.contextMessageRetrieve(project, conversationId, messageId);
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/messages/${messageId}`,
      { project },
    );

    mockApi.post.mockResolvedValue(apiSuccess({ messages: [] }));
    await contextTools.contextMessageBatchRetrieve(project, conversationId, [messageId]);
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/messages/batch`,
      { messageIds: [messageId] },
      { project },
    );
  });

  it("routes checkpoint browsing and restore-as-new through the API boundary", async () => {
    mockApi.get.mockResolvedValue(apiSuccess());
    await contextTools.contextCheckpointList(project, conversationId, 25, "checkpoint-cursor");
    expect(mockApi.get).toHaveBeenCalledWith(
      `/context/conversations/${conversationId}/checkpoints`,
      { project, limit: "25", cursor: "checkpoint-cursor" },
    );
    await contextTools.contextCheckpointGet(project, conversationId, checkpointId);
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/checkpoints/${checkpointId}`,
      { project },
    );

    mockApi.post.mockResolvedValue(apiSuccess({ conversation: { id: "new" } }));
    const confirmationToken = "a".repeat(43);
    await contextTools.contextCheckpointRestore(project, conversationId, checkpointId, 3, confirmationToken, "Recovered", { source: "fixture" }, "restore-key");
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/checkpoints/${checkpointId}/restore`,
      { expectedRevision: 3, confirmationToken, title: "Recovered", metadata: { source: "fixture" }, idempotencyKey: "restore-key" },
      { project },
    );
  });

  it("routes content-free maintenance preview, authorization, reversible archive, and audit through the API", async () => {
    mockApi.post.mockResolvedValue(apiSuccess({ data: [] }));
    await contextTools.contextCheckpointMaintenancePreview(project, {
      conversationIds: [conversationId],
      staleBefore: "2026-07-27T00:00:00.000Z",
      includeInvalid: true,
      limit: 10,
    });
    expect(mockApi.post).toHaveBeenCalledWith(
      "/context/conversations/maintenance/preview",
      {
        conversationIds: [conversationId],
        staleBefore: "2026-07-27T00:00:00.000Z",
        includeInvalid: true,
        limit: 10,
      },
      { project },
    );

    await contextTools.contextCheckpointMaintenanceAuthorize(
      project,
      conversationId,
      "restore_checkpoint",
      3,
      checkpointId,
    );
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/maintenance/authorize`,
      { operation: "restore_checkpoint", expectedRevision: 3, checkpointId },
      { project },
    );

    const confirmationToken = "b".repeat(43);
    await contextTools.contextConversationArchive(project, conversationId, 3, confirmationToken);
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/archive`,
      { expectedRevision: 3, confirmationToken },
      { project },
    );
    await contextTools.contextConversationUnarchive(project, conversationId, 3, confirmationToken);
    expect(mockApi.post).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/unarchive`,
      { expectedRevision: 3, confirmationToken },
      { project },
    );

    mockApi.get.mockResolvedValue(apiSuccess({ data: [] }));
    await contextTools.contextCheckpointAuditList(project, conversationId, 25);
    expect(mockApi.get).toHaveBeenLastCalledWith(
      `/context/conversations/${conversationId}/maintenance/audit`,
      { project, limit: "25" },
    );
  });
});
