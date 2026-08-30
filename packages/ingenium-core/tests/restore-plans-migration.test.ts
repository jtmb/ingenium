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
    DROP TABLE backup_deletion_reservations;
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

  it("installs migration 085's immutable phase evidence with the execution run project binding", () => {
    const db = getDb(isolatedDb());
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'backup_restore_execution_phase_events'").get())
      .toMatchObject({
        sql: expect.stringContaining(
          "FOREIGN KEY(project_id, run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT",
        ),
      });
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'backup_restore_execution_phase_events_validate_insert'").get())
      .toMatchObject({
        sql: expect.stringContaining("project_id = NEW.project_id AND id = NEW.run_id"),
      });
    for (const trigger of [
      "backup_restore_execution_phase_events_validate_insert",
      "backup_restore_execution_phase_events_immutable_update",
      "backup_restore_execution_phase_events_immutable_delete",
    ]) {
      expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger))
        .toEqual({ count: 1 });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("installs migration 090's bounded deletion reservation and restore-preview exclusion", () => {
    const db = getDb(isolatedDb());
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'backup_deletion_reservations'").get())
      .toMatchObject({
        sql: expect.stringContaining(
          "FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE CASCADE",
        ),
      });
    for (const trigger of [
      "backup_deletion_reservations_reject_referenced_backup",
      "backup_restore_plans_reject_deleting_backup",
    ]) {
      expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger))
        .toEqual({ count: 1 });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("applies migration 083 to an upgrade database with no RESTORE-100 inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    removeRestore100Schema(db);
    db.exec("DROP TABLE backup_restore_execution_phase_events;");
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

  it("fails closed for partial RESTORE-101 phase-event inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    db.exec("DROP TRIGGER backup_restore_execution_phase_events_immutable_delete;");
    resetDbForTest();
    expect(() => getDb(path)).toThrow("Migration 085 is in a PARTIAL state");
  });

  it("fails closed for partial backup-deletion reservation inventory", () => {
    const path = isolatedDb();
    const db = getDb(path);
    db.exec("DROP TRIGGER backup_restore_plans_reject_deleting_backup;");
    resetDbForTest();
    expect(() => getDb(path)).toThrow("Migration 090 is in a PARTIAL state");
  });

  it("rejects phase-event inventory without its restore prerequisites before unrelated migrations run", () => {
    const path = isolatedDb();
    const db = getDb(path);
    removeRestore100Schema(db);
    resetDbForTest();
    expect(() => getDb(path)).toThrow("Migration 085 is in a PARTIAL state");
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
    const phaseEvents = readFileSync(new URL("../data/migrations/085_restore_executor_phase_events.sql", import.meta.url), "utf8");
    expect(phaseEvents).toContain("FOREIGN KEY(project_id, run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT");
    expect(phaseEvents).toContain("project_id = NEW.project_id AND id = NEW.run_id");
    const deletionReservations = readFileSync(new URL("../data/migrations/090_backup_deletion_reservations.sql", import.meta.url), "utf8");
    expect(deletionReservations).toContain("CREATE TABLE IF NOT EXISTS backup_deletion_reservations");
    expect(deletionReservations).toContain("backup_deletion_reservations_reject_referenced_backup");
    expect(deletionReservations).toContain("backup_restore_plans_reject_deleting_backup");
  });
});
