import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const project = "protected-plugin-project";
const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
  McpBridgeError: class McpBridgeError extends Error {
    constructor(readonly failure: string) {
      super("bridge");
    }
  },
}));

let worktree = "";
let originalProject: string | undefined;

function mcpResponse(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function successfulMcpTool(name: string) {
  if (name === "repository_sync") {
    return mcpResponse({
      docs: { summary: { created: 1 } },
      resources: {
        summary: {
          skill: { created: 0 },
          agent: { created: 0 },
          plugin: { created: 0 },
        },
      },
    });
  }
  if (name === "extraction_run") return mcpResponse({ created: 0 });
  return mcpResponse({ processed: 0 });
}

beforeEach(() => {
  originalProject = process.env.INGENIUM_PROJECT;
  process.env.INGENIUM_PROJECT = project;
  worktree = mkdtempSync(join(tmpdir(), "ingenium-plugin-protected-auth-"));
  mkdirSync(join(worktree, "docs"), { recursive: true });
  writeFileSync(join(worktree, "docs", "index.md"), "# Fixture\n", "utf8");
  mockCallMcpTool.mockReset();
  vi.resetModules();
});

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
  mockCallMcpTool.mockReset();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("packaged extension lifecycle MCP boundary", () => {
  it("binds repository and observer calls to the configured project without direct HTTP mutations", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockCallMcpTool.mockImplementation(async (_worktree: string, name: string) => successfulMcpTool(name));

    const { ResourceSyncPlugin } = await import("./resource-sync.js");
    const { AutoObserverPlugin } = await import("./auto-observer.js");
    const { ObserverPlugin } = await import("./observer.js");
    const log = vi.fn();

    const resourceSync = await ResourceSyncPlugin({ worktree, client: { app: { log } } });
    await resourceSync.event({ event: { type: "session.created" } });
    const autoObserver = await AutoObserverPlugin({ worktree, client: { app: { log } } });
    await autoObserver.event({ event: { type: "session.idle" } });
    const observer = await ObserverPlugin({ worktree, client: { app: { log } } });
    await observer.event({ event: { type: "session.created", session: { id: "session-1" } } });

    expect(mockCallMcpTool.mock.calls.map(([, name]) => name)).toEqual([
      "repository_sync",
      "extraction_run",
      "pipeline_event_log",
      "pipeline_event_log",
      "synthesis_run",
    ]);
    expect(mockCallMcpTool.mock.calls.every(([calledWorktree, _name, args]) =>
      calledWorktree === worktree && args.project === project,
    )).toBe(true);
    expect(mockCallMcpTool).toHaveBeenCalledWith(worktree, "repository_sync", expect.objectContaining({
      project,
      dryRun: false,
      docsManifest: { files: [expect.objectContaining({ path: "docs/index.md" })] },
      resourcesManifest: expect.objectContaining({ version: 2 }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps resource-sync bridge failures non-fatal and credential-free", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.fn();
    mockCallMcpTool.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack"));
    const { ResourceSyncPlugin } = await import("./resource-sync.js");

    const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log } } });
    await plugin.event({ event: { type: "session.created" } });

    const diagnostic = JSON.stringify(log.mock.calls);
    expect(diagnostic).toContain("resource_sync: request_failed");
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("private.example");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication", { failure: "authentication" }, "authentication"],
    ["timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
  ])("keeps %s observer bridge failures non-fatal and credential-free", async (_case, failure, expected) => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const log = vi.fn();
    mockCallMcpTool.mockRejectedValue(failure);
    const { AutoObserverPlugin } = await import("./auto-observer.js");
    const plugin = await AutoObserverPlugin({ worktree, client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.idle" } })).resolves.toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).toContain(`trigger_extraction: ${expected}`);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
