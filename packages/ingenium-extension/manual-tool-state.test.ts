import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertExtensionToolEnabled = vi.hoisted(() => vi.fn());
const mockTriggerSynthesis = vi.hoisted(() => vi.fn());
const mockLogPipelineEvent = vi.hoisted(() => vi.fn());
const mockImportObservationsFromFile = vi.hoisted(() => vi.fn());

vi.mock("@opencode-ai/plugin", () => ({
  tool: (definition: unknown) => definition,
}));

vi.mock("./mcp-tool-state.js", () => ({
  assertExtensionToolEnabled: mockAssertExtensionToolEnabled,
}));

vi.mock("./mcp-client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{}" }] }),
  mcpToolData: () => ({}),
  McpBridgeError: class extends Error {},
}));

vi.mock("./observer-core.js", () => ({
  triggerSynthesis: mockTriggerSynthesis,
  logPipelineEvent: mockLogPipelineEvent,
  importObservationsFromFile: mockImportObservationsFromFile,
}));

import { AutoObserverPlugin } from "./auto-observer.js";
import { ObserverPlugin } from "./observer.js";

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("manual extension MCP tool state enforcement", () => {
  const worktree = "/worktree";

  beforeEach(() => {
    mockAssertExtensionToolEnabled.mockResolvedValue("extension-project");
    mockTriggerSynthesis.mockResolvedValue({ triggered: true, message: "ok" });
    mockLogPipelineEvent.mockResolvedValue(undefined);
    mockImportObservationsFromFile.mockResolvedValue({ imported: 0, skipped: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: { created: 0 } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("checks each manual extension tool against its exact catalog name", async () => {
    const auto = await AutoObserverPlugin({ worktree, client: { app: { log: vi.fn() } } });
    const observer = await ObserverPlugin({ worktree, client: { app: { log: vi.fn() } } });

    await (auto.tool.auto_observe_now as any).execute({}, { worktree });
    await (observer.tool.synthesize_observations as any).execute({}, { worktree });

    expect(mockAssertExtensionToolEnabled).toHaveBeenNthCalledWith(1, "auto_observe_now", worktree);
    expect(mockAssertExtensionToolEnabled).toHaveBeenNthCalledWith(2, "synthesize_observations", worktree);
  });

  it("propagates only the fixed state code for a disabled manual tool", async () => {
    mockAssertExtensionToolEnabled.mockRejectedValue(new Error("TOOL_DISABLED"));
    const auto = await AutoObserverPlugin({ worktree, client: { app: { log: vi.fn() } } });

    await expect((auto.tool.auto_observe_now as any).execute({}, { worktree }))
      .rejects.toThrow("TOOL_DISABLED");
    expect((fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("keeps lifecycle automation best-effort and outside the manual state guard", async () => {
    const auto = await AutoObserverPlugin({ worktree, client: { app: { log: vi.fn() } } });
    const observer = await ObserverPlugin({ worktree, client: { app: { log: vi.fn() } } });

    await auto.event({ event: { type: "session.idle" } });
    await observer.event({ event: { type: "session.created" } });

    expect(mockAssertExtensionToolEnabled).not.toHaveBeenCalled();
    expect(mockTriggerSynthesis).toHaveBeenCalledOnce();
  });
});
