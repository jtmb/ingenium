import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  createProject,
  getGlobalProject,
  setProjectGlobal,
} from "../lib/tools/projects.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;
let tempDir = "";

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-phase4c-core-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "canonical", "data.db");
  process.env.INGENIUM_HOME = join(tempDir, "home");
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("Phase 4C core database boundaries", () => {
  it("enforces one in-process DB singleton instead of opening a second requested path", () => {
    const firstPath = join(tempDir, "canonical", "data.db");
    const secondPath = join(tempDir, "unexpected", "other.db");

    const first = getDb(firstPath);
    const second = getDb(secondPath);

    expect(second).toBe(first);
    expect(first.name).toBe(firstPath);
    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(secondPath)).toBe(false);
  });

  it("keeps the public project mutation paths singleton-safe", () => {
    createProject("first-global", true);
    createProject("second-global", true);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get())
      .toEqual({ count: 1 });

    expect(setProjectGlobal("first-global", true)).toBe(true);
    expect(getGlobalProject()?.name).toBe("first-global");
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get())
      .toEqual({ count: 1 });
  });

  it("upgrades a pre-053 duplicate-global DB using global-default as canonical", () => {
    // Build a real pre-053 database. A fresh current database already has the
    // unique index, so inserting a second global there would only test the
    // constraint rather than the upgrade reconciliation path.
    const legacyPath = join(tempDir, "pre-053.db");
    const legacy = new Database(legacyPath);
    const migrationDir = resolve(__dirname, "../data/migrations");
    const pre053Migrations = readdirSync(migrationDir)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 52)
      .sort();
    expect(pre053Migrations).toHaveLength(52);
    for (const migration of pre053Migrations) {
      legacy.exec(readFileSync(join(migrationDir, migration), "utf8"));
    }

    const now = new Date().toISOString();
    legacy.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run("canonical-global", "global-default", "/legacy/canonical", now, now);
    expect(legacy.prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get())
      .toEqual({ count: 1 });
    legacy.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run("legacy-global", "legacy-global", "/legacy/duplicate", now, now);
    expect(legacy.prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get())
      .toEqual({ count: 2 });
    legacy.close();

    // Point the core singleton at the legacy file. Opening it applies 053 and
    // must use global-default as the only safe canonical designation.
    process.env.INGENIUM_CORE_DB_PATH = legacyPath;
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS count FROM projects WHERE is_global = 1").get())
      .toEqual({ count: 1 });
    expect(db.prepare("SELECT name FROM projects WHERE is_global = 1").get())
      .toEqual({ name: "global-default" });
    expect(getGlobalProject()?.name).toBe("global-default");
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_projects_one_active_global'",
    ).get()).toEqual({ count: 1 });
  });

  it("keeps the migration runner inventory aligned with all numbered SQL files", () => {
    const migrationDir = resolve(__dirname, "../data/migrations");
    const latestMigration = "084_restore_executor.sql";
    const expected = Array.from({ length: 84 }, (_, index) => `${String(index + 1).padStart(3, "0")}`)
      .map((number) => {
        const files = readdirSync(migrationDir).filter((file) => file.startsWith(`${number}_`) && file.endsWith(".sql"));
        expect(files, `migration ${number} must have exactly one SQL file`).toHaveLength(1);
        return files[0]!;
      });
    const actual = readdirSync(migrationDir)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file))
      .sort();

    expect(actual).toEqual(expected);
    expect(expected).toContain("049_workspace_project_migration.sql");
    expect(expected).toContain("050_context_rag_phase3.sql");
    expect(expected).toContain("051_thread_retirement.sql");
    expect(expected).toContain("052_agent_category_integrity.sql");
    expect(expected).toContain("053_global_project_integrity_and_protected_settings.sql");
    expect(expected).toContain("054_agent_frontmatter_metadata.sql");
    expect(expected).toContain("055_reserved_broker_delete_protection.sql");
    expect(expected).toContain("056_reserved_broker_rename_protection.sql");
    expect(expected).toContain("057_reserved_broker_immutable.sql");
    expect(expected).toContain("058_reserved_broker_connection_independent.sql");
    expect(expected).toContain("059_repository_docs_onboarding.sql");
    expect(expected).toContain("060_repository_resource_sync.sql");
    expect(expected).toContain("061_global_backup_ownership.sql");
    expect(expected).toContain("062_child_mcp_definitions.sql");
    expect(expected).toContain("063_immutable_context_conversations.sql");
    expect(expected).toContain("064_child_mcp_tool_categories.sql");
    expect(expected).toContain("065_context_rag_ingestion.sql");
    expect(expected).toContain("066_context_checkpoint_governance.sql");
    expect(expected).toContain("067_context_migration_repair.sql");
    expect(expected).toContain("068_usage_telemetry.sql");
    expect(expected).toContain("069_context_conversation_snapshot_imports.sql");
    expect(expected).toContain("070_drop_legacy_rag_embeddings.sql");
    expect(expected).toContain("071_context_rag_session_source_reference.sql");
    expect(expected).toContain("072_task_source_references.sql");
    expect(expected).toContain("073_task_coordination.sql");
    expect(expected).toContain("074_task_reservation_tokens.sql");
    expect(expected).toContain("075_coordination_registry.sql");
    expect(expected).toContain("076_trusted_job_events.sql");
    expect(expected).toContain("077_job_event_deliveries.sql");
    expect(expected).toContain("083_restore_plans.sql");
    expect(expected).toContain("078_usage_advisory_thresholds.sql");
    expect(expected).toContain("079_usage_attention_items.sql");
    expect(expected).toContain("080_job_vault_references.sql");
    expect(expected).toContain("081_vault_job_runs.sql");
    expect(expected).toContain("082_job_vault_revision_audit.sql");
    expect(expected).toContain("084_restore_executor.sql");
    expect(expected.at(-1)).toBe(latestMigration);
    expect(expected).toContain(latestMigration);

    const coordinationMigration = readFileSync(
      join(migrationDir, "075_coordination_registry.sql"),
      "utf8",
    );
    expect(coordinationMigration).toContain("CREATE TABLE coordination_worktrees");
    expect(coordinationMigration).toContain("CREATE TABLE coordination_sessions");
    expect(coordinationMigration).toContain("CREATE TABLE coordination_claims");
    expect(coordinationMigration).toContain("CREATE TABLE coordination_mutation_receipts");
    expect(coordinationMigration).toContain("coordination_mutation_receipts_immutable_update");
    expect(coordinationMigration).toContain("FOREIGN KEY(project_id, worktree_id)");

    const dbSource = readFileSync(resolve(__dirname, "../lib/db.ts"), "utf8");
    const freshRegistration = dbSource.match(
      /if \(tableCount\.count === 0\) \{([\s\S]*?)\n\s*\} else \{/,
    );
    expect(freshRegistration?.[1]).toBeDefined();
    expect(freshRegistration?.[1]?.match(/"\d{3}_[^"]+\.sql"/g))
      .toEqual(expected.map((migration) => `"${migration}"`));

    const upgradeRegistration = dbSource.match(
      /const restoreExecutorMigration = inspectRestoreExecutorMigration\(db\);[\s\S]*?if \(!restoreExecutorMigration\.complete\) \{([\s\S]*?)\n\s*\}/,
    );
    expect(upgradeRegistration?.[1]).toContain(
      `readFileSync(resolve(migrationsDir, "${latestMigration}"), "utf-8")`,
    );
  });
});
