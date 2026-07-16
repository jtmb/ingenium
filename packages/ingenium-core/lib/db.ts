import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

/**
 * Retry budget for `execTransaction` when SQLite reports contention.
 *
 * WRITE_MAX_RETRIES = 15 — chosen so that with typical backoff durations
 * (~85 ms average delay × 15 attempts ≈ 1.3 s) the total retry window stays
 * well under the busy_timeout of 5000 ms set in getDb(). This prevents the
 * retry loop from outlasting SQLite's own busy handler.
 *
 * WRITE_RETRY_MIN_MS = 20 — baseline delay; at ~20 ms a SQLite write is
 * nearly always committed on modern hardware, so a second attempt will
 * likely see a clean lock.
 *
 * WRITE_RETRY_MAX_MS = 150 — upper bound prevents a single contention
 * spike from adding more than ~150 ms to any one retry cycle.
 *
 * The actual delay is uniform-random between min and max to avoid
 * thundering-herd re-collision (all concurrent writers retrying on the
 * same cadence).
 */
const WRITE_MAX_RETRIES = 15;
const WRITE_RETRY_MIN_MS = 20;
const WRITE_RETRY_MAX_MS = 150;

let db: Database.Database | null = null;

/**
 * Returns the singleton SQLite database connection, creating it on first call.
 *
 * Pragma rationale:
 * - `journal_mode = WAL` — permits concurrent readers without blocking writers.
 *   Required for the dashboard and API to read while background synthesis writes.
 * - `busy_timeout = 5000` — SQLite will wait up to 5 s for a lock instead of
 *   immediately returning SQLITE_BUSY. Combined with `execTransaction` retries,
 *   this gives a two-tier contention strategy (SQLite waits, then we retry).
 * - `foreign_keys = ON` — SQLite defaults to OFF for backward compatibility.
 *   Must be re-enabled every connection because it is not persisted in the DB file.
 */
export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

/**
 * Apply SQL migrations using a probe-based strategy (no migrations table).
 *
 * WHY NOT a migrations table: Earlier versions of this schema used a `_migrations`
 * tracking table, but it was removed to avoid a circular bootstrapping problem —
 * the core DB setup needs to run before the API layer (which manages the migrations
 * table) is available. Instead, we probe for schema features:
 *
 * - **Fresh DB** (zero tables): apply all migration files in sequence.
 * - **Existing DB**: probe for individual columns/tables/constraints and apply only
 *   the missing ones. This is idempotent and handles upgrades from any prior version.
 *
 * Migrations that rebuild tables (e.g., FK constraint changes) temporarily disable
 * foreign_keys enforcement to avoid cascading FTS trigger errors during the rebuild.
 */
