import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject, deleteProject, isValidProjectName, migrateWorkspaceProject, setProjectGlobal, updateProject } from "../lib/tools/projects.js";

let tempDir = "";
afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

function database() {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-projects-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  return getDb(process.env.INGENIUM_CORE_DB_PATH);
}

function seedWorkspaceProject(skillCount = 10): { db: ReturnType<typeof getDb>; sourceId: string } {
  const db = database();
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, '/workspace', '/workspace', 0, ?, ?)").run(sourceId, now, now);
  for (let index = 0; index < skillCount; index++) {
    db.prepare("INSERT INTO skills (id, project_id, name, description, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(randomUUID(), sourceId, `skill-${index}`, "test", `content-${index}`, now, now);
  }
  return { db, sourceId };
}

describe("project identity", () => {
  it("rejects unsafe project names", () => {
    for (const name of ["", " ", "/workspace", "a/b", "a\\b", ".", "..", " name", "name ", "a\u0000b", "x".repeat(65)]) {
      expect(isValidProjectName(name)).toBe(false);
    }
    expect(isValidProjectName("global-default")).toBe(true);
  });

  it("keeps exactly one active global project", () => {
    database();
    createProject("first", true);
    createProject("second", true);
    const globals = getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT name FROM projects WHERE is_global = 1").all() as Array<{ name: string }>;
    expect(globals).toEqual([{ name: "second" }]);
    expect(setProjectGlobal("first", true)).toBe(true);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT name FROM projects WHERE is_global = 1").all()).toEqual([{ name: "first" }]);
  });

  it("returns a typed child-reference result without deleting a project", () => {
    const db = database();
    const project = createProject("referenced-project");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), project.id, "child", now, now);

    expect(deleteProject(project.name)).toEqual({ status: "has_children", childTables: ["tasks"] });
    expect(db.prepare("SELECT name FROM projects WHERE id = ?").get(project.id)).toEqual({ name: "referenced-project" });
  });

  it("renames only the database project path and does not create the new directory", () => {
    database();
    const project = createProject("old-name");
    const updated = updateProject("old-name", "new-name");
    expect(updated?.path).not.toBe(project.path);
    expect(updated?.path.endsWith("new-name")).toBe(true);
    expect(existsSync(updated!.path)).toBe(false);
  });

  it("dry-runs then migrates exactly ten DB-only workspace skills with a durable manifest", () => {
    const { db, sourceId } = seedWorkspaceProject();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), sourceId, "kept child", now, now);

    const dryRun = migrateWorkspaceProject(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.sourceSkillCount).toBe(10);
    expect(dryRun.sourceHashes).toHaveLength(10);
    expect(db.prepare("SELECT 1 FROM projects WHERE name = '/workspace'").get()).toBeTruthy();

    const migrated = migrateWorkspaceProject();
    expect(migrated.migrated).toBe(true);
    expect(migrated.manifestId).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM projects WHERE name = '/workspace'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = (SELECT id FROM projects WHERE name = 'global-default')").get()).toEqual({ count: 10 });
    expect(db.prepare("SELECT status, source_skill_count FROM project_migration_manifests WHERE id = ?").get(migrated.manifestId)).toEqual({ status: "completed", source_skill_count: 10 });
  });

  it("refuses a workspace migration unless the source has exactly ten skills", () => {
    const { db } = seedWorkspaceProject(9);
    expect(() => migrateWorkspaceProject()).toThrow(/source skill count mismatch/);
    expect(db.prepare("SELECT 1 FROM projects WHERE name = '/workspace'").get()).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) AS count FROM project_migration_manifests").get()).toEqual({ count: 0 });
  });

  it("records collisions without exposing skill content and renames the migrated source", () => {
    const { db } = seedWorkspaceProject();
    const global = createProject("global-default", true);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO skills (id, project_id, name, description, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(randomUUID(), global.id, "skill-0", "existing", "different-content", now, now);

    const result = migrateWorkspaceProject();
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]).toMatchObject({ name: "skill-0", destinationName: expect.stringMatching(/^migrated-[a-f0-9]{16}$/) });
    expect(JSON.stringify(result.collisions)).not.toContain("content-0");
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ? AND name = ?").get(global.id, result.collisions[0]!.destinationName)).toEqual({ count: 1 });
  });

  it("rolls back when migrated skill content fails hash verification", () => {
    const { db } = seedWorkspaceProject();
    db.exec("CREATE TRIGGER corrupt_workspace_skill AFTER UPDATE OF project_id ON skills WHEN OLD.project_id != NEW.project_id BEGIN UPDATE skills SET content = 'corrupted' WHERE id = NEW.id; END");

    expect(() => migrateWorkspaceProject()).toThrow(/skill hash verification failed/);
    expect(db.prepare("SELECT 1 FROM projects WHERE name = '/workspace'").get()).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = (SELECT id FROM projects WHERE name = '/workspace')").get()).toEqual({ count: 10 });
    expect(db.prepare("SELECT status FROM project_migration_manifests").get()).toEqual({ status: "prepared" });
  });

  it("rolls back when foreign-key verification fails", () => {
    const { db } = seedWorkspaceProject();
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), randomUUID(), "orphaned task", new Date().toISOString(), new Date().toISOString());
    db.pragma("foreign_keys = ON");

    expect(() => migrateWorkspaceProject()).toThrow(/foreign-key check failed/);
    expect(db.prepare("SELECT 1 FROM projects WHERE name = '/workspace'").get()).toBeTruthy();
    expect(db.prepare("SELECT status FROM project_migration_manifests").get()).toEqual({ status: "prepared" });
  });
});
