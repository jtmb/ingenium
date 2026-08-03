import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";

const directories: string[] = [];

function isolatedDb(): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-restore-migration-"));
  directories.push(directory);
  return join(directory, "data");
}

function removeRestore100Schema(db: ReturnType<typeof getDb>): void {
  db.exec(`
    DROP TABLE backup_restore_execution_receipts;
    DROP TABLE backup_restore_execution_events;
    DROP TABLE backup_restore_executor_plan_revisions;
    DROP TABLE backup_restore_execution_items;
    DROP TABLE backup_restore_execution_runs;
    DROP TABLE backup_restore_execution_authorizations;
    DROP TABLE backup_restore_receipts;
    DROP TABLE backup_restore_events;
    DROP TABLE backup_restore_stages;
    DROP TABLE backup_restore_authorizations;
    DROP TABLE backup_restore_plan_revisions;
    DROP TABLE backup_restore_plans;
    DROP INDEX idx_backup_records_project_id_id;
  `);
}

afterEach(() => {
  resetDbForTest();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("migration 083 RESTORE-100 inventory", () => {
  it("installs immutable plan identity, revisions, stages, authorizations, events, and receipts", () => {
    const db = getDb(isolatedDb());
    for (const table of ["backup_restore_plans", "backup_restore_plan_revisions", "backup_restore_stages", "backup_restore_authorizations", "backup_restore_events", "backup_restore_receipts"]) {
      expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
        .toEqual({ count: 1 });
    }
    for (const trigger of [
      "backup_restore_plans_immutable_update", "backup_restore_plans_immutable_delete",
      "backup_restore_plan_revisions_validate_insert", "backup_restore_plan_revisions_create_event",
      "backup_restore_plan_revisions_immutable_update", "backup_restore_plan_revisions_immutable_delete",
      "backup_restore_stages_validate_insert", "backup_restore_stages_immutable_update", "backup_restore_stages_immutable_delete",
      "backup_restore_events_immutable_update", "backup_restore_events_immutable_delete",
      "backup_restore_receipts_immutable_update", "backup_restore_receipts_immutable_delete",
    ]) {
      expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger))
        .toEqual({ count: 1 });
    }
  });

  it("installs migration 084's separate execution authorization, run, item, event, and receipt ledger", () => {
    const db = getDb(isolatedDb());
    for (const table of [
      "backup_restore_execution_authorizations", "backup_restore_execution_runs", "backup_restore_execution_items",
      "backup_restore_executor_plan_revisions", "backup_restore_execution_events", "backup_restore_execution_receipts",
    ]) {
      expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
        .toEqual({ count: 1 });
    }
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'backup_restore_authorizations_consume_once'").get())
      .toMatchObject({ sql: expect.stringContaining("NEW.id IS NOT OLD.id") });
  });

  it("applies migration 083 to an upgrade database with no RESTORE-100 inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    removeRestore100Schema(db);
    resetDbForTest();
    const upgraded = getDb(path);
    expect(upgraded.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'backup_restore_plans'").get())
      .toEqual({ count: 1 });
  });

  it("fails closed for partial RESTORE-100 inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    removeRestore100Schema(db);
    db.exec("CREATE TABLE backup_restore_plans (id TEXT PRIMARY KEY)");
    resetDbForTest();
    expect(() => getDb(path)).toThrow("Migration 083 is in a PARTIAL state");
  });

  it("fails closed for partial RESTORE-101 inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    db.exec("DROP TABLE backup_restore_execution_receipts; DROP TABLE backup_restore_execution_events; DROP TABLE backup_restore_executor_plan_revisions; DROP TABLE backup_restore_execution_items; DROP TABLE backup_restore_execution_runs; DROP TABLE backup_restore_execution_authorizations;");
    db.exec("CREATE TABLE backup_restore_execution_runs (id TEXT PRIMARY KEY)");
    resetDbForTest();
    expect(() => getDb(path)).toThrow("Migration 084 is in a PARTIAL state");
  });

  it("keeps the signed bundle migration source in the packaged migration inventory", () => {
    const migration = readFileSync(new URL("../data/migrations/083_restore_plans.sql", import.meta.url), "utf8");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("backup_restore_events_immutable_update");
    expect(migration).toContain("backup_restore_plan_revisions_validate_insert");
    expect(migration).toContain("restore plans require the active global project");
    expect(migration).toContain("stage_integrity_failed");
    expect(migration).toContain("NEW.from_state IN ('confirmed', 'ready_for_executor') AND NEW.to_state = 'failed'");
    const executor = readFileSync(new URL("../data/migrations/084_restore_executor.sql", import.meta.url), "utf8");
    expect(executor).toContain("restore execution deadline must be fifteen minutes");
    expect(executor).toContain("NEW.id IS NOT OLD.id");
    expect(executor).toContain("backup_restore_executor_plan_revisions");
  });
});
