import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildRepositoryManifestV2,
  loadManifest,
  pushDiskToApi,
  RepositorySyncScanError,
  repositorySync,
  saveManifest,
  type SyncManifest,
} from "./resource-sync.js";
import { OnboardingSyncPlugin } from "./onboarding-sync.js";
import { resetEnsuredProjects } from "./project-resolver.js";
import { parseInitProjectArgs } from "./scripts/init-project.js";

let worktree = "";
const originalFetch = globalThis.fetch;
const originalProject = process.env.INGENIUM_PROJECT;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configuredPluginPaths = [
  "packages/ingenium-extension/auto-observer.ts",
  "packages/ingenium-extension/observer.ts",
  "packages/ingenium-extension/resource-sync.ts",
];

function write(relativePath: string, content: string): void {
  const target = join(worktree, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function manifest(): SyncManifest {
  return {
    version: 2,
    project: "repository-fixture",
    lastFullSync: "",
    resources: {
      skills: {}, agents: {}, plugins: {}, commands: {}, config: {},
      repository: { docs: {}, skills: {}, agents: {}, plugins: {} },
    },
  };
}

function fixture(): void {
  worktree = mkdtempSync(join(tmpdir(), "ingenium-repository-sync-"));
  process.env.INGENIUM_PROJECT = "repository-fixture";
  write("docs/index.md", "# Index\n");
  write("docs/guides/nested.md", "# Nested\n");
  write(".opencode/skills/fixture-skill/SKILL.md", "---\nname: fixture-skill\ndescription: \"Fixture\"\n---\n\nBody\n");
  write(".opencode/skills/fixture-skill/metadata.json", JSON.stringify({ tags: ["one", "two"], alwaysApply: true, category: "workflow" }));
  write(".opencode/skills/fixture-skill/references/nested/example.md", "Reference\n");
  write(".opencode/skills/consolidation-map.json", JSON.stringify({ canonicalSkills: ["fixture-skill"] }));
  write(".opencode/skills/learnings.md", "# Fallback learnings\n");
  write(".opencode/skills/observations.md", "# Fallback observations\n");
  const agent = "---\nname: fixture-agent\ndescription: \"Fixture agent\"\nmode: subagent\nhidden: true\npermission:\n  read: allow\nskills:\n  - fixture-skill\n---\n\nAgent body\n";
  write(".opencode/agents/chat/fixture-agent.md", agent);
  write(".opencode/agents/fixture-agent.md", agent);
  write(".opencode/agents/execution/ingenium-llm-broker.md", "---\nname: ingenium-llm-broker\n---\nUnsafe\n");
  write(".opencode/agents/browser-agent-errors.md", "# Browser diagnostic\n");
  write(".opencode/plugins/nested/local-plugin.ts", "export const local = true;\n");
  write("packages/custom-plugin.ts", "export const custom = true;\n");
  write("opencode.json", JSON.stringify({
    plugin: [
      { path: "packages/custom-plugin.ts", enabled: true, options: { level: "strict", apiKey: "do-not-persist", nested: { accessToken: "do-not-persist" } } },
      ".opencode/plugins/nested/local-plugin.ts",
    ],
  }));
}

function successfulFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/projects") && init?.method === "POST") {
      return { ok: true, status: 201, json: async () => ({}) } as Response;
    }
    // Keep the repository docs response distinct from project provisioning.
    // repositorySync must receive a successful payload here or it returns
    // before exercising the resource endpoint used by the wrapper tests.
    if (path.endsWith("/docs/repository/sync") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ data: { summary: { created: 2, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } } }) } as Response;
    }
    if (path.endsWith("/repository/resources/sync") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ data: { summary: {
        skill: { created: 1, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
        agent: { created: 1, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
        plugin: { created: 2, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
      } } }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetEnsuredProjects();
  globalThis.fetch = originalFetch;
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("repository-authoritative manifest v2", () => {
  it("requires an explicit deterministic init mode and accepts docs-only scope", () => {
    expect(parseInitProjectArgs(["--dry-run", "--docs-only"])).toEqual({ dryRun: true, scope: "docs" });
    expect(parseInitProjectArgs(["--apply"])).toEqual({ dryRun: false, scope: "all" });
    expect(() => parseInitProjectArgs([])).toThrow(/exactly one/);
    expect(() => parseInitProjectArgs(["--dry-run", "--apply"])).toThrow(/exactly one/);
  });

  it("projects nested docs, complete skills, linked compatibility agents, and configured/local plugins", () => {
    fixture();
    const projection = buildRepositoryManifestV2(worktree, manifest());

    expect(projection.docs.map((entry) => entry.path)).toEqual(["docs/guides/nested.md", "docs/index.md"]);
    expect(projection.skills).toHaveLength(1);
    expect(projection.skills[0]).toMatchObject({
      path: ".opencode/skills/fixture-skill/SKILL.md",
      category: "workflow",
      tags: ["one", "two"],
      alwaysApply: true,
      fileTree: { "references/nested/example.md": "Reference\n" },
    });
    expect(projection.agents).toHaveLength(1);
    expect(projection.agents[0]).toMatchObject({
      name: "fixture-agent",
      category: "chat",
      mirrors: [".opencode/agents/fixture-agent.md"],
      metadata: { hidden: true },
      permissions: { read: "allow" },
      skills: ["fixture-skill"],
    });
    expect(projection.agents.map((entry) => entry.name)).not.toContain("ingenium-llm-broker");
    expect(projection.agents.map((entry) => entry.path)).not.toContain(".opencode/agents/browser-agent-errors.md");
    expect(projection.plugins.map((entry) => ({ path: entry.path, order: entry.order, enabled: entry.enabled, options: entry.options }))).toEqual([
      { path: ".opencode/plugins/nested/local-plugin.ts", order: 1, enabled: true, options: {} },
      { path: "packages/custom-plugin.ts", order: 0, enabled: true, options: { level: "strict", nested: {} } },
    ]);
    expect(projection.plugins.every((entry) => entry.fileType === "regular" && entry.isSymlink === false)).toBe(true);
    expect(projection.plugins.map((entry) => entry.path)).not.toContain(".opencode/plugins/.opencode/plugins/nested/local-plugin.ts");
  });

  it("scans the canonical repository artifacts without treating support files or diagnostics as resources", () => {
    const projection = buildRepositoryManifestV2(repositoryRoot, manifest());

    expect(projection.skills).toHaveLength(10);
    expect(projection.skills.every((entry) => entry.path === `.opencode/skills/${entry.name}/SKILL.md`)).toBe(true);
    expect(projection.skills.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
      ".opencode/skills/consolidation-map.json",
      ".opencode/skills/learnings.md",
      ".opencode/skills/observations.md",
    ]));
    expect(projection.agents.map((entry) => entry.path)).not.toContain(".opencode/agents/browser-agent-errors.md");
    expect(projection.agents.map((entry) => entry.name)).toContain("browser-agent");
    expect(projection.plugins.map((entry) => entry.path)).toEqual(configuredPluginPaths);
    for (const plugin of projection.plugins) {
      expect(plugin.source).toBe(readFileSync(join(repositoryRoot, plugin.path), "utf8"));
    }
  });

  it("changes semantic hashes for metadata/frontmatter-only edits and retains unique nested moves", async () => {
    fixture();
    successfulFetch();
    await repositorySync(worktree);
    const state = loadManifest(worktree, "repository-fixture");
    const first = buildRepositoryManifestV2(worktree, state);
    const firstSkill = first.skills[0]!;
    renameSync(
      join(worktree, ".opencode", "skills", "fixture-skill", "references", "nested"),
      join(worktree, ".opencode", "skills", "fixture-skill", "references", "moved"),
    );
    const moved = buildRepositoryManifestV2(worktree, state).skills[0]!;
    expect(moved.identity).toBe(firstSkill.identity);
    write(".opencode/skills/fixture-skill/metadata.json", JSON.stringify({ tags: ["changed"], alwaysApply: true, category: "workflow" }));
    const metadataChanged = buildRepositoryManifestV2(worktree, state).skills[0]!;
    expect(metadataChanged.sha256).not.toBe(firstSkill.sha256);
    expect(metadataChanged.identity).toBe(firstSkill.identity);
  });

  it("applies baselines only after confirmation, supports docs-only, and preserves the baseline on auth failure", async () => {
    fixture();
    const fetchMock = successfulFetch();
    const applied = await repositorySync(worktree, { scope: "all" });
    expect(applied).toMatchObject({ dryRun: false, project: "repository-fixture", docs: { pushed: 2 }, skills: { pushed: 1 } });
    const saved = JSON.parse(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8"));
    expect(saved.version).toBe(2);
    expect(Object.keys(saved.resources.repository.docs)).toHaveLength(2);
    expect(Object.keys(saved.resources.repository.skills)).toHaveLength(1);

    const callsBeforeDocsOnly = fetchMock.mock.calls.length;
    await repositorySync(worktree, { scope: "docs" });
    const docsOnlyCalls = fetchMock.mock.calls.slice(callsBeforeDocsOnly).map(([url]) => String(url));
    expect(docsOnlyCalls).toHaveLength(1);
    expect(docsOnlyCalls[0]).toContain("/docs/repository/sync");

    const beforeFailure = readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8");
    write("docs/index.md", "# Changed\n");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response));
    const failed = await repositorySync(worktree, { scope: "docs" });
    expect(failed.docs.errors).toBe(1);
    expect(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8")).toBe(beforeFailure);
  });

  it("does not provision or persist a baseline during dry-run", async () => {
    fixture();
    const fetchMock = successfulFetch();
    const result = await repositorySync(worktree, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.endsWith("/projects"))).toBe(false);
    expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-state.json"))).toBe(false);
  });

  it("does not advance non-doc baselines for a docs-only confirmation", async () => {
    fixture();
    successfulFetch();
    await repositorySync(worktree, { scope: "docs" });
    const saved = JSON.parse(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8"));
    expect(saved.resources.repository.docs).not.toEqual({});
    expect(saved.resources.repository.skills).toEqual({});
    expect(saved.resources.repository.agents).toEqual({});
    expect(saved.resources.repository.plugins).toEqual({});
  });

  it("pushDiskToApi sends the allowlisted plugin projection after the docs endpoint succeeds", async () => {
    fixture();
    const fetchMock = successfulFetch();

    const result = await pushDiskToApi(worktree);

    expect(result).toMatchObject({
      plugins: { created: 2, skipped: 0, errors: 0 },
      agents: { created: 1, skipped: 0, errors: 0 },
      skills: { created: 1, skipped: 0, errors: 0 },
    });
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual([
      "/api/v1/projects",
      "/api/v1/docs/repository/sync",
      "/api/v1/repository/resources/sync",
    ]);

    const resourcesCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/repository/resources/sync"));
    expect(resourcesCall).toBeDefined();
    const body = JSON.parse(String(resourcesCall![1]?.body));
    expect(body.manifest.plugins.map((plugin: { path: string }) => plugin.path)).toEqual([
      ".opencode/plugins/nested/local-plugin.ts",
      "packages/custom-plugin.ts",
    ]);
    expect(body.manifest.plugins.every((plugin: { fileType: string; isSymlink: boolean }) =>
      plugin.fileType === "regular" && plugin.isSymlink === false)).toBe(true);
  });

  it("enforces the configured-plugin allowlist through pushDiskToApi", async () => {
    fixture();
    write("secrets/plugin.ts", "export const secret = true;\n");
    write("opencode.json", JSON.stringify({ plugin: ["secrets/plugin.ts"] }));
    const fetchMock = successfulFetch();

    await expect(pushDiskToApi(worktree)).rejects.toBeInstanceOf(RepositorySyncScanError);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/api/v1/projects",
    ]);
  });

  it("runs OnboardingSyncPlugin's session.created wrapper and logs the pushed resources", async () => {
    fixture();
    const fetchMock = successfulFetch();
    const log = vi.fn();
    const plugin = await OnboardingSyncPlugin({ worktree, client: { app: { log } } });

    await plugin.event({ event: { type: "session.idle" } });
    expect(fetchMock).not.toHaveBeenCalled();

    await plugin.event({ event: { type: "session.created" } });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toMatchObject({
      body: {
        service: "onboarding-sync",
        level: "info",
        message: expect.stringContaining("onboarding-sync/plugins: created 2"),
      },
    });
  });

  it("keeps a symlinked manifest target untouched through the OnboardingSyncPlugin wrapper", async () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-manifest-wrapper-outside-"));
    try {
      const outsideManifest = join(outside, "manifest.json");
      const original = JSON.stringify({ version: 2, project: "outside", resources: {} });
      writeFileSync(outsideManifest, original, "utf8");
      const manifestPath = join(worktree, ".opencode", ".ingenium-sync-state.json");
      symlinkSync(outsideManifest, manifestPath);
      const fetchMock = successfulFetch();
      const plugin = await OnboardingSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });

      await expect(plugin.event({ event: { type: "session.created" } })).rejects.toBeInstanceOf(RepositorySyncScanError);
      expect(readFileSync(outsideManifest, "utf8")).toBe(original);
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        "/api/v1/projects",
        "/api/v1/docs/repository/sync",
        "/api/v1/repository/resources/sync",
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlink traversal instead of following repository content", () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-repository-outside-"));
    try {
      writeFileSync(join(outside, "escape.md"), "# escape\n");
      symlinkSync(outside, join(worktree, "docs", "linked"));
      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects configured plugin sources outside approved roots or through symlinks", () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-plugin-outside-"));
    try {
      write("secrets/plugin.ts", "export const secret = true;\n");
      write("opencode.json", JSON.stringify({ plugin: ["secrets/plugin.ts"] }));
      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);

      writeFileSync(join(outside, "plugin.ts"), "export const external = true;\n");
      write("opencode.json", JSON.stringify({ plugin: ["packages/linked-plugin.ts"] }));
      symlinkSync(join(outside, "plugin.ts"), join(worktree, "packages", "linked-plugin.ts"));
      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked .opencode ancestor for resource reads and manifest writes", () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-manifest-outside-"));
    try {
      writeFileSync(join(outside, ".ingenium-sync-state.json"), JSON.stringify({
        version: 2,
        project: "repository-fixture",
        lastFullSync: "",
        resources: { skills: { escaped: "hash" }, agents: {}, plugins: {}, commands: {}, config: {} },
      }));
      rmSync(join(worktree, ".opencode"), { recursive: true, force: true });
      symlinkSync(outside, join(worktree, ".opencode"), "dir");

      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
      expect(loadManifest(worktree, "repository-fixture").resources.skills).toEqual({});
      expect(() => saveManifest(worktree, manifest())).toThrow(RepositorySyncScanError);
      expect(JSON.parse(readFileSync(join(outside, ".ingenium-sync-state.json"), "utf8")).resources.skills).toEqual({ escaped: "hash" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