function runMigrations(db: Database.Database): void {
  const migrationsDir = resolve(import.meta.dirname ?? __dirname, "../data/migrations");

  const tableCount = db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type='table'",
  ).get() as { count: number };

  if (tableCount.count === 0) {
    // Fresh database — apply every migration in dependency order
        for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql", "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql", "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql", "014_configs.sql", "015_auto_observer_source.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql", "018_extraction_pipeline_events.sql", "019_trait_exemplar_fk_setnull.sql", "020_kanban_board.sql", "021_jobs.sql", "022_email_cache.sql", "023_fix_servers_unique.sql", "024_skills_unique_per_project.sql", "025_email_string_ids.sql", "026_email_suggestions.sql", "027_email_summaries.sql", "028_email_suggestion_queue.sql", "029_docs_spaces.sql", "030_docs_pages.sql", "031_docs_pages_fts.sql", "032_docs_drafts.sql", "033_docs_versions.sql", "034_docs_tags.sql", "035_docs_links.sql", "036_docs_comments.sql", "037_docs_project_links.sql", "038_docs_attachments.sql", "039_docs_templates.sql", "040_docs_integrity.sql", "041_skill_maintenance_locks.sql", "042_skill_versions.sql", "043_skill_lineage.sql", "044_skill_proposals.sql", "045_pipeline_event_types.sql"]) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
      db.exec(sql);
      logger.info("db", `Applied migration ${file}`);
    }
    // Verify and rebuild skills_fts after all migrations (including 024 + 041)
    verifyAndRebuildSkillsFts(db);
  } else {
    // Check if archived_at column exists (migration 002)
    const colCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('projects') WHERE name = 'archived_at'",
    ).get() as { count: number };
    if (colCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "002_archive.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 002_archive.sql");
    }

    // Check if agents table exists (migration 003)
    const agentsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='agents'"
    ).get() as { count: number };
    if (agentsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "003_agents.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 003_agents.sql");
    }

    // Check if status column exists on learnings (migration 004)
    const statusColCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('learnings') WHERE name = 'status'"
    ).get() as { count: number };
    if (statusColCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "004_learnings_status.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 004_learnings_status.sql");
    }

    // Check if tags column exists on skills (migration 005)
    const tagsColCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'tags'"
    ).get() as { count: number };
    if (tagsColCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "005_skills_metadata.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 005_skills_metadata.sql");
    }

    // Check if file_tree column exists on skills (migration 006)
    const fileTreeCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('skills') WHERE name = 'file_tree'"
    ).get() as { count: number };
    if (fileTreeCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "006_skill_file_tree.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 006_skill_file_tree.sql");
    }

    // Check if observations table exists (migration 007)
    const observationsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='observations'"
    ).get() as { count: number };
    if (observationsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "007_observations.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 007_observations.sql");
    }

    // Check if personality_traits table exists (migration 008)
    const personalityCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='personality_traits'"
    ).get() as { count: number };
    if (personalityCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "008_personality_traits.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 008_personality_traits.sql");
    }

    // Check if pipeline_events table exists (migration 009)
    const pipelineEventsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='pipeline_events'"
    ).get() as { count: number };
    if (pipelineEventsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "009_pipeline_events.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 009_pipeline_events.sql");
    }

    // Check if commands table exists (migration 010)
    const commandsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='commands'"
    ).get() as { count: number };
    if (commandsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "010_commands.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 010_commands.sql");
    }

    // Check if source column exists on servers (migration 011)
    const sourceColCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('servers') WHERE name = 'source'"
    ).get() as { count: number };
    if (sourceColCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "011_server_source.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 011_server_source.sql");
    }

    // Check if is_global column exists on projects (migration 012)
    const isGlobalColCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('projects') WHERE name = 'is_global'"
    ).get() as { count: number };
    if (isGlobalColCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "012_project_is_global.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 012_project_is_global.sql");
    }

    // Check if plugins table still uses UNIQUE(name) instead of UNIQUE(project_id, name) (migration 013)
    const pluginsCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='plugins'"
    ).get() as { sql: string } | undefined;
    if (pluginsCreateSql && !pluginsCreateSql.sql.includes("UNIQUE(project_id, name)")) {
      const sql = readFileSync(resolve(migrationsDir, "013_fix_plugins_unique.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 013_fix_plugins_unique.sql");
    }

    // Check if configs table exists (migration 014)
    const configsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='configs'"
    ).get() as { count: number };
    if (configsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "014_configs.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 014_configs.sql");
    }

    // Migration 015: Add 'auto-observer' to observations.source CHECK constraint.
    // This expands the allowed sources enum without dropping the table —
    // migration 015 rebuilds it, so we re-read `observationsCreateSql` afterward
    // for use in the migration 017 guard below.
    let observationsCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'"
    ).get() as { sql: string } | undefined;
    if (observationsCreateSql && !observationsCreateSql.sql.includes("auto-observer")) {
      const sql = readFileSync(resolve(migrationsDir, "015_auto_observer_source.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 015_auto_observer_source.sql");
      observationsCreateSql = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'"
      ).get() as { sql: string } | undefined;
    }

    // Check if mcp_tool_states table exists (migration 016)
    const mcpToolStatesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='mcp_tool_states'"
    ).get() as { count: number };
    if (mcpToolStatesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "016_mcp_tool_states.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 016_mcp_tool_states.sql");
    }

    // Migration 017: Rebuild personality_traits FK after migration 015 recreated observations.
    // SQLite internally references tables by pointer, not name. When migration 015
    // rebuilt the observations table, personality_traits' FK was left pointing at a
    // stale internal reference. We detect this by looking for the 017_rebuilt marker
    // comment in the personality_traits CREATE SQL — if absent, the FK needs rebuilding.
    // FK enforcement is temporarily disabled to avoid cascading errors from FTS triggers
    // during the table rebuild.
    const traitsSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits'"
    ).get() as { sql: string } | undefined;
    if (traitsSql && observationsCreateSql && observationsCreateSql.sql.includes("auto-observer") && !traitsSql.sql.includes("017_rebuilt")) {
      const sql = readFileSync(resolve(migrationsDir, "017_fix_trait_fk.sql"), "utf-8");
      db.pragma("foreign_keys = OFF");
      db.exec(sql);
      db.pragma("foreign_keys = ON");
      logger.info("db", "Applied migration 017_fix_trait_fk.sql");
    }

    // Migration 018: Add extraction_completed / extraction_failed to pipeline_events CHECK.
    const pipelineCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pipeline_events'"
    ).get() as { sql: string } | undefined;
    if (pipelineCreateSql && !pipelineCreateSql.sql.includes("extraction_completed")) {
      const sql = readFileSync(resolve(migrationsDir, "018_extraction_pipeline_events.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 018_extraction_pipeline_events.sql");
    }

    // Migration 019: Change personality_traits.exemplar_observation_id FK to ON DELETE SET NULL.
    // The default ON DELETE NO ACTION blocks observation deletion when a trait references it.
    // SET NULL allows observations to be pruned without cascade-deleting the trait.
    // FK enforcement is temporarily disabled to avoid FTS trigger errors during table rebuild.
    const traits019Sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits'"
    ).get() as { sql: string } | undefined;
    if (traits019Sql && !traits019Sql.sql.includes("019_fk_setnull")) {
      const sql = readFileSync(resolve(migrationsDir, "019_trait_exemplar_fk_setnull.sql"), "utf-8");
      db.pragma("foreign_keys = OFF");
      db.exec(sql);
      db.pragma("foreign_keys = ON");
      logger.info("db", "Applied migration 019_trait_exemplar_fk_setnull.sql");
    }

    // Check if task_comments table exists (migration 020)
    const taskCommentsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='task_comments'"
    ).get() as { count: number };
    if (taskCommentsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "020_kanban_board.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 020_kanban_board.sql");
    }

    // Check if jobs table exists (migration 021)
    const jobsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='jobs'"
    ).get() as { count: number };
    if (jobsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "021_jobs.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 021_jobs.sql");
    }

    // Check if email_cache table exists (migration 022)
    const emailCacheCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='email_cache'"
    ).get() as { count: number };
    if (emailCacheCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "022_email_cache.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 022_email_cache.sql");
    }

    // Check if servers table still uses UNIQUE(name) instead of UNIQUE(project_id, name) (migration 023)
    const serversCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='servers'"
    ).get() as { sql: string } | undefined;
    if (serversCreateSql && !serversCreateSql.sql.includes("UNIQUE(project_id, name)")) {
      const sql = readFileSync(resolve(migrationsDir, "023_fix_servers_unique.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 023_fix_servers_unique.sql");
    }

    // Check if skills table still uses UNIQUE(name) instead of UNIQUE(project_id, name) (migration 024)
    const skillsCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='skills'"
    ).get() as { sql: string } | undefined;
    if (skillsCreateSql && !skillsCreateSql.sql.includes("UNIQUE(project_id, name)")) {
      const sql = readFileSync(resolve(migrationsDir, "024_skills_unique_per_project.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 024_skills_unique_per_project.sql");
    }

    // Migration 025: Rebuild email_cache with TEXT uid column.
    // IMAP UIDs can exceed INTEGER range on some providers (e.g., large shared mailboxes).
    // This widens the column from INTEGER to TEXT to accommodate arbitrary-length UIDs
    // while maintaining backward compatibility via the -- 025_rebuilt marker.
    const emailCacheCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='email_cache'"
    ).get() as { sql: string } | undefined;
    if (emailCacheCreateSql && !emailCacheCreateSql.sql.includes("-- 025_rebuilt")) {
      const sql = readFileSync(resolve(migrationsDir, "025_email_string_ids.sql"), "utf-8");
      db.pragma("foreign_keys = OFF");
      db.exec(sql);
      db.pragma("foreign_keys = ON");
      logger.info("db", "Applied migration 025_email_string_ids.sql");
    }

    // Check if email_suggestions table exists (migration 026)
    const emailSuggestionsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='email_suggestions'"
    ).get() as { count: number };
    if (emailSuggestionsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "026_email_suggestions.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 026_email_suggestions.sql");
    }

    // Check if email_summaries table exists (migration 027)
    const emailSummariesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='email_summaries'"
    ).get() as { count: number };
    if (emailSummariesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "027_email_summaries.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 027_email_summaries.sql");
    }

    // Check if email_suggestion_queue table exists (migration 028)
    const esqCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='email_suggestion_queue'"
    ).get() as { count: number };
    if (esqCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "028_email_suggestion_queue.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 028_email_suggestion_queue.sql");
    }

    // Check if docs_spaces table exists (migration 029)
    const docsSpacesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_spaces'"
    ).get() as { count: number };
    if (docsSpacesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "029_docs_spaces.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 029_docs_spaces.sql");
    }

    // Check if docs_pages table exists (migration 030)
    const docsPagesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_pages'"
    ).get() as { count: number };
    if (docsPagesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "030_docs_pages.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 030_docs_pages.sql");
    }

    // Check if docs_pages_fts FTS table exists (migration 031)
    const docsPagesFtsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_pages_fts'"
    ).get() as { count: number };
    if (docsPagesFtsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "031_docs_pages_fts.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 031_docs_pages_fts.sql");
    }

    // Check if docs_page_drafts table exists (migration 032)
    const docsDraftsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_page_drafts'"
    ).get() as { count: number };
    if (docsDraftsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "032_docs_drafts.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 032_docs_drafts.sql");
    }

    // Check if docs_page_versions table exists (migration 033)
    const docsVersionsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_page_versions'"
    ).get() as { count: number };
    if (docsVersionsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "033_docs_versions.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 033_docs_versions.sql");
    }

    // Check if docs_tags table exists (migration 034)
    const docsTagsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_tags'"
    ).get() as { count: number };
    if (docsTagsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "034_docs_tags.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 034_docs_tags.sql");
    }

    // Check if docs_page_links table exists (migration 035)
    const docsLinksCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_page_links'"
    ).get() as { count: number };
    if (docsLinksCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "035_docs_links.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 035_docs_links.sql");
    }

    // Check if docs_comments table exists (migration 036)
    const docsCommentsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_comments'"
    ).get() as { count: number };
    if (docsCommentsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "036_docs_comments.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 036_docs_comments.sql");
    }

    // Check if docs_page_projects table exists (migration 037)
    const docsProjCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_page_projects'"
    ).get() as { count: number };
    if (docsProjCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "037_docs_project_links.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 037_docs_project_links.sql");
    }

    // Check if docs_attachments table exists (migration 038)
    const docsAttachCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_attachments'"
    ).get() as { count: number };
    if (docsAttachCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "038_docs_attachments.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 038_docs_attachments.sql");
    }

    // Check if docs_templates table exists (migration 039)
    const docsTemplatesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='docs_templates'"
    ).get() as { count: number };
    if (docsTemplatesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "039_docs_templates.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 039_docs_templates.sql");
    }

    // Migration 040: Add title column to docs_page_drafts.
    // Guards against existing databases that created the drafts table without a title
    // column (pre-040 schema). Detects by probing for the column rather than checking
    // a migration version number.
    const draftTitle040 = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('docs_page_drafts') WHERE name = 'title'"
    ).get() as { count: number };
    if (draftTitle040.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "040_docs_integrity.sql"), "utf-8");
      db.pragma("foreign_keys = OFF");
      db.exec(sql);
      db.pragma("foreign_keys = ON");
      logger.info("db", "Applied migration 040_docs_integrity.sql");
    }

    // Migration 041: Add maintenance_locks table + skills_fts integrity verification.
    // Detects by probing for the maintenance_locks table existence.
    const maintLockCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='maintenance_locks'"
    ).get() as { count: number };
    if (maintLockCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "041_skill_maintenance_locks.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 041_skill_maintenance_locks.sql");
      verifyAndRebuildSkillsFts(db);
    }

    // Migration 042: Add revision + archived_at to skills, create immutable skill_versions table.
    // 🔴 FULL INTEGRITY PROBE: Must verify ALL required components:
    //    - skills.revision and skills.archived_at columns
    //    - skill_versions table
    //    - skill_versions_after_insert / skill_versions_after_update triggers
    //    - skill_versions_before_update / skill_versions_before_delete triggers (immutability)
    //    - idx_skill_versions_skill_rev index
    // Any partial state must fail with an actionable error message.
    const revCol = db.prepare("SELECT count(*) as c FROM pragma_table_info('skills') WHERE name='revision'").get() as { c: number };
    const arcCol = db.prepare("SELECT count(*) as c FROM pragma_table_info('skills') WHERE name='archived_at'").get() as { c: number };
    const hasRev = revCol.c > 0;
    const hasArc = arcCol.c > 0;
    const hasVerTable = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='skill_versions'").get() as { c: number }).c > 0;
    const hasAfterIns = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='trigger' AND name='skill_versions_after_insert'").get() as { c: number }).c > 0;
    const hasAfterUpd = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='trigger' AND name='skill_versions_after_update'").get() as { c: number }).c > 0;
    const hasBefUpd = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='trigger' AND name='skill_versions_before_update'").get() as { c: number }).c > 0;
    const hasBefDel = (db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='trigger' AND name='skill_versions_before_delete'").get() as { c: number }).c > 0;

    const any042 = hasRev || hasArc || hasVerTable || hasAfterIns || hasAfterUpd || hasBefUpd || hasBefDel;
    const all042 = hasRev && hasArc && hasVerTable && hasAfterIns && hasAfterUpd && hasBefUpd && hasBefDel;

    if (any042 && !all042) {
      const missing: string[] = [];
      if (!hasRev) missing.push("skills.revision column");
      if (!hasArc) missing.push("skills.archived_at column");
      if (!hasVerTable) missing.push("skill_versions table");
      if (!hasAfterIns) missing.push("skill_versions_after_insert trigger");
      if (!hasAfterUpd) missing.push("skill_versions_after_update trigger");
      if (!hasBefUpd) missing.push("skill_versions_before_update trigger");
      if (!hasBefDel) missing.push("skill_versions_before_delete trigger");
      throw new Error(
        "Migration 042 is in a PARTIAL state. Some components exist but others are missing: " +
        missing.join(", ") + ". " +
        "This means the migration was interrupted. Run migration 042_skill_versions.sql manually to complete it, " +
        "or drop the revision column and re-run the migration.",
      );
    }

    if (!all042) {
      const sql = readFileSync(resolve(migrationsDir, "042_skill_versions.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 042_skill_versions.sql");
    }

    // Migration 043: Create skill_lineage table. Safe index repair allowed.
    const lineageCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='skill_lineage'"
    ).get() as { count: number };
    if (lineageCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "043_skill_lineage.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 043_skill_lineage.sql");
    } else {
      const lineageIdxCheck = db.prepare(
        "SELECT count(*) as count FROM sqlite_master WHERE type='index' AND name='idx_skill_lineage_target'"
      ).get() as { count: number };
      if (lineageIdxCheck.count === 0) {
        logger.warn("db", "skill_lineage table exists but idx_skill_lineage_target index missing — re-running migration 043 to repair");
        const sql = readFileSync(resolve(migrationsDir, "043_skill_lineage.sql"), "utf-8");
        db.exec(sql);
      }
    }

    // Migration 044: Create skill_proposals table.
    // 🔴 PARTIAL-STATE PROBE: If table exists but required lifecycle columns are missing,
    // fail with an actionable error — NEVER re-run CREATE TABLE IF NOT EXISTS which cannot add columns.
    const proposalsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='skill_proposals'"
    ).get() as { count: number };
    if (proposalsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "044_skill_proposals.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 044_skill_proposals.sql");
    } else {
      // Probe for all required lifecycle columns
      const requiredCols = [
        "target_revision_before", "source_revision_before", "target_created",
        "expected_source_revision", "updated_at",
      ];
      const missingCols: string[] = [];
      for (const col of requiredCols) {
        const c = db.prepare("SELECT count(*) as c FROM pragma_table_info('skill_proposals') WHERE name = ?").get(col) as { c: number };
        if (c.c === 0) missingCols.push(col);
      }
      if (missingCols.length > 0) {
        throw new Error(
          "Migration 044 is in a PARTIAL state. The skill_proposals table exists but is missing required columns: " +
          missingCols.join(", ") + ". " +
          "CREATE TABLE IF NOT EXISTS cannot add columns to an existing table. " +
          "To repair: either drop the skill_proposals table and re-run migration 044, " +
          "or manually ALTER TABLE ADD COLUMN for each missing column.",
        );
      }
      // Check for required indexes
      const idxCheck = db.prepare(
        "SELECT count(*) as c FROM sqlite_master WHERE type='index' AND name='idx_skill_proposals_candidate_uniq'"
      ).get() as { c: number };
      if (idxCheck.c === 0) {
        throw new Error(
          "Migration 044 is in a PARTIAL state: skill_proposals table exists but idx_skill_proposals_candidate_uniq index is missing. " +
          "Run migration 044_skill_proposals.sql manually to recreate the index.",
        );
      }
    }

    // Migration 045: Add skill_created, skill_updated, and proposal event types to pipeline_events CHECK constraint.
    const pipeline045Check = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='pipeline_events'"
    ).get() as { count: number };
    if (pipeline045Check.count > 0) {
      // Probe: try inserting a test row with skill_created type.
      // If the CHECK constraint rejects it, the migration has not been applied.
      try {
        db.prepare(
          "INSERT INTO pipeline_events (project_id, event_type, event_source, title, created_at) VALUES ('__migration_probe__', 'skill_created', 'synthesis', 'probe', ?)"
        ).run(new Date().toISOString());
        db.prepare("DELETE FROM pipeline_events WHERE project_id='__migration_probe__'").run();
      } catch {
        // skill_created is rejected by the old CHECK constraint — apply migration
        const sql = readFileSync(resolve(migrationsDir, "045_pipeline_event_types.sql"), "utf-8");
        db.exec(sql);
        logger.info("db", "Applied migration 045_pipeline_event_types.sql");
      }
    }
  }
}

