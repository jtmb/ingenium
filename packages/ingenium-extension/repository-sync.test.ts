import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  acquireRepositorySyncLock,
  buildRepositoryManifestV2,
  drainRepositoryLifecycleQueue,
  incrementalSync,
  loadManifest,
  pushDiskToApi,
  REPOSITORY_MAX_DOC_BYTES,
  REPOSITORY_MAX_FILE_BYTES,
  REPOSITORY_MAX_RESOURCE_BYTES,
  REPOSITORY_MAX_RESOURCE_TOTAL_BYTES,
  RepositorySyncScanError,
  repositorySync,
  repositoryLifecycleStateForTest,
  resetIncrementalSyncThrottle,
  ResourceSyncPlugin,
  saveManifest,
  type SyncManifest,
} from "./resource-sync.js";
import { McpBridgeError } from "./mcp-client.js";
import { OnboardingSyncPlugin } from "./onboarding-sync.js";
import { resetEnsuredProjects } from "./project-resolver.js";
import { parseInitProjectArgs } from "./scripts/init-project.js";

const mockCallMcpTool = vi.hoisted(() => vi.fn());

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
  McpBridgeError: class McpBridgeError extends Error {
    constructor(
      readonly failure: string,
      readonly diagnostic = "",
      readonly stage?: string,
      readonly currentRevision?: number,
      readonly errorCode?: string,
    ) {
      super("bridge");
    }
  },
}));

