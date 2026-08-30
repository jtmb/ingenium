import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("../project-resolver.js", () => ({
  resolveExtensionProject: () => "extension-project",
}));

vi.mock("../extension-binding.js", () => ({
  resolveExtensionBinding: () => ({ project: "extension-project" }),
}));

vi.mock("../mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: () => ({}),
  McpBridgeError: class McpBridgeError extends Error {
    constructor(readonly failure: string) { super("bridge"); }
  },
}));

import { classifyObserverFailure, classifyObserverHttpFailure, logPipelineEvent } from "../observer-core.js";

describe("observer API diagnostics", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockCallMcpTool.mockReset();
  });

  afterEach(() => {
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [404, "not_found"],
    [423, "locked"],
    [500, "request_failed"],
  ] as const)("maps HTTP %i to the stable %s category", (status, expected) => {
    expect(classifyObserverHttpFailure(status)).toBe(expected);
  });

  it("classifies timeout-shaped transport failures without preserving error text", () => {
    const error = new Error("Bearer secret-token timed out") as Error & { name: string };
    error.name = "TimeoutError";

    expect(classifyObserverFailure(error)).toBe("timeout");
  });

  it.each([
    ["API-down", () => mockCallMcpTool.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack")), "request_failed"],
    ["authentication", () => mockCallMcpTool.mockRejectedValue({ name: "McpBridgeError", failure: "authentication" }), "authentication"],
    ["timeout", () => {
      const error = new Error("Bearer secret-token http://private.example/timeout");
      error.name = "TimeoutError";
      mockCallMcpTool.mockRejectedValue(error);
    }, "timeout"],
  ] as const)("reports only the stable %s failure through the lifecycle callback", async (_case, failRequest, failure) => {
    failRequest();
    const report = vi.fn();

    await expect(logPipelineEvent("session_created", "plugin", "started", "/worktree", "", {}, undefined, report))
      .resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith("pipeline_event_rejected", failure);
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(report.mock.calls)).not.toContain("private.example");
  });

  it("swallows a rejected lifecycle reporter without a recursive diagnostic", async () => {
    mockCallMcpTool.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack"));
    const report = vi.fn(() => { throw new Error("logger rejected"); });

    await expect(logPipelineEvent("session_created", "plugin", "started", "/worktree", "", {}, undefined, report))
      .resolves.toBeUndefined();
    expect(report).toHaveBeenCalledOnce();
  });
});
