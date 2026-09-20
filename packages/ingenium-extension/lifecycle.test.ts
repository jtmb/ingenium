import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveBinding = vi.hoisted(() => vi.fn());
const mockContextSync = vi.hoisted(() => vi.fn());
const mockUsageSync = vi.hoisted(() => vi.fn());
const mockRecoverySource = vi.hoisted(() => vi.fn());
const mockPublishRecovery = vi.hoisted(() => vi.fn());
const mockRecoveryHandoff = vi.hoisted(() => vi.fn());

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
vi.mock("./scripts/production-restart.js", () => ({ redactedHandoffFromSession: mockRecoveryHandoff }));
vi.mock("./tui-recovery.js", () => ({
  currentRecoverySource: mockRecoverySource,
  isValidRecoveryRole: (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
  publishCurrentParentRecovery: mockPublishRecovery,
}));

import { LifecyclePlugin } from "./lifecycle.js";

beforeEach(() => {
  mockResolveBinding.mockReset();
  mockContextSync.mockReset();
  mockUsageSync.mockReset();
  mockRecoverySource.mockReset();
  mockPublishRecovery.mockReset();
  mockRecoveryHandoff.mockReset();
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

  it("publishes a content-free current-parent handoff with monotonic session revision", async () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const storageMappingHash = "a".repeat(64);
    const handoff = {
      replay: { sessionIdSha256: "b".repeat(64), todos: [{ id: "TODO-1", content: "Continue", status: "in_progress", priority: "high" }] },
      status: "idle", taskHash: null, actions: [], changedPaths: [], checks: [],
      todos: { total: 1, pending: 0, inProgress: 1, completed: 0, cancelled: 0, state: "in_progress" },
      nextWork: { kind: "continue_task", referenceHash: "c".repeat(64) },
    };
    mockResolveBinding.mockReturnValue({ project: "ingenium", projectId, workspaceId: "workspace-1",
      launcherWorktree: "/worktree", storageMappingHash, audience: "mcp" });
    mockRecoverySource.mockReturnValue({ head: "d".repeat(40), clean: true });
    mockRecoveryHandoff.mockReturnValue(handoff);
    mockContextSync.mockResolvedValue(undefined);
    mockUsageSync.mockResolvedValue(undefined);
    vi.stubEnv("INGENIUM_RESTART_NONCE", "n".repeat(43));
    const get = vi.fn().mockResolvedValue({ data: { data: { id: "ses-1", location: { directory: "/worktree" } } } });
    const messages = vi.fn().mockResolvedValue({ data: { data: [{
      id: "assistant-1", type: "assistant", agent: "engineer", model: { id: "model", providerID: "provider" },
      time: { created: 1 }, content: [],
    }], cursor: { next: null } } });
    const plugin = await LifecyclePlugin({
      worktree: "/worktree", client: { v2: { session: { get, messages } } },
      serverUrl: new URL("http://127.0.0.1:4098"),
    } as any);

    if (!plugin.event) throw new Error("lifecycle hook missing");
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } } as any);
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } } as any);

    expect(mockPublishRecovery).toHaveBeenCalledTimes(2);
    expect(mockPublishRecovery.mock.calls[0]?.[0]).toMatchObject({
      binding: { project: "ingenium", projectId, workspaceId: "workspace-1", launcherWorktree: "/worktree", storageMappingHash },
      nonce: "n".repeat(43), controlPlane: "http://127.0.0.1:4098", source: { head: "d".repeat(40), clean: true },
      sessions: [{ role: "engineer", sessionId: "ses-1", incarnation: 1, revision: 0, fence: 1,
        coordinationSessionId: expect.stringMatching(/^session-[0-9a-f]{64}$/),
        worktreeId: expect.stringMatching(/^worktree-[0-9a-f]{64}$/), handoff, todos: [{ id: "TODO-1", status: "in_progress" }] }],
    });
    expect(mockPublishRecovery.mock.calls[1]?.[0]?.sessions?.[0]).toMatchObject({ incarnation: 1, revision: 1, fence: 1 });
  });
});
