import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_TOOL_CATALOG } from "../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.js";

class MockApiUnavailableError extends Error {}
class MockApiHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
};

vi.mock("../lib/client.js", () => ({
  api: mockApi,
  ApiHttpError: MockApiHttpError,
  ApiUnavailableError: MockApiUnavailableError,
}));

const memoryTools = await import("../lib/tools/memory.js");
const project = "memory-project";
const workspaceId = "memory-workspace";
const memoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function data(result: { content: [{ text: string }] }): any {
  return JSON.parse(result.content[0].text);
}

describe("explicit memory MCP handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers all seven tools once with single-prefix canonical catalog entries", () => {
    const source = readFileSync(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8");
    const names = ["save", "read", "list", "search", "update", "forget", "operation_status"].map((verb) => `memory_${verb}`);
    expect(MCP_TOOL_CATALOG.filter((entry) => entry.category === "Memory").map((entry) => entry.name)).toEqual(names.map((name) => `ingenium_${name}`));
    for (const name of names) {
      expect(source.split(`server.registerTool(\n  "${name}",`)).toHaveLength(2);
      expect(source).toContain(`wrapHandler(C("${name}")`);
      const entry = MCP_TOOL_CATALOG.find((entry) => entry.name === `ingenium_${name}`)!;
      expect(entry).toMatchObject({ projectScope: "per-project", defaultEnabled: true });
      expect(entry.apiEndpoints?.length).toBeGreaterThan(0);
      if (name === "memory_save" || name === "memory_forget") expect(source).toContain(`description: ${JSON.stringify(entry.description)}`);
    }
  });

  it("returns exact read/list content without rewriting user preferences", async () => {
    const memory = { id: memoryId, content: "  Prefer concise answers.\n", tags: ["preference"], source: "user-directive" };
    mockApi.get.mockResolvedValueOnce({ data: { memory } }).mockResolvedValueOnce({ data: { items: [{ memory }] } });
    expect(data(await memoryTools.memoryRead(project, workspaceId, memoryId))).toEqual({ memory });
    expect(mockApi.get).toHaveBeenCalledWith(`/memory/${memoryId}`, { project, workspaceId, visibility: "private" });
    expect(data(await memoryTools.memoryList(project, workspaceId))).toEqual({ items: [{ memory }] });
    expect(mockApi.get).toHaveBeenCalledWith("/memory", { project, workspaceId, visibility: "private" });
  });

  it("routes bounded lifecycle calls through the API", async () => {
    mockApi.post.mockResolvedValue({ data: { receipt: { operationId: "save-one" } } });
    await memoryTools.memorySave(project, workspaceId, "save-one", "Remember this", ["preference"]);
    expect(mockApi.post).toHaveBeenCalledWith("/memory", {
      operationId: "save-one",
      workspaceId,
      content: "Remember this",
      tags: ["preference"],
    }, { project });

    mockApi.get.mockResolvedValue({ data: { items: [] } });
    await memoryTools.memorySearch(project, workspaceId, "remember", "private", { limit: 4, tokenBudget: 256 });
    expect(mockApi.get).toHaveBeenCalledWith("/memory/search", {
      project,
      workspaceId,
      visibility: "private",
      q: "remember",
      limit: "4",
      tokenBudget: "256",
    });

    mockApi.patch.mockResolvedValue({ data: { receipt: { operationId: "update-one" } } });
    await memoryTools.memoryUpdate(project, workspaceId, memoryId, "update-one", 1, "Updated");
    expect(mockApi.patch).toHaveBeenCalledWith(`/memory/${memoryId}`, {
      operationId: "update-one",
      workspaceId,
      expectedVersion: 1,
      content: "Updated",
    }, { project });

    mockApi.del.mockResolvedValue({ data: { receipt: { operationId: "forget-one" } } });
    await memoryTools.memoryForget(project, workspaceId, memoryId, "forget-one", 2);
    expect(mockApi.del).toHaveBeenCalledWith(`/memory/${memoryId}`, { project }, {
      operationId: "forget-one",
      workspaceId,
      expectedVersion: 2,
    });
  });

  it("reconciles an unknown transport outcome before exposing a committed receipt", async () => {
    mockApi.post.mockRejectedValue(new MockApiUnavailableError());
    mockApi.get.mockResolvedValue({ data: { status: "committed", receipt: { operationId: "save-two", version: 1 } } });

    const result = await memoryTools.memorySave(project, workspaceId, "save-two", "Synthetic fact");

    expect(mockApi.get).toHaveBeenCalledWith("/memory/operations/save-two", { project, workspaceId });
    expect(data(result)).toEqual({
      memory: null,
      receipt: { operationId: "save-two", version: 1 },
      idempotent: true,
      reconciled: true,
    });
  });

  it("returns pending without a false receipt when reconciliation finds no operation", async () => {
    mockApi.del.mockRejectedValue(new MockApiUnavailableError());
    mockApi.get.mockResolvedValue({ data: { status: "unknown", operationId: "forget-two" } });

    const result = await memoryTools.memoryForget(project, workspaceId, memoryId, "forget-two", 1);

    expect(data(result)).toEqual({
      status: "pending",
      operationId: "forget-two",
      nextAction: "memory_operation_status",
    });
  });

  it("returns pending when a server error leaves the mutation and status outcomes unknown", async () => {
    mockApi.patch.mockRejectedValue(new MockApiHttpError(503));
    mockApi.get.mockRejectedValue(new MockApiUnavailableError());

    const result = await memoryTools.memoryUpdate(project, workspaceId, memoryId, "update-unknown", 1, "Updated");

    expect(mockApi.get).toHaveBeenCalledWith("/memory/operations/update-unknown", { project, workspaceId });
    expect(data(result)).toEqual({
      status: "pending",
      operationId: "update-unknown",
      nextAction: "memory_operation_status",
    });
  });
});
