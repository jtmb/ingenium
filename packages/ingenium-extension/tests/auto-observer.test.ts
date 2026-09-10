import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertExtensionToolEnabled = vi.hoisted(() => vi.fn());
const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("@opencode-ai/plugin", () => ({
  tool: (definition: unknown) => definition,
}));

vi.mock("../mcp-tool-state.js", () => ({
  assertExtensionToolEnabled: mockAssertExtensionToolEnabled,
}));

vi.mock("../project-resolver.js", () => ({
  resolveExtensionProject: () => "extension-project",
}));

vi.mock("../extension-binding.js", () => ({
  resolveExtensionBinding: () => ({ project: "extension-project" }),
}));

vi.mock("../mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
  McpBridgeError: class McpBridgeError extends Error {
    constructor(readonly failure: string) { super("bridge"); }
  },
}));

let AutoObserverPlugin: typeof import("../auto-observer.js").AutoObserverPlugin;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

describe("AutoObserverPlugin lifecycle output", () => {
  beforeEach(async () => {
    vi.resetModules();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockAssertExtensionToolEnabled.mockReset().mockResolvedValue(undefined);
    mockCallMcpTool.mockReset();
    ({ AutoObserverPlugin } = await import("../auto-observer.js"));
  });

  afterEach(() => {
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    ["API-down", () => mockCallMcpTool.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack")), "request_failed"],
    ["authentication", () => mockCallMcpTool.mockRejectedValue({ name: "McpBridgeError", failure: "authentication" }), "authentication"],
    ["non-extraction", () => mockCallMcpTool.mockRejectedValue({ name: "McpBridgeError", failure: "locked" }), "request_failed"],
    ["timeout", () => {
      const error = new Error("Bearer secret-token http://private.example/timeout");
      error.name = "TimeoutError";
      mockCallMcpTool.mockRejectedValue(error);
    }, "timeout"],
  ] as const)("keeps %s lifecycle failures non-fatal and reports only the safe reason", async (_case, failRequest, reason) => {
    failRequest();
    const log = vi.fn();
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.idle" } })).resolves.toBeUndefined();

    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain(`trigger_extraction: ${reason}`);
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("private.example");
    expect(output).not.toContain("stack");
  });

  it("swallows logger rejection without changing manual tool errors", async () => {
    mockCallMcpTool.mockRejectedValue({ name: "McpBridgeError", failure: "authentication" });
    const log = vi.fn().mockRejectedValue(new Error("logger rejected Bearer secret-token"));
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.idle" } })).resolves.toBeUndefined();
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ service: "auto-observer", level: "warn", message: "trigger_extraction: authentication" }),
    }));

    const manual = await (plugin.tool.auto_observe_now as any).execute({}, { worktree: "/worktree" });
    expect(JSON.parse(manual)).toEqual({ triggered: false, message: "Extraction request failed" });
    expect(mockAssertExtensionToolEnabled).toHaveBeenCalledWith("auto_observe_now", "/worktree");
  });

  it("reports the asynchronous extraction acknowledgment without inventing a created count", async () => {
    mockCallMcpTool.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ status: "started" }) }] });
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { app: { log: vi.fn() } } });

    const manual = JSON.parse(await (plugin.tool.auto_observe_now as any).execute({}, { worktree: "/worktree" }));

    expect(manual).toEqual({ triggered: true, status: "started", message: "Extraction scheduled" });
    expect(JSON.stringify(manual)).not.toContain("unknown");
    expect(JSON.stringify(manual)).not.toContain("created");
  });
});
