import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, projects, repositoryResources, repositorySync, resetDbForTest } from "../lib/index.js";

let directory = "";
let projectId = "";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function skill(identity = "skill:fixture", name = "fixture-skill", path = ".opencode/skills/fixture-skill/SKILL.md") {
  const semantic = {
    path,
    name,
    skillMd: "---\nname: fixture-skill\ndescription: \"Fixture\"\n---\n\nBody\n",
    body: "Body\n",
    description: "Fixture",
    category: "workflow",
    tags: ["repo"],
    alwaysApply: true,
    metadata: { category: "workflow", tags: ["repo"], alwaysApply: true },
    fileTree: { "references/nested.md": "Nested\n" },
  };
  return { identity, sha256: hash(semantic), ...semantic };
}

function agent(identity = "agent:fixture", name = "fixture-agent", path = ".opencode/agents/chat/fixture-agent.md") {
  const semantic = {
    path,
    name,
    category: "chat",
    frontmatter: "name: fixture-agent\ndescription: \"Fixture agent\"\nmode: subagent\nhidden: true\npermission:\n  read: allow\nskills:\n  - fixture-skill",
    body: "Agent body\n",
    description: "Fixture agent",
    mode: "subagent",
    permissions: { read: "allow" },
    metadata: { hidden: true },
    skills: ["fixture-skill"],
    mirrors: [".opencode/agents/fixture-agent.md"],
    enabled: true,
  };
  return { identity, sha256: hash(semantic), ...semantic };
}

function plugin(identity = "plugin:fixture", name = "fixture-plugin", path = ".opencode/plugins/nested/fixture-plugin.ts") {
  const semantic = {
    path,
    name,
    source: "export const fixture = true;\n",
    fileType: "regular" as const,
    isSymlink: false as const,
    enabled: true,
    order: 0,
    options: { level: "strict" } as Record<string, unknown>,
  };
  return { identity, sha256: hash(semantic), ...semantic };
}

