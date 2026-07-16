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
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ── Test Helpers ──────────────────────────────────────────────────────────

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

// Keep a reference to the original fetch
const originalFetch = globalThis.fetch;

function mockFetch(responses: Array<{ pattern: string; status: number; body: any; method?: string }>) {
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const reqMethod = (init?.method || "GET").toUpperCase();
    
    // Find matching response: prefer method-specific, then fallback to any method
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

// ── Import modules under test (after mocking setup) ────────────────────────

// We need to reset module caches between tests since the module stores
// project resolution state. Use dynamic imports.

async function importModule() {
  // Clear module cache to get fresh state
  const mod = await import("../packages/ingenium-extension/resource-sync.js");
  return mod;
}

// ── Tests: Project Resolution ──────────────────────────────────────────────

describe("Project Resolution", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...origEnv };
  });

  it("uses INGENIUM_PROJECT env var when set", async () => {
    process.env.INGENIUM_PROJECT = "my-custom-project";
    // Need fresh import to pick up env var
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const result = resolveProject("/home/user/worktrees/my-other-project");
    expect(result).toBe("my-custom-project");
    resetProjectCache();
  });

  it("falls back to worktree basename when env var is empty", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const result = resolveProject("/home/user/repos/gh-llm-bootstrap");
    expect(result).toBe("gh-llm-bootstrap");
    resetProjectCache();
  });

  it("falls back to worktree basename when env var is whitespace", async () => {
    process.env.INGENIUM_PROJECT = "   ";
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const result = resolveProject("/home/user/repos/my-worktree");
    expect(result).toBe("my-worktree");
    resetProjectCache();
  });

  it("never falls back to global-default when unset", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    // Should use worktree name, not global-default
    const result = resolveProject("/some/path/valid-worktree");
    expect(result).toBe("valid-worktree");
    expect(result).not.toBe("global-default");
    resetProjectCache();
  });

  it("throws when worktree is root (no meaningful basename)", async () => {
    delete process.env.INGENIUM_PROJECT;
    vi.resetModules();
    const { resolveProject, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    expect(() => resolveProject("/")).toThrow(/Could not resolve project name/);
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
});

// ── Tests: Manifest ────────────────────────────────────────────────────────

describe("Manifest", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = tmpDir();
    vi.resetModules();
  });

  afterEach(() => {
    try { rmSync(worktree, { recursive: true, force: true }); } catch {}
    vi.resetModules();
    // Reset project cache between tests
  });

  it("creates manifest when none exists", async () => {
    // Need to set env for project resolution
    process.env.INGENIUM_PROJECT = "test-project";
    vi.resetModules();
    const { loadManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    expect(manifest.version).toBe(1);
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
    // Load with new project name → should reset
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
    expect(manifest.version).toBe(1);
    expect(manifest.resources.skills).toEqual({});
  });
});

// ── Tests: Content Hashing ─────────────────────────────────────────────────

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

// ── Tests: Conflict Resolution ─────────────────────────────────────────────

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
    // Set up: API has skill "foo" with content v2, disk has v1, manifest baseline is v1
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    // Create disk skill with content "v1"
    const skillDir = resolve(worktree, ".opencode", "skills", "foo");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: foo\ndescription: \"test\"\n---\n\nv1 content");
    writeFileSync(resolve(skillDir, "metadata.json"), JSON.stringify({ tags: [], alwaysApply: false }));

    // Set manifest baseline to actual hash of current disk content (body-only, matching API)
    const { hashContent: hc1 } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    manifest.resources.skills["foo"] = hc1("v1 content");
    saveManifest(worktree, manifest);

    // Mock API returning v2 content (different hash)
    mockFetch([
      { pattern: "/skills?project=test-project", status: 200, body: { data: [{ name: "foo", description: "test", content: "v2 updated content", tags: "", always_apply: 0, enabled: true }] } },
    ]);

    try {
      // Import fresh (after mock is set up)
      vi.resetModules();
      const { syncSkills, loadManifest: loadManifest2, resetProjectCache: reset2 } = await import("../packages/ingenium-extension/resource-sync.js");
      reset2();

      const m2 = loadManifest2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      // Should have synced (wrote API v2 to disk)
      expect(result.synced).toBeGreaterThanOrEqual(1);
    } finally {
      restoreFetch();
    }
  });

  it("both changed: logs conflict, preserves both (does not overwrite)", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    // Disk has "bar" with content "disk-v2", manifest says "bar" was "v1-original"
    const skillDir = resolve(worktree, ".opencode", "skills", "bar");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: bar\ndescription: \"t\"\n---\n\ndisk-v2");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const { hashContent: hcBar } = await import("../packages/ingenium-extension/resource-sync.js");
    const manifest = loadManifest(worktree, "test-project");
    // Baseline is the original (v1) content that was shared between API and disk
    manifest.resources.skills["bar"] = hcBar("v1-original");
    saveManifest(worktree, manifest);

    // API has different content too ("api-v2")
    mockFetch([
      { pattern: "/skills?project=test-project", method: "GET", status: 200, body: { data: [{ name: "bar", description: "t", content: "api-v2 content", tags: "", always_apply: 0, enabled: true }] } },
      { pattern: "/skills?project=test-project", method: "POST", status: 201, body: { data: { name: "bar" } } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      // Conflict detected → count as conflict + skipped
      expect(result.conflicts).toBeGreaterThanOrEqual(1);
      // Disk content should still be "disk-v2" (not overwritten)
      const currentDisk = readFileSync(resolve(skillDir, "SKILL.md"), "utf-8");
      expect(currentDisk).toContain("disk-v2");
    } finally {
      restoreFetch();
    }
  });

  it("equal: skips when no changes", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    // Disk matches manifest baseline → no change
    const skillDir = resolve(worktree, ".opencode", "skills", "equal-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: equal-skill\ndescription: \"e\"\n---\n\nsame-content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    const manifest = loadManifest(worktree, "test-project");
    // Store the hash of the skill body (without frontmatter), matching API representation
    const { hashContent: hc } = await import("../packages/ingenium-extension/resource-sync.js");
    const diskHash = hc("same-content");
    manifest.resources.skills["equal-skill"] = diskHash;
    saveManifest(worktree, manifest);

    const responses = [
      { pattern: "/skills?project=test-project", status: 200, body: { data: [{ name: "equal-skill", description: "e", content: "same-content", tags: "", always_apply: 0, enabled: true }] } },
    ];

    mockFetch(responses);
    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      // No changes → synced should be 0
      expect(result.synced).toBe(0);
      expect(result.pushed).toBe(0);
      expect(result.conflicts).toBe(0);
    } finally {
      restoreFetch();
    }
  });
});

