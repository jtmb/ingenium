import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

/**
 * The database file used by deployed Ingenium instances. Do not change this
 * default to a `.db` sibling: existing containers persist this exact path in
 * the `/app/.ingenium` volume.
 */
export const DEPLOYED_CORE_DB_PATH = "/app/.ingenium/data";

const LEGACY_DEFAULT_DB_PATHS = new Set([
  "./data",
  "./.ingenium/data.db",
  "/app/.ingenium/data.db",
]);

/**
 * Resolve the single database path used by production code.
 *
 * Callers may still supply an explicit path for isolated tests. Historical
 * production fallback spellings are normalized here rather than being allowed
 * to create a second database beside the deployed `/app/.ingenium/data` file.
 * This resolver never moves, creates, or rewrites an existing database.
 */
export function resolveCoreDbPath(requestedPath?: string): string {
  const requested = requestedPath?.trim();
  if (requested && !LEGACY_DEFAULT_DB_PATHS.has(requested)) {
    return resolve(requested);
  }

  const configured = process.env.INGENIUM_CORE_DB_PATH?.trim();
  if (configured && !LEGACY_DEFAULT_DB_PATHS.has(configured)) return resolve(configured);

  const configuredHome = process.env.INGENIUM_HOME?.trim();
  if (configuredHome) return resolve(configuredHome, "data");

  // A container normally has /app as its working directory before the volume
  // exists, so check both the data file and its mounted parent.
  if (
    existsSync(DEPLOYED_CORE_DB_PATH) ||
    existsSync(dirname(DEPLOYED_CORE_DB_PATH)) ||
    resolve(process.cwd()) === "/app"
  ) {
    return DEPLOYED_CORE_DB_PATH;
  }

  return resolve(process.cwd(), ".ingenium", "data");
}

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
 * Migration 058 owns the connection-independent reserved-broker trigger set.
 * Re-applying it at startup repairs partial historical migrations and backfills
 * the complete immutable canonical template before normal application use.
 */
function enforceReservedBrokerInvariant(db: Database.Database): void {
  const agentsTable = db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'agents'",
  ).get() as { count: number };
  if (agentsTable.count === 0) return;

  const metadataColumn = db.prepare(
    "SELECT count(*) as count FROM pragma_table_info('agents') WHERE name = 'metadata'",
  ).get() as { count: number };
  if (metadataColumn.count === 0) return;

  const migrationsDir = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
  db.exec(readFileSync(resolve(migrationsDir, "058_reserved_broker_connection_independent.sql"), "utf-8"));
}

interface ContextConversationMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface ContextCheckpointGovernanceMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

function hasContextConversationColumns(
  db: Database.Database,
  table: string,
  requiredColumns: string[],
): boolean {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>;
  return requiredColumns.every((column) => columns.some((candidate) => candidate.name === column));
}

