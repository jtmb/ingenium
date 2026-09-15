import { createHash } from "node:crypto";
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
  resolveExtensionBinding: () => ({ project: "extension-project", launcherWorktree: "/worktree" }),
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

    await expect(plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-external" } } })).resolves.toBeUndefined();

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

    await expect(plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-external" } } })).resolves.toBeUndefined();
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

  it("sends only exact visible redacted user messages, including after a fresh plugin instance", async () => {
    mockCallMcpTool.mockResolvedValue({ content: [{ text: JSON.stringify({ enabled: true }) }] });
    const user = { info: { id: "msg-user", sessionID: "ses-external", role: "user" }, parts: [
      { type: "text", text: "I prefer concise answers. Bearer secret-canary" },
      { type: "text", synthetic: true, text: "hidden-canary" },
      { type: "tool", text: "tool-canary" },
    ] };
    const client = { session: {
      get: vi.fn().mockResolvedValue({ data: { id: "ses-external", directory: "/worktree" } }),
      messages: vi.fn().mockResolvedValue({ data: [user,
        { info: { id: "msg-assistant", sessionID: "ses-external", role: "assistant", time: { completed: 1 } }, parts: [{ type: "text", text: "assistant-canary" }] },
        { ...user, info: { ...user.info, id: "msg-hidden", hidden: true } },
      ] }),
    } };
    const event = { event: { type: "session.idle", properties: { sessionID: "ses-external", operational: "metadata-canary" } } };
    for (let restart = 0; restart < 2; restart++) {
      const plugin = await AutoObserverPlugin({ worktree: "/worktree", client });
      await Promise.all([plugin.event(event), plugin.event(event)]);
    }
    const coordinationSessionId = `session-${createHash("sha256").update("ses-external", "utf8").digest("hex")}`;
    const probes = mockCallMcpTool.mock.calls.filter((call) => !call[2].external.message);
    const sent = mockCallMcpTool.mock.calls.filter((call) => call[2].external.message);
    expect(probes).toHaveLength(2);
    expect(probes[0][2]).toEqual({ project: "extension-project", external: {
      worktree: "/worktree", sessionId: coordinationSessionId,
    } });
    expect(sent).toHaveLength(2);
    expect(sent[0][2]).toEqual({ project: "extension-project", external: { worktree: "/worktree", sessionId: coordinationSessionId,
      message: { id: "msg-user", role: "user", text: "I prefer concise answers. [REDACTED]" } } });
    expect(sent[1][2]).toEqual(sent[0][2]);
    expect(client.session.get).toHaveBeenCalledWith({ path: { id: "ses-external" }, query: { directory: "/worktree" } });
    expect(client.session.messages).toHaveBeenCalledWith({
      path: { id: "ses-external" }, query: { directory: "/worktree", limit: 100 },
    });
    expect(JSON.stringify(mockCallMcpTool.mock.calls)).not.toMatch(/secret-canary|hidden-canary|tool-canary|assistant-canary|metadata-canary/);
  });

  it("does not read messages when learning is disabled or the event has no exact session", async () => {
    mockCallMcpTool.mockResolvedValue({ content: [{ text: JSON.stringify({ enabled: false }) }] });
    const client = { session: { get: vi.fn(), messages: vi.fn() } };
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client });
    await plugin.event({ event: { type: "session.idle" } });
    expect(mockCallMcpTool).not.toHaveBeenCalled();
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-external" } } });
    expect(client.session.get).not.toHaveBeenCalled();
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it("does not let unfinished assistant/tool payloads suppress a later user preference", async () => {
    mockCallMcpTool.mockResolvedValue({ content: [{ text: JSON.stringify({ enabled: true }) }] });
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { session: {
      get: vi.fn().mockResolvedValue({ data: { id: "ses-external", directory: "/worktree" } }),
      messages: vi.fn().mockResolvedValue({ data: [
        { info: { id: "msg-assistant", sessionID: "ses-external", role: "assistant" }, parts: [{ type: "tool", text: "x".repeat(1024 * 1024) }] },
        { info: { id: "msg-user", sessionID: "ses-external", role: "user" }, parts: [{ type: "text", text: "I prefer concise replies." }] },
      ] }),
    } } });
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-external" } } });
    expect(mockCallMcpTool.mock.calls.filter((call) => call[2].external.message)).toHaveLength(1);
  });

  it("rejects foreign SDK session/worktree identity before transmitting text", async () => {
    mockCallMcpTool.mockResolvedValue({ content: [{ text: JSON.stringify({ enabled: true }) }] });
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { session: {
      get: vi.fn().mockResolvedValue({ data: { id: "foreign", directory: "/foreign" } }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    } } });
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-external" } } });
    expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
    expect(mockCallMcpTool.mock.calls[0][2].external.message).toBeUndefined();
  });
});
