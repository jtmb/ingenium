import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, projects, repositoryResources, resetDbForTest } from "../lib/index.js";

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