/**
 * Verify the skills_fts virtual table and all three migration-024 triggers exist,
 * then rebuild the FTS index. If any component is missing, throws an actionable
 * error rather than silently falling back to removed manual FTS writes.
 *
 * This is called after migration 041 is applied (both fresh-DB and upgrade paths).
 */
export function verifyAndRebuildSkillsFts(db: Database.Database): void {
  // Verify virtual table exists
  const ftsTable = db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='skills_fts'",
  ).get() as { count: number };
  if (ftsTable.count === 0) {
    throw new Error(
      "skills_fts virtual table is missing after migration 041. " +
      "The FTS5 triggers (migration 024) cannot function without this table. " +
      "Run migration 024_skills_unique_per_project.sql to recreate the FTS infrastructure.",
    );
  }

  // Verify all three triggers exist
  const triggers = ["skills_fts_insert", "skills_fts_delete", "skills_fts_update"];
  for (const trig of triggers) {
    const found = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='trigger' AND name = ?",
    ).get(trig) as { count: number };
    if (found.count === 0) {
      throw new Error(
        `FTS5 trigger '${trig}' is missing after migration 041. ` +
        "The skills table requires all three AFTER INSERT/UPDATE/DELETE triggers " +
        "(defined in migration 024) for correct FTS synchronization. " +
        "Run migration 024_skills_unique_per_project.sql to recreate them.",
      );
    }
  }

  // All infrastructure present — rebuild FTS index
  db.prepare("INSERT INTO skills_fts(skills_fts) VALUES('rebuild')").run();
  logger.info("db", "skills_fts index rebuilt after migration 041 verification");
}

