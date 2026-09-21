import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveBinding = vi.hoisted(() => vi.fn());
const mockContextSync = vi.hoisted(() => vi.fn());
const mockUsageSync = vi.hoisted(() => vi.fn());

vi.mock("./extension-binding.js", () => ({ resolveExtensionBinding: mockResolveBinding }));
vi.mock("./context-upload.js", () => ({
  ContextAutoUploader: class {
    sync = mockContextSync;
  },
}));
vi.mock("./external-usage.js", () => ({
  ExternalUsageCollector: class {
    sync = mockUsageSync;
  },
}));
vi.mock("./mcp-client.js", () => ({
  callMcpTool: vi.fn(),
  mcpToolData: vi.fn(),
}));
vi.mock("./plugin-lifecycle-log.js", () => ({ logPluginLifecycle: vi.fn() }));

import { LifecyclePlugin } from "./lifecycle.js";

beforeEach(() => {
  mockResolveBinding.mockReset();
  mockContextSync.mockReset();
  mockUsageSync.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("independent lifecycle adapter", () => {
  it("uses the root lifecycle hook while delegating session reads to the v2 client", async () => {
    mockResolveBinding.mockReturnValue({ project: "ingenium", audience: "mcp", launcherWorktree: "/worktree" });
    mockContextSync.mockResolvedValue(undefined);
    mockUsageSync.mockResolvedValue(undefined);
    const client = { v2: { session: {} }, app: { log: vi.fn() } };
    const plugin = await LifecyclePlugin({
      worktree: "/worktree",
      client,
      serverUrl: new URL("http://127.0.0.1:4098"),
    } as any);

    if (!plugin.event) throw new Error("lifecycle hook missing");
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } } as any);
    expect(mockContextSync).toHaveBeenCalledWith("ses-1");
    expect(mockUsageSync).toHaveBeenCalledWith("ses-1");
    expect(mockResolveBinding).toHaveBeenCalledWith("/worktree", { purpose: "general", allowMissingCredential: true });
  });

  it("ignores unrelated lifecycle events and keeps usage failures non-fatal", async () => {
    mockResolveBinding.mockReturnValue({ project: "ingenium", audience: "mcp", launcherWorktree: "/worktree" });
    mockContextSync.mockReset().mockResolvedValue(undefined);
    mockUsageSync.mockReset().mockRejectedValue(new Error("usage unavailable"));
    const plugin = await LifecyclePlugin({
      worktree: "/worktree",
      client: { v2: {} },
      serverUrl: new URL("http://127.0.0.1:4098"),
    } as any);

    if (!plugin.event) throw new Error("lifecycle hook missing");
    await plugin.event({ event: { type: "session.created", properties: { sessionID: "ses-1" } } } as any);
    expect(mockContextSync).not.toHaveBeenCalled();
    await expect(plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } } as any)).resolves.toBeUndefined();
  });

});
