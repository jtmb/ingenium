import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertExtensionToolEnabled = vi.hoisted(() => vi.fn());
const mockEnsureExtensionProject = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@opencode-ai/plugin", () => ({
  tool: (definition: unknown) => definition,
}));

vi.mock("../mcp-tool-state.js", () => ({
  assertExtensionToolEnabled: mockAssertExtensionToolEnabled,
}));

vi.mock("../project-resolver.js", () => ({
  ensureExtensionProject: mockEnsureExtensionProject,
  classifyExtensionProjectFailure: () => "unavailable",
}));

vi.mock("../api-auth.js", () => ({
  apiRequestHeaders: () => new Headers(),
}));

let AutoObserverPlugin: typeof import("../auto-observer.js").AutoObserverPlugin;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

function failedResponse(status: number): Response {
  return { ok: false, status, json: async () => ({ error: { detail: "Bearer secret-token http://private.example/body" } }) } as Response;
}

describe("AutoObserverPlugin lifecycle output", () => {
  beforeEach(async () => {
    vi.resetModules();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockAssertExtensionToolEnabled.mockReset().mockResolvedValue(undefined);
    mockEnsureExtensionProject.mockReset().mockResolvedValue("extension-project");
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
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
    ["API-down", () => mockFetch.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack")), "request_failed"],
    ["authentication", () => mockFetch.mockResolvedValue(failedResponse(401)), "authentication"],
    ["timeout", () => {
      const error = new Error("Bearer secret-token http://private.example/timeout");
      error.name = "TimeoutError";
      mockFetch.mockRejectedValue(error);
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
    mockFetch.mockResolvedValue(failedResponse(403));
    const log = vi.fn().mockRejectedValue(new Error("logger rejected Bearer secret-token"));
    const plugin = await AutoObserverPlugin({ worktree: "/worktree", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.idle" } })).resolves.toBeUndefined();
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ service: "auto-observer", level: "warn", message: "trigger_extraction: authentication" }),
    }));

    const manual = await (plugin.tool.auto_observe_now as any).execute({}, { worktree: "/worktree" });
    expect(JSON.parse(manual)).toEqual({ triggered: false, message: "API 403" });
    expect(mockAssertExtensionToolEnabled).toHaveBeenCalledWith("auto_observe_now", "/worktree");
  });
});