/**
 * Execute `fn` inside a SQLite transaction with automatic retry on contention.
 *
 * Retries only on SQLITE_BUSY (another connection holds a lock) and
 * SQLITE_LOCKED (internal SQLite deadlock within the same connection).
 * Other errors (SQLITE_CONSTRAINT, SQLITE_CORRUPT, etc.) are thrown immediately.
 *
 * 🔴 WAL SAFETY: `checkpointAfterWrite()` must NEVER be called inside `fn`.
 * Calling a WAL checkpoint inside an active transaction causes SQLITE_LOCKED
 * because the checkpoint tries to read-lock the WAL while the transaction's
 * write-lock is still held. Always call `checkpointAfterWrite()` *after*
 * `execTransaction()` returns.
 */
export function execTransaction<T>(fn: () => T, retries = WRITE_MAX_RETRIES): T {
  if (!db) {
    db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = db!.transaction(fn)();
      return result;
    } catch (err) {
      if (
        attempt < retries - 1 &&
        err instanceof Error &&
        (err.message.includes("SQLITE_BUSY") || err.message.includes("SQLITE_LOCKED"))
      ) {
        const delay = WRITE_RETRY_MIN_MS + Math.random() * (WRITE_RETRY_MAX_MS - WRITE_RETRY_MIN_MS);
        logger.warn("db", "DB contention, retrying", { attempt, delay });
        sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Transaction failed after max retries");
}

/**
 * Busy-wait sleep using Atomics.wait (not setTimeout) to avoid event-loop starvation.
 *
 * In the retry-hot path of `execTransaction`, we want to block the calling
 * thread/promise without yielding to the event loop — setTimeout would defer
 * the retry to a future microtask tick, potentially allowing other concurrent
 * transactions to queue up. Atomics.wait blocks natively on the main thread
 * (Node.js worker threads) or synchronously in a single-threaded context.
 *
 * SharedArrayBuffer is required by the Atomics API; the actual buffer content
 * is irrelevant since we never write to it — we only wait on the initial value.
 */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Sanitize user input for FTS5 literal matching.
 *
 * Escapes double-quotes (FTS5 convention: double them), then wraps the
 * entire query in double-quotes so the FTS5 parser treats it as a literal
 * phrase rather than interpreting operators like *, ^, (, ), -, +, AND, OR,
 * NOT, NEAR.
 *
 * NOTE: This is an injection-prevention measure. Without wrapping, a user
 * could inject FTS5 syntax (e.g., `foo OR bar`) that changes query semantics.
 * The double-quote wrapping forces the entire input to be treated as a single
 * literal term that must match verbatim.
 *
 * FIXME: Only `"` is escaped. `'` is safe in FTS5 (it has no special meaning),
 * but if the input contains non-ASCII whitespace or control characters, the
 * FTS5 tokenizer may behave unexpectedly. A future improvement could strip
 * non-printable characters as well.
 */
export function sanitizeFts5Query(input: string): string {
  if (!input || input.trim().length === 0) return "";
  const escaped = input.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Conditionally issue a PASSIVE WAL checkpoint after every 50th write.
 *
 * 🔴 MUST be called OUTSIDE `execTransaction()` — see WAL SAFETY warning on execTransaction.
 * Calling checkpoint inside a transaction causes SQLITE_LOCKED.
 *
 * The 50-write threshold is a heuristic:
 * - Too frequent (<10 writes): checkpoint overhead dominates write latency.
 * - Too infrequent (>200 writes): the WAL file grows large, degrading read
 *   performance and increasing crash-recovery time.
 * - 50 writes keeps the WAL file typically under ~1 MB in normal operation.
 *
 * PASSIVE mode is used (not FULL or RESTART) because it only checkpoints if
 * there are no concurrent readers — it never blocks active queries.
 */
let writeCount = 0;
export function checkpointAfterWrite(): void {
  writeCount++;
  if (writeCount >= 50) {
    db?.pragma("wal_checkpoint(PASSIVE)");
    writeCount = 0;
  }
}

/**
 * Reset the singleton database connection.
 * For test use only — closes the current connection and clears the singleton
 * so the next getDb() call creates a fresh connection to a new path.
 */
export function resetDbForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
  writeCount = 0;
}