function hasCompositeForeignKey(
  db: Database.Database,
  table: string,
  referencedTable: string,
  fromColumns: string[],
): boolean {
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list('${table}')`).all() as Array<{
    id: number;
    seq: number;
    table: string;
    from: string;
  }>;
  const groups = new Map<number, Array<{ seq: number; table: string; from: string }>>();
  for (const foreignKey of foreignKeys) {
    const group = groups.get(foreignKey.id) ?? [];
    group.push(foreignKey);
    groups.set(foreignKey.id, group);
  }
  return [...groups.values()].some((group) => (
    group.length === fromColumns.length
    && group.every((foreignKey) => foreignKey.table === referencedTable
      && fromColumns[foreignKey.seq] === foreignKey.from)
  ));
}

/** Probe every invariant introduced by migration 063 before treating it as applied. */
function inspectContextConversationMigration(db: Database.Database): ContextConversationMigrationState {
  const requiredTables: Record<string, string[]> = {
    context_conversations: ["id", "project_id", "title", "request_hash", "idempotency_key", "tags", "priority", "metadata", "created_at"],
    context_messages: ["id", "project_id", "conversation_id", "sequence", "role", "content", "content_hash", "request_hash", "idempotency_key", "tags", "priority", "metadata", "created_at"],
    context_checkpoints: ["id", "project_id", "conversation_id", "sequence", "through_message_id", "message_count", "state_hash", "request_hash", "idempotency_key", "metadata", "created_at"],
    context_checkpoint_rag_sources: ["project_id", "checkpoint_id", "rag_source_id", "ordinal", "metadata", "created_at"],
  };
  const requiredTableSqlFragments: Record<string, string[]> = {
    context_conversations: [
      "length(title) BETWEEN 1 AND 256",
      "length(request_hash) = 64",
      "json_type(tags) = 'array'",
      "length(CAST(tags AS BLOB)) <= 4096",
      "priority BETWEEN 0 AND 10",
      "json_type(metadata) = 'object'",
      "length(CAST(metadata AS BLOB)) <= 16384",
      "FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT",
    ],
    context_messages: [
      "CHECK(sequence >= 0)",
      "role IN ('system', 'user', 'assistant', 'tool')",
      "length(content) BETWEEN 1 AND 262144",
      "length(content_hash) = 64",
      "length(request_hash) = 64",
      "UNIQUE(project_id, conversation_id, sequence)",
    ],
    context_checkpoints: [
      "CHECK(sequence >= 0)",
      "CHECK(message_count >= 1)",
      "length(state_hash) = 64",
      "length(request_hash) = 64",
      "UNIQUE(project_id, conversation_id, sequence)",
    ],
    context_checkpoint_rag_sources: [
      "CHECK(ordinal >= 0)",
      "UNIQUE(project_id, checkpoint_id, ordinal)",
    ],
  };
  const requiredIndexes = [
    "idx_rag_sources_project_id",
    "idx_context_conversations_project_created",
    "idx_context_messages_conversation_sequence",
    "idx_context_checkpoints_conversation_sequence",
    "idx_context_checkpoint_rag_sources_source",
  ];
  const requiredTriggers = [
    "context_conversations_immutable_update",
    "context_conversations_immutable_delete",
    "context_messages_immutable_update",
    "context_messages_immutable_delete",
    "context_messages_fts_insert",
    "context_checkpoints_immutable_update",
    "context_checkpoints_immutable_delete",
    "context_checkpoint_rag_sources_immutable_update",
    "context_checkpoint_rag_sources_immutable_delete",
  ];
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(requiredTables)) {
    const tableExists = (db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= tableExists;
    if (!tableExists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql: string } | undefined;
    if (!tableSql || !requiredTableSqlFragments[table]!.every((fragment) => tableSql.sql.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
  }

  const contextMessagesFts = (db.prepare(
    "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'context_messages_fts'",
  ).get() as { count: number }).count > 0;
  any ||= contextMessagesFts;
  if (!contextMessagesFts) missing.push("context_messages_fts table");

  for (const index of requiredIndexes) {
    const exists = (db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }

  for (const trigger of requiredTriggers) {
    const exists = (db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }

  const requiredForeignKeys: Array<[string, string, string[]]> = [
    ["context_messages", "context_conversations", ["project_id", "conversation_id"]],
    ["context_checkpoints", "context_conversations", ["project_id", "conversation_id"]],
    ["context_checkpoints", "context_messages", ["project_id", "conversation_id", "through_message_id"]],
    ["context_checkpoint_rag_sources", "context_checkpoints", ["project_id", "checkpoint_id"]],
    ["context_checkpoint_rag_sources", "rag_sources", ["project_id", "rag_source_id"]],
  ];
  for (const [table, referencedTable, fromColumns] of requiredForeignKeys) {
    if (hasCompositeForeignKey(db, table, referencedTable, fromColumns)) continue;
    missing.push(`${table} → ${referencedTable} composite foreign key`);
  }

  return { any, complete: missing.length === 0, missing };
}

/** Probe the CTX-004 authorization and append-only audit safeguards as a unit. */
function inspectContextCheckpointGovernanceMigration(db: Database.Database): ContextCheckpointGovernanceMigrationState {
  const requiredTables: Record<string, string[]> = {
    context_checkpoint_maintenance_authorizations: [
      "id", "project_id", "operation", "conversation_id", "checkpoint_id", "expected_revision",
      "confirmation_hash", "expires_at", "consumed_at", "created_at",
    ],
    context_checkpoint_audit_events: [
      "id", "project_id", "event_type", "conversation_id", "checkpoint_id", "target_conversation_id",
      "expected_revision", "checkpoint_state_hash", "authorization_id", "archive_sequence", "created_at",
    ],
  };
  const requiredIndexes = [
    "idx_context_checkpoint_maintenance_authorizations_target",
    "idx_context_checkpoint_audit_events_project_created",
    "idx_context_checkpoint_audit_events_restore_branches",
  ];
  const requiredTriggers = [
    "context_checkpoint_audit_events_immutable_update",
    "context_checkpoint_audit_events_immutable_delete",
  ];
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(requiredTables)) {
    const tableExists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= tableExists;
    if (!tableExists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
  }

  for (const index of requiredIndexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of requiredTriggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }

  const requiredForeignKeys: Array<[string, string, string[]]> = [
    ["context_checkpoint_maintenance_authorizations", "context_conversations", ["project_id", "conversation_id"]],
    ["context_checkpoint_maintenance_authorizations", "context_checkpoints", ["project_id", "checkpoint_id"]],
    ["context_checkpoint_audit_events", "context_conversations", ["project_id", "conversation_id"]],
    ["context_checkpoint_audit_events", "context_conversations", ["project_id", "target_conversation_id"]],
    ["context_checkpoint_audit_events", "context_checkpoints", ["project_id", "checkpoint_id"]],
    ["context_checkpoint_audit_events", "context_checkpoint_maintenance_authorizations", ["project_id", "authorization_id"]],
  ];
  for (const [table, referencedTable, fromColumns] of requiredForeignKeys) {
    if (hasCompositeForeignKey(db, table, referencedTable, fromColumns)) continue;
    missing.push(`${table} → ${referencedTable} composite foreign key`);
  }

  return { any, complete: missing.length === 0, missing };
}

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
export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedDbPath = resolveCoreDbPath(dbPath);

  const dir = dirname(resolvedDbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedDbPath);
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
        for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql", "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql", "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql", "014_configs.sql", "015_auto_observer_source.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql", "018_extraction_pipeline_events.sql", "019_trait_exemplar_fk_setnull.sql", "020_kanban_board.sql", "021_jobs.sql", "022_email_cache.sql", "023_fix_servers_unique.sql", "024_skills_unique_per_project.sql", "025_email_string_ids.sql", "026_email_suggestions.sql", "027_email_summaries.sql", "028_email_suggestion_queue.sql", "029_docs_spaces.sql", "030_docs_pages.sql", "031_docs_pages_fts.sql", "032_docs_drafts.sql", "033_docs_versions.sql", "034_docs_tags.sql", "035_docs_links.sql", "036_docs_comments.sql", "037_docs_project_links.sql", "038_docs_attachments.sql", "039_docs_templates.sql", "040_docs_integrity.sql", "041_skill_maintenance_locks.sql", "042_skill_versions.sql", "043_skill_lineage.sql", "044_skill_proposals.sql", "045_pipeline_event_types.sql", "046_vault.sql", "047_backups.sql", "048_docs_rag.sql", "049_workspace_project_migration.sql", "050_context_rag_phase3.sql", "051_thread_retirement.sql", "052_agent_category_integrity.sql", "053_global_project_integrity_and_protected_settings.sql", "054_agent_frontmatter_metadata.sql", "055_reserved_broker_delete_protection.sql", "056_reserved_broker_rename_protection.sql", "057_reserved_broker_immutable.sql", "058_reserved_broker_connection_independent.sql", "059_repository_docs_onboarding.sql", "060_repository_resource_sync.sql", "061_global_backup_ownership.sql", "062_child_mcp_definitions.sql", "063_immutable_context_conversations.sql", "064_child_mcp_tool_categories.sql", "065_context_rag_ingestion.sql", "066_context_checkpoint_governance.sql"]) {
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

    // Migration 046: Add vault_config table for encrypted credential storage.
    const vaultConfigCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='vault_config'"
    ).get() as { count: number };
    if (vaultConfigCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "046_vault.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 046_vault.sql");
    }

    // Migration 047: Create backup inventory and restore job tables.
    const backupRecordsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='backup_records'",
    ).get() as { count: number };
    if (backupRecordsCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "047_backups.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 047_backups.sql");
    }

    // Migration 048: Create RAG ingestion, chunking, FTS, and embedding tables.
    const ragSourcesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='rag_sources'",
    ).get() as { count: number };
    if (ragSourcesCheck.count === 0) {
      const sql = readFileSync(resolve(migrationsDir, "048_docs_rag.sql"), "utf-8");
      db.exec(sql);
      logger.info("db", "Applied migration 048_docs_rag.sql");
    }
    const workspaceMigrationCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='project_migration_manifests'").get() as { count: number };
    if (workspaceMigrationCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "049_workspace_project_migration.sql"), "utf-8"));
      logger.info("db", "Applied migration 049_workspace_project_migration.sql");
    }
    const contextSourceCheck = db.prepare("SELECT count(*) as count FROM pragma_table_info('context_entries') WHERE name='source'").get() as { count: number };
    if (contextSourceCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "050_context_rag_phase3.sql"), "utf-8"));
      logger.info("db", "Applied migration 050_context_rag_phase3.sql");
    }

    // Migration 051: retire the empty Thread import checkpoint and rebuild the
    // source-type CHECK constraint. The preflight happens before any schema
    // mutation, so an unexpected legacy payload remains intact for recovery.
    const ragSourcesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rag_sources'").get() as { sql: string } | undefined;
    const threadImportsCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='rag_thread_imports'").get() as { count: number };
    if (ragSourcesSql?.sql.includes("thread_import") || threadImportsCheck.count > 0) {
      const threadSourceCount = (db.prepare("SELECT count(*) as count FROM rag_sources WHERE source_type = 'thread_import'").get() as { count: number }).count;
      const threadImportCount = threadImportsCheck.count > 0
        ? (db.prepare("SELECT count(*) as count FROM rag_thread_imports").get() as { count: number }).count
        : 0;
      if (threadSourceCount > 0 || threadImportCount > 0) {
        throw new Error("Migration 051_thread_retirement requires verified-zero Thread data; restore or migrate legacy RAG rows before retrying.");
      }
      db.pragma("foreign_keys = OFF");
      try {
        db.exec(readFileSync(resolve(migrationsDir, "051_thread_retirement.sql"), "utf-8"));
      } finally {
        db.pragma("foreign_keys = ON");
      }
      logger.info("db", "Applied migration 051_thread_retirement.sql");
    }

    // Migration 052: normalize historical category values and enforce the
    // canonical agent-category allowlist at the database boundary.
    const agentsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'").get() as { sql: string } | undefined;
    if (agentsSql && !agentsSql.sql.includes("'chat'")) {
      db.pragma("foreign_keys = OFF");
      try {
        db.exec(readFileSync(resolve(migrationsDir, "052_agent_category_integrity.sql"), "utf-8"));
      } finally {
        db.pragma("foreign_keys = ON");
      }
      logger.info("db", "Applied migration 052_agent_category_integrity.sql");
    }

    // Migration 053: enforce one active global project and map OAuth application
    // secrets to encrypted vault items. Older databases could have duplicate
    // global rows; only the explicitly canonical global-default row is safe to
    // reconcile automatically. Any other duplicate set must be resolved by an
    // operator before the uniqueness constraint is installed.
    const globalIndexCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='index' AND name='idx_projects_one_active_global'",
    ).get() as { count: number };
    const protectedSettingsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='protected_settings'",
    ).get() as { count: number };
    if (globalIndexCheck.count === 0 || protectedSettingsCheck.count === 0) {
      if (globalIndexCheck.count === 0) reconcileDuplicateActiveGlobals(db);
      db.exec(readFileSync(resolve(migrationsDir, "053_global_project_integrity_and_protected_settings.sql"), "utf-8"));
      logger.info("db", "Applied migration 053_global_project_integrity_and_protected_settings.sql");
    }

    if (protectedSettingsCheck.count > 0) {
      const requiredColumns = ["project_id", "key", "vault_item_id", "created_at", "updated_at"];
      const missingColumns = requiredColumns.filter((column) => {
        const found = db.prepare("SELECT count(*) as count FROM pragma_table_info('protected_settings') WHERE name = ?")
          .get(column) as { count: number };
        return found.count === 0;
      });
      if (missingColumns.length > 0) {
        throw new Error(`Migration 053 is in a PARTIAL state: protected_settings is missing required columns: ${missingColumns.join(", ")}`);
      }
    }

    // Migration 054: retain non-runtime agent frontmatter metadata (currently
    // `hidden`) independently of the markdown file. The file can legitimately
    // disappear while an agent is disabled, so it cannot be the source of truth.
    const agentMetadataCheck = db.prepare(
      "SELECT count(*) as count FROM pragma_table_info('agents') WHERE name = 'metadata'",
    ).get() as { count: number };
    if (agentMetadataCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "054_agent_frontmatter_metadata.sql"), "utf-8"));
      logger.info("db", "Applied migration 054_agent_frontmatter_metadata.sql");
    }

    // Migration 055: direct SQL must not be able to remove the reserved broker
    // while its project is still present. Keep the check trigger-based so it
    // also protects maintenance scripts that bypass the API layer.
    const brokerDeleteTriggerCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'trigger' AND name = 'agents_broker_delete_protection'",
    ).get() as { count: number };
    if (brokerDeleteTriggerCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "055_reserved_broker_delete_protection.sql"), "utf-8"));
      logger.info("db", "Applied migration 055_reserved_broker_delete_protection.sql");
    }

    // Migration 056: a direct rename would evade the name-scoped invariant
    // trigger from 054, so reject it before a reserved broker row can change.
    const brokerRenameTriggerCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'trigger' AND name = 'agents_broker_rename_protection'",
    ).get() as { count: number };
    if (brokerRenameTriggerCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "056_reserved_broker_rename_protection.sql"), "utf-8"));
      logger.info("db", "Applied migration 056_reserved_broker_rename_protection.sql");
    }

    // Migration 058 replaces the recursive-trigger-dependent 057 protection
    // with BEFORE INSERT/UPDATE collision and template guards that also hold
    // for raw connections configured with recursive_triggers = 0.
    const brokerConnectionIndependentTriggerCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'trigger' AND name = 'agents_broker_insert_template_protection'",
    ).get() as { count: number };
    if (brokerConnectionIndependentTriggerCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "058_reserved_broker_connection_independent.sql"), "utf-8"));
      logger.info("db", "Applied migration 058_reserved_broker_connection_independent.sql");
    }

    // Migration 059: repository-authoritative docs manifest identity. The table
    // retains an archived page's source path/hash after its RAG source is
    // removed, so a later reappearance can restore the same Docs page.
    const repositoryDocsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'docs_repository_pages'",
    ).get() as { count: number };
    if (repositoryDocsCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "059_repository_docs_onboarding.sql"), "utf-8"));
      logger.info("db", "Applied migration 059_repository_docs_onboarding.sql");
    }

    const repositoryResourcesCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'repository_sync_resources'",
    ).get() as { count: number };
    if (repositoryResourcesCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "060_repository_resource_sync.sql"), "utf-8"));
      logger.info("db", "Applied migration 060_repository_resource_sync.sql");
    }

    // Migration 061: move legacy per-project backup metadata to the active
    // global project. Startup retries the same idempotent backfill after the
    // global project is ensured, covering first-start databases with no global
    // row at migration time.
    const backupOwnershipMigrationCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'backup_ownership_migrations'",
    ).get() as { count: number };
    if (backupOwnershipMigrationCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "061_global_backup_ownership.sql"), "utf-8"));
      logger.info("db", "Applied migration 061_global_backup_ownership.sql");
    }

    // Migration 062: persist shell-free child MCP definitions and their bounded
    // discovery metadata. The legacy `servers` table remains untouched because
    // it also records the built-in launcher projection.
    const childMcpDefinitionsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'mcp_child_server_definitions'",
    ).get() as { count: number };
    if (childMcpDefinitionsCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "062_child_mcp_definitions.sql"), "utf-8"));
      logger.info("db", "Applied migration 062_child_mcp_definitions.sql");
    }

    // Migration 063: immutable conversation/checkpoint/message records are
    // intentionally separate from mutable context_entries. A partial schema is
    // unsafe: missing immutable triggers or scoped foreign keys would allow an
    // irreversible integrity breach, so fail loudly instead of guessing a repair.
    const contextConversationMigration = inspectContextConversationMigration(db);
    if (contextConversationMigration.any && !contextConversationMigration.complete) {
      throw new Error(
        "Migration 063 is in a PARTIAL state. Missing required components: "
        + contextConversationMigration.missing.join(", ")
        + ". Restore the migration's complete schema before retrying.",
      );
    }
    if (!contextConversationMigration.complete) {
      db.exec(readFileSync(resolve(migrationsDir, "063_immutable_context_conversations.sql"), "utf-8"));
      logger.info("db", "Applied migration 063_immutable_context_conversations.sql");
    }

    // Migration 064 upgrades the generic child-tool category CHECK constraint.
    // Existing discovery rows retain their owner and are projected to
    // `Child MCP / <server>` atomically by the rebuilding migration.
    const childMcpToolCategoryCheck = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mcp_child_discovered_tools'",
    ).get() as { sql?: string } | undefined;
    if (!childMcpToolCategoryCheck?.sql?.includes("Child MCP /")) {
      db.exec(readFileSync(resolve(migrationsDir, "064_child_mcp_tool_categories.sql"), "utf-8"));
      logger.info("db", "Applied migration 064_child_mcp_tool_categories.sql");
    }

    // Migration 065: bounded context uploads are staged separately from the
    // public RAG corpus and become immutable when checkpointed.
    const contextRagUploadsCheck = db.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'context_rag_uploads'",
    ).get() as { count: number };
    if (contextRagUploadsCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "065_context_rag_ingestion.sql"), "utf-8"));
      logger.info("db", "Applied migration 065_context_rag_ingestion.sql");
    }

    // Migration 066: archive intent and restore authorization form one safety
    // boundary. A partial schema could permit unaudited maintenance, so fail
    // closed instead of attempting an incomplete repair.
    const contextCheckpointGovernanceMigration = inspectContextCheckpointGovernanceMigration(db);
    if (contextCheckpointGovernanceMigration.any && !contextCheckpointGovernanceMigration.complete) {
      throw new Error(
        "Migration 066 is in a PARTIAL state. Missing required components: "
        + contextCheckpointGovernanceMigration.missing.join(", ")
        + ". Restore the migration's complete schema before retrying.",
      );
    }
    if (!contextCheckpointGovernanceMigration.complete) {
      db.exec(readFileSync(resolve(migrationsDir, "066_context_checkpoint_governance.sql"), "utf-8"));
      logger.info("db", "Applied migration 066_context_checkpoint_governance.sql");
    }
  }

  enforceReservedBrokerInvariant(db);
}

function reconcileDuplicateActiveGlobals(db: Database.Database): void {
  const activeGlobals = db.prepare(
    "SELECT id, name FROM projects WHERE is_global = 1 AND archived_at IS NULL ORDER BY name, created_at, id",
  ).all() as Array<{ id: string; name: string }>;
  if (activeGlobals.length <= 1) return;

  const canonical = activeGlobals.filter((project) => project.name === "global-default");
  if (canonical.length !== 1) {
    throw new Error(
      "Migration 053 refused: multiple active global projects exist without an unambiguous global-default canonical project. Resolve the duplicate global designation before retrying.",
    );
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "UPDATE projects SET is_global = 0, updated_at = ? WHERE is_global = 1 AND archived_at IS NULL AND id <> ?",
    ).run(now, canonical[0]!.id);
  })();
  logger.warn("db", "Reconciled duplicate active global projects using global-default as canonical", {
    demotedCount: activeGlobals.length - 1,
  });
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
    db = getDb();
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
