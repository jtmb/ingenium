import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("../lib/client.js", () => ({ api: { post } }));

import { synthesisRun } from "../lib/tools/synthesis.js";

describe("synthesis MCP adapter", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: { status: "started" } });
  });

  it("forwards the validated OpenCode session identifier as the API session_id", async () => {
    await expect(synthesisRun("project", "ses_safe-123")).resolves.toEqual({
      content: [{ type: "text", text: JSON.stringify({ status: "started" }) }],
    });
    expect(post).toHaveBeenCalledWith("/synthesis/run", {}, {
      project: "project",
      session_id: "ses_safe-123",
    });
  });

  it("omits session content while preserving a missing identifier", async () => {
    await synthesisRun("project");
    expect(post).toHaveBeenCalledWith("/synthesis/run", {}, {
      project: "project",
      session_id: undefined,
    });
  });
});
