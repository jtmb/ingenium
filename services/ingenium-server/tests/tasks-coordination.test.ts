import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = {
  patch: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const taskTools = await import("../lib/tools/tasks.js");

describe("task coordination MCP wrappers", () => {
  const project = "coordination-project";
  const reservationToken = "0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.patch.mockResolvedValue({ ok: true, status: 200, data: { revision: 5 } });
    mockApi.post.mockResolvedValue({ ok: true, status: 200, data: { revision: 5 } });
    mockApi.del.mockResolvedValue({ ok: true, status: 204, data: null });
  });

  it("preserves replay inputs, exact task paths, payloads, and project scope", async () => {
    await taskTools.taskUpdate(
      project,
      "task-update",
      { title: "updated", task_id: "wrong-task", expected_revision: 99, idempotency_key: "wrong-key" },
      4,
      "update-replay-1",
    );
    await taskTools.taskBulkUpdate(
      project,
      ["task-a", "task-b"],
      {
        priority: 3,
        task_ids: ["wrong-task"],
        expected_revision: 99,
        expected_revisions: { "wrong-task": 99 },
        idempotency_key: "wrong-key",
      },
      4,
      { "task-a": 4, "task-b": 5 },
      "bulk-replay-1",
    );
    await taskTools.taskDelete(project, "task-delete", 6, "delete-replay-1");
    await taskTools.taskReserve(
      project,
      "task-reserve",
      "agent-a",
      "worktree-a",
      reservationToken,
      7,
      "reserve-replay-1",
    );
    await taskTools.taskRelease(
      project,
      "task-release",
      "agent-a",
      "worktree-a",
      reservationToken,
      8,
      "release-replay-1",
    );

    expect(mockApi.patch).toHaveBeenCalledWith(
      "/tasks/task-update",
      { title: "updated", expected_revision: 4, idempotency_key: "update-replay-1" },
      { project },
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(
      1,
      "/tasks/bulk",
      {
        task_ids: ["task-a", "task-b"],
        priority: 3,
        expected_revision: 4,
        idempotency_key: "bulk-replay-1",
        expected_revisions: { "task-a": 4, "task-b": 5 },
      },
      { project },
    );
    expect(mockApi.del).toHaveBeenCalledWith(
      "/tasks/task-delete",
      { project },
      { expected_revision: 6, idempotency_key: "delete-replay-1" },
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(
      2,
      "/tasks/task-reserve/reserve",
      {
        owner: "agent-a",
        worktree: "worktree-a",
        reservation_token: reservationToken,
        expected_revision: 7,
        idempotency_key: "reserve-replay-1",
      },
      { project },
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(
      3,
      "/tasks/task-release/release",
      {
        owner: "agent-a",
        worktree: "worktree-a",
        reservation_token: reservationToken,
        expected_revision: 8,
        idempotency_key: "release-replay-1",
      },
      { project },
    );
  });
});
