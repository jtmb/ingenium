import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";

const migrationDirectory = resolve(__dirname, "../data/migrations");
const directories: string[] = [];

function legacyDatabase(withRetiredSource = false): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-thread-retirement-"));
  directories.push(directory);
  const path = join(directory, "data.db");
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(migrationDirectory, "001_init.sql"), "utf8"));
  db.exec(readFileSync(join(migrationDirectory, "048_docs_rag.sql"), "utf8"));
  db.prepare("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))")
    .run("project-id", "legacy-project", "/legacy-project");
  db.prepare("INSERT INTO rag_sources (id, project_id, title, source_type, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', datetime('now'), datetime('now'))")
    .run("source-id", "project-id", "Legacy source", withRetiredSource ? "thread_import" : "text");
  db.close();
  return path;
}

afterEach(() => {
  resetDbForTest();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("migration 051 Thread retirement", () => {
  it("applies the retired schema cleanup on a fresh database", () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-thread-retirement-fresh-"));
    directories.push(directory);
    const db = getDb(join(directory, "data.db"));
    expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rag_thread_imports'").get()).toEqual({ count: 0 });
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_sources'").get() as { sql: string }).sql).not.toContain("thread_import");
  });

  it("rebuilds verified-zero legacy RAG sources without losing generic rows", () => {
    const db = getDb(legacyDatabase());
    expect(db.prepare("SELECT title, source_type FROM rag_sources WHERE id = 'source-id'").get()).toEqual({ title: "Legacy source", source_type: "text" });
    expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rag_thread_imports'").get()).toEqual({ count: 0 });
    expect((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_sources'").get() as { sql: string }).sql).not.toContain("thread_import");
    expect(() => db.prepare("INSERT INTO rag_sources (id, project_id, title, source_type) VALUES ('rejected', 'project-id', 'Rejected', 'thread_import')").run()).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses migration before changing a database that still has legacy data", () => {
    const path = legacyDatabase(true);
    expect(() => getDb(path)).toThrow(/verified-zero Thread data/);
    resetDbForTest();
    const db = new Database(path);
    expect(db.prepare("SELECT source_type FROM rag_sources WHERE id = 'source-id'").get()).toEqual({ source_type: "thread_import" });
    expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rag_thread_imports'").get()).toEqual({ count: 1 });
    db.close();
  });
});
