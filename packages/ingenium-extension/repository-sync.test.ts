import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildRepositoryManifestV2,
  loadManifest,
  pushDiskToApi,
  REPOSITORY_MAX_RESOURCE_TOTAL_BYTES,
  RepositorySyncScanError,
  repositorySync,
  saveManifest,
  type SyncManifest,
} from "./resource-sync.js";
import { OnboardingSyncPlugin } from "./onboarding-sync.js";
import { resetEnsuredProjects } from "./project-resolver.js";
import { parseInitProjectArgs } from "./scripts/init-project.js";

const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
}));

let worktree = "";
const originalFetch = globalThis.fetch;
const originalProject = process.env.INGENIUM_PROJECT;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configuredPluginPaths = [
  "packages/ingenium-extension/plugins/auto-observer.ts",
  "packages/ingenium-extension/plugins/observer.ts",
  "packages/ingenium-extension/plugins/resource-sync.ts",
  "packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs",
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

function successfulMcp(): ReturnType<typeof vi.fn> {
  const call = vi.fn(async (_worktree: string, name: string, args: Record<string, unknown>) => {
    expect(name).toBe("repository_sync");
    return {
      content: [{ type: "text", text: JSON.stringify({
        project: args.project,
        dryRun: args.dryRun,
        docs: { summary: { created: 2, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } },
        resources: args.resourcesManifest === undefined ? undefined : { summary: {
          skill: { created: 1, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
          agent: { created: 1, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
          plugin: { created: 2, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
        } },
      }) }],
    };
  });
  mockCallMcpTool.mockImplementation(call);
  return call;
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockCallMcpTool.mockReset();
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
    expect(Object.keys(projection.skills.find((entry) => entry.name === "development-conventions")!.fileTree).length).toBeGreaterThanOrEqual(66);
    for (const plugin of projection.plugins) {
      expect(plugin.source).toBe(readFileSync(join(repositoryRoot, plugin.path), "utf8"));
    }
  });

  it("ignores a mode-0600 regular agent profile without blocking repository initialization", () => {
    fixture();
    const profilePath = join(worktree, ".opencode", "agents", "execution", "unreadable-agent.md");
    writeFileSync(profilePath, "---\nname: unreadable-agent\ndescription: \"Unreadable\"\nmode: subagent\npermission:\n  read: allow\n---\n\nAgent body\n", "utf8");
    chmodSync(profilePath, 0o600);

    const projection = buildRepositoryManifestV2(worktree, manifest());

    expect(lstatSync(profilePath).isFile()).toBe(true);
    expect(projection.agents.map((entry) => entry.name)).not.toContain("unreadable-agent");
  });

  it("changes semantic hashes for metadata/frontmatter-only edits and retains unique nested moves", async () => {
    fixture();
    successfulMcp();
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
    const mcpCall = successfulMcp();
    const applied = await repositorySync(worktree, { scope: "all" });
    expect(applied).toMatchObject({ dryRun: false, project: "repository-fixture", docs: { pushed: 2 }, skills: { pushed: 1 } });
    const saved = JSON.parse(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8"));
    expect(saved.version).toBe(2);
    expect(Object.keys(saved.resources.repository.docs)).toHaveLength(2);
    expect(Object.keys(saved.resources.repository.skills)).toHaveLength(1);

    const callsBeforeDocsOnly = mcpCall.mock.calls.length;
    await repositorySync(worktree, { scope: "docs" });
    const docsOnlyCalls = mcpCall.mock.calls.slice(callsBeforeDocsOnly);
    expect(docsOnlyCalls).toHaveLength(1);
    expect(docsOnlyCalls[0]![1]).toBe("repository_sync");
    expect(docsOnlyCalls[0]![2]).toMatchObject({ resourcesManifest: undefined });

    const beforeFailure = readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8");
    write("docs/index.md", "# Changed\n");
    mockCallMcpTool.mockRejectedValueOnce(new Error("MCP unavailable"));
    const failed = await repositorySync(worktree, { scope: "docs" });
    expect(failed.docs.errors).toBe(1);
    expect(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8")).toBe(beforeFailure);
  });

  it("does not provision or persist a baseline during dry-run", async () => {
    fixture();
    const mcpCall = successfulMcp();
    const result = await repositorySync(worktree, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(mcpCall).toHaveBeenCalledWith(worktree, "repository_sync", expect.objectContaining({ dryRun: true }));
    expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-state.json"))).toBe(false);
  });

  it("does not advance non-doc baselines for a docs-only confirmation", async () => {
    fixture();
    successfulMcp();
    await repositorySync(worktree, { scope: "docs" });
    const saved = JSON.parse(readFileSync(join(worktree, ".opencode", ".ingenium-sync-state.json"), "utf8"));
    expect(saved.resources.repository.docs).not.toEqual({});
    expect(saved.resources.repository.skills).toEqual({});
    expect(saved.resources.repository.agents).toEqual({});
    expect(saved.resources.repository.plugins).toEqual({});
  });

  it("pushDiskToApi sends the complete allowlisted projection through repository_sync", async () => {
    fixture();
    const mcpCall = successfulMcp();

    const result = await pushDiskToApi(worktree);

    expect(result).toMatchObject({
      plugins: { created: 2, skipped: 0, errors: 0 },
      agents: { created: 1, skipped: 0, errors: 0 },
      skills: { created: 1, skipped: 0, errors: 0 },
    });
    expect(mcpCall).toHaveBeenCalledOnce();
    const payload = mcpCall.mock.calls[0]![2] as { resourcesManifest: { plugins: Array<{ path: string; fileType: string; isSymlink: boolean }> } };
    expect(payload.resourcesManifest.plugins.map((plugin) => plugin.path)).toEqual([
      ".opencode/plugins/nested/local-plugin.ts",
      "packages/custom-plugin.ts",
    ]);
    expect(payload.resourcesManifest.plugins.every((plugin) =>
      plugin.fileType === "regular" && plugin.isSymlink === false)).toBe(true);
    expect(payload.resourcesManifest).toMatchObject({
      skills: [expect.objectContaining({ metadata: { tags: ["one", "two"], alwaysApply: true, category: "workflow" }, fileTree: { "references/nested/example.md": "Reference\n" } })],
    });
  });

  it("enforces the configured-plugin allowlist through pushDiskToApi", async () => {
    fixture();
    write("secrets/plugin.ts", "export const secret = true;\n");
    write("opencode.json", JSON.stringify({ plugin: ["secrets/plugin.ts"] }));
    successfulMcp();

    await expect(pushDiskToApi(worktree)).rejects.toBeInstanceOf(RepositorySyncScanError);
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  it("rejects aggregate resource content before MCP and preserves the confirmed baseline", async () => {
    fixture();
    successfulMcp();
    await repositorySync(worktree);
    const statePath = join(worktree, ".opencode", ".ingenium-sync-state.json");
    const baseline = readFileSync(statePath, "utf8");
    const body = "x".repeat(Math.floor(REPOSITORY_MAX_RESOURCE_TOTAL_BYTES / 7));

    for (let index = 0; index < 7; index += 1) {
      write(
        `.opencode/skills/aggregate-${index}/SKILL.md`,
        `---\nname: aggregate-${index}\ndescription: "Aggregate"\n---\n\n${body}`,
      );
    }

    await expect(repositorySync(worktree)).rejects.toBeInstanceOf(RepositorySyncScanError);
    expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
    expect(readFileSync(statePath, "utf8")).toBe(baseline);
  });

  it("runs OnboardingSyncPlugin's session.created wrapper and logs the pushed resources", async () => {
    fixture();
    const mcpCall = successfulMcp();
    const log = vi.fn();
    const plugin = await OnboardingSyncPlugin({ worktree, client: { app: { log } } });

    await plugin.event({ event: { type: "session.idle" } });
    expect(mcpCall).not.toHaveBeenCalled();

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
      successfulMcp();
      const plugin = await OnboardingSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });

      await expect(plugin.event({ event: { type: "session.created" } })).rejects.toBeInstanceOf(RepositorySyncScanError);
      expect(readFileSync(outsideManifest, "utf8")).toBe(original);
      expect(mockCallMcpTool).toHaveBeenCalledOnce();
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

  it("rejects a symlinked agent profile without reading its target", () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-agent-profile-outside-"));
    try {
      const outsideProfile = join(outside, "outside-agent.md");
      const original = "---\nname: escaped-agent\ndescription: \"Outside\"\nmode: subagent\npermission:\n  read: allow\n---\n\nOutside\n";
      writeFileSync(outsideProfile, original, "utf8");
      symlinkSync(outsideProfile, join(worktree, ".opencode", "agents", "execution", "escaped-agent.md"));

      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
      expect(readFileSync(outsideProfile, "utf8")).toBe(original);
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
