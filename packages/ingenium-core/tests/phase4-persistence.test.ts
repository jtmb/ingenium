import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  archiveProject,
  createProject,
  deleteProject,
  ensureCanonicalGlobalProject,
  getCanonicalGlobalProject,
  getFormerGlobalProjectIds,
  getGlobalProject,
  migrateWorkspaceProject,
  setProjectGlobal,
} from "../lib/tools/projects.js";
import { settings } from "../lib/index.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

let tempDir = "";
let databasePath = "";

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4-core-"));
  databasePath = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  process.env.INGENIUM_HOME = join(tempDir, "home");
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  databasePath = "";

  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

function openDatabase() {
  return getDb(databasePath);
}

function seedWorkspaceSkills(db: ReturnType<typeof getDb>): string {
  const sourceId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, '/workspace', '/workspace', 0, ?, ?)",
  ).run(sourceId, now, now);

  for (let index = 0; index < 10; index += 1) {
    db.prepare(
      `INSERT INTO skills
       (id, project_id, name, description, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      sourceId,
      `phase4-skill-${index}`,
      "phase 4 fixture",
      `phase4-content-${index}`,
      index === 0 ? 0 : 1,
      now,
      now,
    );
  }

  return sourceId;
}

describe("Phase 4 core persistence boundaries", () => {
  it("persists project and settings data after closing and reopening the same DB", () => {
    const global = createProject("global-default", true);
    settings.setSetting(global.id, "phase4.persistence", "survives-reopen");

    const firstConnection = openDatabase();
    expect(firstConnection.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 1 });

    resetDbForTest();

    const reopenedConnection = openDatabase();
    expect(reopenedConnection.name).toBe(databasePath);
    expect(reopenedConnection.prepare("SELECT name FROM projects WHERE id = ?").get(global.id)).toEqual({
      name: "global-default",
    });
    expect(settings.getSetting(global.id, "phase4.persistence")).toBe("survives-reopen");
  });

  it("resolves every operation to the canonical DB path without creating a second DB", () => {
    const global = createProject("global-default", true);
    settings.setSetting(global.id, "phase4.path", "canonical");

    expect(openDatabase().name).toBe(databasePath);
    resetDbForTest();
    expect(openDatabase().name).toBe(databasePath);

    expect(existsSync(databasePath)).toBe(true);
    const databaseFiles = readdirSync(tempDir, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith(".db"));
    expect(databaseFiles).toEqual(["canonical/data.db"]);
    expect(existsSync(join(tempDir, "data"))).toBe(false);
    expect(existsSync(join(tempDir, ".ingenium", "data.db"))).toBe(false);
  });

  it("deletes, recreates, and reassigns the global project without leaving two globals", () => {
    const originalGlobal = createProject("original-global", true);
    const reassignedProject = createProject("reassigned-project");

    expect(setProjectGlobal(reassignedProject.name, true)).toBe(true);
    expect(getGlobalProject()?.name).toBe(reassignedProject.name);

    expect(deleteProject(originalGlobal.name)).toEqual({ status: "deleted" });
    const replacement = createProject("replacement-global", true);

    expect(getGlobalProject()?.name).toBe(replacement.name);
    expect(openDatabase().prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get()).toEqual({
      count: 1,
    });
  });

  it("does not let a noncanonical active global project capture server-owned resources", () => {
    createProject("alternate-global", true);

    expect(() => getCanonicalGlobalProject()).toThrow(/global-default/i);
    expect(() => ensureCanonicalGlobalProject()).toThrow(/global-default/i);

    const canonical = createProject("global-default", true);
    expect(getCanonicalGlobalProject()?.id).toBe(canonical.id);
  });

  it("seeds only the active global when provenance is first installed", () => {
    const db = openDatabase();
    const activeGlobalId = randomUUID();
    const archivedGlobalId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run(activeGlobalId, "global-default", "global-default", now, now);
    db.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
    ).run(archivedGlobalId, "archived-legacy-global", "archived-legacy-global", now, now, now);
    db.exec("DROP TABLE server_global_project_provenance");

    resetDbForTest();
    const reopened = openDatabase();

    expect(reopened.prepare(
      "SELECT source_project_id, event_type FROM server_global_project_provenance ORDER BY id",
    ).all()).toEqual([{ source_project_id: activeGlobalId, event_type: "became_global" }]);
    expect(getFormerGlobalProjectIds(activeGlobalId)).toEqual([]);
  });

  it("records lifecycle-proven former globals without selecting ordinary projects", () => {
    const canonical = createProject("global-default", true);
    const ordinaryActive = createProject("ordinary-active");
    const ordinaryArchived = createProject("ordinary-archived");
    const former = createProject("former-global");

    expect(archiveProject(ordinaryArchived.name)).toBe(true);
    expect(setProjectGlobal(former.name, true)).toBe(true);
    expect(setProjectGlobal(canonical.name, true)).toBe(true);

    expect(getFormerGlobalProjectIds(canonical.id)).toEqual([former.id]);
    expect(getFormerGlobalProjectIds(canonical.id)).not.toContain(ordinaryActive.id);
    expect(getFormerGlobalProjectIds(canonical.id)).not.toContain(ordinaryArchived.id);
  });

  it("runs workspace migration once and preserves disabled skill metadata", () => {
    const db = openDatabase();
    const sourceId = seedWorkspaceSkills(db);
    createProject("global-default", true);

    const first = migrateWorkspaceProject();
    expect(first.migrated).toBe(true);
    expect(first.manifestId).toBeTruthy();

    const second = migrateWorkspaceProject();
    expect(second).toMatchObject({ migrated: false, sourceSkillCount: 0, sourceHashes: [] });
    expect(db.prepare("SELECT 1 FROM projects WHERE id = ?").get(sourceId)).toBeUndefined();

    const destination = getGlobalProject()!;
    expect(db.prepare("SELECT enabled FROM skills WHERE project_id = ? AND name = ?").get(destination.id, "phase4-skill-0"))
      .toEqual({ enabled: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM project_migration_manifests WHERE status = 'completed'").get())
      .toEqual({ count: 1 });
  });
});
