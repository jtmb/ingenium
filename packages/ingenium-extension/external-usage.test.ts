import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ExternalUsageCollector, externalUsageEvent } from "./external-usage.js";
import type { OpenCodeV2Client } from "./opencode-v2.js";

const worktree = "/home/brajam/repos/ingenium";
const message = { id: "msg-usage", sessionID: "ses-usage", role: "assistant",
  providerID: "openai", modelID: "model", agent: "engineer", time: { completed: 1_800_000_000_000 },
  tokens: { input: 4, output: 0, reasoning: 2, cache: { read: 0 } } };
function v2Assistant(id = "msg-usage") {
  return { id, type: "assistant" as const, agent: "engineer", model: { id: "model", providerID: "openai" },
    time: { created: 1, completed: 1_800_000_000_000 }, tokens: { input: 4, output: 0, reasoning: 2, cache: { read: 0, write: 0 } },
    content: [{ type: "text" as const, id: `${id}-part`, text: "secret-canary" }] };
}
function v2Session(worktree: string, messages: unknown[]) {
  const session = {
    get: vi.fn(async () => ({ data: { id: "ses-usage", location: { directory: worktree } } })),
    messages: vi.fn(async () => ({ data: { data: messages, cursor: {} } })),
  };
  return { client: { session } as unknown as OpenCodeV2Client, session };
}

describe("external completed assistant usage", () => {
  it("copies reported metadata only and preserves absent versus zero without inferred totals or cost", () => {
    const event = externalUsageEvent({ ...message, text: "secret-canary", reasoning: "private", parts: [{ text: "private" }] }, "ses-usage", worktree)!;
    expect(event).toMatchObject({ inputTokens: 4, outputTokens: 0, reasoningTokens: 2, cacheReadTokens: 0,
      completedAt: "2027-01-15T08:00:00.000Z", providerId: "openai", modelId: "model", agentId: "engineer",
      sessionId: `session-${createHash("sha256").update("ses-usage", "utf8").digest("hex")}` });
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
    const fixture = v2Session(worktree, [v2Assistant()]);
    const collector = new ExternalUsageCollector("ingenium", worktree, fixture.client, invoke);
    await Promise.all([collector.sync("ses-usage"), collector.sync("ses-usage")]);
    expect(invoke).toHaveBeenCalledTimes(2);
    await collector.sync("ses-usage");
    await new ExternalUsageCollector("ingenium", worktree, fixture.client, invoke).sync("ses-usage");
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[2]);
    expect(fixture.session.messages).toHaveBeenCalledWith({ sessionID: "ses-usage", limit: 100, order: "asc" });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("secret-canary");
    fixture.session.get.mockResolvedValue({ data: { id: "foreign", location: { directory: worktree } } });
    await expect(collector.sync("ses-usage")).rejects.toThrow("SESSION_UNAVAILABLE");
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("does not blindly retry an uncertain write; a later idle reuses the exact event", async () => {
    const client = v2Session(worktree, [v2Assistant()]).client;
    const invoke = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ created: false });
    const collector = new ExternalUsageCollector("ingenium", worktree, client, invoke);
    await expect(collector.sync("ses-usage")).rejects.toThrow("timeout");
    expect(invoke).toHaveBeenCalledTimes(1);
    await collector.sync("ses-usage");
    expect(invoke.mock.calls[0]).toEqual(invoke.mock.calls[1]);
  });

  it("paginates with an opaque server cursor and fails closed on a repeated page", async () => {
    const page = Array.from({ length: 100 }, (_, index) => index === 0 ? v2Assistant("msg-0") : {
      id: `msg-${index}`, type: "user" as const, time: { created: 1 }, text: "prompt",
    });
    const messages = vi.fn().mockResolvedValueOnce({ data: { data: page, cursor: { next: "older" } } })
      .mockResolvedValueOnce({ data: { data: [v2Assistant("msg-100")], cursor: {} } });
    const session = { get: async () => ({ data: { id: "ses-usage", location: { directory: worktree } } }), messages };
    const client = { session } as unknown as OpenCodeV2Client;
    const invoke = vi.fn(async () => ({ created: false }));
    const collector = new ExternalUsageCollector("ingenium", worktree, client, invoke);
    await collector.sync("ses-usage");
    expect(messages).toHaveBeenNthCalledWith(2, { sessionID: "ses-usage", limit: 100, cursor: "older" });
    expect(invoke).toHaveBeenCalledTimes(2);
    messages.mockResolvedValue({ data: { data: page, cursor: { next: "same-page" } } });
    await expect(collector.sync("ses-usage")).rejects.toThrow("CURSOR_FAILED");
    expect(messages).toHaveBeenCalledTimes(4);
  });
});
