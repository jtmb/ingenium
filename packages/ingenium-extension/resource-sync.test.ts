import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hashContent,
  incrementalSync,
  resetIncrementalSyncThrottle,
  resetProjectCache,
  syncAgents,
  syncCommands,
  syncConfig,
  syncPlugins,
  writeAgentToDisk,
  type SyncManifest,
} from "./resource-sync.js";
import { resetEnsuredProjects } from "./project-resolver.js";

let worktree = "";

afterEach(() => {
  vi.unstubAllGlobals();
  resetIncrementalSyncThrottle();
  resetProjectCache();
  resetEnsuredProjects();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("agent resource sync", () => {
  it("does not serialize API model metadata into markdown frontmatter", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    writeAgentToDisk(worktree, {
      name: "sync-agent",
      content: "# Synced agent",
      description: "sync test",
      category: "execution",
      mode: "subagent",
      model: "deepseek/centralized-only",
    });

    const content = readFileSync(join(worktree, ".opencode", "agents", "execution", "sync-agent.md"), "utf8");
    expect(content).not.toMatch(/^model:/m);
  });

  it("serializes broker wildcard deny and hidden metadata without implicit capabilities", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, {
      name: "ingenium-llm-broker",
      content: "# Broker",
      category: "execution",
      permissions: JSON.stringify({ "*": "deny" }),
      metadata: JSON.stringify({ hidden: true }),
    })).toBe(true);

    const content = readFileSync(
      join(worktree, ".opencode", "agents", "execution", "ingenium-llm-broker.md"),
      "utf8",
    );
    expect(content).toContain("hidden: true");
    expect(content).toContain('"*": deny');
    expect(content).not.toMatch(/^\s+(?:read|write|bash):\s+allow$/m);
  });

  it.each([
    ["omitted", undefined, undefined],
    ["malformed", "{not-json", "[not-json"],
    ["permissive", JSON.stringify({ "*": "allow", read: "allow" }), JSON.stringify({ hidden: false })],
  ])("normalizes %s broker fields before writing disk sync output", (_case, permissions, metadata) => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, {
      name: "ingenium-llm-broker",
      content: "# Broker",
      category: "execution",
      permissions,
      metadata,
    })).toBe(true);

    const content = readFileSync(
      join(worktree, ".opencode", "agents", "execution", "ingenium-llm-broker.md"),
      "utf8",
    );
    expect(content).toContain("hidden: true");
    expect(content).toMatch(/^permission:\n  "\*": deny$/m);
    expect(content).not.toMatch(/^\s+(?:read|write|bash):\s+allow$/m);
  });

  it("rejects traversal names, invalid categories, and symlinked agent directories", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const outside = mkdtempSync(join(tmpdir(), "ingenium-agent-outside-"));
    try {
      expect(writeAgentToDisk(worktree, { name: "../escape", content: "# no" })).toBe(false);
      expect(writeAgentToDisk(worktree, { name: "safe", category: "../escape", content: "# no" })).toBe(false);

      mkdirSync(join(worktree, ".opencode", "agents"), { recursive: true });
      symlinkSync(outside, join(worktree, ".opencode", "agents", "execution"));
      expect(writeAgentToDisk(worktree, { name: "safe", category: "execution", content: "# no" })).toBe(false);
      expect(existsSync(join(outside, "safe.md"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("removes stale disk files for disabled API agents instead of resurrecting them", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, { name: "disabled-agent", category: "execution", content: "# stale" })).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ name: "disabled-agent", content: "# API", category: "execution", enabled: false }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: true });

    expect(result.removed).toBe(1);
    expect(existsSync(join(worktree, ".opencode", "agents", "execution", "disabled-agent.md"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats numeric disabled broker rows as tombstones and never recreates their file", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const brokerPath = join(worktree, ".opencode", "agents", "execution", "ingenium-llm-broker.md");
    expect(writeAgentToDisk(worktree, {
      name: "ingenium-llm-broker",
      category: "execution",
      content: "# Stale broker",
    })).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          name: "ingenium-llm-broker",
          content: "# API broker",
          category: "execution",
          enabled: 0,
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1,
      project: "project",
      lastFullSync: "",
      resources: {
        skills: {},
        agents: { "ingenium-llm-broker": hashContent("stale-broker") },
        plugins: {},
        commands: {},
        config: {},
      },
    };

    const result = await syncAgents(worktree, "project", manifest, { isInitialSync: true });

    expect(result.removed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(existsSync(brokerPath)).toBe(false);
    expect(manifest.resources.agents["ingenium-llm-broker"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("imports a disk-only ordinary agent as disabled", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, { name: "orphan-agent", category: "chat", content: "# local" })).toBe(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: true });

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).enabled).toBe(false);
  });

  it("quarantines disk-only brokers on an empty API without posting an import", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const executionDir = join(worktree, ".opencode", "agents", "execution");
    const researchDir = join(worktree, ".opencode", "agents", "research");
    mkdirSync(executionDir, { recursive: true });
    mkdirSync(researchDir, { recursive: true });
    const broker = "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Disk-only broker\n";
    writeFileSync(join(executionDir, "ingenium-llm-broker.md"), broker);
    writeFileSync(join(researchDir, "ingenium-llm-broker.md"), broker);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1,
      project: "project",
      lastFullSync: "",
      resources: {
        skills: {},
        agents: { "ingenium-llm-broker": hashContent("stale-broker") },
        plugins: {},
        commands: {},
        config: {},
      },
    };

    const result = await syncAgents(worktree, "project", manifest, { isInitialSync: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.method).toBeUndefined();
    expect(result).toMatchObject({ pushed: 0, skipped: 1, removed: 1, errors: 0 });
    expect(existsSync(join(executionDir, "ingenium-llm-broker.md"))).toBe(false);
    expect(existsSync(join(researchDir, "ingenium-llm-broker.md"))).toBe(false);
    expect(manifest.resources.agents["ingenium-llm-broker"]).toBeUndefined();
  });

  it("adds the protected fallback bearer token to resource-sync requests", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const opencodeDir = join(worktree, ".opencode");
    mkdirSync(opencodeDir);
    const tokenPath = join(opencodeDir, ".ingenium-api-token");
    writeFileSync(tokenPath, "test_resource_sync_token_0123456789\n", { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await syncAgents(worktree, "project", { version: 1, project: "project", lastFullSync: "", resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } }, { isInitialSync: false });

    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("Authorization")).toBe("Bearer test_resource_sync_token_0123456789");
  });

  it("rejects an API-created arbitrary broker profile instead of trusting or writing it", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const executionDir = join(worktree, ".opencode", "agents", "execution");
    const researchDir = join(worktree, ".opencode", "agents", "research");
    mkdirSync(executionDir, { recursive: true });
    mkdirSync(researchDir, { recursive: true });
    const weakenedProfile = "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Weak broker\n";
    writeFileSync(join(executionDir, "ingenium-llm-broker.md"), weakenedProfile);
    writeFileSync(join(researchDir, "ingenium-llm-broker.md"), weakenedProfile);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          name: "ingenium-llm-broker",
          content: "# Trusted broker",
          description: "trusted",
          category: "execution",
          mode: "subagent",
          permissions: JSON.stringify({ "*": "allow" }),
          metadata: JSON.stringify({ hidden: false }),
          enabled: true,
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1 as const,
      project: "project",
      lastFullSync: "",
      resources: {
        skills: {},
        agents: { "ingenium-llm-broker": hashContent("stale-baseline") },
        plugins: {},
        commands: {},
        config: {},
      },
    };

    const result = await syncAgents(worktree, "project", manifest, { isInitialSync: false });

    expect(result).toMatchObject({ pushed: 0, synced: 0, skipped: 1, errors: 1, removed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(executionDir, "ingenium-llm-broker.md"))).toBe(false);
    expect(existsSync(join(researchDir, "ingenium-llm-broker.md"))).toBe(false);
    expect(manifest.resources.agents["ingenium-llm-broker"]).toBeUndefined();
  });

  it("records a successful initial agent import as a converged baseline", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    expect(writeAgentToDisk(worktree, { name: "initial-agent", category: "execution", content: "# Local agent" })).toBe(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1 as const,
      project: "project",
      lastFullSync: "",
      resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} },
    };

    const result = await syncAgents(worktree, "project", manifest, { isInitialSync: true });

    expect(result).toMatchObject({ pushed: 1, conflicts: 0, errors: 0 });
    expect(manifest.resources.agents["initial-agent"]).toBe(hashContent(JSON.stringify({
      content: "# Local agent",
      permissions: "{}",
      metadata: "{}",
    })));
  });

  it.each([
    ["plugin", ".opencode/plugins/local-plugin.ts", "export {}", syncPlugins, "plugins"],
    ["command", ".opencode/commands/local-command.md", "# Local command", syncCommands, "commands"],
  ] as const)("records a successful initial %s import as a converged baseline", async (_kind, relativePath, source, sync, resource) => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const fullPath = join(worktree, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, source);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1 as const,
      project: "project",
      lastFullSync: "",
      resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} },
    };

    const result = await sync(worktree, "project", manifest, { isInitialSync: true });
    const name = resource === "plugins" ? "local-plugin" : "local-command";

    expect(result).toMatchObject({ pushed: 1, conflicts: 0, errors: 0 });
    expect(manifest.resources[resource][name]).toBe(hashContent(source));
  });

  it("records a successful initial config import as a converged baseline", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const source = '{"plugin":[]}\n';
    writeFileSync(join(worktree, "opencode.json"), source);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const manifest: SyncManifest = {
      version: 1 as const,
      project: "project",
      lastFullSync: "",
      resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} },
    };

    const result = await syncConfig(worktree, "project", manifest, { isInitialSync: true });

    expect(result).toMatchObject({ pushed: 1, conflicts: 0, errors: 0 });
    expect(manifest.resources.config.hash).toBe(hashContent(source));
  });
});

