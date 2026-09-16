import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, plugins, projects, resetDbForTest } from "../lib/index.js";
import * as database from "../lib/db.js";

let directory: string;
let projectId: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "plugin-description-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data.db"));
  vi.stubEnv("INGENIUM_HOME", join(directory, "home"));
  resetDbForTest();
  projectId = projects.createProject("description-test").id;
});
afterEach(() => {
  vi.restoreAllMocks();
  resetDbForTest();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("migration 119 preserves every existing column and seeds shipped and custom plugins", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE plugins (id TEXT PRIMARY KEY, name TEXT, source_content TEXT, enabled INTEGER, updated_at TEXT)");
    const names = ["auto-observer", "observer", "resource-sync", "session-coordinator", "ponytail", "custom"];
    for (const name of names) db.prepare("INSERT INTO plugins VALUES (?, ?, ?, 0, 'original')").run(name, name, "export {};");
    const before = db.prepare("SELECT * FROM plugins").all();
    db.transaction(() => db.exec(readFileSync(new URL("../data/migrations/119_plugin_description.sql", import.meta.url), "utf8")))();
    expect(db.prepare("SELECT id, name, source_content, enabled, updated_at FROM plugins").all()).toEqual(before);
    for (const row of db.prepare("SELECT name, description FROM plugins").all() as Array<{ name: string; description: string }>) {
      expect(row.description).toBe(plugins.defaultPluginDescription(row.name));
      expect(row.description.length).toBeGreaterThan(20);
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA table_info(plugins)").all()).toContainEqual(expect.objectContaining({ name: "description", notnull: 1, dflt_value: "''" }));
  } finally { db.close(); }
});

it("changes only description/timestamp, checkpoints after commit, persists across reopen and never writes plugin files", () => {
  const db = getDb();
  db.prepare("INSERT INTO plugins (id, project_id, name, file_path, source_content, enabled, created_at, updated_at) VALUES ('fixture', ?, 'fixture', '/outside/plugin.ts', 'export {};', 0, 'original', 'original')").run(projectId);
  const before = plugins.getPlugin(projectId, "fixture")!;
  const files = readdirSync(directory).sort();
  const checkpoint = vi.spyOn(database, "checkpointAfterWrite").mockImplementation(() => { expect(db.inTransaction).toBe(false); });
  const description = "<script>alert('text only')</script> ' ; --\nLocal notes";
  expect(plugins.updatePluginDescription(projectId, "fixture", description)).toEqual({ ...before, description, updated_at: expect.any(String) });
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(readdirSync(directory).sort()).toEqual(files);
  resetDbForTest();
  expect(plugins.getPlugin(projectId, "fixture")?.description).toBe(description);
  expect(plugins.updatePluginDescription(projectId, "missing", "notes")).toBeUndefined();
  expect(plugins.updatePluginDescription("foreign-project", "fixture", "notes")).toBeUndefined();
  for (const invalid of [null, 1, {}, "x".repeat(2001), "bad\0text"]) {
    expect(() => plugins.updatePluginDescription(projectId, "fixture", invalid as string)).toThrow();
  }
  expect(plugins.updatePluginDescription(projectId, "fixture", "")?.description).toBe("");
});

it("rejects mixed, unknown and empty update bodies", () => {
  for (const body of [{}, { description: "notes", file_path: "other.ts" }, { description: "notes", source_content: "code" }, { description: "notes", enabled: true }, { description: "notes", order: 3 }]) {
    expect(plugins.pluginUpdateSchema.safeParse(body).success).toBe(false);
  }
  expect(plugins.pluginUpdateSchema.safeParse({ description: "x".repeat(2000) }).success).toBe(true);
});

it("upgrades an existing database on reopen once and preserves edits on later startups", () => {
  const db = getDb();
  db.prepare("INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at) VALUES ('existing', ?, 'ponytail', 'ponytail.mjs', 1, 'export {};', 'before', 'before')").run(projectId);
  db.exec("ALTER TABLE plugins DROP COLUMN description");
  const before = db.prepare("SELECT * FROM plugins").all();
  resetDbForTest();
  expect(getDb().prepare("SELECT id, project_id, name, file_path, enabled, source_content, created_at, updated_at FROM plugins").all()).toEqual(before);
  expect(plugins.getPlugin(projectId, "ponytail")?.description).toBe(plugins.defaultPluginDescription("ponytail"));
  plugins.updatePluginDescription(projectId, "ponytail", "Local edit");
  resetDbForTest();
  expect(plugins.getPlugin(projectId, "ponytail")?.description).toBe("Local edit");
});
