import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupLegacySkillTombstones,
  buildRepositoryManifestV2,
  hashContent,
  incrementalSync,
  repositorySync,
  resetIncrementalSyncThrottle,
  resetProjectCache,
  syncAgents,
  syncSkills,
  syncCommands,
  syncConfig,
  syncPlugins,
  writeAgentToDisk,
  type SyncManifest,
} from "./resource-sync.js";
import { resetEnsuredProjects } from "./project-resolver.js";

const mockCallMcpTool = vi.hoisted(() => vi.fn());
const fsFaults = vi.hoisted(() => ({
  beforeRename: undefined as undefined | ((source: string, destination: string) => void),
  afterRename: undefined as undefined | ((source: string, destination: string) => void),
  beforeUnlink: undefined as undefined | ((path: string) => void),
  beforeRmdir: undefined as undefined | ((path: string) => void),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync(source: string, destination: string) {
      fsFaults.beforeRename?.(source, destination);
      actual.renameSync(source, destination);
      fsFaults.afterRename?.(source, destination);
    },
    unlinkSync(path: string) {
      fsFaults.beforeUnlink?.(path);
      actual.unlinkSync(path);
    },
    rmdirSync(path: string) {
      fsFaults.beforeRmdir?.(path);
      actual.rmdirSync(path);
    },
  };
});

vi.mock("./mcp-client.js", () => ({
  callMcpTool: mockCallMcpTool,
  mcpToolData: (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0]!.text),
}));

let worktree = "";

const CANONICAL_SKILLS = [
  "development-conventions",
  "devops-conventions",
  "database-conventions",
  "engineering-workflow",
  "mcp-tooling",
  "local-models",
  "security-audit",
  "documentation",
  "self-learning",
  "skill-maintenance",
];

interface CleanupFixtureMapping {
  source: string;
  target?: string;
  sourcePath?: string;
}

function createCleanupFixture(root: string, fixtures: CleanupFixtureMapping[]): void {
  const skillsRoot = join(root, ".opencode", "skills");
  mkdirSync(skillsRoot, { recursive: true });
  const mappings = fixtures.map((fixture) => {
    const target = fixture.target ?? "development-conventions";
    const expectedSourcePath = `.opencode/skills/${target}/references/sources/${fixture.source}/source-index.md`;
    const sourcePath = fixture.sourcePath ?? expectedSourcePath;
    const preservedSource = `# ${fixture.source}\n`;
    const expectedSourceFile = join(root, expectedSourcePath);
    mkdirSync(join(expectedSourceFile, ".."), { recursive: true });
    writeFileSync(expectedSourceFile, preservedSource);
    const targetSkill = join(skillsRoot, target, "SKILL.md");
    mkdirSync(join(targetSkill, ".."), { recursive: true });
    writeFileSync(targetSkill, `---\nname: ${target}\ndescription: test\n---\n`);
    const legacyDir = join(skillsRoot, fixture.source);
    mkdirSync(legacyDir);
    writeFileSync(
      join(legacyDir, "MIGRATED-TO.md"),
      `**Canonical target**: \`${target}\`\n\n[source-index.md](../${target}/references/sources/${fixture.source}/source-index.md)\n`,
    );
    return { source: fixture.source, target, sourcePath, sourceHash: hashContent(preservedSource) };
  });
  writeFileSync(
    join(skillsRoot, "consolidation-map.json"),
    JSON.stringify({ version: "1.0.0", canonicalSkills: CANONICAL_SKILLS, mappings }),
  );
}

