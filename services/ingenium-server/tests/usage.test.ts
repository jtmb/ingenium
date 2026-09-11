import { beforeEach, describe, expect, it, vi } from "vitest";
const post = vi.hoisted(() => vi.fn());
vi.mock("../lib/client.js", () => ({ api: { post } }));
import { externalUsageSchema, usageIngest } from "../lib/tools/usage.js";

const event = { worktree: "/home/brajam/repos/ingenium", sessionId: "ses-usage", messageId: "msg-usage",
  role: "assistant" as const, completedAt: "2026-09-10T10:00:00.000Z", inputTokens: 0 };
beforeEach(() => { post.mockReset(); });
describe("usage MCP boundary", () => {
  it("forwards only strict metadata in the exact launcher project", async () => {
    post.mockResolvedValue({ data: { created: true } });
    expect(await usageIngest("ingenium", event, "ingenium")).toMatchObject({ content: [{ text: '{"created":true}' }] });
    expect(post).toHaveBeenCalledWith("/usage/external", event, { project: "ingenium" });
    expect(post.mock.calls[0][1]).not.toHaveProperty("costAmount");
  });
  it("rejects foreign projects and untrusted extra fields before HTTP", async () => {
    await expect(usageIngest("foreign", event, "ingenium")).rejects.toThrow("BINDING_REJECTED");
    await expect(usageIngest("ingenium", event)).rejects.toThrow("BINDING_REJECTED");
    await expect(usageIngest("ingenium", { ...event, text: "secret-canary" } as typeof event, "ingenium")).rejects.toThrow();
    for (const override of [{ role: "tool" }, { completedAt: undefined }, { costAmount: -1 }, { providerId: "sk-secret-canary" }]) {
      expect(externalUsageSchema.safeParse({ ...event, ...override }).success).toBe(false);
    }
    expect(post).not.toHaveBeenCalled();
  });
  it("does not replay uncertain transport outcomes", async () => {
    post.mockRejectedValue(new Error("unavailable"));
    await expect(usageIngest("ingenium", event, "ingenium")).rejects.toThrow("unavailable");
    expect(post).toHaveBeenCalledTimes(1);
  });
});
