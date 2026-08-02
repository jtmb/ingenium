import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("context API client", () => {
  it("lists project-scoped context source summaries with pagination", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [], total: 0, limit: 1, offset: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.context.sources.list("project/one", { limit: 1, offset: 2 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/context/sources/summary?project=project%2Fone&limit=1&offset=2",
    );
  });

  it("encodes a project-scoped message search request", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.context.messages.search("conversation/id", "preferred format", "project/one", 25);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/context/conversations/conversation%2Fid/messages/search?project=project%2Fone&q=preferred+format&limit=25",
    );
  });

  it("sends restore-as-new input to the selected project endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.context.checkpoints.restore("conversation/id", "checkpoint/id", {
      expectedRevision: 4,
      title: "Restored preferences",
      metadata: { restoredBy: "dashboard" },
      idempotencyKey: "context-test-1",
    }, "project/one");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/context/conversations/conversation%2Fid/checkpoints/checkpoint%2Fid/restore?project=project%2Fone",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        expectedRevision: 4,
        title: "Restored preferences",
        metadata: { restoredBy: "dashboard" },
        idempotencyKey: "context-test-1",
      }),
    });
  });
});