// ── Tests: Known-Map Guard ──────────────────────────────────────────────────

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

    // Create a disk-only skill that's NOT in the manifest
    const skillDir = resolve(worktree, ".opencode", "skills", "user-added-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: user-added-skill\ndescription: \"user\"\n---\n\nuser content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    // Manifest has no "user-added-skill" entry
    const manifest = loadManifest(worktree, "test-project");
    saveManifest(worktree, manifest);

    // API returns empty list (skill not in API)
    mockFetch([
      { pattern: "/skills?project=test-project", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      // Disk file should still exist (preserved, not deleted)
      expect(existsSync(resolve(skillDir, "SKILL.md"))).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("removes disk-only items THAT ARE in manifest (API deleted them)", async () => {
    const { loadManifest, saveManifest, resetProjectCache } = await import("../packages/ingenium-extension/resource-sync.js");
    resetProjectCache();

    // Create a disk skill that IS in the manifest (was previously managed)
    const skillDir = resolve(worktree, ".opencode", "skills", "managed-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), "---\nname: managed-skill\ndescription: \"m\"\n---\n\nmanaged content");
    writeFileSync(resolve(skillDir, "metadata.json"), "{}");

    // Manifest HAS "managed-skill"
    const manifest = loadManifest(worktree, "test-project");
    manifest.resources.skills["managed-skill"] = "some-baseline-hash";
    saveManifest(worktree, manifest);

    // API returns empty list (skill deleted from API)
    mockFetch([
      { pattern: "/skills?project=test-project", status: 200, body: { data: [] } },
    ]);

    try {
      vi.resetModules();
      const { syncSkills, loadManifest: lm2, resetProjectCache: r2 } = await import("../packages/ingenium-extension/resource-sync.js");
      r2();
      const m2 = lm2(worktree, "test-project");
      const result = await syncSkills(worktree, "test-project", m2, { isInitialSync: false });

      // Should have been removed (was managed, now deleted from API)
      expect(result.removed).toBeGreaterThanOrEqual(1);
      // Directory should be removed
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      restoreFetch();
    }
  });
});

// ── Tests: Plugin opencode.json Merge ──────────────────────────────────────

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
    // Start with no ingenium plugins
    createOpenCodeConfig([]);

    vi.resetModules();
    // Need dynamic import to get fresh module state
    const mod = await import("../packages/ingenium-extension/resource-sync.js");

    // Simulate what mergePluginsIntoConfig does by calling via syncPlugins
    // But we can't easily mock the internal function. Instead, let's use the
    // plugin merge function from the setup path.

    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/observer.ts", enabled: true },
        { name: "resource-sync", file_path: "./packages/ingenium-extension/resource-sync.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      // Check that opencode.json was updated
      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toContain("./packages/ingenium-extension/observer.ts");
      expect(updated.plugin).toContain("./packages/ingenium-extension/resource-sync.ts");
    } finally {
      restoreFetch();
    }
  });

  it("preserves non-ingenium user plugins", async () => {
    createOpenCodeConfig([
      "./my-custom-plugin.ts",
      "./packages/ingenium-extension/observer.ts",
    ]);

    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/observer.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      // User plugin preserved
      expect(updated.plugin).toContain("./my-custom-plugin.ts");
    } finally {
      restoreFetch();
    }
  });

  it("removes disabled plugins from opencode.json plugin[] array", async () => {
    createOpenCodeConfig([
      "./packages/ingenium-extension/observer.ts",
      "./packages/ingenium-extension/old-plugin.ts",
    ]);

    // API returns only observer (old-plugin disabled/removed)
    mockFetch([
      { pattern: "/plugins?project=test-project", status: 200, body: { data: [
        { name: "observer", file_path: "./packages/ingenium-extension/observer.ts", enabled: true },
      ] } },
    ]);

    try {
      vi.resetModules();
      const { syncPlugins, loadManifest } = await import("../packages/ingenium-extension/resource-sync.js");
      const manifest = loadManifest(worktree, "test-project");

      await syncPlugins(worktree, "test-project", manifest, { isInitialSync: false });

      const updated = JSON.parse(readFileSync(resolve(worktree, "opencode.json"), "utf-8"));
      expect(updated.plugin).toContain("./packages/ingenium-extension/observer.ts");
      expect(updated.plugin).not.toContain("./packages/ingenium-extension/old-plugin.ts");
    } finally {
      restoreFetch();
    }
  });
});
