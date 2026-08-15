import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "ingenium-core";
import { runDatabaseIntegrityCheck } from "../scripts/check-database-integrity";

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-database-integrity-"));
  databasePath = join(directory, "data");
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
});

describe("database integrity CLI contract", () => {
  it("returns only content-free zero counts for a valid isolated database", () => {
    getDb(databasePath);

    expect(runDatabaseIntegrityCheck(databasePath)).toEqual({
      ok: true,
      integrityViolationCount: 0,
      foreignKeyViolationCount: 0,
    });
  });

  it("counts an isolated foreign-key violation without returning row content", () => {
    const database = getDb(databasePath);
    database.exec("CREATE TABLE integrity_parent (id INTEGER PRIMARY KEY); CREATE TABLE integrity_child (parent_id INTEGER REFERENCES integrity_parent(id));");
    database.pragma("foreign_keys = OFF");
    database.prepare("INSERT INTO integrity_child (parent_id) VALUES (?)").run(42);
    resetDbForTest();

    const result = runDatabaseIntegrityCheck(databasePath);
    expect(result).toEqual({
      ok: false,
      integrityViolationCount: 0,
      foreignKeyViolationCount: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/integrity_child|parent_id|databasePath|PRAGMA/i);
  });

  it("fails closed with content-free counts for an isolated corrupt database", () => {
    writeFileSync(databasePath, "not a sqlite database");

    const result = runDatabaseIntegrityCheck(databasePath);
    expect(result.ok).toBe(false);
    expect(result.integrityViolationCount).toBeGreaterThan(0);
    expect(result.foreignKeyViolationCount).toBeGreaterThan(0);
    expect(Object.keys(result).sort()).toEqual([
      "foreignKeyViolationCount",
      "integrityViolationCount",
      "ok",
    ]);
  });
});
