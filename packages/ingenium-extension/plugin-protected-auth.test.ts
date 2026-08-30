import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const project = "protected-plugin-project";
const operationId = "00000000-0000-4000-8000-000000000099";
const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  openMcpToolClient: vi.fn(async (worktree: string) => ({
    callTool: (name: string, args: Record<string, unknown>) => mockCallMcpTool(worktree, name, args),
    close: vi.fn(async () => undefined),
  })),
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
  McpBridgeError: class McpBridgeError extends Error {
    constructor(readonly failure: string) {
      super("bridge");
    }
  },
}));

let worktree = "";
let originalProject: string | undefined;
let originalStorageMappingHash: string | undefined;
let coordinationRevision = 0;
let coordinationClaimKey = "";

function mcpResponse(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function coordinationSession() {
  return {
    actorId: `actor-${"a".repeat(64)}`,
    revision: coordinationRevision,
    fence: 1,
    state: "active",
    heartbeatAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:05:00.000Z",
    snapshotRevision: 0,
    currentTaskId: null,
    currentTaskRevision: null,
    contextConversationId: "00000000-0000-4000-8000-000000000001",
    contextRevision: 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function successfulMcpTool(name: string, args: Record<string, unknown> = {}) {
  if (name === "coordination_update") {
    if (args.operation !== "register") coordinationRevision += 1;
    return mcpResponse({
      session: coordinationSession(),
      ...(args.operation === "register" ? {
        memory: {
          conversationId: "00000000-0000-4000-8000-000000000001",
          revision: 0,
          entries: [],
          throughRevision: 0,
          acknowledgementRequired: false,
        },
      } : {}),
    });
  }
  if (name === "coordination_claim") {
    if (args.action === undefined) {
      coordinationClaimKey = args.client_claim_key as string;
      coordinationRevision += 1;
      return mcpResponse({ session: coordinationSession(), acceptedEpoch: 1, manifestGeneration: 0, operationId });
    }
    if (args.client_claim_key !== coordinationClaimKey) throw new Error("claim key");
    coordinationRevision += 1;
    return mcpResponse({ session: coordinationSession(), acceptedEpoch: 1, manifestGeneration: 0 });
  }
  if (name === "repository_sync") {
    return mcpResponse({
      generation: 1,
      manifestHash: "b".repeat(64),
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
  if (name === "extraction_run") return mcpResponse({ status: "started" });
  return mcpResponse({ processed: 0 });
}

beforeEach(() => {
  originalProject = process.env.INGENIUM_PROJECT;
  originalStorageMappingHash = process.env.INGENIUM_STORAGE_MAPPING_HASH;
  process.env.INGENIUM_PROJECT = project;
  process.env.INGENIUM_STORAGE_MAPPING_HASH = "a".repeat(64);
  worktree = mkdtempSync(join(tmpdir(), "ingenium-plugin-protected-auth-"));
  execFileSync("git", ["-C", worktree, "init", "--quiet"], { timeout: 10_000, stdio: "ignore" });
  mkdirSync(join(worktree, ".opencode"), { recursive: true });
  mkdirSync(join(worktree, "docs"), { recursive: true });
  writeFileSync(join(worktree, "docs", "index.md"), "# Fixture\n", "utf8");
  for (const name of [
    ".ingenium-mcp-credential",
    ".ingenium-learning-credential",
    ".ingenium-repository-sync-credential",
  ]) {
    const path = join(worktree, ".opencode", name);
    writeFileSync(path, `${name[10]!.repeat(32)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
    mcp: {
      ingenium: {
        type: "local",
        enabled: true,
        command: ["node", "packages/ingenium-extension/dist/scripts/mcp-server.js"],
        environment: {
          INGENIUM_API_URL: "http://localhost:4097/api/v1",
          INGENIUM_PROJECT: project,
           INGENIUM_WORKSPACE_ID: "protected-plugin-workspace",
           INGENIUM_WORKTREE: worktree,
           INGENIUM_STORAGE_MAPPING_HASH: "a".repeat(64),
          INGENIUM_MCP_AUDIENCE: "mcp",
          INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
          INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
          INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
        },
      },
    },
  }));
  coordinationRevision = 0;
  coordinationClaimKey = "";
  mockCallMcpTool.mockReset();
  vi.resetModules();
});

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalStorageMappingHash === undefined) delete process.env.INGENIUM_STORAGE_MAPPING_HASH;
  else process.env.INGENIUM_STORAGE_MAPPING_HASH = originalStorageMappingHash;
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
    mockCallMcpTool.mockImplementation(async (_worktree: string, name: string, args: Record<string, unknown>) => successfulMcpTool(name, args));

    const { ResourceSyncPlugin } = await import("./resource-sync.js");
    const { AutoObserverPlugin } = await import("./auto-observer.js");
    const { ObserverPlugin } = await import("./observer.js");
    const log = vi.fn();

    const resourceSync = await ResourceSyncPlugin({ worktree, client: { app: { log } } });
    await resourceSync.event({ event: { type: "session.created", properties: { info: { id: "session-resource-sync" } } } });
    const autoObserver = await AutoObserverPlugin({ worktree, client: { app: { log } } });
    await autoObserver.event({ event: { type: "session.idle" } });
    const observer = await ObserverPlugin({ worktree, client: { app: { log } } });
    await observer.event({ event: { type: "session.created", session: { id: "session-1" } } });

    expect(mockCallMcpTool.mock.calls.map(([, name]) => name)).toEqual([
      "coordination_update",
      "coordination_claim",
      "coordination_claim",
      "coordination_claim",
      "repository_sync",
      "coordination_claim",
      "coordination_claim",
      "coordination_claim",
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
    await plugin.event({ event: { type: "session.created", properties: { info: { id: "session-resource-sync" } } } });

    const diagnostic = JSON.stringify(log.mock.calls);
    expect(diagnostic).toContain("coordination: request_failed");
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("private.example");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("holds the repository claim around the complete session-triggered sync", async () => {
    mockCallMcpTool.mockImplementation(async (_worktree: string, name: string, args: Record<string, unknown>) => successfulMcpTool(name, args));
    const { ResourceSyncPlugin } = await import("./resource-sync.js");
    const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });

    await plugin.event({ event: {
      type: "session.created",
      properties: { info: { id: "session-resource-sync" } },
    } });

    expect(mockCallMcpTool.mock.calls.map(([, name]) => name)).toEqual([
      "coordination_update",
      "coordination_claim",
      "coordination_claim",
      "coordination_claim",
      "repository_sync",
      "coordination_claim",
      "coordination_claim",
      "coordination_claim",
    ]);
    const claimCalls = mockCallMcpTool.mock.calls.filter(([, name]) => name === "coordination_claim");
    const claim = claimCalls[0]![2];
    expect(claimCalls.map(([, , args]) => args.action ?? "batch")).toEqual([
      "batch", "renew", "verify", "renew", "verify", "complete",
    ]);
    expect(claim).toEqual(expect.objectContaining({
      expected_revision: 0,
      fence: 1,
      ownership_token: expect.any(String),
      client_claim_key: expect.any(String),
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    }));
    const sync = mockCallMcpTool.mock.calls.find(([, name]) => name === "repository_sync")![2];
    expect(sync.claim).toEqual(expect.objectContaining({
      accepted_epoch: 1,
      client_claim_key: claim.client_claim_key,
      expected_revision: expect.any(Number),
      fence: 1,
      ownership_token: expect.any(String),
    }));
    expect(claim.client_claim_key).not.toBe(claim.ownership_token);
    expect(mockCallMcpTool.mock.calls.some(([, name]) => name === "coordination_release")).toBe(false);
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
