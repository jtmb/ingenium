import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

const WRITE_MAX_RETRIES = 15;
const WRITE_RETRY_MIN_MS = 20;
const WRITE_RETRY_MAX_MS = 150;

let db: Database.Database | null = null;

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

function runMigrations(db: Database.Database): void {
  const migrationsDir = resolve(import.meta.dirname ?? __dirname, "../data/migrations");

  // Check if we need to initialize the schema
  const tableCount = db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type='table'",
  ).get() as { count: number };

  if (tableCount.count === 0) {
    // Fresh DB — run all migrations in order
      for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql", "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql", "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql", "014_configs.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql", "018_extraction_pipeline_events.sql", "019_trait_exemplar_fk_setnull.sql", "020_kanban_board.sql", "021_jobs.sql", "022_email_cache.sql", "023_fix_servers_unique.sql", "024_skills_unique_per_project.sql", "025_email_string_ids.sql", "026_email_suggestions.sql", "027_email_summaries.sql", "028_email_suggestion_queue.sql", "029_docs_spaces.sql", "030_docs_pages.sql", "031_docs_pages_fts.sql", "032_docs_drafts.sql", "033_docs_versions.sql", "034_docs_tags.sql", "035_docs_links.sql", "036_docs_comments.sql", "037_docs_project_links.sql", "038_docs_attachments.sql", "039_docs_templates.sql"]) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
      db.exec(sql);
      logger.info("db", `Applied migration ${file}`);
    }
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

    // Check if observations source CHECK includes 'auto-observer' (migration 015)
    let observationsCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='observations'"
    ).get() as { sql: string } | undefined;
    if (observationsCreateSql && !observationsCreateSql.sql.includes("auto-observer")) {
      const sql = readFileSync(resolve(migrationsDir, "015_auto_observer_source.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 015_auto_observer_source.sql");
      // Re-read observations CREATE SQL — migration 015 just rebuilt the table
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

    // Check if personality_traits FK needs rebuilding (migration 017)
    // After migration 015 renamed/recreated observations, the FK in personality_traits
    // may reference a stale internal table reference. Detect by checking if the
    // personality_traits CREATE TABLE SQL includes the 017_rebuilt marker comment.
    const traitsSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits'"
    ).get() as { sql: string } | undefined;
    if (traitsSql && observationsCreateSql && observationsCreateSql.sql.includes("auto-observer") && !traitsSql.sql.includes("017_rebuilt")) {
      const sql = readFileSync(resolve(migrationsDir, "017_fix_trait_fk.sql"), "utf-8");
      // Disable FK enforcement during migration to avoid cascading FTS trigger errors
      db.pragma("foreign_keys = OFF");
      db.exec(sql);
      db.pragma("foreign_keys = ON");
      logger.info("db", "Applied migration 017_fix_trait_fk.sql");
    }

    // Check if pipeline_events CHECK constraint includes extraction event types (migration 018)
    const pipelineCreateSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pipeline_events'"
    ).get() as { sql: string } | undefined;
    if (pipelineCreateSql && !pipelineCreateSql.sql.includes("extraction_completed")) {
      const sql = readFileSync(resolve(migrationsDir, "018_extraction_pipeline_events.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 018_extraction_pipeline_events.sql");
    }

    // Check if personality_traits FK uses ON DELETE SET NULL (migration 019)
    // The default NO ACTION blocks observation deletes when traits reference them.
    // Detect by checking if the CREATE SQL includes the 019_fk_setnull marker.
    const traits019Sql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits'"
    ).get() as { sql: string } | undefined;
    if (traits019Sql && !traits019Sql.sql.includes("019_fk_setnull")) {
      const sql = readFileSync(resolve(migrationsDir, "019_trait_exemplar_fk_setnull.sql"), "utf-8");
      // Disable FK enforcement during migration to avoid cascading FTS trigger errors
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

    // Check if email_cache uid column needs TEXT rebuild (migration 025)
    // Detect by checking if the CREATE TABLE SQL includes the -- 025_rebuilt marker.
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
  }
}

export function execTransaction<T>(fn: () => T, retries = WRITE_MAX_RETRIES): T {
  // Ensure DB is initialized before transaction
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

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Sanitize user input for FTS5 literal matching.
 * Escapes double-quotes (FTS5 convention: double them), then wraps the
 * entire query in double-quotes so the FTS5 parser treats it as a literal
 * phrase rather than interpreting operators like *, ^, (, ), -, +, AND, OR,
 * NOT, NEAR.
 */
export function sanitizeFts5Query(input: string): string {
  if (!input || input.trim().length === 0) return "";
  // Escape double-quotes by doubling them per FTS5 spec
  const escaped = input.replace(/"/g, '""');
  // Wrap in double-quotes for literal matching
  return `"${escaped}"`;
}

// WAL checkpoint every 50 writes
let writeCount = 0;
export function checkpointAfterWrite(): void {
  writeCount++;
  if (writeCount >= 50) {
    db?.pragma("wal_checkpoint(PASSIVE)");
    writeCount = 0;
  }
}