function manifest(overrides: Partial<{ skills: unknown[]; agents: unknown[]; plugins: unknown[] }> = {}) {
  return {
    version: 2,
    skills: overrides.skills ?? [skill()],
    agents: overrides.agents ?? [agent()],
    plugins: overrides.plugins ?? [plugin()],
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-repository-resources-"));
  process.env.INGENIUM_HOME = join(directory, "home");
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projectId = projects.createProject("repository-resources").id;
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_HOME;
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository resource sync", () => {
  it("upgrades migration 060 without losing rows, keys, hash validation, index, or project cascade", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('fixture')");
      db.exec(readFileSync(new URL("../data/migrations/060_repository_resource_sync.sql", import.meta.url), "utf8"));
      const insert = () => db.prepare("INSERT INTO repository_sync_resources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const kind of ["skill", "agent", "plugin"]) {
        insert().run("fixture", kind, kind, kind, kind, `path/${kind}`, "a".repeat(64), JSON.stringify({ kind }), "created", "updated");
      }
      const before = db.prepare("SELECT * FROM repository_sync_resources ORDER BY resource_type").all();
      const migration = readFileSync(new URL("../data/migrations/118_repository_command_resources.sql", import.meta.url), "utf8");
      db.transaction(() => db.exec(migration))();
      expect(db.prepare("SELECT * FROM repository_sync_resources ORDER BY resource_type").all()).toEqual(before);
      insert().run("fixture", "command", "command:id", "id", "run", ".opencode/commands/run.md", "b".repeat(64), "{}", "created", "updated");
      for (const [project, kind, identity, id, hash] of [
        ["fixture", "invalid", "other", "other", "a".repeat(64)],
        ["missing", "command", "other", "other", "a".repeat(64)],
        ["fixture", "command", "command:id", "other", "a".repeat(64)],
        ["fixture", "command", "other", "id", "a".repeat(64)],
        ["fixture", "command", "other", "other", "z".repeat(64)],
        ["fixture", "command", "other", "other", "a".repeat(63)],
      ]) expect(() => insert().run(project, kind, identity, id, "run", "path", hash, "{}", "created", "updated")).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA index_list(repository_sync_resources)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "idx_repository_sync_resources_project_type_name" }),
      ]));
      db.prepare("DELETE FROM projects WHERE id = ?").run("fixture");
      expect(db.prepare("SELECT * FROM repository_sync_resources").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("syncs commands atomically with stable readback, no drift, scoped deletion, and legacy omission safety", () => {
    const semantic = { path: ".opencode/commands/run.md", name: "run", source: "---\ndescription: Run checks\n---\nRun $ARGUMENTS\n", fileType: "regular", isSymlink: false };
    const command = { identity: "command:run", sha256: hash(semantic), ...semantic };
    const resourcesManifest = { ...manifest(), commands: [command] };
    const worktreeId = `worktree-${"c".repeat(64)}`;
    const input = { docsManifest: { files: [] }, resourcesManifest, worktreeId, expectedGeneration: 0, dryRun: true };
    const db = getDb();
    expect(repositorySync.applyRepositorySync(projectId, input).resources?.summary.command.created).toBe(1);
    expect(db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId)).toEqual([]);
    const applied = repositorySync.applyRepositorySync(projectId, { ...input, dryRun: false });
    expect(applied.resources?.confirmed).toContainEqual({ type: "command", identity: command.identity, path: command.path, sha256: command.sha256 });
    const persisted = db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId);
    expect(persisted).toEqual([expect.objectContaining({ content: command.source, file_path: command.path })]);
    expect(JSON.parse((db.prepare("SELECT payload FROM repository_sync_resources WHERE project_id = ? AND resource_type = 'command'").get(projectId) as { payload: string }).payload)).toEqual(command);
    const previousResources = ["skills", "agents", "plugins"].map((table) => db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId));
    const repeated = repositorySync.applyRepositorySync(projectId, { ...input, dryRun: false, expectedGeneration: 1 });
    expect(repeated.resources?.summary).toMatchObject({ command: { unchanged: 1 }, skill: { unchanged: 1 }, agent: { unchanged: 1 }, plugin: { unchanged: 1 } });
    expect(db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId)).toEqual(persisted);
    expect(["skills", "agents", "plugins"].map((table) => db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId))).toEqual(previousResources);
    expect(() => repositorySync.applyRepositorySync(projectId, { ...input, dryRun: false })).toThrow("MANIFEST_GENERATION_CONFLICT");
    for (const malformed of [
      { ...command, source: "tampered" }, { ...command, path: "../run.md" },
      { ...command, isSymlink: true }, { ...command, name: "different" },
    ]) expect(() => repositorySync.applyRepositorySync(projectId, { ...input, dryRun: false, expectedGeneration: 2, resourcesManifest: { ...resourcesManifest, commands: [malformed] } })).toThrow(repositoryResources.RepositoryResourcesManifestError);
    expect(db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId)).toEqual(persisted);
    expect(() => repositoryResources.syncRepositoryResources("missing-project", resourcesManifest)).toThrow();
    const other = projects.createProject("other-command-project").id;
    repositoryResources.syncRepositoryResources(other, resourcesManifest);
    repositoryResources.syncRepositoryResources(projectId, manifest());
    expect(db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId)).toEqual(persisted);
    const renamedSemantic = { ...semantic, name: "renamed", path: ".opencode/commands/renamed.md" };
    const renamed = { identity: command.identity, sha256: hash(renamedSemantic), ...renamedSemantic };
    expect(repositoryResources.syncRepositoryResources(projectId, { ...manifest(), commands: [renamed] }).summary.command.renamed).toBe(1);
    db.prepare("INSERT INTO commands (id, project_id, name, file_path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("unmanaged-command", projectId, "unmanaged", ".opencode/commands/unmanaged.md", "Keep", "now", "now");
    expect(repositoryResources.syncRepositoryResources(projectId, { ...manifest(), commands: [] }, true).summary.command.removed).toBe(1);
    expect(repositoryResources.syncRepositoryResources(projectId, { ...manifest(), commands: [] }).summary.command.removed).toBe(1);
    expect(db.prepare("SELECT name FROM commands WHERE project_id = ?").all(projectId)).toEqual([{ name: "unmanaged" }]);
    expect(db.prepare("SELECT content FROM commands WHERE project_id = ?").all(other)).toEqual([{ content: command.source }]);
  });

  it("runs migration 118 on an existing database once and retains managed resource payloads across reopen", () => {
    repositoryResources.syncRepositoryResources(projectId, manifest());
    const db = getDb();
    const before = db.prepare("SELECT * FROM repository_sync_resources ORDER BY resource_type").all();
    const oldSchema = readFileSync(new URL("../data/migrations/060_repository_resource_sync.sql", import.meta.url), "utf8");
    db.transaction(() => {
      db.exec("CREATE TEMP TABLE saved_resources AS SELECT * FROM repository_sync_resources; DROP TABLE repository_sync_resources");
      db.exec(oldSchema);
      db.exec("INSERT INTO repository_sync_resources SELECT * FROM saved_resources; DROP TABLE saved_resources");
    })();
    resetDbForTest();
    const upgraded = getDb();
    expect(upgraded.prepare("SELECT * FROM repository_sync_resources ORDER BY resource_type").all()).toEqual(before);
    expect((upgraded.prepare("SELECT sql FROM sqlite_master WHERE name = 'repository_sync_resources'").get() as { sql: string }).sql).toContain("'command'");
    upgraded.exec("CREATE INDEX test_118_reopen_sentinel ON repository_sync_resources(identity)");
    resetDbForTest();
    expect(getDb().prepare("SELECT * FROM repository_sync_resources ORDER BY resource_type").all()).toEqual(before);
    expect(getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'test_118_reopen_sentinel'").get()).toEqual({ name: "test_118_reopen_sentinel" });
  });

  it("rolls back the entire bulk transaction when command storage fails", () => {
    const db = getDb();
    db.exec("CREATE TRIGGER reject_command BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT, 'command storage failure'); END");
    const semantic = { name: "run", path: ".opencode/commands/run.md", source: "Run checks", fileType: "regular", isSymlink: false };
    expect(() => repositorySync.applyRepositorySync(projectId, {
      docsManifest: { files: [] }, resourcesManifest: { ...manifest(), commands: [{ identity: "command:run", sha256: hash(semantic), ...semantic }] },
      dryRun: false, expectedGeneration: 0, worktreeId: `worktree-${"d".repeat(64)}`,
    })).toThrow("command storage failure");
    for (const table of ["skills", "agents", "plugins", "commands", "repository_sync_resources", "repository_sync_generations"]) {
      expect(db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId)).toEqual([]);
    }
  });

  it("applies generation CAS per authenticated worktree identity and reports the bounded current generation", () => {
    const worktreeId = `worktree-${"a".repeat(64)}`;
    const input = {
      docsManifest: { files: [] },
      resourcesManifest: { version: 2, skills: [], agents: [], plugins: [] },
      dryRun: false,
      expectedGeneration: 0,
      worktreeId,
    };

    expect(repositorySync.applyRepositorySync(projectId, input)).toMatchObject({ generation: 1, dryRun: false });
    try {
      repositorySync.applyRepositorySync(projectId, input);
      throw new Error("expected generation conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(repositorySync.RepositorySyncError);
      expect(error).toMatchObject({ code: "MANIFEST_GENERATION_CONFLICT", currentGeneration: 1 });
    }
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare(
      "SELECT generation FROM repository_sync_generations WHERE project_id = ? AND worktree_id = ?",
    ).get(projectId, worktreeId)).toEqual({ generation: 1 });
  });

  it("accepts a combined projection above 2 MiB after structural preflight", () => {
    const docsManifest = {
      files: [712_063, 501_677, 501_678].map((size, index) => {
        const content = "# Documentation\n".padEnd(size, "x");
        return {
          path: index === 0 ? "docs/reference/ROADMAP.md" : `docs/large-${index}.md`, content,
          sha256: createHash("sha256").update(content).digest("hex"),
          fileType: "regular", isSymlink: false,
        };
      }),
    };
    const source = "x".repeat(200_000);
    const plugins = Array.from({ length: 4 }, (_, index) => {
      const semantic = {
        path: `.opencode/plugins/large-${index}.ts`, name: `large-${index}`, source,
        fileType: "regular" as const, isSymlink: false as const, enabled: true, order: index, options: {},
      };
      return { identity: `plugin:large-${index}`, sha256: hash(semantic), ...semantic };
    });
    const input = {
      docsManifest,
      resourcesManifest: { version: 2, skills: [], agents: [], plugins },
      dryRun: true,
      expectedGeneration: 0,
      worktreeId: `worktree-${"b".repeat(64)}`,
    };

    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(2 * 1024 * 1024);
    expect(repositorySync.applyRepositorySync(projectId, input)).toMatchObject({ dryRun: true, generation: 0 });
  });

  it("rejects deep, high-cardinality, overlong, and aggregate-heavy structures before canonicalization", () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 18; depth += 1) nested = { nested };
    const candidates = [
      { docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: Array(513).fill(null), agents: [], plugins: [] } },
      { docsManifest: { files: [{ path: "x".repeat(513), content: "", sha256: "a".repeat(64), fileType: "regular", isSymlink: false }] } },
      { docsManifest: { files: [{ path: "docs/large.md", content: "x".repeat(2 * 1024 * 1024 + 1), sha256: "a".repeat(64), fileType: "regular", isSymlink: false }] } },
      { docsManifest: { files: Array.from({ length: 3 }, (_, index) => ({ path: `docs/${index}.md`, content: "x".repeat(700 * 1024) })) } },
      { docsManifest: { files: [] }, resourcesManifest: {
        version: 2, skills: [], agents: [], plugins: [{ source: "x".repeat(256 * 1024 + 1) }],
      } },
      { docsManifest: { files: [] }, resourcesManifest: {
        version: 2, skills: [], agents: [], plugins: [], content: "x".repeat(512 * 1024 + 1),
      } },
      { docsManifest: { files: [] }, resourcesManifest: {
        version: 2, skills: [], agents: [],
        plugins: Array.from({ length: 7 }, (_, index) => ({ source: "x".repeat(240 * 1024), path: `.opencode/plugins/${index}.ts` })),
      } },
      { docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: [], agents: [], plugins: [], nested } },
    ];

    for (const candidate of candidates) {
      expect(() => repositorySync.assertRepositorySyncStructure(candidate)).toThrow(expect.objectContaining({
        code: "REPOSITORY_SYNC_STRUCTURE_LIMIT",
      }));
    }
  });

  it("imports deterministically, is idempotent, and retains identity through a unique rename", () => {
    const first = repositoryResources.syncRepositoryResources(projectId, manifest());
    expect(first.summary).toMatchObject({ skill: { created: 1 }, agent: { created: 1 }, plugin: { created: 1 } });

    const second = repositoryResources.syncRepositoryResources(projectId, manifest(), true);
    expect(second).toMatchObject({ dryRun: true, summary: { skill: { unchanged: 1 }, agent: { unchanged: 1 }, plugin: { unchanged: 1 } } });

    const renamed = skill("skill:fixture", "renamed-skill", ".opencode/skills/renamed-skill/SKILL.md");
    renamed.skillMd = renamed.skillMd.replace("fixture-skill", "renamed-skill");
    renamed.sha256 = hash({
      path: renamed.path, name: renamed.name, skillMd: renamed.skillMd, body: renamed.body,
      description: renamed.description, category: renamed.category, tags: renamed.tags,
      alwaysApply: renamed.alwaysApply, metadata: renamed.metadata, fileTree: renamed.fileTree,
    });
    const result = repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [renamed] }));
    expect(result.summary.skill.renamed).toBe(1);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT name FROM skills WHERE project_id = ?").get(projectId)).toEqual({ name: "renamed-skill" });
  });

  it("adopts a prior managed identity when the resource name remains stable", () => {
    repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [skill("skill:previous")] }));
    const adopted = skill("skill:adopted");

    expect(repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [adopted] })).summary.skill.unchanged).toBe(1);
    expect(repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [adopted] }), true).summary.skill.unchanged).toBe(1);
  });

  it("treats metadata/frontmatter-only changes as repository updates without losing the exact payload", () => {
    repositoryResources.syncRepositoryResources(projectId, manifest());
    const changed = skill();
    changed.metadata = { category: "workflow", tags: ["metadata-only"], alwaysApply: true };
    changed.sha256 = hash({
      path: changed.path, name: changed.name, skillMd: changed.skillMd, body: changed.body,
      description: changed.description, category: changed.category, tags: changed.tags,
      alwaysApply: changed.alwaysApply, metadata: changed.metadata, fileTree: changed.fileTree,
    });
    const result = repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [changed] }));
    expect(result.summary.skill.updated).toBe(1);
    const payload = getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare(
      "SELECT payload FROM repository_sync_resources WHERE project_id = ? AND resource_type = 'skill'",
    ).get(projectId) as { payload: string };
    expect(JSON.parse(payload.payload).metadata).toEqual(changed.metadata);
  });

  it("accepts a composite skill entry when each source field and the aggregate are bounded", () => {
    const composite = skill();
    const body = "x".repeat(140 * 1024);
    composite.skillMd = `---\nname: fixture-skill\ndescription: "Fixture"\n---\n\n${body}`;
    composite.body = body;
    composite.sha256 = hash({
      path: composite.path, name: composite.name, skillMd: composite.skillMd, body: composite.body,
      description: composite.description, category: composite.category, tags: composite.tags,
      alwaysApply: composite.alwaysApply, metadata: composite.metadata, fileTree: composite.fileTree,
    });

    expect(Buffer.byteLength(JSON.stringify(composite))).toBeGreaterThan(256 * 1024);
    expect(repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [composite] }), true).summary.skill.created).toBe(1);
  });

  it("archives/removes only prior sync-managed entries and leaves unmanaged data untouched", () => {
    repositoryResources.syncRepositoryResources(projectId, manifest());
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO skills (id, project_id, name, description, content, enabled, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)")
      .run("unmanaged-skill", projectId, "unmanaged-skill", "Unmanaged", "Body", now, now);
    db.prepare("INSERT INTO agents (id, project_id, name, description, category, mode, permissions, metadata, skills, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'execution', 'subagent', '{}', '{}', '[]', ?, 1, ?, ?)")
      .run("unmanaged-agent", projectId, "unmanaged-agent", "Unmanaged", "Body", now, now);
    db.prepare("INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
      .run("unmanaged-plugin", projectId, "unmanaged-plugin", ".opencode/plugins/unmanaged.ts", "export {}", now, now);

    const result = repositoryResources.syncRepositoryResources(projectId, manifest({ skills: [], agents: [], plugins: [] }));
    expect(result.summary).toMatchObject({ skill: { archived: 1 }, agent: { removed: 1 }, plugin: { removed: 1 } });
    expect(db.prepare("SELECT archived_at FROM skills WHERE id = 'unmanaged-skill'").get()).toEqual({ archived_at: null });
    expect(db.prepare("SELECT 1 AS present FROM agents WHERE id = 'unmanaged-agent'").get()).toEqual({ present: 1 });
    expect(db.prepare("SELECT 1 AS present FROM plugins WHERE id = 'unmanaged-plugin'").get()).toEqual({ present: 1 });
  });

  it("rejects a manifest that attempts to import the immutable broker", () => {
    const broker = agent("agent:broker", "ingenium-llm-broker", ".opencode/agents/execution/ingenium-llm-broker.md");
    expect(() => repositoryResources.syncRepositoryResources(projectId, manifest({ agents: [broker] }), true))
      .toThrow(repositoryResources.RepositoryResourcesManifestError);
  });

  it("rejects unsafe plugin paths, non-regular plugin claims, and secret-like option keys", () => {
    const unsafePath = { ...plugin(), path: "secrets/plugin.ts" };
    const symlinked = { ...plugin(), isSymlink: true };
    const secretOptions = plugin();
    secretOptions.options = { level: "strict", nested: { accessToken: "do-not-persist" } };
    secretOptions.sha256 = hash({
      path: secretOptions.path,
      name: secretOptions.name,
      source: secretOptions.source,
      fileType: secretOptions.fileType,
      isSymlink: secretOptions.isSymlink,
      enabled: secretOptions.enabled,
      order: secretOptions.order,
      options: secretOptions.options,
    });

    for (const candidate of [unsafePath, symlinked, secretOptions]) {
      expect(() => repositoryResources.syncRepositoryResources(projectId, manifest({ plugins: [candidate] }), true))
        .toThrow(repositoryResources.RepositoryResourcesManifestError);
    }
  });
});