afterEach(() => {
  fsFaults.beforeRename = undefined;
  fsFaults.afterRename = undefined;
  fsFaults.beforeUnlink = undefined;
  fsFaults.beforeRmdir = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetIncrementalSyncThrottle();
  resetProjectCache();
  resetEnsuredProjects();
  mockCallMcpTool.mockReset();
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

  it("writes public agent profiles as 0644 and never follows a profile symlink", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const profilePath = join(worktree, ".opencode", "agents", "execution", "public-agent.md");

    expect(writeAgentToDisk(worktree, { name: "public-agent", category: "execution", content: "# Public" })).toBe(true);
    expect(statSync(profilePath).mode & 0o777).toBe(0o644);
    chmodSync(profilePath, 0o600);
    expect(writeAgentToDisk(worktree, { name: "public-agent", category: "execution", content: "# Repaired" })).toBe(true);
    expect(statSync(profilePath).mode & 0o777).toBe(0o644);

    const outsidePath = join(worktree, "outside-agent.md");
    writeFileSync(outsidePath, "# Outside", "utf8");
    unlinkSync(profilePath);
    symlinkSync(outsidePath, profilePath);

    expect(writeAgentToDisk(worktree, { name: "public-agent", category: "execution", content: "# Escape" })).toBe(false);
    expect(readFileSync(outsidePath, "utf8")).toBe("# Outside");
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

  it("adds the protected repository-sync credential to resource-sync requests", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-"));
    const opencodeDir = join(worktree, ".opencode");
    mkdirSync(opencodeDir);
    const tokenPath = join(opencodeDir, ".ingenium-repository-sync-credential");
    writeFileSync(tokenPath, "test_resource_sync_token_0123456789\n", { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    vi.stubEnv("INGENIUM_MCP_AUDIENCE", "repository-sync");
    vi.stubEnv("INGENIUM_MCP_CREDENTIAL", "{file:.opencode/.ingenium-repository-sync-credential}");
    vi.stubEnv("INGENIUM_MCP_CREDENTIAL_FILE", ".opencode/.ingenium-repository-sync-credential");
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

describe("legacy skill tombstone cleanup", () => {
  it("keeps a racing SKILL.md non-discoverable when directory removal fails after marker unlink", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const legacyPath = join(worktree, ".opencode", "skills", "legacy-skill");
    fsFaults.beforeRmdir = (path) => {
      if (basename(path) === "tombstone") {
        writeFileSync(join(path, "SKILL.md"), "---\nname: legacy-skill\ndescription: raced\n---\n");
      }
    };

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.rejected).toEqual([{ path: ".opencode/skills/legacy-skill", reason: "rmdir-failed" }]);
    expect(existsSync(legacyPath) && !existsSync(join(legacyPath, "MIGRATED-TO.md"))).toBe(false);
    expect(buildRepositoryManifestV2(worktree).skills.map((skill) => skill.name)).not.toContain("legacy-skill");
    const quarantine = join(worktree, ".opencode", "skills", ".ingenium-tombstone-cleanup");
    const staged = join(quarantine, readdirSync(quarantine)[0]!, "tombstone");
    expect(readFileSync(join(staged, "SKILL.md"), "utf8")).toContain("description: raced");
  });

  it("leaves the original valid tombstone in place when staging fails", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const legacyPath = join(worktree, ".opencode", "skills", "legacy-skill");
    fsFaults.beforeRename = (source) => {
      if (basename(source) === "legacy-skill") throw new Error("injected stage failure");
    };

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.rejected).toEqual([{ path: ".opencode/skills/legacy-skill", reason: "stage-failed" }]);
    expect(existsSync(join(legacyPath, "MIGRATED-TO.md"))).toBe(true);
    expect(existsSync(join(worktree, ".opencode", "skills", "development-conventions", "SKILL.md"))).toBe(true);
  });

  it("restores the valid tombstone when marker unlink fails", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const legacyPath = join(worktree, ".opencode", "skills", "legacy-skill");
    fsFaults.beforeUnlink = (path) => {
      if (basename(path) === "MIGRATED-TO.md") throw new Error("injected unlink failure");
    };

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.rejected).toEqual([{ path: ".opencode/skills/legacy-skill", reason: "unlink-failed" }]);
    expect(existsSync(join(legacyPath, "MIGRATED-TO.md"))).toBe(true);
    expect(existsSync(join(worktree, ".opencode", "skills", ".ingenium-tombstone-cleanup"))).toBe(false);
  });

  it("retains a staged tombstone when restoration fails and recovers it on restart", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    const legacyPath = join(skillsRoot, "legacy-skill");
    fsFaults.beforeUnlink = (path) => {
      if (basename(path) === "MIGRATED-TO.md") throw new Error("injected unlink failure");
    };
    fsFaults.beforeRename = (source, destination) => {
      if (basename(source) === "tombstone" && basename(destination) === "legacy-skill") {
        throw new Error("injected restore failure");
      }
    };

    const failed = cleanupLegacySkillTombstones(worktree);

    expect(failed.rejected).toEqual([{ path: ".opencode/skills/legacy-skill", reason: "restore-failed" }]);
    expect(existsSync(legacyPath)).toBe(false);
    const quarantine = join(skillsRoot, ".ingenium-tombstone-cleanup");
    expect(existsSync(join(quarantine, readdirSync(quarantine)[0]!, "tombstone", "MIGRATED-TO.md"))).toBe(true);
    expect(buildRepositoryManifestV2(worktree).skills.map((skill) => skill.name)).not.toContain("legacy-skill");

    fsFaults.beforeUnlink = undefined;
    fsFaults.beforeRename = undefined;
    expect(cleanupLegacySkillTombstones(worktree)).toMatchObject({
      removed: [".opencode/skills/legacy-skill"],
      rejected: [],
    });
    expect(existsSync(quarantine)).toBe(false);
  });

  it("recovers a markerless staged directory after an interrupted rmdir", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    const quarantine = join(skillsRoot, ".ingenium-tombstone-cleanup");
    fsFaults.beforeRmdir = (path) => {
      if (basename(path) === "tombstone") throw new Error("injected rmdir failure");
    };

    const failed = cleanupLegacySkillTombstones(worktree);

    expect(failed.rejected).toEqual([{ path: ".opencode/skills/legacy-skill", reason: "rmdir-failed" }]);
    const staged = join(quarantine, readdirSync(quarantine)[0]!, "tombstone");
    expect(readdirSync(staged)).toEqual([]);
    expect(existsSync(join(skillsRoot, "legacy-skill"))).toBe(false);

    fsFaults.beforeRmdir = undefined;
    expect(cleanupLegacySkillTombstones(worktree).rejected).toEqual([]);
    expect(existsSync(quarantine)).toBe(false);
  });

  it("retains post-stage races and unrelated quarantine entries without recursive deletion", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    const quarantine = join(skillsRoot, ".ingenium-tombstone-cleanup");
    fsFaults.afterRename = (source, destination) => {
      if (basename(source) === "legacy-skill" && basename(destination) === "tombstone") {
        writeFileSync(join(destination, "unexpected.txt"), "retain\n");
      }
    };

    expect(cleanupLegacySkillTombstones(worktree).rejected).toEqual([
      { path: ".opencode/skills/legacy-skill", reason: "post-stage-validation-failed" },
    ]);
    const stageName = readdirSync(quarantine)[0]!;
    const staged = join(quarantine, stageName, "tombstone");
    expect(readFileSync(join(staged, "unexpected.txt"), "utf8")).toBe("retain\n");

    fsFaults.afterRename = undefined;
    mkdirSync(join(quarantine, "not-helper-owned"), { mode: 0o700 });
    writeFileSync(join(quarantine, "not-helper-owned", "keep.txt"), "keep\n");
    const recovered = cleanupLegacySkillTombstones(worktree);
    expect(recovered.rejected).toEqual([
      { path: ".opencode/skills/.ingenium-tombstone-cleanup/not-helper-owned", reason: "unsafe-staging-entry" },
      { path: `.opencode/skills/.ingenium-tombstone-cleanup/${stageName}`, reason: "unsafe-staging-entry" },
    ]);
    expect(readFileSync(join(staged, "unexpected.txt"), "utf8")).toBe("retain\n");
    expect(readFileSync(join(quarantine, "not-helper-owned", "keep.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(skillsRoot, "development-conventions", "SKILL.md"))).toBe(true);
  });

  it("recovers only a lineage-mapped helper-owned staged tombstone", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    const quarantine = join(skillsRoot, ".ingenium-tombstone-cleanup");
    const stage = join(quarantine, "stage-legacy-skill-12345678-1234-4123-8123-123456789abc");
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    chmodSync(quarantine, 0o700);
    chmodSync(stage, 0o700);
    renameSync(join(skillsRoot, "legacy-skill"), join(stage, "tombstone"));
    mkdirSync(join(quarantine, "stage-unknown-12345678-1234-4123-8123-123456789abc"), { mode: 0o700 });

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.removed).toEqual([".opencode/skills/legacy-skill"]);
    expect(result.rejected).toEqual([
      { path: ".opencode/skills/.ingenium-tombstone-cleanup/stage-unknown-12345678-1234-4123-8123-123456789abc", reason: "unsafe-staging-entry" },
    ]);
    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(quarantine, "stage-unknown-12345678-1234-4123-8123-123456789abc"))).toBe(true);
    expect(existsSync(join(skillsRoot, "development-conventions", "SKILL.md"))).toBe(true);
  });

  it("never accepts a canonical skill name as a cleanup source", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill", target: "devops-conventions" }]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    mkdirSync(join(skillsRoot, "development-conventions"));
    writeFileSync(join(skillsRoot, "development-conventions", "SKILL.md"), "canonical\n");
    const mapPath = join(skillsRoot, "consolidation-map.json");
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    map.mappings[0].source = "development-conventions";
    writeFileSync(mapPath, JSON.stringify(map));

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.rejected).toEqual([
      { path: ".opencode/skills/consolidation-map.json", reason: "invalid-consolidation-map" },
    ]);
    expect(existsSync(join(skillsRoot, "development-conventions", "SKILL.md"))).toBe(true);
  });

  it("dry-runs, removes a lineage-proven marker directory without network access, and is idempotent", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const legacyPath = join(worktree, ".opencode", "skills", "legacy-skill");

    expect(cleanupLegacySkillTombstones(worktree, { dryRun: true })).toEqual({
      dryRun: true,
      removable: [".opencode/skills/legacy-skill"],
      removed: [],
      rejected: [],
    });
    expect(existsSync(legacyPath)).toBe(true);

    expect(cleanupLegacySkillTombstones(worktree)).toEqual({
      dryRun: false,
      removable: [".opencode/skills/legacy-skill"],
      removed: [".opencode/skills/legacy-skill"],
      rejected: [],
    });
    expect(existsSync(legacyPath)).toBe(false);
    expect(cleanupLegacySkillTombstones(worktree)).toEqual({
      dryRun: false,
      removable: [],
      removed: [],
      rejected: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  it("leaves malformed, nonempty, symlinked, and traversal-mapped candidates untouched", () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [
      { source: "malformed" },
      { source: "nonempty" },
      { source: "symlinked" },
      { source: "traversal", sourcePath: "../outside/source-index.md" },
    ]);
    const skillsRoot = join(worktree, ".opencode", "skills");
    writeFileSync(join(skillsRoot, "malformed", "MIGRATED-TO.md"), "not a valid marker\n");
    writeFileSync(join(skillsRoot, "nonempty", "keep.txt"), "keep\n");
    const symlinkTarget = join(worktree, "symlink-target");
    rmSync(join(skillsRoot, "symlinked"), { recursive: true });
    mkdirSync(symlinkTarget);
    writeFileSync(join(symlinkTarget, "MIGRATED-TO.md"), "outside\n");
    symlinkSync(symlinkTarget, join(skillsRoot, "symlinked"));

    const result = cleanupLegacySkillTombstones(worktree);

    expect(result.removed).toEqual([]);
    expect(result.rejected).toEqual([
      { path: ".opencode/skills/malformed", reason: "marker-mismatch" },
      { path: ".opencode/skills/nonempty", reason: "nonempty-directory" },
      { path: ".opencode/skills/symlinked", reason: "unsafe-candidate" },
      { path: ".opencode/skills/traversal", reason: "invalid-source-index" },
    ]);
    for (const source of ["malformed", "nonempty", "symlinked", "traversal"]) {
      expect(existsSync(join(skillsRoot, source))).toBe(true);
    }
  });

  it("applies cleanup before repository skill scanning and the MCP call", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-cleanup-"));
    createCleanupFixture(worktree, [{ source: "legacy-skill" }]);
    const credentialPath = join(worktree, ".opencode", ".ingenium-repository-sync-credential");
    writeFileSync(credentialPath, `${"r".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
    vi.stubEnv("INGENIUM_PROJECT", "cleanup-project");
    vi.stubEnv("INGENIUM_WORKSPACE_ID", "cleanup-workspace");
    vi.stubEnv("INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE", ".opencode/.ingenium-repository-sync-credential");
    const legacyPath = join(worktree, ".opencode", "skills", "legacy-skill");
    mockCallMcpTool.mockImplementation(async () => {
      return { content: [{ type: "text", text: JSON.stringify({
        docs: { summary: {} },
        resources: { summary: { skill: {}, agent: {}, plugin: {} } },
      }) }] };
    });

    const docsOnly = await repositorySync(worktree, { scope: "docs" });
    expect(docsOnly.docs.errors).toBe(0);
    expect(existsSync(legacyPath)).toBe(true);
    const result = await repositorySync(worktree);

    expect(result.skills.errors).toBe(0);
    expect(mockCallMcpTool).toHaveBeenCalledTimes(2);
    expect(existsSync(legacyPath)).toBe(false);
  });
});

describe("incremental resource sync recovery", () => {
  it("keeps lower-level sync diagnostics off stdio without a lifecycle reporter", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-lifecycle-"));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Bearer secret-token http://private.example/stack")));

    const result = await syncSkills(worktree, "project", {
      version: 1,
      project: "project",
      lastFullSync: "",
      resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} },
    }, { isInitialSync: true });

    expect(result.errors).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("does not consume the idle throttle when an incremental reconciliation fails", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-resource-sync-idle-"));
    const originalProject = process.env.INGENIUM_PROJECT;
    process.env.INGENIUM_PROJECT = "idle-recovery-project";
    let calls = 0;
    mockCallMcpTool.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("MCP unavailable");
      return { content: [{ type: "text", text: JSON.stringify({
        docs: { summary: {} },
        resources: { summary: { skill: {}, agent: {}, plugin: {} } },
      }) }] };
    });

    try {
      const failed = await incrementalSync(worktree);
      const recovered = await incrementalSync(worktree);
      const throttled = await incrementalSync(worktree);

      expect(failed?.docs?.errors).toBe(1);
      expect(recovered?.docs?.errors).toBe(0);
      expect(throttled).toBeNull();
      expect(calls).toBe(2);
    } finally {
      if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
      else process.env.INGENIUM_PROJECT = originalProject;
    }
  });
});