describe("incremental resource sync recovery", () => {
  it("does not consume the idle throttle when an incremental reconciliation fails", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-idle-"));
    const originalProject = process.env.INGENIUM_PROJECT;
    process.env.INGENIUM_PROJECT = "idle-recovery-project";
    let docsCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/preflight")) return { ok: true, status: 200, json: async () => ({}) } as Response;
      if (path.endsWith("/projects")) return { ok: true, status: 201, json: async () => ({}) } as Response;
      if (path.endsWith("/docs/repository/sync")) {
        docsCalls += 1;
        if (docsCalls === 1) return { ok: false, status: 503, json: async () => ({}) } as Response;
        return { ok: true, status: 200, json: async () => ({ data: { summary: {} } }) } as Response;
      }
      if (path.endsWith("/repository/resources/sync")) {
        return { ok: true, status: 200, json: async () => ({ data: { summary: {} } }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const failed = await incrementalSync(worktree);
      const recovered = await incrementalSync(worktree);
      const throttled = await incrementalSync(worktree);

      expect(failed?.docs?.errors).toBe(1);
      expect(recovered?.docs?.errors).toBe(0);
      expect(throttled).toBeNull();
      expect(docsCalls).toBe(2);
    } finally {
      if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
      else process.env.INGENIUM_PROJECT = originalProject;
    }
  });
});
