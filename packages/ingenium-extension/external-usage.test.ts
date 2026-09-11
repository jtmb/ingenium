import { describe, expect, it, vi } from "vitest";
import { ExternalUsageCollector, externalUsageEvent } from "./external-usage.js";

const worktree = "/home/brajam/repos/ingenium";
const message = { id: "msg-usage", sessionID: "ses-usage", role: "assistant",
  providerID: "openai", modelID: "model", agent: "engineer", time: { completed: 1_800_000_000_000 },
  tokens: { input: 4, output: 0, reasoning: 2, cache: { read: 0 } } };

describe("external completed assistant usage", () => {
  it("copies reported metadata only and preserves absent versus zero without inferred totals or cost", () => {
    const event = externalUsageEvent({ ...message, text: "secret-canary", reasoning: "private", parts: [{ text: "private" }] }, "ses-usage", worktree)!;
    expect(event).toMatchObject({ inputTokens: 4, outputTokens: 0, reasoningTokens: 2, cacheReadTokens: 0,
      completedAt: "2027-01-15T08:00:00.000Z", providerId: "openai", modelId: "model", agentId: "engineer" });
    expect(event.costAmount).toBeUndefined();
    expect(event.totalTokens).toBeUndefined();
    expect(event.cacheWriteTokens).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/secret-canary|private|parts|text/);
  });

  it.each([{ role: "user" }, { role: "tool" }, { sessionID: "foreign" }, { time: {} },
    { time: { completed: Infinity } }, { error: { message: "secret" } }, { id: "sk-secret-canary" },
    { providerID: { text: "secret" } }, { modelID: "sk-secret-canary" }, { cost: "secret" }, { tokens: { input: "private" } }])("rejects non-completed or foreign message %j", (override) => {
    expect(externalUsageEvent({ ...message, ...override }, "ses-usage", worktree)).toBeUndefined();
  });

  it("uses exact directory/session SDK calls and stable metadata on duplicate idle, reconnect and restart", async () => {
    const invoke = vi.fn(async () => ({ created: false }));
    const client = { session: { get: vi.fn(async () => ({ data: { id: "ses-usage", directory: worktree } })),
      messages: vi.fn(async () => ({ data: [{ info: message, parts: [{ type: "text", text: "secret-canary" }] }] })) } };
    const collector = new ExternalUsageCollector("ingenium", worktree, client, invoke);
    await Promise.all([collector.sync("ses-usage"), collector.sync("ses-usage")]);
    expect(invoke).toHaveBeenCalledTimes(2);
    await collector.sync("ses-usage");
    await new ExternalUsageCollector("ingenium", worktree, client, invoke).sync("ses-usage");
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[2]);
    expect(client.session.messages).toHaveBeenCalledWith({ path: { id: "ses-usage" }, query: { directory: worktree, limit: 100 } });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("secret-canary");
    client.session.get.mockResolvedValue({ data: { id: "foreign", directory: worktree } });
    await expect(collector.sync("ses-usage")).rejects.toThrow("BINDING_REJECTED");
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("does not blindly retry an uncertain write; a later idle reuses the exact event", async () => {
    const client = { session: { get: async () => ({ data: { id: "ses-usage", directory: worktree } }),
      messages: async () => ({ data: [{ info: message }] }) } };
    const invoke = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ created: false });
    const collector = new ExternalUsageCollector("ingenium", worktree, client, invoke);
    await expect(collector.sync("ses-usage")).rejects.toThrow("timeout");
    expect(invoke).toHaveBeenCalledTimes(1);
    await collector.sync("ses-usage");
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1]);
  });

  it("paginates with the oldest message cursor and fails closed on a repeated page", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ info: { ...message, id: `msg-${index}`,
      role: index === 0 ? "assistant" : "user" } }));
    const messages = vi.fn().mockResolvedValueOnce({ data: page })
      .mockResolvedValueOnce({ data: [{ info: { ...message, id: "msg-older" } }] });
    const client = { session: { get: async () => ({ data: { id: "ses-usage", directory: worktree } }), messages } };
    const invoke = vi.fn(async () => ({ created: false }));
    const collector = new ExternalUsageCollector("ingenium", worktree, client, invoke);
    await collector.sync("ses-usage");
    expect(messages).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: { directory: worktree, limit: 100, before: "msg-0" } }));
    expect(invoke).toHaveBeenCalledTimes(2);
    messages.mockResolvedValue({ data: page });
    await expect(collector.sync("ses-usage")).rejects.toThrow("BINDING_REJECTED");
    expect(messages).toHaveBeenCalledTimes(4);
  });
});
