/**
 * Resource Sync Engine Tests
 *
 * Tests for:
 *   - Project name derivation (env var, worktree fallback, no default)
 *   - Manifest read/write/update, missing manifest creation
 *   - Content hash comparison
 *   - known-map guard: disk-only items not in manifest are preserved
 *   - known-map guard: disk-only items in manifest are deleted on API delete
 *   - Plugin opencode.json merge
 *
 * These tests use in-memory file systems via tmp directories and mock the
 * fetch API. They exercise the core sync engine functions from resource-sync.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("../packages/ingenium-extension/mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
}));

function tmpDir(): string {
  const dir = resolve(tmpdir(), `resource-sync-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(filePath: string, content: string): void {
  const parent = resolve(filePath, "..");
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

const originalFetch = globalThis.fetch;

function mockFetch(responses: Array<{ pattern: string; status: number; body: any; method?: string }>) {
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const reqMethod = (init?.method || "GET").toUpperCase();
    
    // Prefer method-specific mocks so one URL can represent multiple operations.
    let match: typeof responses[0] | undefined;
    for (const resp of responses) {
      if (urlStr.includes(resp.pattern)) {
        if (resp.method && resp.method.toUpperCase() === reqMethod) {
          match = resp;
          break;
        }
        if (!resp.method && !match) {
          match = resp;
        }
      }
    }
    
    if (match) {
      return {
        ok: match.status < 400,
        status: match.status,
        json: async () => match.body,
      } as Response;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    } as Response;
  }) as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function importModule() {
  const mod = await import("../packages/ingenium-extension/resource-sync.js");
  return mod;
}

describe("Project Resolution", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockCallMcpTool.mockReset();
  });

  it("uses INGENIUM_PROJECT env var when set", async () => {
    process.env.INGENIUM_PROJECT = "my-custom-project";
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const result = resolveProject("/home/user/worktrees/my-other-project");
    expect(result).toBe("my-custom-project");
    resetProjectCache();
  });

  it("requires a credential-bound project locator when env var is empty", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/home/user/repos/gh-llm-bootstrap")).toThrow(/credential-bound INGENIUM_PROJECT/);
    resetProjectCache();
  });

  it("rejects a whitespace-only explicit project", async () => {
    process.env.INGENIUM_PROJECT = "   ";
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/home/user/repos/my-worktree")).toThrow(/safe project name/);
    resetProjectCache();
  });

  it.each(["a/b", "a\\b", ".", "..", "bad\u0000name", "x".repeat(65)])("rejects every unsafe explicit project identifier: %j", async (project) => {
    process.env.INGENIUM_PROJECT = project;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/home/user/repos/worktree")).toThrow(/safe project name/);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("rejected project identity"));
    expect(stderr.mock.calls.flat().join("")).not.toContain(project);
    resetProjectCache();
  });

  it("never falls back to global-default when unset", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/some/path/valid-worktree")).toThrow(/credential-bound INGENIUM_PROJECT/);
    resetProjectCache();
  });

  it("throws when worktree is root (no meaningful basename)", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/")).toThrow(/credential-bound INGENIUM_PROJECT/);
    resetProjectCache();
  });

  it("rejects the container workspace basename without an explicit project", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/workspace")).toThrow(/credential-bound INGENIUM_PROJECT/);
  });

  it("allows the container workspace only with an explicit global project", async () => {
    process.env.INGENIUM_PROJECT = "global-default";
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(resolveProject("/workspace")).toBe("global-default");
    resetProjectCache();
  });

  it("caches project resolution (idempotent)", async () => {
    process.env.INGENIUM_PROJECT = "cached-project";
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const first = resolveProject("/some/path");
    const second = resolveProject("/different/path");
    expect(first).toBe("cached-project");
    expect(second).toBe("cached-project");
    resetProjectCache();
  });

  it("deduplicates concurrent extension project provisioning and retries failures", async () => {
    process.env.INGENIUM_PROJECT = "provisioned-project";
    process.env.INGENIUM_WORKSPACE_ID = "fixture-workspace";
    vi.resetModules();
    const { ensureExtensionProject, resetEnsuredProjects } = await import("../packages/ingenium-extension/project-resolver.js");
    let detailAttempts = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/preflight")) return {
        ok: true,
        status: 200,
        json: async () => ({ data: {
          scopes: ["projects:read"],
          organizationId: "fixture-organization",
          projectId: "fixture-project-id",
          projectIds: ["fixture-project-id"],
          audience: "mcp",
          workspaceId: "fixture-workspace",
          launcherWorktree: "/worktrees/provisioned-project",
          restartRequiredOnCredentialChange: true,
        } }),
      } as Response;
      detailAttempts += 1;
      return {
        ok: detailAttempts !== 2,
        status: detailAttempts === 2 ? 500 : 200,
        json: async () => ({ data: { project: { id: "fixture-project-id" } } }),
      } as Response;
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await expect(Promise.all([
      ensureExtensionProject("/worktrees/provisioned-project", "http://api.test/api/v1/"),
      ensureExtensionProject("/worktrees/provisioned-project", "http://api.test/api/v1"),
    ])).resolves.toEqual(["provisioned-project", "provisioned-project"]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/preflight"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/projects/provisioned-project/detail"))).toHaveLength(1);

    resetEnsuredProjects();
    await expect(ensureExtensionProject("/worktrees/provisioned-project", "http://api.test/api/v1")).rejects.toMatchObject({ failure: "rejected" });
    await expect(ensureExtensionProject("/worktrees/provisioned-project", "http://api.test/api/v1")).resolves.toBe("provisioned-project");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/preflight"))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/projects/provisioned-project/detail"))).toHaveLength(3);
    resetEnsuredProjects();
  });

  it("submits the configured project through MCP on session creation without direct mutation fetches", async () => {
    process.env.INGENIUM_PROJECT = "startup-project";
    const worktree = tmpDir();
    writeFile(resolve(worktree, "docs", "index.md"), "# MCP fixture\n");
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockCallMcpTool.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          docs: { summary: { created: 1 } },
          resources: { summary: { skill: {}, agent: {}, plugin: {} } },
        }),
      }],
    });
    const { ResourceSyncPlugin } = await import("../packages/ingenium-extension/resource-sync.js");

    try {
      const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });
      await plugin.event({ event: { type: "session.created" } });

      expect(mockCallMcpTool).toHaveBeenCalledWith(worktree, "repository_sync", expect.objectContaining({
        project: "startup-project",
        dryRun: false,
        docsManifest: { files: [expect.objectContaining({ path: "docs/index.md" })] },
        resourcesManifest: expect.objectContaining({ version: 2 }),
      }));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe("Manifest", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("creates manifest when none exists", async () => {
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
    const { loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    expect(manifest.version).toBe(2);
    expect(manifest.project).toBe("test-project");
    expect(manifest.resources.skills).toEqual({});
    expect(manifest.resources.agents).toEqual({});
    expect(manifest.lastFullSync).toBeTruthy();
    resetProjectCache();
  });

  it("reads existing manifest", async () => {
    const manifestDir = resolve(worktree, ".opencode");
    mkdirSync(manifestDir, { recursive: true });
    const manifestData = {
      version: 1,
      project: "test-project",
      projectId: "project-instance-1",
      lastFullSync: "2025-01-01T00:00:00.000Z",
      resources: {
        skills: { "my-skill": "abc123" },
        agents: {},
        plugins: {},
        commands: {},
        config: { hash: "def456" },
      },
    };
    writeFileSync(resolve(manifestDir, ".ingenium-sync-state.json"), JSON.stringify(manifestData));

    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
    const { loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    expect(manifest.resources.skills["my-skill"]).toBe("abc123");
    expect(manifest.projectId).toBe("project-instance-1");
    expect(manifest.resources.config.hash).toBe("def456");
    resetProjectCache();
  });

  it("resets manifest when project identity changes", async () => {
    const manifestDir = resolve(worktree, ".opencode");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      resolve(manifestDir, ".ingenium-sync-state.json"),
      JSON.stringify({
        version: 1,
        project: "old-project",
        lastFullSync: "2025-01-01T00:00:00.000Z",
        resources: { skills: { old: "xyz" }, agents: {}, plugins: {}, commands: {}, config: {} },
      }),
    );

    vi.resetModules();
    const { loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "new-project");
    expect(manifest.project).toBe("new-project");
    expect(manifest.resources.skills).toEqual({});
  });

  it("writes manifest to disk", async () => {
    vi.resetModules();
    const { loadManifest, saveManifest } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "my-project");
    manifest.resources.skills["test-skill"] = "hash123";
    manifest.resources.config.hash = "confighash";
    saveManifest(worktree, manifest);

    const savedPath = resolve(worktree, ".opencode", ".ingenium-sync-state.json");
    expect(existsSync(savedPath)).toBe(true);

    const saved = JSON.parse(readFileSync(savedPath, "utf-8"));
    expect(saved.resources.skills["test-skill"]).toBe("hash123");
    expect(saved.resources.config.hash).toBe("confighash");
  });

  it("handles corrupted manifest gracefully", async () => {
    const manifestDir = resolve(worktree, ".opencode");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(resolve(manifestDir, ".ingenium-sync-state.json"), "not valid json {{{");

    vi.resetModules();
    const { loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    expect(manifest.version).toBe(2);
    expect(manifest.resources.skills).toEqual({});
  });
});

describe("API project recreation recovery", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    restoreFetch();
    rmSync(worktree, { recursive: true, force: true });
    vi.resetModules();
  });

  it("does not use legacy command synchronization when the API project ID changes", async () => {
    const commandPath = resolve(worktree, ".opencode", "commands", "keep-me.md");
    writeFile(commandPath, "# Keep me\n");
    writeFile(resolve(worktree, ".opencode", ".ingenium-sync-state.json"), JSON.stringify({
      version: 1,
      project: "test-project",
      projectId: "old-project-id",
      lastFullSync: "2025-01-01T00:00:00.000Z",
      resources: {
        skills: {}, agents: {}, plugins: {}, commands: { "keep-me": "old-hash" }, config: {},
      },
    }));
    mockFetch([
      { pattern: "/auth/preflight", method: "GET", status: 200, body: {} },
      { pattern: "/projects", method: "POST", status: 409, body: {} },
      { pattern: "/projects", method: "GET", status: 200, body: { data: [{ id: "new-project-id", name: "test-project" }] } },
      { pattern: "/skills/locks/acquire", method: "POST", status: 200, body: { data: { ownerToken: "lock-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: {} } },
      { pattern: "/skills", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/agents", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/plugins", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/commands", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/commands", method: "POST", status: 201, body: { data: {} } },
      { pattern: "/config", method: "GET", status: 200, body: { data: null } },
    ]);
    const { fullSync } = await import("../packages/ingenium-extension/resource-sync.js");

    const result = await fullSync(worktree);

    expect(existsSync(commandPath)).toBe(true);
    expect(result.commands.pushed).toBe(0);
    const manifest = JSON.parse(readFileSync(resolve(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8"));
    expect(manifest.projectId).toBe("old-project-id");
  });
});

describe("Content Hashing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("produces consistent SHA-256 hashes", async () => {
    const { hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
    const h1 = hashContent("hello world");
    const h2 = hashContent("hello world");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("produces different hashes for different content", async () => {
    const { hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
    const h1 = hashContent("foo");
    const h2 = hashContent("bar");
    expect(h1).not.toBe(h2);
  });

  it("hashes empty string", async () => {
    const { hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
    const h = hashContent("");
    expect(h).toHaveLength(64);
    expect(h).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("Conflict Resolution", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("API newer wins: writes to disk when API changed but disk matches baseline", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    const skillDir = resolve(worktree, ".opencode", "skills", "foo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: foo\ndescription: \"test\"\n---\n\nv1 content");
    writeFileSync(resolve(skillDir, "metadata.json"), JSON.stringify({ tags: [], alwaysApply: false }));

    const { hashContent: hc1 } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    manifest.resources.skills["foo"] = hc1("v1 content");
    saveManifest(worktree, manifest);

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "test-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", status: 200, body: { data: [{ name: "foo", description: "test", content: "v2 updated content", tags: "", always_apply: 0, enabled: true }] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: loadManifest2, resetProjectCache: reset2 } = await import("../packages/ingenium-extension/resource-sync.js");
      reset2();

      const m2 = loadManifest2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      expect(result.synced).toBeGreaterThanOrEqual(1);
    } finally {
      restoreFetch();
    }
  });

  it("both changed: logs conflict, preserves both (does not overwrite)", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    const skillDir = resolve(worktree, ".opencode", "skills", "bar");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: bar\ndescription: \"t\"\n---\n\ndisk-v2");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const { hashContent: hcBar } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    manifest.resources.skills["bar"] = hcBar("v1-original");
    saveManifest(worktree, manifest);

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conflict-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [{ name: "bar", description: "t", content: "api-v2 content", tags: "", always_apply: 0, enabled: true }] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 201, body: { data: { name: "bar" } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      expect(result.conflicts).toBeGreaterThanOrEqual(1);
      const currentDisk = readFileSync(resolve(skillDir, "SKILL.md"), "utf-8");
      expect(currentDisk).toContain("disk-v2");
    } finally {
      restoreFetch();
    }
  });

  it("equal: skips when no changes", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    const skillDir = resolve(worktree, ".opencode", "skills", "equal-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: equal-skill\ndescription: \"e\"\n---\n\nsame-content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const manifest = loadManifest(worktree, "test-project");
    const { hashContent: hc } = await import("../packages/ingenium-extension/resource-sync.js");
    const diskHash = hc("same-content");
    manifest.resources.skills["equal-skill"] = diskHash;
    saveManifest(worktree, manifest);

    const responses = [
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "equal-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", status: 200, body: { data: [{ name: "equal-skill", description: "e", content: "same-content", tags: "", always_apply: 0, enabled: true }] } },
    ];

    mockFetch(responses);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      expect(result.synced).toBe(0);
      expect(result.pushed).toBe(0);
      expect(result.conflicts).toBe(0);
    } finally {
      restoreFetch();
    }
  });
});

describe("Known-Map Guard (disk-only items)", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("preserves disk-only items NOT in manifest (user-added locally)", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    const skillDir = resolve(worktree, ".opencode", "skills", "user-added-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: user-added-skill\ndescription: \"user\"\n---\n\nuser content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const manifest = loadManifest(worktree, "test-project");
    saveManifest(worktree, manifest);

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "preserve-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("removes disk-only items THAT ARE in manifest (API deleted them)", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    const skillDir = resolve(worktree, ".opencode", "skills", "managed-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: managed-skill\ndescription: \"m\"\n---\n\nmanaged content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const manifest = loadManifest(worktree, "test-project");
    manifest.resources.skills["managed-skill"] = "some-baseline-hash";
    saveManifest(worktree, manifest);

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "remove-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      expect(result.removed).toBeGreaterThanOrEqual(1);
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});

describe("Plugin opencode.json Merge", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  function createOpenCodeConfig(plugins: string[]) {
    const config = {
      $schema: "https://opencode.ai/config.json",
      permission: "allow",
      plugin: plugins,
    };
    writeFileSync(resolve(worktree, "opencode.json"), JSON.stringify(config, null, 2));
  }

  it("adds new API plugins to opencode.json plugin[] array", async () => {
    createOpenCodeConfig([]);

    vi.resetModules();
    const mod = await import("../packages/ingenium-extension/resource-sync.js");

    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/plugins/observer.ts", enabled: true },
        { name: "resource-sync", file_path: "./packages/ingenium-extension/plugins/resource-sync.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toContain("./packages/ingenium-extension/plugins/observer.ts");
      expect(updated.plugin).toContain("./packages/ingenium-extension/plugins/resource-sync.ts");
    } finally {
      restoreFetch();
    }
  });

  it("preserves non-ingenium user plugins", async () => {
    createOpenCodeConfig([
      "./my-custom-plugin.ts",
      "./packages/ingenium-extension/plugins/observer.ts",
    ]);

    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/plugins/observer.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toContain("./my-custom-plugin.ts");
    } finally {
      restoreFetch();
    }
  });

  it("preserves core extension bootstrap plugins when the recreated API project is empty", async () => {
    createOpenCodeConfig([
      "./packages/ingenium-extension/plugins/auto-observer.ts",
      "./packages/ingenium-extension/plugins/observer.ts",
      "./packages/ingenium-extension/plugins/resource-sync.ts",
      "./packages/ingenium-extension/plugins/session-coordinator.ts",
    ]);
    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      await syncPlugins(worktree, "test-project", loadManifest(worktree, "test-project"), { isInitialSync: true });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toEqual([
        "./packages/ingenium-extension/plugins/auto-observer.ts",
        "./packages/ingenium-extension/plugins/observer.ts",
        "./packages/ingenium-extension/plugins/resource-sync.ts",
        "./packages/ingenium-extension/plugins/session-coordinator.ts",
      ]);
    } finally {
      restoreFetch();
    }
  });

  it("removes disabled plugins from opencode.json plugin[] array", async () => {
    createOpenCodeConfig([
      "./packages/ingenium-extension/plugins/observer.ts",
      "./packages/ingenium-extension/old-plugin.ts",
    ]);

    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/plugins/observer.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toContain("./packages/ingenium-extension/plugins/observer.ts");
      expect(updated.plugin).not.toContain("./packages/ingenium-extension/old-plugin.ts");
    } finally {
      restoreFetch();
    }
  });
});

describe("Maintenance Lock Integration", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("skips skill sync when lock is unavailable, preserves manifest", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 423, body: { error: { code: "LOCKED", message: "locked", retryAfterMs: 5000 } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const skillDir = resolve(worktree, ".opencode", "skills", "preserved-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: preserved-skill\ndescription: \"test\"\n---\n\npreserved content");
      writeFileSync(resolve(skillDir, "metadata.json"), "{}");

      const manifest = loadManifest(worktree, "test-project");
      const manifestBefore = { ...manifest.resources.skills };

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(result.skipped).toBeGreaterThanOrEqual(1);

      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);

      expect(manifest.resources.skills).toEqual(manifestBefore);
    } finally {
      restoreFetch();
    }
  });

  it("owner bypass: sync proceeds when lock token is held", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "test-lock-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "api-skill", description: "test", content: "api content", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(result.synced).toBeGreaterThanOrEqual(1);
    } finally {
      restoreFetch();
    }
  });

  it("lock released in finally even after error during sync", async () => {
    let releaseCallCount = 0;

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "error-test-token" } } },
      {
        pattern: "/skills/locks/release", method: "POST",
        status: 200, body: { data: { released: true } },
      },
      { pattern: "/skills?project=test-project", method: "GET", status: 500, body: { error: "internal error" } },
    ]);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/skills/locks/release")) {
        releaseCallCount++;
      }
      return origFetch(url, init);
    }) as typeof globalThis.fetch;

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(releaseCallCount).toBe(1);
    } finally {
      restoreFetch();
    }
  });

  it("non-owner 423: skill mutation blocked without valid token", async () => {
    const ownerToken = "owner-token-a";
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      {
        pattern: "/skills?project=test-project", method: "GET",
        status: 200, body: { data: [] },
      },
      {
        pattern: "/skills?project=test-project", method: "POST",
        status: 423, body: { error: { code: "LOCKED", message: "locked", retryAfterMs: 5000 } },
      },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const skillDir = resolve(worktree, ".opencode", "skills", "blocked-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: blocked-skill\ndescription: \"t\"\n---\n\nblocked");
      writeFileSync(resolve(skillDir, "metadata.json"), "{}");

      const manifest = loadManifest(worktree, "test-project");

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });
      expect(result.errors).toBeGreaterThanOrEqual(1);
    } finally {
      restoreFetch();
    }
  });

  it("transport error: reports errors, preserves manifest, releases lock", async () => {
    let releaseCallCount = 0;
    const origFetch = globalThis.fetch;

    mockFetch([
      {
        pattern: "/skills/locks/acquire", method: "POST",
        status: 500, body: { error: "Internal Server Error" },
      },
    ]);

    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/skills/locks/release")) {
        releaseCallCount++;
      }
      return (origFetch as typeof globalThis.fetch)(url, init);
    }) as typeof globalThis.fetch;

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      const manifestBefore = { ...manifest.resources.skills };

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(result.errors).toBeGreaterThanOrEqual(1);
      expect(result.skipped).toBe(0);

      expect(manifest.resources.skills).toEqual(manifestBefore);

      expect(releaseCallCount).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  it("release failure is logged but does not fail the sync", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "release-fail-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 500, body: { error: "internal" } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(result).toBeDefined();
    } finally {
      restoreFetch();
    }
  });
});

describe("Manifest Convergence", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("successful disk-only push sets manifest baseline to disk hash", async () => {
    const skillDir = resolve(worktree, ".opencode", "skills", "new-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: new-skill\ndescription: \"d\"\n---\n\ndisk content v1");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conv-token-1" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 201, body: { data: { name: "new-skill" } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache, hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      expect(manifest.resources.skills["new-skill"]).toBeUndefined();

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });

      expect(result.pushed).toBeGreaterThanOrEqual(1);

      const diskHash = hashContent("disk content v1");
      expect(manifest.resources.skills["new-skill"]).toBe(diskHash);
    } finally {
      restoreFetch();
    }
  });

  it("failed push preserves manifest baseline unchanged", async () => {
    const skillDir = resolve(worktree, ".opencode", "skills", "fail-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: fail-skill\ndescription: \"f\"\n---\n\nfail content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conv-token-2" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 500, body: { error: "server error" } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      const manifestBefore = { ...manifest.resources.skills };

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });

      expect(result.errors).toBeGreaterThanOrEqual(1);

      expect(manifest.resources.skills).toEqual(manifestBefore);
    } finally {
      restoreFetch();
    }
  });

  it("conflict preserves both baselines unchanged, siblings still converge", async () => {
    const { hashContent: hc } = await import("../packages/ingenium-extension/resource-sync.js");

    const skillADir = resolve(worktree, ".opencode", "skills", "skill-a");
    mkdirSync(skillADir, { recursive: true });
    writeFileSync(resolve(skillADir, "SKILL.md"), "---\nname: skill-a\ndescription: \"a\"\n---\n\ndisk-v2");
    writeFileSync(resolve(skillADir, "metadata.json"), "{}");

    const skillBDir = resolve(worktree, ".opencode", "skills", "skill-b");
    mkdirSync(skillBDir, { recursive: true });
    writeFileSync(resolve(skillBDir, "SKILL.md"), "---\nname: skill-b\ndescription: \"b\"\n---\n\nb-v1");
    writeFileSync(resolve(skillBDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conv-token-3" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      {
        pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
          { name: "skill-a", description: "a", content: "api-v2", tags: "", always_apply: 0, enabled: true },
          { name: "skill-b", description: "b", content: "b-v2", tags: "", always_apply: 0, enabled: true },
        ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache, hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["skill-a"] = hashContent("v1");
      manifest.resources.skills["skill-b"] = hashContent("b-v1");

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(result.conflicts).toBeGreaterThanOrEqual(1);
      expect(manifest.resources.skills["skill-a"]).toBe(hashContent("v1"));

      expect(result.synced).toBeGreaterThanOrEqual(1);
      expect(manifest.resources.skills["skill-b"]).toBe(hashContent("b-v2"));

      const currentDiskA = readFileSync(resolve(skillADir, "SKILL.md"), "utf-8");
      expect(currentDiskA).toContain("disk-v2");
    } finally {
      restoreFetch();
    }
  });

  it("mixed success/failure: successful items converge, failed items preserve baseline", async () => {
    const { hashContent: hc } = await import("../packages/ingenium-extension/resource-sync.js");

    const successDir = resolve(worktree, ".opencode", "skills", "success-skill");
    mkdirSync(successDir, { recursive: true });
    writeFileSync(resolve(successDir, "SKILL.md"), "---\nname: success-skill\ndescription: \"s\"\n---\n\nnew-disk");
    writeFileSync(resolve(successDir, "metadata.json"), "{}");

    const failDir = resolve(worktree, ".opencode", "skills", "fail-skill");
    mkdirSync(failDir, { recursive: true });
    writeFileSync(resolve(failDir, "SKILL.md"), "---\nname: fail-skill\ndescription: \"f\"\n---\n\ndisk-v2");
    writeFileSync(resolve(failDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conv-token-4" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      {
        pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
          { name: "success-skill", description: "s", content: "original", tags: "", always_apply: 0, enabled: true },
          { name: "fail-skill", description: "f", content: "original", tags: "", always_apply: 0, enabled: true },
        ] } },
      {
        pattern: "/skills?project=test-project", method: "POST",
        status: 201, body: { data: { name: "success-skill" } },
      },
    ]);

    // URL-and-method matching gives both POSTs the same success response in this case.
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache, hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["success-skill"] = hashContent("original");
      manifest.resources.skills["fail-skill"] = hashContent("original");

      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(manifest.resources.skills["success-skill"]).toBeDefined();
      expect(manifest.resources.skills["fail-skill"]).toBeDefined();

      expect(manifest.resources.skills["success-skill"]).toBe(hashContent("new-disk"));
    } finally {
      restoreFetch();
    }
  });

  it("confirmed deletion removes baseline, disk-only not-in-manifest leaves baseline unchanged", async () => {
    const { hashContent: hc } = await import("../packages/ingenium-extension/resource-sync.js");

    const deletedDir = resolve(worktree, ".opencode", "skills", "deleted-skill");
    mkdirSync(deletedDir, { recursive: true });
    writeFileSync(resolve(deletedDir, "SKILL.md"), "---\nname: deleted-skill\ndescription: \"d\"\n---\n\nold content");
    writeFileSync(resolve(deletedDir, "metadata.json"), "{}");

    const newDir = resolve(worktree, ".opencode", "skills", "new-skill");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(resolve(newDir, "SKILL.md"), "---\nname: new-skill\ndescription: \"n\"\n---\n\nbrand new");
    writeFileSync(resolve(newDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "conv-token-5" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache, hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();

      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["deleted-skill"] = hashContent("old content");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(result.removed).toBeGreaterThanOrEqual(1);
      expect(manifest.resources.skills["deleted-skill"]).toBeUndefined();

      expect(manifest.resources.skills["new-skill"]).toBeUndefined();

      expect(existsSync(deletedDir)).toBe(false);
      expect(existsSync(newDir)).toBe(true);
    } finally {
      restoreFetch();
    }
  });
});

describe("file_tree security (writeSkillToDisk)", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("rejects absolute API file_tree paths", async () => {
    const outsideFile = resolve(worktree, "outside-target.txt");
    writeFileSync(outsideFile, "should-not-be-here");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ft-test-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "ft-abs", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ [outsideFile]: "evil" }) },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "ft-abs");
      // file_tree entries must remain inside the skill root.
      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);
      expect(readFileSync(outsideFile, "utf-8")).toBe("should-not-be-here");
    } finally {
      restoreFetch();
    }
  });

  it("rejects traversal API file_tree paths", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ft-trav-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "ft-trav", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "../../../evil.txt": "bad" }) },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(existsSync(resolve(worktree, "evil.txt"))).toBe(false);
    } finally {
      restoreFetch();
    }
  });

  it("rejects reserved SKILL.md and metadata.json in file_tree", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ft-res-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "ft-res", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "SKILL.md": "bad-canonical", "metadata.json": "bad-canonical", "extra.md": "# Extra" }) },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "ft-res");
      expect(readFileSync(resolve(skillDir, "SKILL.md"), "utf-8")).toContain("# OK");
      const meta = JSON.parse(readFileSync(resolve(skillDir, "metadata.json"), "utf-8"));
      expect(meta.alwaysApply).toBe(false);
      expect(readFileSync(resolve(skillDir, "extra.md"), "utf-8")).toBe("# Extra");
    } finally {
      restoreFetch();
    }
  });

  it("allows normal nested auxiliary file_tree paths", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ft-nested-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "ft-nested", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "ref/a.md": "# A", "ref/b/c.md": "# C" }) },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "ft-nested");
      expect(readFileSync(resolve(skillDir, "ref/a.md"), "utf-8")).toBe("# A");
      expect(readFileSync(resolve(skillDir, "ref/b/c.md"), "utf-8")).toBe("# C");
    } finally {
      restoreFetch();
    }
  });

  it("rejects symlinked ancestor escape in file_tree (nonexistent descendant)", async () => {
    // A symlinked ancestor must not allow file_tree writes outside the skill root.
    const outsideDir = resolve(worktree, "outside");
    mkdirSync(outsideDir, { recursive: true });
    const tmpTarget = resolve(worktree, "real-escape-target");
    mkdirSync(tmpTarget, { recursive: true });
    writeFileSync(resolve(tmpTarget, "pwned.txt"), "escaped!");

    const skillDir = resolve(worktree, ".opencode", "skills", "ft-symlink");
    mkdirSync(skillDir, { recursive: true });
    const escapeLink = resolve(skillDir, "escape-link");
    symlinkSync(tmpTarget, escapeLink, "dir");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ft-sym-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "ft-symlink", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "escape-link/nonexistent/deep/evil.txt": "pwned" }) },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(existsSync(resolve(tmpTarget, "nonexistent", "deep", "evil.txt"))).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});

describe("category preservation (pushSkillToApi + writeSkillToDisk)", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("pushSkillToApi sends category from metadata.json", async () => {
    const skillDir = resolve(worktree, ".opencode", "skills", "cat-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: cat-skill\ndescription: \"Cat test\"\n---\n\n# Cat content");
    writeFileSync(resolve(skillDir, "metadata.json"), JSON.stringify({ tags: ["test"], alwaysApply: false, category: "custom-cat" }));

    let capturedBody: string | null = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/skills/locks/acquire")) {
        return { ok: true, status: 201, json: async () => ({ data: { ownerToken: "cat-capture-token" } }) } as Response;
      }
      if (urlStr.includes("/skills/locks/release")) {
        return { ok: true, status: 200, json: async () => ({ data: { released: true } }) } as Response;
      }
      const method = (init?.method || "GET").toUpperCase();
      if (urlStr.includes("/skills?project=")) {
        if (method === "GET") {
          return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
        }
        if (method === "POST") {
          capturedBody = (init?.body as string) || null;
          return { ok: true, status: 201, json: async () => ({ data: { name: "cat-skill" } }) } as Response;
        }
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof globalThis.fetch;

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });
      expect(result.pushed).toBeGreaterThanOrEqual(1);
      expect(capturedBody).not.toBeNull();
      const body = JSON.parse(capturedBody!);
      expect(body.category).toBe("custom-cat");
    } finally {
      restoreFetch();
    }
  });

  it("writeSkillToDisk includes category in metadata.json when API row has it", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "cat-write-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "cat-write", description: "CW", content: "# CW", tags: "x", always_apply: 1, enabled: true, category: "governance" },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const metaPath = resolve(worktree, ".opencode", "skills", "cat-write", "metadata.json");
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      expect(meta.category).toBe("governance");
      expect(meta.tags).toEqual(["x"]);
      expect(meta.alwaysApply).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("writeSkillToDisk omits category from metadata.json when API row lacks it", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "nocat-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "nocat", description: "NC", content: "# NC", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const metaPath = resolve(worktree, ".opencode", "skills", "nocat", "metadata.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      expect(meta).not.toHaveProperty("category");
    } finally {
      restoreFetch();
    }
  });
});

describe("normalized reserved path defense", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("rejects ./SKILL.md (normalized reserved path)", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "nrp1-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "nrp-dotskill", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "./SKILL.md": "injected" }) },
      ] } },
    ]);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "nrp-dotskill");
      expect(readFileSync(resolve(skillDir, "SKILL.md"), "utf-8")).toContain("# OK");
    } finally {
      restoreFetch();
    }
  });

  it("rejects refs/../metadata.json (traversal to reserved)", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "nrp2-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "nrp-trav", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "refs/../metadata.json": "injected" }) },
      ] } },
    ]);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "nrp-trav");
      const meta = JSON.parse(readFileSync(resolve(skillDir, "metadata.json"), "utf-8"));
      expect(meta.alwaysApply).toBe(false); // canonical, not injected
    } finally {
      restoreFetch();
    }
  });

  it("rejects empty string file_tree path", async () => {
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "nrp3-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "nrp-empty", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true,
          file_tree: JSON.stringify({ "": "injected" }) },
      ] } },
    ]);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      const skillDir = resolve(worktree, ".opencode", "skills", "nrp-empty");
      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });
});

describe("unsafe name & symlinked skill dir defense", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("API skill row with path-traversal name is skipped", async () => {
    const outsideFile = resolve(worktree, "should-not-exist-pwned.txt");
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "unsafe-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "../../../escape", description: "evil", content: "# evil", tags: "", always_apply: 0, enabled: true },
        { name: "safe-skill", description: "safe", content: "# safe", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(existsSync(outsideFile)).toBe(false);
      expect(existsSync(resolve(worktree, ".opencode", "skills", "safe-skill", "SKILL.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("top-level symlinked skill directory is not scanned or pushed", async () => {
    const realDir = resolve(worktree, "real-skill");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(resolve(realDir, "SKILL.md"), "---\nname: symlinked-skill\ndescription: \"S\"\n---\n\n# Symlinked content");
    writeFileSync(resolve(realDir, "metadata.json"), "{}");

    const skillsDir = resolve(worktree, ".opencode", "skills");
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(realDir, resolve(skillsDir, "symlinked-skill"), "dir");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "symdir-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 201, body: { data: { name: "symlinked-skill" } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });
      expect(result.pushed).toBe(0);
    } finally {
      restoreFetch();
    }
  });
});

describe("top-level skill-dir symlink rejection (API→disk)", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("API→disk refuses existing top-level skill-dir symlink and leaves outside target unchanged", async () => {
    // Existing skill-directory symlinks must not redirect API writes.
    const outsideDir = resolve(worktree, "outside-symlink-target");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(resolve(outsideDir, "pwned.txt"), "original content");

    const skillsDir = resolve(worktree, ".opencode", "skills");
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(outsideDir, resolve(skillsDir, "top-sym"), "dir");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "topsym-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "top-sym", description: "test", content: "# OK", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(readFileSync(resolve(outsideDir, "pwned.txt"), "utf-8")).toBe("original content");
      expect(existsSync(resolve(outsideDir, "SKILL.md"))).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});

describe("nested symlink deletion safety", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("confirmed deletion of normal skill with nested symlink unlinks only the link, leaves external target unchanged", async () => {
    const skillDir = resolve(worktree, ".opencode", "skills", "nested-sym-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: nested-sym-skill\ndescription: \"T\"\n---\n\n# Nested content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const outsideFile = resolve(worktree, "outside-target-file.txt");
    writeFileSync(outsideFile, "external data");

    mkdirSync(resolve(skillDir, "ref"), { recursive: true });
    symlinkSync(outsideFile, resolve(skillDir, "ref/symlinked"), "file");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "delsym-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["nested-sym-skill"] = "some-baseline";
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(result.removed).toBeGreaterThanOrEqual(1);
      expect(existsSync(outsideFile)).toBe(true);
      expect(readFileSync(outsideFile, "utf-8")).toBe("external data");
    } finally {
      restoreFetch();
    }
  });
});

describe("unsafe frontmatter name push errors", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("unsafe SKILL.md frontmatter name is not POSTed and increments errors", async () => {
    const skillDir = resolve(worktree, ".opencode", "skills", "safe-dir-name");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: ../../../escape\ndescription: \"unsafe\"\n---\n\n# Unsafe fm");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "ufm-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 201, body: { data: { name: "safe-dir-name" } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });
      expect(result.errors).toBeGreaterThanOrEqual(1);
      expect(result.pushed).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  it("unsafe API skill row increments errors and creates no outside path", async () => {
    const outsideFile = resolve(worktree, "outside-skill-should-not-exist");
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "uapi-token" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "../../../outside-skill", description: "evil", content: "# evil", tags: "", always_apply: 0, enabled: true },
        { name: "safe-again", description: "safe", content: "# safe", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(result.errors).toBeGreaterThanOrEqual(1);
      expect(existsSync(resolve(worktree, ".opencode", "skills", "safe-again", "SKILL.md"))).toBe(true);
      expect(existsSync(outsideFile)).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});

// MIGRATED-TO markers keep archived skill directories out of disk discovery and
// prevent API rows from recreating their canonical files.

describe("Phase 3: MIGRATED-TO marker defense", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
  });

  it("scanDiskSkills skips directories containing MIGRATED-TO.md marker", async () => {
    // A marker must suppress discovery even if a stale SKILL.md remains.
    const legacyDir = resolve(worktree, ".opencode", "skills", "legacy-absorbed");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(resolve(legacyDir, "SKILL.md"), "---\nname: legacy-absorbed\ndescription: \"L\"\n---\n\nlegacy content");
    writeFileSync(resolve(legacyDir, "metadata.json"), "{}");
    writeFileSync(resolve(legacyDir, "MIGRATED-TO.md"), "MIGRATED-TO: canonical-skill\n\nThis skill has been absorbed.");

    const normalDir = resolve(worktree, ".opencode", "skills", "normal-skill");
    mkdirSync(normalDir, { recursive: true });
    writeFileSync(resolve(normalDir, "SKILL.md"), "---\nname: normal-skill\ndescription: \"N\"\n---\n\nnormal content");
    writeFileSync(resolve(normalDir, "metadata.json"), "{}");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "mig-token-1" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "normal-skill", description: "N", content: "normal content", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(existsSync(resolve(legacyDir, "SKILL.md"))).toBe(true);
      expect(result.errors).toBe(0);
      expect(result.pushed).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  it("pushSkillToApi rejects directories with MIGRATED-TO.md marker (initial sync)", async () => {
    const legacyDir = resolve(worktree, ".opencode", "skills", "migrated-push");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(resolve(legacyDir, "SKILL.md"), "---\nname: migrated-push\ndescription: \"M\"\n---\n\nmigrated push content");
    writeFileSync(resolve(legacyDir, "metadata.json"), "{}");
    writeFileSync(resolve(legacyDir, "MIGRATED-TO.md"), "MIGRATED-TO: target-skill\n");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "mig-token-2" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: true });

      expect(result.pushed).toBe(0);
      expect(existsSync(resolve(legacyDir, "SKILL.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("writeSkillToDisk refuses to write SKILL.md into directory with MIGRATED-TO.md marker", async () => {
    const legacyDir = resolve(worktree, ".opencode", "skills", "absorbed-skill");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(resolve(legacyDir, "MIGRATED-TO.md"), "MIGRATED-TO: canonical-target\n\nAbsorbed during Phase 3.");
    // An active API row must not resurrect a marked directory.
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "mig-token-3" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
        { name: "absorbed-skill", description: "A", content: "should not be written", tags: "", always_apply: 0, enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(existsSync(resolve(legacyDir, "SKILL.md"))).toBe(false);
      expect(existsSync(resolve(legacyDir, "MIGRATED-TO.md"))).toBe(true);
      expect(result.synced).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  it("archived legacy skills do not resurrect SKILL.md via API→disk sync", async () => {
    const legacyDir = resolve(worktree, ".opencode", "skills", "archived-legacy");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(resolve(legacyDir, "MIGRATED-TO.md"), "MIGRATED-TO: canonical\n\nPhase 3 consolidation.");
    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "mig-token-4" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      expect(existsSync(resolve(legacyDir, "SKILL.md"))).toBe(false);
      expect(result.errors).toBe(0);
      expect(result.pushed).toBe(0);
      expect(result.synced).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  it("MIGRATED-TO marker survives when skill is in manifest and API deletes it", async () => {
    // Marked directories are excluded from both maps, so cleanup cannot delete
    // a leftover SKILL.md without an explicit operator action.
    const skillDir = resolve(worktree, ".opencode", "skills", "managed-migrated");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: managed-migrated\ndescription: \"MM\"\n---\n\nold content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");
    writeFileSync(resolve(skillDir, "MIGRATED-TO.md"), "MIGRATED-TO: target\n");

    mockFetch([
      { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "mig-token-5" } } },
      { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["managed-migrated"] = "some-old-baseline-hash";

      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });

      // The marker dir is skipped by scanDiskSkills, so `resolveResource` is never
      // called for this name. removeFromDisk is NOT invoked. The dir contents survive.
      expect(result.removed).toBe(0);
      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(skillDir, "MIGRATED-TO.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });
});

describe("CRLF frontmatter parsing", () => {
  it("CRLF SKILL.md hashing matches LF counterpart (no false conflict)", async () => {
    const worktree = tmpDir();
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
    try {
      const skillDir = resolve(worktree, ".opencode", "skills", "crlf-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(resolve(skillDir, "SKILL.md"), "---\r\nname: crlf-skill\r\ndescription: \"CRLF test\"\r\n---\r\n\r\n# CRLF Body\r\nSome text.");
      writeFileSync(resolve(skillDir, "metadata.json"), "{}");

      mockFetch([
        { pattern: "/skills/locks/acquire", method: "POST", status: 201, body: { data: { ownerToken: "crlf-token" } } },
        { pattern: "/skills/locks/release", method: "POST", status: 200, body: { data: { released: true } } },
        { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [
          { name: "crlf-skill", description: "CRLF test", content: "# CRLF Body\nSome text.", tags: "", always_apply: 0, enabled: true },
        ] } },
      ]);

      vi.resetModules();
      const { syncSkills, loadManifest, resetProjectCache, hashContent } = await import("../packages/ingenium-extension/resource-sync.js");
      resetProjectCache();
      const manifest = loadManifest(worktree, "test-project");
      manifest.resources.skills["crlf-skill"] = hashContent("# CRLF Body\nSome text.");
      const result = await syncSkills(worktree, "test-project", manifest, { isInitialSync: false });
      expect(result.conflicts).toBe(0);
    } finally {
      restoreFetch();
      try { rmSync(worktree, { recursive: true, force: true }); } catch {}
      vi.resetModules();
    }
  });
});
