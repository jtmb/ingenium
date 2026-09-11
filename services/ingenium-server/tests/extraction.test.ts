import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("../lib/client.js", () => ({ api: { post } }));
import { extractionRun } from "../lib/tools/extraction.js";

const external = { worktree: "/worktree", sessionId: "ses-external",
  message: { id: "msg-user", role: "user" as const, text: "I prefer concise replies. Bearer secret-canary" } };

describe("external extraction MCP adapter", () => {
  beforeEach(() => post.mockReset().mockResolvedValue({ data: { enabled: true, created: true, observationId: 1 } }));

  it("redacts before authenticated API transport and preserves identities", async () => {
    await extractionRun("ingenium", external, "ingenium");
    expect(post).toHaveBeenCalledWith("/extraction/run", { external: { ...external,
      message: { ...external.message, text: "I prefer concise replies. [REDACTED]" } } }, { project: "ingenium" });
    expect(JSON.stringify(post.mock.calls)).not.toContain("secret-canary");
  });

  it("rejects foreign/unknown launcher binding and non-user payloads", async () => {
    for (const binding of [null, "foreign"]) await expect(extractionRun("ingenium", external, binding)).rejects.toThrow("BINDING_REJECTED");
    await expect(extractionRun("ingenium", { ...external, message: { ...external.message, role: "assistant" } } as any, "ingenium")).rejects.toThrow();
    await expect(extractionRun("ingenium", { ...external, metadata: "operational" } as any, "ingenium")).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("preserves the legacy scan trigger", async () => {
    await extractionRun("ingenium");
    expect(post).toHaveBeenCalledWith("/extraction/run", {}, { project: "ingenium" });
  });
});