let worktree = "";
const originalFetch = globalThis.fetch;
const originalProject = process.env.INGENIUM_PROJECT;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configuredPluginPaths = [
  "packages/ingenium-extension/plugins/auto-observer.ts",
  "packages/ingenium-extension/plugins/observer.ts",
  "packages/ingenium-extension/plugins/resource-sync.ts",
  "packages/ingenium-extension/plugins/session-coordinator.ts",
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
  const agent = "---\nname: fixture-agent\ndescription: \"Fixture agent\"\nmode: subagent\ndisable: false\nhidden: true\npermission:\n  \"*\": deny\n  read: allow\nskills:\n  - fixture-skill\n---\n\nAgent body\n";
  write(".opencode/agents/chat/nested/fixture-agent.md", agent);
  write(".opencode/agents/execution/ingenium-llm-broker.md", "---\nname: ingenium-llm-broker\n---\nUnsafe\n");
  write(".opencode/agents/sync-diagnostics.md", "# Sync diagnostic\n");
  write(".opencode/plugins/nested/local-plugin.ts", "export const local = true;\n");
  write(".opencode/.ingenium-repository-sync-credential", `${"a".repeat(32)}\n`);
  chmodSync(join(worktree, ".opencode", ".ingenium-repository-sync-credential"), 0o600);
  write("packages/custom-plugin.ts", "export const custom = true;\n");
  write("opencode.json", JSON.stringify({
    mcp: {
      ingenium: {
        type: "local",
        enabled: true,
        environment: {
          INGENIUM_API_URL: "http://localhost:4097/api/v1",
          INGENIUM_MCP_AUDIENCE: "repository-sync",
          INGENIUM_PROJECT: "repository-fixture",
          INGENIUM_WORKSPACE_ID: "repository-workspace",
          INGENIUM_WORKTREE: worktree,
        },
      },
    },
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
        generation: args.dryRun ? args.expectedGeneration : (args.expectedGeneration as number) + 1,
        manifestHash: "a".repeat(64),
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
  resetIncrementalSyncThrottle();
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
  it.each(["created", "updated", "renamed", "archived", "removed"])("requires restart for agent-only %s applies, but not previews", async (change) => {
    fixture();
    const call = successfulMcp();
    mockCallMcpTool.mockImplementation(async (...args: Parameters<typeof call>) => {
      const result = await call(...args);
      const payload = JSON.parse(result.content[0]!.text);
      payload.resources.summary.agent = { [change]: 1 };
      payload.resources.summary.plugin = { unchanged: 2 };
      result.content[0]!.text = JSON.stringify(payload);
      return result;
    });

    expect((await repositorySync(worktree, { dryRun: true })).restartRequired).toBe(false);
    expect((await repositorySync(worktree)).restartRequired).toBe(true);
  });

  it("does not require restart for unchanged agents and plugins", async () => {
    fixture();
    const call = successfulMcp();
    mockCallMcpTool.mockImplementation(async (...args: Parameters<typeof call>) => {
      const result = await call(...args);
      const payload = JSON.parse(result.content[0]!.text);
      payload.resources.summary.agent = { unchanged: 1 };
      payload.resources.summary.plugin = { unchanged: 2 };
      result.content[0]!.text = JSON.stringify(payload);
      return result;
    });
    expect((await repositorySync(worktree)).restartRequired).toBe(false);
  });
  it("requires an explicit deterministic init mode and accepts docs-only scope", () => {
    expect(parseInitProjectArgs(["--dry-run", "--docs-only"])).toEqual({ dryRun: true, scope: "docs" });
    expect(parseInitProjectArgs(["--apply"])).toEqual({ dryRun: false, scope: "all" });
    expect(() => parseInitProjectArgs([])).toThrow(/exactly one/);
    expect(() => parseInitProjectArgs(["--dry-run", "--apply"])).toThrow(/exactly one/);
  });

  it("projects nested docs, complete skills, recursively discovered categorized agents, and configured/local plugins", () => {
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
      mirrors: [],
      metadata: { hidden: true },
      permissions: { "*": "deny", read: "allow" },
      skills: ["fixture-skill"],
      enabled: true,
    });
    expect(projection.agents.map((entry) => entry.name)).not.toContain("ingenium-llm-broker");
    expect(projection.agents.map((entry) => entry.path)).not.toContain(".opencode/agents/sync-diagnostics.md");
    expect(projection.plugins.map((entry) => ({ path: entry.path, order: entry.order, enabled: entry.enabled, options: entry.options }))).toEqual([
      { path: ".opencode/plugins/nested/local-plugin.ts", order: 1, enabled: true, options: {} },
      { path: "packages/custom-plugin.ts", order: 0, enabled: true, options: { level: "strict", nested: {} } },
    ]);
    expect(projection.plugins.every((entry) => entry.fileType === "regular" && entry.isSymlink === false)).toBe(true);
    expect(projection.plugins.map((entry) => entry.path)).not.toContain(".opencode/plugins/.opencode/plugins/nested/local-plugin.ts");
  });

  it("scans the canonical repository artifacts without treating support files or diagnostics as resources", () => {
    const projection = buildRepositoryManifestV2(repositoryRoot, manifest());
    const roadmap = readFileSync(join(repositoryRoot, "docs/reference/ROADMAP.md"), "utf8");

    expect(Buffer.byteLength(roadmap)).toBeLessThanOrEqual(REPOSITORY_MAX_DOC_BYTES);
    expect(projection.docs.find((entry) => entry.path === "docs/reference/ROADMAP.md")?.content)
      .toBe(roadmap.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));

    expect(projection.skills.map((entry) => entry.name)).toEqual([
      "database-conventions", "development-conventions", "devops-conventions", "documentation",
      "mcp-tooling", "security-audit", "self-learning", "skill-maintenance",
    ]);
    expect(projection.skills.every((entry) => entry.path === `.opencode/skills/${entry.name}/SKILL.md`)).toBe(true);
    expect(projection.skills.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
      ".opencode/skills/consolidation-map.json",
      ".opencode/skills/learnings.md",
      ".opencode/skills/observations.md",
    ]));
    const expectedAgentPaths = [
      "chat/ingenium-chat.md",
      "execution/ingenium-docs.md",
      "execution/ingenium-qa.md",
      "execution/ingenium-recovery-engineer.md",
      "execution/ingenium-software-engineer-fast.md",
      "execution/ingenium-software-engineer-premium.md",
      "primary/ingenium-orchestrator.md",
      "research/ingenium-explore.md",
      "research/ingenium-scout.md",
      "security/ingenium-security-auditor.md",
    ].map((path) => `.opencode/agents/${path}`)
      .filter((path) => (lstatSync(join(repositoryRoot, path)).mode & 0o777) === 0o644);
    expect(projection.agents.map((entry) => entry.path).sort()).toEqual(expectedAgentPaths.sort());
    expect(projection.agents.every((entry) => /^\.opencode\/agents\/[^/]+\/.+\.md$/.test(entry.path))).toBe(true);
    expect(projection.agents.map((entry) => entry.name)).not.toContain("browser-agent");
    expect(new Set(projection.agents.map((entry) => entry.name)).size).toBe(projection.agents.length);
    expect(projection.plugins.map((entry) => entry.path)).toEqual(configuredPluginPaths);
    expect(Object.keys(projection.skills.find((entry) => entry.name === "development-conventions")!.fileTree).length).toBeGreaterThanOrEqual(66);
    for (const plugin of projection.plugins) {
      expect(plugin.source).toBe(readFileSync(join(repositoryRoot, plugin.path), "utf8"));
    }
  });

  it("allows canonical documentation above 512 KiB up to the aggregate documentation budget", async () => {
    fixture();
    const existingBytes = buildRepositoryManifestV2(worktree, manifest()).docs
      .reduce((total, entry) => total + Buffer.byteLength(entry.content), 0);
    const content = "x".repeat(REPOSITORY_MAX_DOC_BYTES - existingBytes);
    expect(Buffer.byteLength(content)).toBeGreaterThan(REPOSITORY_MAX_FILE_BYTES);
    write("docs/guides/large.md", content);
    expect(buildRepositoryManifestV2(worktree, manifest()).docs)
      .toContainEqual(expect.objectContaining({ path: "docs/guides/large.md", content }));

    const call = successfulMcp();
    await repositorySync(worktree, { scope: "docs", dryRun: true });
    expect(call).toHaveBeenCalledWith(worktree, "repository_sync", expect.objectContaining({
      docsManifest: { files: expect.arrayContaining([expect.objectContaining({ path: "docs/guides/large.md", content })]) },
    }));
  });

  it("rejects documentation exceeding the per-file or aggregate documentation budget", () => {
    fixture();
    write("docs/large.md", "x".repeat(REPOSITORY_MAX_DOC_BYTES + 1));
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);

    write("docs/large.md", "x".repeat(REPOSITORY_MAX_DOC_BYTES));
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
  });

  it.each([REPOSITORY_MAX_RESOURCE_BYTES + 1, REPOSITORY_MAX_FILE_BYTES + 1])(
    "still rejects non-doc resources of %i bytes",
    (bytes) => {
      fixture();
      write("packages/custom-plugin.ts", "x".repeat(bytes));
      expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(RepositorySyncScanError);
    },
  );

  it("rejects root-level orphan profiles and duplicate categorized identities", () => {
    fixture();
    const profile = readFileSync(join(worktree, ".opencode/agents/chat/nested/fixture-agent.md"), "utf8");
    write(".opencode/agents/orphan.md", profile.replace("name: fixture-agent", "name: orphan"));
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/Orphan root-level agent profile/);

    rmSync(join(worktree, ".opencode/agents/orphan.md"));
    write(".opencode/agents/research/fixture-agent.md", profile);
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/Duplicate agent profiles/);
  });

  it("rejects categorized profiles without explicit default-deny lifecycle metadata", () => {
    fixture();
    const profilePath = join(worktree, ".opencode/agents/chat/nested/fixture-agent.md");
    const profile = readFileSync(profilePath, "utf8");

    writeFileSync(profilePath, profile.replace('"*": deny', '"*": allow'));
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/not default-deny/);

    writeFileSync(profilePath, profile.replace("hidden: true\n", ""));
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/lifecycle metadata is incomplete/);
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

    const firstAgent = first.agents[0]!;
    const agentPath = join(worktree, ".opencode/agents/chat/nested/fixture-agent.md");
    writeFileSync(agentPath, readFileSync(agentPath, "utf8").replace("disable: false", "disable: true"));
    const disabledAgent = buildRepositoryManifestV2(worktree, state).agents[0]!;
    expect(disabledAgent.enabled).toBe(false);
    expect(disabledAgent.sha256).not.toBe(firstAgent.sha256);
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

  it("retries a generation conflict from the bounded server generation without retrying authentication", async () => {
    fixture();
    mockCallMcpTool
      .mockRejectedValueOnce(new McpBridgeError("revision_conflict", "", "call", 4, "MANIFEST_GENERATION_CONFLICT"))
      .mockImplementationOnce(async (_worktree: string, _name: string, args: Record<string, unknown>) => ({
        content: [{ type: "text", text: JSON.stringify({
          generation: (args.expectedGeneration as number) + 1,
          manifestHash: "a".repeat(64),
          docs: { summary: {} },
          resources: { summary: { skill: {}, agent: {}, plugin: {} } },
        }) }],
      }));

    expect((await repositorySync(worktree)).docs.errors).toBe(0);
    expect(mockCallMcpTool.mock.calls.map(([, , args]) => args.expectedGeneration)).toEqual([0, 4]);
    expect(loadManifest(worktree, "repository-fixture").generation).toBe(5);

    mockCallMcpTool.mockReset();
    mockCallMcpTool.mockRejectedValue(new McpBridgeError("authentication", "", "call", undefined, "REPOSITORY_SYNC_AUTHORIZATION_FAILED"));
    expect((await repositorySync(worktree)).docs.errors).toBe(1);
    expect(mockCallMcpTool).toHaveBeenCalledOnce();
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
    const config = JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf8"));
    write("opencode.json", JSON.stringify({ ...config, plugin: ["secrets/plugin.ts"] }));
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

  it("rejects a stale local manifest generation without replacing newer state", () => {
    fixture();
    const current = manifest();
    current.generation = 1;
    saveManifest(worktree, current);
    const stale = manifest();
    expect(() => saveManifest(worktree, stale, { expected: 0, next: 2 }))
      .toThrow("Repository manifest generation changed");
    expect(loadManifest(worktree, "repository-fixture").generation).toBe(1);
  });

  it("retries an uncertain remote apply and retains content-free recovery evidence after exhaustion", async () => {
    fixture();
    mockCallMcpTool.mockRejectedValue(new McpBridgeError("request_failed"));
    const result = await repositorySync(worktree);
    expect(result.docs.errors).toBe(1);
    expect(mockCallMcpTool).toHaveBeenCalledTimes(4);
    const recovery = join(worktree, ".opencode", ".ingenium-sync-recovery");
    const evidence = JSON.parse(readFileSync(join(recovery, readdirSync(recovery)[0]!), "utf8"));
    expect(evidence).toMatchObject({ version: 1, reason: "apply_uncertain", generation: 0 });
    expect(JSON.stringify(evidence)).not.toContain("connection lost");
  });

  it("acquires atomically, refuses a live owner, and recovers only a verified dead owner", () => {
    fixture();
    const first = acquireRepositorySyncLock(worktree);
    expect(first).not.toBeNull();
    expect(acquireRepositorySyncLock(worktree)).toBeNull();

    const ownerPath = join(worktree, ".opencode", ".ingenium-sync-lock", "owner.json");
    writeFileSync(ownerPath, JSON.stringify({ pid: 2_147_483_647, token: first!.token }) + "\n", { mode: 0o600 });
    const recovered = acquireRepositorySyncLock(worktree);
    expect(recovered).not.toBeNull();
    expect(recovered!.token).not.toBe(first!.token);
    recovered!.release();
    expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-lock"))).toBe(false);
  });

  it("waits for a foreign live lock before running the repository projection", async () => {
    fixture();
    successfulMcp();
    const lock = acquireRepositorySyncLock(worktree)!;
    const blocker = spawn(process.execPath, ["-e", "setTimeout(() => {}, 150)"], { stdio: "ignore" });
    const exited = new Promise<void>((resolvePromise) => blocker.once("exit", () => resolvePromise()));
    writeFileSync(
      join(worktree, ".opencode", ".ingenium-sync-lock", "owner.json"),
      JSON.stringify({ pid: blocker.pid, token: lock.token }) + "\n",
      { mode: 0o600 },
    );

    try {
      const result = await repositorySync(worktree);

      expect(result.docs.errors).toBe(0);
      expect(mockCallMcpTool).toHaveBeenCalledOnce();
    } finally {
      if (blocker.exitCode === null) blocker.kill();
      await exited;
    }
  });

  it("rejects a symlinked lock path without following it", () => {
    fixture();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-sync-lock-outside-"));
    try {
      symlinkSync(outside, join(worktree, ".opencode", ".ingenium-sync-lock"), "dir");
      expect(() => acquireRepositorySyncLock(worktree)).toThrow(RepositorySyncScanError);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("checks the random ownership token before releasing the lock", () => {
    fixture();
    const lock = acquireRepositorySyncLock(worktree)!;
    writeFileSync(
      join(worktree, ".opencode", ".ingenium-sync-lock", "owner.json"),
      JSON.stringify({ pid: process.pid, token: "f".repeat(32) }) + "\n",
      { mode: 0o600 },
    );

    expect(() => lock.release()).toThrow("ownership changed");
    expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-lock"))).toBe(true);
  });

  it("queues and coalesces lifecycle synchronization without awaiting network work", async () => {
    fixture();
    successfulMcp();
    const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });

    const first = plugin.event({ event: { type: "session.created" } });
    const second = plugin.event({ event: { type: "session.created" } });
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(mockCallMcpTool).not.toHaveBeenCalled();

    await drainRepositoryLifecycleQueue(worktree);
    expect(mockCallMcpTool).toHaveBeenCalledOnce();
  });

  it("does not repeat a successful startup sync for an idle event queued in flight", async () => {
    fixture();
    const successfulCall = successfulMcp();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mockCallMcpTool.mockImplementation(async (...args) => {
      await pending;
      return successfulCall(...args);
    });
    const plugin = await ResourceSyncPlugin({ worktree, client: { app: { log: vi.fn() } } });

    plugin.event({ event: { type: "session.created" } });
    await vi.waitFor(() => expect(mockCallMcpTool).toHaveBeenCalledOnce());
    plugin.event({ event: { type: "session.idle" } });
    release();

    await drainRepositoryLifecycleQueue(worktree);
    expect(mockCallMcpTool).toHaveBeenCalledOnce();
    expect(repositoryLifecycleStateForTest().lifecycleQueues).toBe(0);
  });

  it("scopes lifecycle completion throttling to each canonical worktree", async () => {
    fixture();
    const firstWorktree = worktree;
    fixture();
    const secondWorktree = worktree;
    successfulMcp();
    try {
      const first = await ResourceSyncPlugin({ worktree: firstWorktree, client: { app: { log: vi.fn() } } });
      const second = await ResourceSyncPlugin({ worktree: secondWorktree, client: { app: { log: vi.fn() } } });

      first.event({ event: { type: "session.created" } });
      await drainRepositoryLifecycleQueue(firstWorktree);
      first.event({ event: { type: "session.idle" } });
      second.event({ event: { type: "session.idle" } });
      await Promise.all([
        drainRepositoryLifecycleQueue(firstWorktree),
        drainRepositoryLifecycleQueue(secondWorktree),
      ]);

      expect(mockCallMcpTool).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(firstWorktree, { recursive: true, force: true });
    }
  });

  it("throttles repeated completed syncs through a canonical-worktree alias", async () => {
    fixture();
    successfulMcp();
    const aliases = mkdtempSync(join(tmpdir(), "ingenium-repository-alias-"));
    const alias = join(aliases, "worktree");
    symlinkSync(worktree, alias, "dir");
    try {
      const first = await incrementalSync(worktree);
      const repeated = await incrementalSync(alias);

      expect(first?.docs?.errors).toBe(0);
      expect(repeated).toBeNull();
      expect(mockCallMcpTool).toHaveBeenCalledOnce();
    } finally {
      rmSync(aliases, { recursive: true, force: true });
    }
  });

  it("bounds and evicts stale canonical-worktree completion state without timers", async () => {
    const roots: string[] = [];
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timers = vi.spyOn(globalThis, "setTimeout");
    successfulMcp();
    const maximum = repositoryLifecycleStateForTest().maximumIncrementalStates;
    try {
      for (let index = 0; index <= maximum; index += 1) {
        fixture();
        roots.push(worktree);
        await incrementalSync(worktree);
      }

      expect(repositoryLifecycleStateForTest()).toMatchObject({
        incrementalStates: maximum,
        lifecycleQueues: 0,
      });
      now += 60_000;
      expect(repositoryLifecycleStateForTest().incrementalStates).toBe(0);
      expect(timers).not.toHaveBeenCalled();
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
      worktree = "";
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
