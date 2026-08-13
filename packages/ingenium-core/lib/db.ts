import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";
import {
  SKILL_PROPOSAL_RETENTION_DELETE_ERROR,
  SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER,
  SKILL_PROPOSAL_RETENTION_INDEX,
} from "./schema.js";

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

interface ContextSnapshotImportMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface ContextRagSessionMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface TaskSourceReferencesMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface TaskCoordinationMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface CoordinationRegistryMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface TrustedJobEventsMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface JobEventDeliveriesMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface UsageAttentionMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface JobVaultReferencesMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface VaultJobRunsMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface JobVaultRevisionAuditMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface RestorePlansMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface RestoreExecutorMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface RestoreExecutorPhaseEventsMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface BackupDeletionReservationsMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface SynthesisBatchMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface SkillProposalRetentionPaginationMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface EmailWatcherMarkersMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface AuthenticationFoundationMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

interface ResourceTenancyMigrationState {
  any: boolean;
  complete: boolean;
  missing: string[];
}

type ContextRepairRow = Record<string, unknown> & { __repair_rowid?: number };

interface RepairedContextConversation {
  id: string;
  project_id: string;
  title: string;
  request_hash: string;
  idempotency_key: string | null;
  tags: string;
  priority: number;
  metadata: string;
  created_at: string;
}

interface RepairedContextMessage {
  id: string;
  project_id: string;
  conversation_id: string;
  sequence: number;
  role: string;
  content: string;
  content_hash: string;
  request_hash: string;
  idempotency_key: string | null;
  tags: string;
  priority: number;
  metadata: string;
  created_at: string;
}

interface RepairedContextCheckpoint {
  id: string;
  project_id: string;
  conversation_id: string;
  sequence: number;
  through_message_id: string;
  message_count: number;
  state_hash: string;
  request_hash: string;
  idempotency_key: string | null;
  metadata: string;
  created_at: string;
  repair_request_hash?: string;
}

interface RepairedContextCheckpointRagSource {
  project_id: string;
  checkpoint_id: string;
  rag_source_id: string;
  ordinal: number;
  metadata: string;
  created_at: string;
}

interface ContextMigrationRepairData {
  conversations: RepairedContextConversation[];
  messages: RepairedContextMessage[];
  checkpoints: RepairedContextCheckpoint[];
  checkpointRagSources: RepairedContextCheckpointRagSource[];
  sourceSchemaHash: string;
}

const CONTEXT_REPAIR_DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";
const CONTEXT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTEXT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

/** Probe CTX-005 as a unit so a partial source mapping never accepts imports. */
function inspectContextSnapshotImportMigration(db: Database.Database): ContextSnapshotImportMigrationState {
  const requiredTables: Record<string, string[]> = {
    context_conversation_sources: [
      "id", "project_id", "source_key", "source_session_id", "conversation_id", "snapshot_hash",
      "entry_count", "created_at", "updated_at",
    ],
    context_conversation_source_messages: [
      "project_id", "source_id", "conversation_id", "message_id", "sequence", "role", "content_hash",
      "source_fingerprint", "created_at",
    ],
  };
  const requiredIndexes = [
    "idx_context_conversation_sources_project_updated",
    "idx_context_conversation_source_messages_message",
  ];
  const requiredTableSqlFragments: Record<string, string[]> = {
    context_conversation_sources: [
      "length(source_key) BETWEEN 1 AND 256",
      "instr(source_key, '/') = 0",
      "instr(source_key, char(92)) = 0",
      "length(snapshot_hash) = 64",
      "CHECK(entry_count >= 1)",
      "UNIQUE(project_id, source_key)",
      "UNIQUE(project_id, conversation_id)",
    ],
    context_conversation_source_messages: [
      "CHECK(sequence >= 0)",
      "role IN ('user', 'assistant')",
      "length(content_hash) = 64",
      "length(source_fingerprint) = 64",
      "UNIQUE(project_id, source_id, source_fingerprint)",
    ],
  };
  const requiredTriggers = [
    "context_conversation_source_messages_immutable_update",
    "context_conversation_source_messages_immutable_delete",
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
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredTableSqlFragments[table]!.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
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
    ["context_conversation_sources", "context_conversations", ["project_id", "conversation_id"]],
    ["context_conversation_source_messages", "context_conversation_sources", ["project_id", "source_id"]],
    ["context_conversation_source_messages", "context_conversations", ["project_id", "conversation_id"]],
    ["context_conversation_source_messages", "context_messages", ["project_id", "conversation_id", "message_id"]],
  ];
  for (const [table, referencedTable, fromColumns] of requiredForeignKeys) {
    if (hasCompositeForeignKey(db, table, referencedTable, fromColumns)) continue;
    missing.push(`${table} → ${referencedTable} composite foreign key`);
  }
  return { any, complete: missing.length === 0, missing };
}

/** Probe CTX-100's session column and immutable RAG guards as one unit. */
function inspectContextRagSessionMigration(db: Database.Database): ContextRagSessionMigrationState {
  const requiredTriggers = [
    "rag_sources_context_upload_immutable_update",
    "rag_sources_context_upload_immutable_delete",
    "rag_chunks_context_upload_immutable_insert",
    "rag_chunks_context_upload_immutable_update",
    "rag_chunks_context_upload_immutable_delete",
  ];
  const missing: string[] = [];
  const sourceReferenceColumn = (db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('context_rag_upload_sessions') WHERE name = 'source_reference'",
  ).get() as { count: number }).count > 0;
  let any = sourceReferenceColumn;
  if (!sourceReferenceColumn) missing.push("source_reference column");
  for (const trigger of requiredTriggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  return { any, complete: missing.length === 0, missing };
}

/** Probe TASK-100's table, scope boundary, uniqueness, and append-only guard as one unit. */
function inspectTaskSourceReferencesMigration(db: Database.Database): TaskSourceReferencesMigrationState {
  const table = "task_source_references";
  const indexes = ["idx_tasks_project_id_id", "idx_task_source_references_task"];
  const trigger = "task_source_references_immutable_update";
  const tableExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count: number }).count > 0;
  const missing: string[] = [];
  let any = tableExists;

  if (!tableExists) {
    missing.push(`${table} table`);
  } else {
    const columns = [
      "id", "project_id", "task_id", "source_type", "source_id", "display_title",
      "display_detail", "source_timestamp", "created_at",
    ];
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    const requiredFragments = [
      "source_type IN ('email', 'context', 'docs', 'chat', 'job')",
      "length(source_id) BETWEEN 1 AND 512",
      "length(display_title) BETWEEN 1 AND 256",
      "UNIQUE(project_id, task_id, source_type, source_id)",
      "FOREIGN KEY(project_id, task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE",
    ];
    if (!tableSql?.sql || !requiredFragments.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
    if (!hasCompositeForeignKey(db, table, "tasks", ["project_id", "task_id"])) {
      missing.push(`${table} → tasks composite foreign key`);
    }
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list('${table}')`).all() as Array<{ table: string }>;
    if (foreignKeys.some((foreignKey) => foreignKey.table !== "tasks")) {
      missing.push(`${table} has unsupported source foreign key`);
    }
  }

  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  const triggerExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(trigger) as { count: number }).count > 0;
  any ||= triggerExists;
  if (!triggerExists) missing.push(`${trigger} trigger`);

  return { any, complete: missing.length === 0, missing };
}

/** Probe COORD-100's additive task coordination boundary as an inseparable unit. */
function inspectTaskCoordinationMigration(db: Database.Database): TaskCoordinationMigrationState {
  const taskColumns = ["revision", "reservation_state", "reservation_owner", "reservation_worktree"];
  const receiptTable = "task_mutation_receipts";
  const receiptColumns = [
    "id", "project_id", "task_id", "operation", "idempotency_key", "request_hash", "result_json", "created_at",
  ];
  const triggers = [
    "tasks_reservation_consistency_insert",
    "tasks_reservation_consistency_update",
    "task_mutation_receipts_immutable_update",
  ];
  const index = "idx_task_mutation_receipts_project_task_created";
  const missing: string[] = [];
  const taskSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
  ).get() as { sql?: string } | undefined;
  const existingTaskColumns = db.prepare("PRAGMA table_info('tasks')").all() as Array<{ name: string }>;
  const hasTaskColumns = taskColumns.every((column) => existingTaskColumns.some((candidate) => candidate.name === column));
  let any = taskColumns.some((column) => existingTaskColumns.some((candidate) => candidate.name === column))
    || triggers.some((trigger) => (
    (db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger) as { count: number }).count > 0
  ));
  if (!hasTaskColumns) missing.push("tasks coordination columns");
  if (!taskSql?.sql || ![
    "CHECK(revision >= 0)",
    "reservation_state IN ('available', 'reserved', 'quarantined')",
  ].every((fragment) => taskSql.sql!.includes(fragment))) {
    missing.push("tasks coordination constraints");
  }

  const receiptExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(receiptTable) as { count: number }).count > 0;
  any ||= receiptExists;
  if (!receiptExists) {
    missing.push(`${receiptTable} table`);
  } else {
    if (!hasContextConversationColumns(db, receiptTable, receiptColumns)) {
      missing.push(`${receiptTable} required columns`);
    }
    const receiptSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(receiptTable) as { sql?: string } | undefined;
    const requiredFragments = [
      "length(operation) BETWEEN 1 AND 64",
      "length(idempotency_key) BETWEEN 1 AND 128",
      "length(request_hash) = 64",
      "json_valid(result_json)",
      "length(CAST(result_json AS BLOB)) <= 16384",
      "UNIQUE(project_id, idempotency_key)",
    ];
    if (!receiptSql?.sql || !requiredFragments.every((fragment) => receiptSql.sql!.includes(fragment))) {
      missing.push(`${receiptTable} constraints`);
    }
  }
  const indexExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(index) as { count: number }).count > 0;
  any ||= indexExists;
  if (!indexExists) missing.push(`${index} index`);
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  return { any, complete: missing.length === 0, missing };
}

function inspectTaskReservationTokenMigration(db: Database.Database): TaskCoordinationMigrationState {
  const tokenColumnExists = (db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('tasks') WHERE name = 'reservation_token_hash'",
  ).get() as { count: number }).count > 0;
  const triggerNames = ["tasks_reservation_consistency_insert", "tasks_reservation_consistency_update"];
  const tokenAwareTriggers = triggerNames.every((name) => {
    const trigger = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(name) as { sql?: string } | undefined;
    return trigger?.sql?.includes("reservation_token_hash") ?? false;
  });
  const deleteTriggerExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'task_mutation_receipts_immutable_delete'",
  ).get() as { count: number }).count > 0;
  const missing = [
    ...(tokenColumnExists ? [] : ["tasks reservation_token_hash column"]),
    ...(tokenAwareTriggers ? [] : ["token-aware reservation consistency triggers"]),
    ...(deleteTriggerExists ? ["removal of task_mutation_receipts_immutable_delete trigger"] : []),
  ];
  return { any: tokenColumnExists || tokenAwareTriggers || deleteTriggerExists, complete: missing.length === 0, missing };
}

function normalizedImmutableUpdateTriggerSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/[\[\]`]/g, "")
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasCoordinationReceiptImmutableUpdateTrigger(db: Database.Database): boolean {
  const trigger = db.prepare(
    "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get("coordination_mutation_receipts_immutable_update") as { tbl_name?: string; sql?: string } | undefined;
  if (trigger?.tbl_name !== "coordination_mutation_receipts" || typeof trigger.sql !== "string") return false;
  const normalized = normalizedImmutableUpdateTriggerSql(trigger.sql);
  return /^create trigger(?: if not exists)? coordination_mutation_receipts_immutable_update before update on coordination_mutation_receipts begin select raise\(abort, '(?:''|[^'])*'\); end;?$/.test(normalized);
}

/** Probe COORD-101's registry as one unit; partial leases are never safe to resume. */
function inspectCoordinationRegistryMigration(db: Database.Database): CoordinationRegistryMigrationState {
  const requiredTables: Record<string, string[]> = {
    coordination_worktrees: ["project_id", "worktree_id", "next_fence", "created_at", "updated_at"],
    coordination_sessions: [
      "id", "project_id", "worktree_id", "session_id", "incarnation", "ownership_token_hash",
      "revision", "fence", "state", "heartbeat_at", "expires_at", "snapshot_json", "snapshot_revision",
      "current_task_id", "current_task_revision", "context_conversation_id", "context_revision", "created_at", "updated_at",
    ],
    coordination_claims: [
      "id", "project_id", "coordination_session_id", "worktree_id", "incarnation", "fence", "kind", "value",
      "baseline_sha256", "state", "created_at", "updated_at", "released_at",
    ],
    coordination_mutation_receipts: ["id", "project_id", "operation", "idempotency_key", "request_hash", "result_json", "created_at"],
  };
  const requiredSql: Record<string, string[]> = {
    coordination_worktrees: [
      "CHECK(next_fence >= 1)",
      "PRIMARY KEY(project_id, worktree_id)",
      "FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE",
    ],
    coordination_sessions: [
      "CHECK(incarnation >= 1)",
      "length(ownership_token_hash) = 64",
      "CHECK(revision >= 0)",
      "CHECK(fence >= 1)",
      "state IN ('active', 'quarantined', 'closed')",
      "json_type(snapshot_json) = 'object'",
      "length(CAST(snapshot_json AS BLOB)) <= 16384",
      "UNIQUE(project_id, id)",
      "UNIQUE(project_id, worktree_id, session_id, incarnation)",
    ],
    coordination_claims: [
      "CHECK(incarnation >= 1)",
      "CHECK(fence >= 1)",
      "length(baseline_sha256) = 64",
      "state IN ('active', 'released', 'dirty', 'quarantined', 'collision')",
      "UNIQUE(project_id, id)",
    ],
    coordination_mutation_receipts: [
      "length(operation) BETWEEN 1 AND 64",
      "length(idempotency_key) BETWEEN 1 AND 128",
      "length(request_hash) = 64",
      "json_valid(result_json)",
      "length(CAST(result_json AS BLOB)) <= 16384",
      "UNIQUE(project_id, idempotency_key)",
      "FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE",
    ],
  };
  const indexes = [
    "idx_coordination_sessions_identity",
    "idx_coordination_sessions_active_expiry",
    "idx_coordination_claims_active_worktree",
    "idx_coordination_claims_session",
    "idx_coordination_mutation_receipts_project_created",
  ];
  const updateTrigger = "coordination_mutation_receipts_immutable_update";
  const deleteTrigger = "coordination_mutation_receipts_immutable_delete";
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredSql[table]!.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
  }

  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  const hasUpdateTrigger = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(updateTrigger) as { count: number }).count > 0;
  const hasDeleteTrigger = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(deleteTrigger) as { count: number }).count > 0;
  any ||= hasUpdateTrigger || hasDeleteTrigger;
  if (!hasUpdateTrigger) missing.push(`${updateTrigger} trigger`);
  else if (!hasCoordinationReceiptImmutableUpdateTrigger(db)) missing.push(`${updateTrigger} immutable trigger semantics`);
  if (hasDeleteTrigger) missing.push(`removal of ${deleteTrigger} trigger`);

  const foreignKeys: Array<[string, string, string[]]> = [
    ["coordination_sessions", "projects", ["project_id"]],
    ["coordination_sessions", "coordination_worktrees", ["project_id", "worktree_id"]],
    ["coordination_sessions", "tasks", ["project_id", "current_task_id"]],
    ["coordination_sessions", "context_conversations", ["project_id", "context_conversation_id"]],
    ["coordination_claims", "projects", ["project_id"]],
    ["coordination_claims", "coordination_sessions", ["project_id", "coordination_session_id"]],
    ["coordination_claims", "coordination_worktrees", ["project_id", "worktree_id"]],
    ["coordination_mutation_receipts", "projects", ["project_id"]],
  ];
  for (const [table, referencedTable, fromColumns] of foreignKeys) {
    if (hasCompositeForeignKey(db, table, referencedTable, fromColumns)) continue;
    missing.push(`${table} → ${referencedTable} foreign key`);
  }

  return { any, complete: missing.length === 0, missing };
}

/** Probe JOB-100 as one append-only boundary; a partial event catalog is unsafe. */
function inspectTrustedJobEventsMigration(db: Database.Database): TrustedJobEventsMigrationState {
  const table = "trusted_job_events";
  const columns = [
    "id", "project_id", "event_type", "schema_version", "producer",
    "source_audit_event_id", "dedupe_key", "payload", "created_at",
  ];
  const requiredTableSql = [
    "schema_version INTEGER NOT NULL CHECK(schema_version = 1)",
    "producer TEXT NOT NULL CHECK(producer = 'context.maintenance')",
    "context.conversation.archived",
    "context.conversation.unarchived",
    "context.checkpoint.restored_as_new",
    "length(CAST(payload AS BLOB)) <= 2048",
    "UNIQUE(project_id, event_type, dedupe_key)",
    "UNIQUE(project_id, source_audit_event_id)",
  ];
  const triggerTables: Record<string, string> = {
    trusted_job_events_payload_contract: table,
    trusted_job_events_context_provenance: table,
    trusted_job_events_immutable_update: table,
    trusted_job_events_immutable_delete: table,
    jobs_trigger_event_catalog_insert: "jobs",
    jobs_trigger_event_catalog_update: "jobs",
  };
  const missing: string[] = [];
  const tableExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count: number }).count > 0;
  let any = tableExists;
  if (!tableExists) {
    missing.push(`${table} table`);
  } else {
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredTableSql.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
    if (!hasCompositeForeignKey(db, table, "projects", ["project_id"])) {
      missing.push(`${table} → projects foreign key`);
    }
    if (!hasCompositeForeignKey(db, table, "context_checkpoint_audit_events", ["project_id", "source_audit_event_id"])) {
      missing.push(`${table} → context_checkpoint_audit_events foreign key`);
    }
  }

  const indexExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_trusted_job_events_project_created'",
  ).get() as { count: number }).count > 0;
  any ||= indexExists;
  if (!indexExists) missing.push("idx_trusted_job_events_project_created index");

  for (const [trigger, expectedTable] of Object.entries(triggerTables)) {
    const row = db.prepare(
      "SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { tbl_name?: string } | undefined;
    any ||= row !== undefined;
    if (row?.tbl_name !== expectedTable) missing.push(`${trigger} trigger`);
  }
  return { any, complete: missing.length === 0, missing };
}

/** JOB-101's queue is an all-or-nothing safety boundary: do not resume a partial lease schema. */
function inspectJobEventDeliveriesMigration(db: Database.Database): JobEventDeliveriesMigrationState {
  const requiredTables: Record<string, string[]> = {
    job_event_dispatches: ["project_id", "trusted_event_id", "snapshotted_at"],
    job_event_deliveries: [
      "id", "project_id", "trusted_event_id", "job_id", "state", "attempt_count", "next_attempt_at",
      "lease_revision", "lease_expires_at", "lease_owner_hash", "last_error_code", "last_error_message",
      "created_at", "updated_at",
    ],
    job_event_attempts: [
      "id", "project_id", "delivery_id", "attempt_number", "run_id", "process_id", "process_group_id",
      "process_start_time", "process_executable", "process_nonce_hash", "created_at", "updated_at",
    ],
  };
  const indexes = [
    "idx_jobs_project_id_id", "idx_job_runs_project_id_id", "idx_job_event_dispatches_project_snapshot",
    "idx_job_event_deliveries_claim", "idx_job_event_deliveries_expiry", "idx_job_event_deliveries_project_updated",
    "idx_job_event_attempts_delivery",
  ];
  const triggers = [
    "job_runs_project_scope_insert",
    "job_runs_project_scope_update",
    "job_event_dispatches_immutable_update",
    "job_event_dispatches_immutable_delete",
    "job_event_attempts_run_matches_delivery",
    "job_event_attempts_immutable_linkage_update",
  ];
  const missing: string[] = [];
  let any = false;

  const runProjectColumn = (db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('job_runs') WHERE name = 'project_id'",
  ).get() as { count: number }).count > 0;
  any ||= runProjectColumn;
  if (!runProjectColumn) missing.push("job_runs.project_id column");

  const jobDeletedAtColumn = (db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('jobs') WHERE name = 'deleted_at'",
  ).get() as { count: number }).count > 0;
  any ||= jobDeletedAtColumn;
  if (!jobDeletedAtColumn) missing.push("jobs.deleted_at column");

  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  if (!hasCompositeForeignKey(db, "job_event_deliveries", "trusted_job_events", ["project_id", "trusted_event_id"])) {
    missing.push("job_event_deliveries → trusted_job_events foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_event_deliveries", "jobs", ["project_id", "job_id"])) {
    missing.push("job_event_deliveries → jobs foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_event_attempts", "job_event_deliveries", ["project_id", "delivery_id"])) {
    missing.push("job_event_attempts → job_event_deliveries foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_event_attempts", "job_runs", ["project_id", "run_id"])) {
    missing.push("job_event_attempts → job_runs foreign key");
  }
  return { any, complete: missing.length === 0, missing };
}

/** USAGE-101 is an all-or-nothing lifecycle ledger; partial guards are unsafe. */
function inspectUsageAttentionMigration(db: Database.Database): UsageAttentionMigrationState {
  const requiredTables: Record<string, string[]> = {
    usage_attention_items: [
      "id", "project_id", "condition", "metric", "status", "evaluation_state", "severity", "message_code",
      "observed", "threshold", "availability", "freshness", "range_from", "range_to", "threshold_revision",
      "opened_at", "acknowledged_at", "resolved_at", "reopened_at", "reopen_count", "last_evaluated_at",
      "revision", "created_at", "updated_at",
    ],
    usage_attention_events: [
      "id", "project_id", "item_id", "transition", "prior_status", "current_status",
      "prior_evaluation_state", "current_evaluation_state", "prior_severity", "current_severity",
      "prior_message_code", "current_message_code", "prior_observed", "current_observed",
      "prior_threshold", "current_threshold", "prior_availability", "current_availability",
      "prior_freshness", "current_freshness", "prior_threshold_revision", "current_threshold_revision",
      "prior_last_evaluated_at", "current_last_evaluated_at", "prior_acknowledged_at",
      "current_acknowledged_at", "created_at",
    ],
  };
  const requiredSql: Record<string, string[]> = {
    usage_attention_items: [
      "usage.advisory:v1:all-history:request_count",
      "UNIQUE(project_id, condition)",
      "status IN ('active', 'resolved')",
      "evaluation_state IN ('disabled', 'unknown', 'below', 'equal', 'above')",
      "severity IN ('info', 'warning', 'critical')",
      "freshness IN ('disabled', 'unknown', 'fresh', 'stale')",
      "CHECK(range_from IS NULL AND range_to IS NULL)",
      "FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT",
    ],
    usage_attention_events: [
      "transition IN ('opened', 'changed', 'resolved', 'reopened', 'ack')",
      "FOREIGN KEY(project_id, item_id) REFERENCES usage_attention_items(project_id, id) ON DELETE RESTRICT",
    ],
  };
  const indexes = [
    "idx_usage_attention_items_project_status_updated",
    "idx_usage_attention_events_project_item_created",
  ];
  const triggers = [
    "usage_attention_items_identity_immutable_update",
    "usage_attention_items_monotonic_update",
    "usage_attention_events_immutable_update",
    "usage_attention_events_immutable_delete",
  ];
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredSql[table]!.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  if (!hasCompositeForeignKey(db, "usage_attention_events", "usage_attention_items", ["project_id", "item_id"])) {
    missing.push("usage_attention_events → usage_attention_items composite foreign key");
  }
  return { any, complete: missing.length === 0, missing };
}

/** VAULT-100 references are a metadata-only authorization boundary. */
function inspectJobVaultReferencesMigration(db: Database.Database): JobVaultReferencesMigrationState {
  const requiredTables: Record<string, string[]> = {
    job_vault_references: [
      "project_id", "job_id", "item_id", "authorized_at", "authorized_item_version", "status",
    ],
    job_vault_reference_audit: [
      "id", "project_id", "job_id", "item_id", "authorized_item_version", "action", "actor", "created_at",
    ],
  };
  const requiredSql: Record<string, string[]> = {
    job_vault_references: [
      "PRIMARY KEY(project_id, job_id, item_id)",
      "status IN ('authorized', 'revoked')",
      "FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT",
      "FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT",
    ],
    job_vault_reference_audit: [
      "length(id) = 36",
      "action IN ('authorized', 'revoked')",
      "actor = 'authenticated_api'",
      "FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT",
      "FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT",
    ],
  };
  const indexes = [
    "idx_vault_items_project_id_id",
    "idx_job_vault_references_project_job_status",
    "idx_job_vault_references_project_item",
    "idx_job_vault_reference_audit_project_job_created",
  ];
  const triggers = [
    "job_vault_references_active_item_insert",
    "job_vault_references_active_item_update",
    "job_vault_references_max_authorized_insert",
    "job_vault_references_max_authorized_update",
    "job_vault_references_identity_immutable_update",
    "job_vault_reference_audit_immutable_update",
    "job_vault_reference_audit_immutable_delete",
  ];
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredSql[table]!.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  if (!hasCompositeForeignKey(db, "job_vault_references", "jobs", ["project_id", "job_id"])) {
    missing.push("job_vault_references → jobs composite foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_vault_references", "vault_items", ["project_id", "item_id"])) {
    missing.push("job_vault_references → vault_items composite foreign key");
  }
  return { any, complete: missing.length === 0, missing };
}

/** VAULT-101 run provenance must be complete before the runner can recover it. */
function inspectVaultJobRunsMigration(db: Database.Database): VaultJobRunsMigrationState {
  const requiredTables: Record<string, string[]> = {
    job_vault_runs: [
      "run_id", "project_id", "job_id", "state", "deadline_at", "process_nonce_hash",
      "process_id", "process_group_id", "process_start_time", "process_executable", "revision",
      "prepared_at", "spawned_at", "teardown_started_at", "cleaned_at", "failed_at", "updated_at",
    ],
    job_vault_run_items: ["project_id", "run_id", "job_id", "item_id", "authorized_item_version", "created_at"],
  };
  const requiredSql: Record<string, string[]> = {
    job_vault_runs: [
      "state IN ('prepared', 'spawned', 'teardown_pending', 'cleaned', 'failed')",
      "FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT",
      "FOREIGN KEY(project_id, run_id) REFERENCES job_runs(project_id, id) ON DELETE RESTRICT",
    ],
    job_vault_run_items: [
      "PRIMARY KEY(project_id, run_id, item_id)",
      "FOREIGN KEY(project_id, run_id) REFERENCES job_vault_runs(project_id, run_id) ON DELETE RESTRICT",
      "FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT",
    ],
  };
  const indexes = ["idx_job_vault_runs_recovery", "idx_job_vault_run_items_project_run"];
  const triggers = [
    "job_vault_runs_identity_immutable_update",
    "job_vault_runs_process_identity_immutable_update",
    "job_vault_runs_state_transition_update",
    "job_vault_runs_spawn_requires_identity",
    "job_vault_runs_revision_cas_update",
    "job_vault_run_items_immutable_update",
    "job_vault_run_items_immutable_delete",
    "job_vault_run_items_matches_run",
  ];
  const missing: string[] = [];
  let any = false;
  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || !requiredSql[table]!.every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  if (!hasCompositeForeignKey(db, "job_vault_runs", "jobs", ["project_id", "job_id"])) {
    missing.push("job_vault_runs → jobs composite foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_vault_runs", "job_runs", ["project_id", "run_id"])) {
    missing.push("job_vault_runs → job_runs composite foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_vault_run_items", "job_vault_runs", ["project_id", "run_id"])) {
    missing.push("job_vault_run_items → job_vault_runs composite foreign key");
  }
  return { any, complete: missing.length === 0, missing };
}

/** VAULT-102 requires CAS revisions and structured, immutable runtime audit rows. */
function inspectJobVaultRevisionAuditMigration(db: Database.Database): JobVaultRevisionAuditMigrationState {
  const jobsRevision = db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('jobs') WHERE name = 'revision'",
  ).get() as { count: number };
  const auditExists = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'job_vault_runtime_audit'",
  ).get() as { count: number };
  const any = jobsRevision.count > 0 || auditExists.count > 0;
  const missing: string[] = [];
  if (jobsRevision.count === 0) missing.push("jobs revision column");
  if (auditExists.count === 0) {
    missing.push("job_vault_runtime_audit table");
    return { any, complete: false, missing };
  }

  const requiredColumns = [
    "id", "project_id", "job_id", "item_id", "action", "run_id", "authorized_item_version", "created_at",
  ];
  if (!hasContextConversationColumns(db, "job_vault_runtime_audit", requiredColumns)) {
    missing.push("job_vault_runtime_audit required columns");
  }
  const tableSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'job_vault_runtime_audit'",
  ).get() as { sql?: string } | undefined;
  if (!tableSql?.sql || ![
    "action IN ('secret_read', 'access_denied')",
    "FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT",
    "FOREIGN KEY(project_id, run_id) REFERENCES job_runs(project_id, id) ON DELETE RESTRICT",
    "FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT",
  ].every((fragment) => tableSql.sql!.includes(fragment))) {
    missing.push("job_vault_runtime_audit constraints");
  }
  for (const index of ["idx_job_vault_runtime_audit_project_job_created"]) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of [
    "jobs_revision_monotonic_update",
    "job_vault_runtime_audit_run_matches_job",
    "job_vault_runtime_audit_immutable_update",
    "job_vault_runtime_audit_immutable_delete",
  ]) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  if (!hasCompositeForeignKey(db, "job_vault_runtime_audit", "jobs", ["project_id", "job_id"])) {
    missing.push("job_vault_runtime_audit → jobs composite foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_vault_runtime_audit", "job_runs", ["project_id", "run_id"])) {
    missing.push("job_vault_runtime_audit → job_runs composite foreign key");
  }
  if (!hasCompositeForeignKey(db, "job_vault_runtime_audit", "vault_items", ["project_id", "item_id"])) {
    missing.push("job_vault_runtime_audit → vault_items composite foreign key");
  }
  return { any, complete: missing.length === 0, missing };
}

/** RESTORE-100 is an all-or-nothing approval boundary. Partial plans must not resume. */
function inspectRestorePlansMigration(db: Database.Database): RestorePlansMigrationState {
  const requiredTables: Record<string, string[]> = {
    backup_restore_plans: [
      "id", "project_id", "backup_id", "dry_run", "manifest_hash", "plan_hash", "components_json",
      "blockers_json", "warnings_json", "created_at",
    ],
    backup_restore_plan_revisions: [
      "id", "project_id", "plan_id", "backup_id", "revision", "from_state", "to_state", "stage_hash", "created_at",
    ],
    backup_restore_authorizations: [
      "id", "project_id", "plan_id", "backup_id", "operation", "plan_revision", "manifest_hash",
      "token_hash", "expires_at", "consumed_at", "created_at",
    ],
    backup_restore_stages: [
      "id", "project_id", "plan_id", "backup_id", "manifest_hash", "plan_hash",
      "ingenium_sha256", "ingenium_size_bytes", "opencode_sha256", "opencode_size_bytes", "stage_hash", "created_at",
    ],
    backup_restore_events: [
      "id", "project_id", "plan_id", "backup_id", "event_type", "from_state", "to_state", "revision",
      "manifest_hash", "plan_hash", "metadata", "created_at",
    ],
    backup_restore_receipts: [
      "id", "project_id", "plan_id", "operation", "idempotency_key", "request_hash", "result_json", "created_at",
    ],
  };
  const indexes = [
    "idx_backup_records_project_id_id",
    "idx_backup_restore_plans_project_created",
    "idx_backup_restore_revisions_project_plan",
    "idx_backup_restore_events_project_plan",
    "idx_backup_restore_authorizations_plan_expiry",
    "idx_backup_restore_receipts_project_created",
  ];
  const triggers = [
    "backup_restore_plans_global_project_insert",
    "backup_restore_plan_revisions_global_project_insert",
    "backup_restore_authorizations_global_project_insert",
    "backup_restore_stages_global_project_insert",
    "backup_restore_events_global_project_insert",
    "backup_restore_receipts_global_project_insert",
    "backup_restore_events_immutable_update",
    "backup_restore_events_immutable_delete",
    "backup_restore_receipts_immutable_update",
    "backup_restore_receipts_immutable_delete",
    "backup_restore_plans_immutable_update",
    "backup_restore_plans_immutable_delete",
    "backup_restore_plan_revisions_immutable_update",
    "backup_restore_plan_revisions_immutable_delete",
    "backup_restore_plan_revisions_validate_insert",
    "backup_restore_plan_revisions_create_event",
    "backup_restore_stages_immutable_update",
    "backup_restore_stages_immutable_delete",
    "backup_restore_stages_validate_insert",
    "backup_restore_authorizations_validate_insert",
    "backup_restore_authorizations_immutable_delete",
    "backup_restore_authorizations_consume_once",
  ];
  const missing: string[] = [];
  let any = false;
  for (const [table, columns] of Object.entries(requiredTables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) {
      missing.push(`${table} table`);
      continue;
    }
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  for (const [table, reference, columns] of [
    ["backup_restore_plans", "backup_records", ["project_id", "backup_id"]],
    ["backup_restore_plan_revisions", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_plan_revisions", "backup_records", ["project_id", "backup_id"]],
    ["backup_restore_authorizations", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_authorizations", "backup_records", ["project_id", "backup_id"]],
    ["backup_restore_stages", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_stages", "backup_records", ["project_id", "backup_id"]],
    ["backup_restore_events", "backup_restore_plan_revisions", ["project_id", "plan_id", "revision"]],
    ["backup_restore_events", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_events", "backup_records", ["project_id", "backup_id"]],
    ["backup_restore_receipts", "backup_restore_plans", ["project_id", "plan_id"]],
  ] as Array<[string, string, string[]]>) {
    if (!hasCompositeForeignKey(db, table, reference, columns)) {
      missing.push(`${table} → ${reference} composite foreign key`);
    }
  }
  return { any, complete: missing.length === 0, missing };
}

/** RESTORE-101's executor ledger is inseparable: partial state must never run. */
function inspectRestoreExecutorMigration(db: Database.Database): RestoreExecutorMigrationState {
  const tables: Record<string, string[]> = {
    backup_restore_execution_authorizations: ["id", "project_id", "plan_id", "backup_id", "operation", "plan_revision", "manifest_hash", "plan_hash", "stage_hash", "token_hash", "expires_at", "consumed_at", "created_at"],
    backup_restore_execution_runs: ["id", "project_id", "plan_id", "backup_id", "authorization_id", "plan_revision", "manifest_hash", "plan_hash", "stage_hash", "state", "phase", "revision", "owner_hash", "fence_hash", "deadline_at", "safety_backup_id", "error_code", "created_at", "updated_at", "completed_at"],
    backup_restore_execution_items: ["id", "project_id", "run_id", "component", "expected_sha256", "size_bytes", "pre_hash", "post_hash", "created_at"],
    backup_restore_executor_plan_revisions: ["id", "project_id", "plan_id", "backup_id", "revision", "from_state", "to_state", "execution_run_id", "stage_hash", "created_at"],
    backup_restore_execution_events: ["id", "project_id", "plan_id", "backup_id", "run_id", "revision", "event_code", "from_state", "to_state", "manifest_hash", "plan_hash", "stage_hash", "metadata", "created_at"],
    backup_restore_execution_receipts: ["id", "project_id", "plan_id", "operation", "idempotency_key", "request_hash", "result_json", "created_at"],
  };
  const indexes = ["idx_backup_restore_execution_authorizations_plan_expiry", "idx_backup_restore_execution_runs_claim", "idx_backup_restore_execution_events_plan", "idx_backup_restore_execution_receipts_project_created"];
  const triggers = [
    "backup_restore_authorizations_consume_once", "backup_restore_execution_authorizations_validate_insert",
    "backup_restore_execution_authorizations_consume_once", "backup_restore_execution_authorizations_immutable_delete",
    "backup_restore_execution_runs_validate_insert", "backup_restore_execution_runs_update", "backup_restore_execution_runs_immutable_delete",
    "backup_restore_execution_items_validate_insert", "backup_restore_execution_items_hashes_write_once", "backup_restore_execution_items_immutable_delete",
    "backup_restore_executor_plan_revisions_validate_insert", "backup_restore_executor_plan_revisions_create_event",
    "backup_restore_executor_plan_revisions_immutable_update", "backup_restore_executor_plan_revisions_immutable_delete",
    "backup_restore_execution_events_immutable_update", "backup_restore_execution_events_immutable_delete",
    "backup_restore_execution_receipts_immutable_update", "backup_restore_execution_receipts_immutable_delete",
  ];
  const missing: string[] = [];
  let any = false;
  for (const [table, columns] of Object.entries(tables)) {
    const exists = (db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${table} table`);
    else if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
  }
  for (const index of indexes) {
    const exists = (db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?").get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger) as { count: number }).count > 0;
    if (trigger !== "backup_restore_authorizations_consume_once") any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  const authorizationGuard = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'backup_restore_authorizations_consume_once'")
    .get() as { sql?: string } | undefined;
  if (any && !authorizationGuard?.sql?.includes("NEW.id IS NOT OLD.id")) missing.push("backup_restore_authorizations identity guard");
  for (const [table, reference, columns] of [
    ["backup_restore_execution_authorizations", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_execution_runs", "backup_restore_execution_authorizations", ["project_id", "authorization_id"]],
    ["backup_restore_execution_items", "backup_restore_execution_runs", ["project_id", "run_id"]],
    ["backup_restore_executor_plan_revisions", "backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_restore_execution_events", "backup_restore_executor_plan_revisions", ["project_id", "plan_id", "revision"]],
    ["backup_restore_execution_receipts", "backup_restore_plans", ["project_id", "plan_id"]],
  ] as Array<[string, string, string[]]>) {
    if (!hasCompositeForeignKey(db, table, reference, columns)) missing.push(`${table} → ${reference} composite foreign key`);
  }
  return { any, complete: missing.length === 0, missing };
}

function inspectRestoreExecutorPhaseEventsMigration(
  db: Database.Database,
): RestoreExecutorPhaseEventsMigrationState {
  const table = "backup_restore_execution_phase_events";
  const requiredColumns = [
    "id", "project_id", "plan_id", "backup_id", "run_id", "phase_code", "status", "error_code", "created_at",
  ];
  const triggers = [
    "backup_restore_execution_phase_events_validate_insert",
    "backup_restore_execution_phase_events_immutable_update",
    "backup_restore_execution_phase_events_immutable_delete",
  ];
  const exists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count: number }).count > 0;
  const missing: string[] = [];
  if (!exists) return { any: false, complete: false, missing: [`${table} table`] };
  if (!hasContextConversationColumns(db, table, requiredColumns)) missing.push(`${table} required columns`);
  const indexExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get("idx_backup_restore_execution_phase_events_plan") as { count: number }).count > 0;
  if (!indexExists) missing.push("idx_backup_restore_execution_phase_events_plan index");
  for (const trigger of triggers) {
    const triggerExists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    if (!triggerExists) missing.push(`${trigger} trigger`);
  }
  const validationTrigger = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'backup_restore_execution_phase_events_validate_insert'",
  ).get() as { sql?: string } | undefined;
  if (validationTrigger?.sql && ![
    "FROM backup_restore_execution_runs",
    "project_id = NEW.project_id",
    "id = NEW.run_id",
    "plan_id = NEW.plan_id",
    "backup_id = NEW.backup_id",
    "NEW.status != 'failed' AND NEW.error_code IS NOT NULL",
    "NEW.status = 'failed' AND NEW.error_code IS NULL",
  ].every((fragment) => validationTrigger.sql!.includes(fragment))) {
    missing.push("backup_restore_execution_phase_events validation trigger");
  }
  for (const [reference, columns] of [
    ["backup_restore_execution_runs", ["project_id", "run_id"]],
    ["backup_restore_plans", ["project_id", "plan_id"]],
    ["backup_records", ["project_id", "backup_id"]],
  ] as Array<[string, string[]]>) {
    if (!hasCompositeForeignKey(db, table, reference, columns)) {
      missing.push(`${table} → ${reference} composite foreign key`);
    }
  }
  return { any: true, complete: missing.length === 0, missing };
}

function inspectBackupDeletionReservationsMigration(
  db: Database.Database,
): BackupDeletionReservationsMigrationState {
  const table = "backup_deletion_reservations";
  const index = "idx_backup_deletion_reservations_state";
  const triggers = [
    "backup_deletion_reservations_reject_referenced_backup",
    "backup_restore_plans_reject_deleting_backup",
  ];
  const tableExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count: number }).count > 0;
  const indexExists = (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(index) as { count: number }).count > 0;
  const triggerRows = triggers.map((trigger) => ({
    trigger,
    row: db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { sql?: string } | undefined,
  }));
  const missing: string[] = [];
  const any = tableExists || indexExists || triggerRows.some(({ row }) => row !== undefined);

  if (!tableExists) {
    missing.push(`${table} table`);
  } else {
    const columns = ["project_id", "backup_id", "state", "attempt_count", "created_at", "updated_at"];
    if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
    const tableSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { sql?: string } | undefined;
    if (!tableSql?.sql || ![
      "state TEXT NOT NULL CHECK(state IN ('reserved', 'deleting'))",
      "attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 2147483647)",
      "PRIMARY KEY(project_id, backup_id)",
      "FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE CASCADE",
    ].every((fragment) => tableSql.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
    if (!hasCompositeForeignKey(db, table, "backup_records", ["project_id", "backup_id"])) {
      missing.push(`${table} → backup_records composite foreign key`);
    }
  }

  if (!indexExists) missing.push(`${index} index`);
  for (const { trigger, row } of triggerRows) {
    if (!row?.sql) missing.push(`${trigger} trigger`);
  }
  const reservationTrigger = triggerRows.find(({ trigger }) => trigger === "backup_deletion_reservations_reject_referenced_backup")?.row;
  if (reservationTrigger?.sql && ![
    "FROM backup_restore_plans",
    "project_id = NEW.project_id",
    "backup_id = NEW.backup_id",
  ].every((fragment) => reservationTrigger.sql!.includes(fragment))) {
    missing.push("backup_deletion_reservations reference trigger");
  }
  const previewTrigger = triggerRows.find(({ trigger }) => trigger === "backup_restore_plans_reject_deleting_backup")?.row;
  if (previewTrigger?.sql && ![
    "FROM backup_deletion_reservations",
    "project_id = NEW.project_id",
    "backup_id = NEW.backup_id",
    "state IN ('reserved', 'deleting')",
  ].every((fragment) => previewTrigger.sql!.includes(fragment))) {
    missing.push("backup_restore_plans deletion trigger");
  }

  return { any, complete: missing.length === 0, missing };
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().replace(/;$/, "").toLowerCase();
}

function inspectSkillProposalRetentionPaginationMigration(
  db: Database.Database,
): SkillProposalRetentionPaginationMigrationState {
  const index = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(SKILL_PROPOSAL_RETENTION_INDEX) as { sql?: string | null } | undefined;
  const trigger = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER) as { sql?: string | null } | undefined;
  const missing: string[] = [];
  const expectedIndexSql = normalizeSchemaSql(
    `CREATE INDEX ${SKILL_PROPOSAL_RETENTION_INDEX}
     ON skill_proposals(project_id, status, created_at DESC, id DESC)`,
  );
  const expectedTriggerSql = normalizeSchemaSql(
    `CREATE TRIGGER ${SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER}
     BEFORE DELETE ON skill_proposals
     BEGIN
       SELECT RAISE(ABORT, '${SKILL_PROPOSAL_RETENTION_DELETE_ERROR}');
     END`,
  );
  const any = index !== undefined || trigger !== undefined;

  if (!index?.sql) {
    missing.push(`${SKILL_PROPOSAL_RETENTION_INDEX} index`);
  } else if (normalizeSchemaSql(index.sql) !== expectedIndexSql) {
    missing.push(`${SKILL_PROPOSAL_RETENTION_INDEX} index definition`);
  }

  if (!trigger?.sql) {
    missing.push(`${SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER} trigger`);
  } else if (normalizeSchemaSql(trigger.sql) !== expectedTriggerSql) {
    missing.push(`${SKILL_PROPOSAL_RETENTION_DELETE_TRIGGER} trigger definition`);
  }

  return { any, complete: missing.length === 0, missing };
}

function inspectEmailWatcherMarkersMigration(db: Database.Database): EmailWatcherMarkersMigrationState {
  const table = "email_watcher_markers";
  const index = "idx_email_watcher_markers_scope_newest";
  const tableRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string } | undefined;
  const indexRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(index) as { sql?: string } | undefined;
  const missing: string[] = [];
  const any = tableRow !== undefined || indexRow !== undefined;

  if (!tableRow?.sql) {
    missing.push(`${table} table`);
  } else {
    const columns = ["id", "project_id", "account_id", "folder", "uid", "created_at", "updated_at"];
    if (!hasContextConversationColumns(db, table, columns)) {
      missing.push(`${table} required columns`);
    }
    if (![
      "id INTEGER PRIMARY KEY AUTOINCREMENT",
      "project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 128)",
      "REFERENCES projects(id) ON DELETE CASCADE",
      "account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256)",
      "folder TEXT NOT NULL CHECK(length(folder) BETWEEN 1 AND 512)",
      "uid TEXT NOT NULL CHECK(length(uid) BETWEEN 1 AND 512)",
      "created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)",
      "updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64)",
      "UNIQUE(project_id, account_id, folder, uid)",
    ].every((fragment) => tableRow.sql!.includes(fragment))) {
      missing.push(`${table} constraints`);
    }
    if (!hasCompositeForeignKey(db, table, "projects", ["project_id"])) {
      missing.push(`${table} → projects foreign key`);
    }
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list('${table}')`).all() as Array<{ table: string }>;
    if (foreignKeys.some((foreignKey) => foreignKey.table !== "projects" && foreignKey.table !== "organizations")) {
      missing.push(`${table} has unsupported foreign key`);
    }
  }

  const expectedIndexSql = normalizeSchemaSql(
    `CREATE INDEX ${index}
     ON email_watcher_markers(project_id, account_id, folder, updated_at DESC, id DESC)`,
  );
  if (!indexRow?.sql) {
    missing.push(`${index} index`);
  } else if (normalizeSchemaSql(indexRow.sql) !== expectedIndexSql) {
    missing.push(`${index} index definition`);
  }

  return { any, complete: missing.length === 0, missing };
}

function inspectMigrationComponents(
  db: Database.Database,
  tables: Record<string, string[]>,
  indexes: string[],
  triggers: string[],
): AuthenticationFoundationMigrationState {
  const missing: string[] = [];
  let any = false;
  for (const [table, columns] of Object.entries(tables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${table} table`);
    else if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
  }
  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }
  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }
  return { any, complete: missing.length === 0, missing };
}

const expectedAuthenticationSchema = new Map<string, Map<string, string>>();

function compareMigrationDefinitions(
  db: Database.Database,
  migrationFile: string,
  prerequisiteSql: string,
  objectNames: string[],
): string[] {
  let expected = expectedAuthenticationSchema.get(migrationFile);
  if (!expected) {
    const reference = new Database(":memory:");
    try {
      reference.exec(prerequisiteSql);
      reference.exec(readFileSync(resolve(import.meta.dirname ?? __dirname, "../data/migrations", migrationFile), "utf-8"));
      expected = new Map(objectNames.map((name) => {
        const row = reference.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql?: string } | undefined;
        if (!row?.sql) throw new Error(`Migration ${migrationFile} reference object is missing: ${name}`);
        return [name, normalizeSchemaSql(row.sql)];
      }));
      expectedAuthenticationSchema.set(migrationFile, expected);
    } finally {
      reference.close();
    }
  }
  return objectNames.flatMap((name) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql?: string } | undefined;
    return row?.sql && normalizeSchemaSql(row.sql) === expected!.get(name) ? [] : [`${name} definition`];
  });
}

function inspectIdentityTenancyMigration(db: Database.Database): AuthenticationFoundationMigrationState {
  const tables = ["organizations", "users", "organization_memberships", "project_memberships", "bootstrap_state", "bootstrap_manifests"];
  const indexes = ["idx_organization_memberships_user", "idx_projects_organization", "idx_project_memberships_user"];
  const triggers = [
    "projects_require_organization_insert", "projects_require_organization_update",
    "project_memberships_same_organization_insert", "project_memberships_same_organization_update",
    "organization_memberships_keep_owner_delete", "organization_memberships_keep_owner_update",
    "project_memberships_reject_org_departure", "project_memberships_reject_org_delete",
    "projects_reject_membership_reparent",
    "bootstrap_manifests_immutable_update", "bootstrap_manifests_immutable_delete",
  ];
  const state = inspectMigrationComponents(db, {
    organizations: ["id", "name", "slug", "status", "created_at", "updated_at"],
    users: ["id", "email_normalized", "display_name", "status", "created_at", "updated_at"],
    organization_memberships: ["organization_id", "user_id", "role", "status", "created_at", "updated_at"],
    project_memberships: ["project_id", "user_id", "role", "created_at", "updated_at"],
    bootstrap_state: ["singleton", "state", "organization_id", "owner_user_id", "claimed_at", "revision", "created_at", "updated_at"],
    bootstrap_manifests: ["id", "migration", "organization_id", "project_count", "project_ids_json", "phase", "integrity_result", "foreign_key_violations", "created_at"],
  }, indexes, triggers);
  const organizationColumn = (db.prepare(
    "SELECT count(*) AS count FROM pragma_table_info('projects') WHERE name = 'organization_id'",
  ).get() as { count: number }).count > 0;
  state.any ||= organizationColumn;
  if (!organizationColumn) state.missing.push("projects.organization_id column");
  if (state.any && state.missing.length === 0) {
    state.missing.push(...compareMigrationDefinitions(
      db,
      "093_identity_tenancy.sql",
      "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, is_global INTEGER, created_at TEXT, updated_at TEXT);",
      [...tables.filter((table) => table !== "users"), ...indexes, ...triggers],
    ));
  }
  if (state.missing.length === 0) {
    const unmapped = db.prepare("SELECT count(*) AS count FROM projects WHERE organization_id IS NULL").get() as { count: number };
    const manifest = db.prepare(
      "SELECT project_count, json_array_length(project_ids_json) AS id_count, phase, integrity_result, foreign_key_violations FROM bootstrap_manifests WHERE migration = 93",
    ).get() as { project_count: number; id_count: number; phase: string; integrity_result: string; foreign_key_violations: number } | undefined;
    if (unmapped.count > 0) state.missing.push("project organization backfill");
    if (!manifest || manifest.project_count !== manifest.id_count || manifest.phase !== "verified"
      || manifest.integrity_result !== "ok" || manifest.foreign_key_violations !== 0) {
      state.missing.push("verified bootstrap manifest");
    }
  }
  state.complete = state.missing.length === 0;
  return state;
}

function inspectAuthenticationMigration(db: Database.Database): AuthenticationFoundationMigrationState {
  const tables = ["auth_identities", "password_credentials", "auth_sessions", "auth_one_time_states", "auth_totp_factors", "auth_recovery_codes", "oidc_providers", "oidc_authorization_states"];
  const indexes = ["idx_auth_identities_user", "idx_auth_sessions_user_active", "idx_auth_one_time_states_expiry", "idx_oidc_authorization_states_expiry"];
  const triggers = ["auth_one_time_states_consume_once", "oidc_authorization_states_consume_once"];
  const state = inspectMigrationComponents(db, {
    auth_identities: ["id", "user_id", "provider", "issuer", "subject", "created_at", "updated_at"],
    password_credentials: ["user_id", "password_hash", "salt", "scrypt_n", "scrypt_r", "scrypt_p", "created_at", "updated_at"],
    auth_sessions: ["id", "user_id", "token_hash", "csrf_hash", "security_epoch", "device_label", "idle_expires_at", "absolute_expires_at", "recent_step_up_at", "revoked_at", "created_at", "last_seen_at"],
    auth_one_time_states: ["id", "purpose", "user_id", "state_hash", "metadata_json", "expires_at", "consumed_at", "created_at"],
    auth_totp_factors: ["id", "user_id", "encrypted_secret", "secret_key_version", "enabled_at", "revoked_at", "created_at"],
    auth_recovery_codes: ["id", "user_id", "code_hash", "consumed_at", "created_at"],
    oidc_providers: ["id", "name", "issuer", "client_id", "redirect_uri", "signature_algorithm", "enabled", "created_at", "updated_at"],
    oidc_authorization_states: ["id", "provider_id", "state_hash", "transaction_hash", "nonce_hash", "encrypted_pkce_verifier", "expires_at", "consumed_at", "created_at"],
  }, indexes, triggers);
  const userColumns = new Set((db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name));
  state.any ||= userColumns.has("email_verified_at") || userColumns.has("security_epoch");
  if (!userColumns.has("email_verified_at")) state.missing.push("users.email_verified_at column");
  if (!userColumns.has("security_epoch")) state.missing.push("users.security_epoch column");
  if (state.any && state.missing.length === 0) {
    state.missing.push(...compareMigrationDefinitions(
      db,
      "094_authentication.sql",
      "CREATE TABLE users (id TEXT PRIMARY KEY);",
      [...tables, ...indexes, ...triggers],
    ));
  }
  state.complete = state.missing.length === 0;
  return state;
}

function isAuth100AuthenticationSchema(db: Database.Database): boolean {
  const sessionColumns = new Set((db.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>).map(({ name }) => name));
  const factorColumns = new Set((db.prepare("PRAGMA table_info(auth_totp_factors)").all() as Array<{ name: string }>).map(({ name }) => name));
  const oneTimeState = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_one_time_states'",
  ).get() as { sql: string } | undefined;
  const oidcProvider = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'oidc_providers'",
  ).get() as { count: number };
  return sessionColumns.has("token_hash")
    && !sessionColumns.has("csrf_hash")
    && factorColumns.has("encrypted_secret")
    && !factorColumns.has("secret_key_version")
    && Boolean(oneTimeState?.sql.includes("'oidc'") && !oneTimeState.sql.includes("'mfa_challenge'"))
    && oidcProvider.count === 0;
}

function inspectAuthorizationAuditMigration(db: Database.Database): AuthenticationFoundationMigrationState {
  const tables = ["installation_admins", "service_principals", "scoped_api_tokens", "organization_invitations", "security_audit_events"];
  const indexes = ["idx_scoped_api_tokens_user", "idx_scoped_api_tokens_service", "idx_organization_invitations_scope", "idx_security_audit_scope"];
  const triggers = [
    "security_audit_events_immutable_update",
    "security_audit_events_immutable_delete",
    "security_audit_events_project_organization_insert",
    "scoped_api_tokens_identity_immutable",
    "scoped_api_tokens_project_organization_insert",
    "scoped_api_tokens_project_organization_update",
    "organization_invitations_consume_once",
  ];
  const state = inspectMigrationComponents(db, {
    installation_admins: ["user_id", "created_at"],
    service_principals: ["id", "organization_id", "name", "status", "created_at", "updated_at"],
    scoped_api_tokens: ["id", "user_id", "service_principal_id", "name", "token_prefix", "token_hash", "scopes_json", "organization_id", "project_id", "expires_at", "revoked_at", "last_used_at", "created_at"],
    organization_invitations: ["id", "organization_id", "email_normalized", "role", "token_hash", "expires_at", "accepted_at", "revoked_at", "created_at"],
    security_audit_events: ["id", "actor_type", "actor_id", "action", "organization_id", "project_id", "outcome", "metadata_json", "created_at"],
  }, indexes, triggers);
  if (state.any && state.missing.length === 0) {
    state.missing.push(...compareMigrationDefinitions(
      db,
      "095_authorization_audit.sql",
      "CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE organizations (id TEXT PRIMARY KEY); CREATE TABLE projects (id TEXT PRIMARY KEY);",
      [...tables, ...indexes, ...triggers],
    ));
  }
  state.complete = state.missing.length === 0;
  return state;
}

function inspectResourceOwnershipMigration(db: Database.Database): ResourceTenancyMigrationState {
  const state = inspectMigrationComponents(db, {
    resource_grants: ["id", "organization_id", "resource_type", "resource_id", "grantee_kind", "grantee_id", "permissions_json", "revision"],
    resource_audit_events: ["id", "organization_id", "project_id", "resource_type", "resource_id", "action", "actor_type", "actor_id", "outcome", "request_id"],
    provider_connections: ["id", "provider_key", "owner_kind", "organization_id", "owner_user_id", "credential_item_id", "config_json", "revision"],
    provider_model_policies: ["id", "connection_id", "purpose", "model_id", "revision"],
    resource_ownership_manifests: ["migration", "organization_id", "counts_json", "ids_json", "phase", "created_at"],
  }, [
    "idx_vault_folders_owner_id", "idx_vault_items_owner_id", "idx_resource_grants_resource", "idx_resource_audit_scope", "idx_resource_audit_exactly_once", "idx_vault_audit_exactly_once", "idx_vault_audit_source",
  ], [
    "vault_folders_owner_valid_insert", "vault_folders_owner_valid_update", "vault_folders_owner_immutable",
    "vault_folders_parent_owner_insert", "vault_folders_parent_owner_update",
    "vault_items_owner_valid_insert", "vault_items_owner_valid_update", "vault_items_owner_immutable",
    "vault_items_folder_owner_insert", "vault_items_folder_owner_update",
    "provider_connections_owner_immutable", "provider_connections_owner_valid_insert", "provider_connections_credential_valid_update",
    "provider_connections_config_secret_free_insert", "provider_connections_config_secret_free_update",
    "resource_grants_revision_update", "resource_audit_events_immutable_update", "resource_audit_events_immutable_delete", "resource_audit_events_project_organization_insert",
    "resource_ownership_manifests_immutable_update", "resource_ownership_manifests_immutable_delete",
  ]);
  for (const [table, columns] of Object.entries({
    vault_folders: ["organization_id", "owner_kind", "owner_user_id", "revision", "created_by_actor_type", "created_by_actor_id"],
    vault_items: ["organization_id", "owner_kind", "owner_user_id", "ownership_revision", "created_by_actor_type", "created_by_actor_id"],
    vault_audit_log: ["organization_id", "actor_type", "actor_id", "request_id", "source_audit_event_id"],
  })) {
    const present = new Set((db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map(({ name }) => name));
    const found = columns.filter((column) => present.has(column));
    state.any ||= found.length > 0;
    for (const column of columns) if (!present.has(column)) state.missing.push(`${table}.${column} column`);
  }
  if (state.missing.length === 0) {
    const unmapped = db.prepare(
      "SELECT (SELECT count(*) FROM vault_folders WHERE organization_id IS NULL) + (SELECT count(*) FROM vault_items WHERE organization_id IS NULL) AS count",
    ).get() as { count: number };
    const manifest = db.prepare("SELECT phase FROM resource_ownership_manifests WHERE migration = 96").get() as { phase: string } | undefined;
    if (unmapped.count > 0) state.missing.push("vault ownership backfill");
    if (manifest?.phase !== "verified") state.missing.push("migration 096 verified manifest");
  }
  state.complete = state.missing.length === 0;
  return state;
}

function inspectMailTenancyMigration(db: Database.Database): ResourceTenancyMigrationState {
  const state = inspectMigrationComponents(db, {
    mail_accounts: ["id", "organization_id", "owner_kind", "owner_user_id", "email", "provider", "auth_type", "config_json", "revision"],
    mail_account_credentials: ["organization_id", "account_id", "credential_kind", "encrypted_value", "token_metadata_json", "version"],
    mail_oauth_attempts: ["state_hash", "organization_id", "owner_kind", "owner_user_id", "account_id", "provider", "actor_type", "actor_id", "expires_at", "consumed_at"],
  }, [
    "idx_email_cache_org_account_folder_uid", "idx_email_bodies_org_account_folder_uid",
    "idx_email_sync_state_org_account_folder", "idx_email_suggestions_org_account_folder_uid",
    "idx_email_summaries_org_account_folder_uid", "idx_email_suggestion_queue_org_account_folder_uid",
    "idx_email_watcher_markers_org_account_folder_uid",
    "idx_mail_oauth_attempts_expiry",
  ], [
    "mail_accounts_owner_immutable", "mail_accounts_owner_valid_insert", "mail_accounts_revision_update",
    "mail_account_credentials_scope_insert", "mail_account_credentials_scope_update",
    "mail_oauth_attempts_consume_once",
    "email_cache_account_scope_insert", "email_cache_account_scope_update", "email_bodies_scope_insert",
    "email_sync_state_scope_insert", "email_sync_state_scope_update", "email_bodies_scope_update",
    "email_suggestions_scope_insert", "email_suggestions_scope_update", "email_summaries_scope_insert",
    "email_summaries_scope_update", "email_suggestion_queue_scope_insert", "email_suggestion_queue_scope_update",
    "email_watcher_markers_scope_insert", "email_watcher_markers_scope_update",
  ]);
  const mailTables = ["email_cache", "email_bodies", "email_sync_state", "email_suggestions", "email_summaries", "email_suggestion_queue", "email_watcher_markers"];
  for (const table of mailTables) {
    const present = (db.prepare(`SELECT count(*) AS count FROM pragma_table_info('${table}') WHERE name = 'organization_id'`).get() as { count: number }).count > 0;
    state.any ||= present;
    if (!present) state.missing.push(`${table}.organization_id column`);
  }
  if (state.missing.length === 0) {
    const predicates = mailTables.map((table) => `(SELECT count(*) FROM ${table} WHERE organization_id IS NULL)`).join(" + ");
    const unmapped = db.prepare(`SELECT ${predicates} AS count`).get() as { count: number };
    const manifest = db.prepare("SELECT phase FROM resource_ownership_manifests WHERE migration = 97").get() as { phase: string } | undefined;
    if (unmapped.count > 0) state.missing.push("mail organization backfill");
    if (manifest?.phase !== "verified") state.missing.push("migration 097 verified manifest");
  }
  state.complete = state.missing.length === 0;
  return state;
}

function inspectSynthesisBatchMigration(db: Database.Database): SynthesisBatchMigrationState {
  const tables: Record<string, string[]> = {
    synthesis_batches: [
      "id", "project_id", "stage", "observation_count", "owner_token", "lease_expires_at",
      "proposal_plan", "last_error_code", "last_error_message", "error_count", "revision",
      "traits_applied_at", "proposals_applied_at", "completed_at", "created_at", "updated_at",
    ],
    synthesis_batch_observations: ["batch_id", "project_id", "observation_id", "ordinal"],
  };
  const indexes = [
    "idx_observations_project_id_id",
    "idx_synthesis_batches_incomplete",
    "idx_synthesis_batch_observations_project_observation",
  ];
  const triggers = ["synthesis_batches_validate_insert", "synthesis_batches_validate_stage"];
  const missing: string[] = [];
  let any = false;

  for (const [table, columns] of Object.entries(tables)) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${table} table`);
    else if (!hasContextConversationColumns(db, table, columns)) missing.push(`${table} required columns`);
  }

  for (const index of indexes) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${index} index`);
  }

  for (const trigger of triggers) {
    const exists = (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger) as { count: number }).count > 0;
    any ||= exists;
    if (!exists) missing.push(`${trigger} trigger`);
  }

  if (!any) return { any: false, complete: false, missing };

  const batchSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'synthesis_batches'",
  ).get() as { sql?: string } | undefined;
  if (!batchSql?.sql || ![
    "stage TEXT NOT NULL DEFAULT 'created'",
    "observation_count INTEGER NOT NULL CHECK(observation_count BETWEEN 1 AND 50)",
    "REFERENCES projects(id) ON DELETE CASCADE",
    "UNIQUE(id, project_id)",
    "proposal_plan IS NOT NULL",
  ].every((fragment) => batchSql.sql!.includes(fragment))) {
    missing.push("synthesis_batches state constraints");
  }

  const observationIndexSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_observations_project_id_id'",
  ).get() as { sql?: string } | undefined;
  if (!observationIndexSql?.sql?.includes("CREATE UNIQUE INDEX")) {
    missing.push("idx_observations_project_id_id unique index");
  }

  for (const [table, reference, columns] of [
    ["synthesis_batch_observations", "synthesis_batches", ["batch_id", "project_id"]],
    ["synthesis_batch_observations", "observations", ["project_id", "observation_id"]],
  ] as Array<[string, string, string[]]>) {
    if (!hasCompositeForeignKey(db, table, reference, columns)) {
      missing.push(`${table} → ${reference} composite foreign key`);
    }
  }

  const stageTrigger = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'synthesis_batches_validate_stage'",
  ).get() as { sql?: string } | undefined;
  if (!stageTrigger?.sql || ![
    "OLD.stage = 'created' AND NEW.stage = 'traits_applied'",
    "OLD.stage = 'traits_applied' AND NEW.stage = 'proposals_applied'",
    "OLD.stage = 'proposals_applied' AND NEW.stage = 'complete'",
    "observation.status <> 'processed'",
  ].every((fragment) => stageTrigger.sql!.includes(fragment))) {
    missing.push("synthesis_batches stage trigger");
  }

  return { any: true, complete: missing.length === 0, missing };
}

function restoreMigrationPartialStateError(migration: string, missing: string[]): Error {
  return new Error(
    `Migration ${migration} is in a PARTIAL state. Missing required components: ${missing.join(", ")}.`
    + " Restore the migration's complete schema before retrying.",
  );
}

function assertNoPartialRestoreMigrations(db: Database.Database): void {
  const restorePlansMigration = inspectRestorePlansMigration(db);
  if (restorePlansMigration.any && !restorePlansMigration.complete) {
    throw restoreMigrationPartialStateError("083", restorePlansMigration.missing);
  }

  const restoreExecutorMigration = inspectRestoreExecutorMigration(db);
  if (restoreExecutorMigration.any && !restoreExecutorMigration.complete) {
    throw restoreMigrationPartialStateError("084", restoreExecutorMigration.missing);
  }
  if (restoreExecutorMigration.any && !restorePlansMigration.complete) {
    throw restoreMigrationPartialStateError("084", ["migration 083 prerequisite schema"]);
  }

  const backupDeletionReservationsMigration = inspectBackupDeletionReservationsMigration(db);
  if (backupDeletionReservationsMigration.any) {
    const missing = [
      ...(!restorePlansMigration.complete ? ["migration 083 prerequisite schema"] : []),
      ...backupDeletionReservationsMigration.missing,
    ];
    if (missing.length > 0) throw restoreMigrationPartialStateError("090", missing);
  }

  const restorePhaseEventsMigration = inspectRestoreExecutorPhaseEventsMigration(db);
  if (!restorePhaseEventsMigration.any) return;
  const missing = [
    ...(!restorePlansMigration.complete ? ["migration 083 prerequisite schema"] : []),
    ...(!restoreExecutorMigration.complete ? ["migration 084 prerequisite schema"] : []),
    ...restorePhaseEventsMigration.missing,
  ];
  if (missing.length > 0) throw restoreMigrationPartialStateError("085", missing);
}

function contextRepairError(message: string): Error {
  return new Error(`Migration 067 context repair preflight refused: ${message}`);
}

function contextRepairHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalizeForContextRepair(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForContextRepair);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeForContextRepair(entry)]));
  }
  return value;
}

function requestHashForContextRepair(value: unknown): string {
  return contextRepairHash(JSON.stringify(canonicalizeForContextRepair(value)));
}

function contextTableExists(db: Database.Database, table: string): boolean {
  return (db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { count: number }).count > 0;
}

function contextTableColumns(db: Database.Database, table: string): Set<string> {
  if (!contextTableExists(db, table)) return new Set();
  return new Set((db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>)
    .map((column) => column.name));
}

function contextRepairRows(db: Database.Database, table: string): ContextRepairRow[] {
  if (!contextTableExists(db, table)) return [];
  try {
    return db.prepare(`SELECT rowid AS __repair_rowid, * FROM ${table}`).all() as ContextRepairRow[];
  } catch {
    // A hand-created partial table can be WITHOUT ROWID. It remains repairable;
    // the stable query order is only used when a missing sequence must be filled.
    return db.prepare(`SELECT * FROM ${table}`).all().map((row, index) => ({
      ...(row as Record<string, unknown>),
      __repair_rowid: index,
    }));
  }
}

function contextColumnValue(row: ContextRepairRow, columns: Set<string>, column: string): unknown {
  return columns.has(column) ? row[column] : undefined;
}

function requiredContextString(
  value: unknown,
  label: string,
  fallback?: string,
): string {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw contextRepairError(`${label} is required to preserve existing rows`);
  }
  if (typeof value !== "string" || value.length === 0) {
    throw contextRepairError(`${label} must be a non-empty string`);
  }
  return value;
}

function nullableIdempotencyKey(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !CONTEXT_IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw contextRepairError(`${label} must be null or a 1–128 character idempotency key`);
  }
  return value;
}

function boundedContextInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw contextRepairError(`${label} is required to preserve existing rows`);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw contextRepairError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function contextJsonValue(
  value: unknown,
  label: string,
  expected: "array" | "object",
  maxBytes: number,
  fallback: string,
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw contextRepairError(`${label} must be bounded JSON`);
  }
  try {
    const parsed = JSON.parse(value);
    const valid = expected === "array"
      ? Array.isArray(parsed)
      : Boolean(parsed) && !Array.isArray(parsed) && typeof parsed === "object";
    if (!valid) throw new Error("unexpected JSON type");
  } catch {
    throw contextRepairError(`${label} must be a JSON ${expected}`);
  }
  return value;
}

function contextCreatedAt(value: unknown, label: string): string {
  if (value === undefined || value === null) return CONTEXT_REPAIR_DEFAULT_CREATED_AT;
  if (typeof value !== "string" || value.length === 0) {
    throw contextRepairError(`${label} must be a non-empty timestamp string`);
  }
  return value;
}

function contextHashValue(value: unknown, fallback: string, label: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !CONTEXT_HASH_PATTERN.test(value)) {
    throw contextRepairError(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function assertContextRepairDatabaseIntegrity(db: Database.Database, phase: "preflight" | "post-repair"): void {
  const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") {
    throw contextRepairError(`${phase} integrity_check failed: ${JSON.stringify(integrityRows)}`);
  }
  let foreignKeyRows: unknown[];
  try {
    foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all();
  } catch (error) {
    // A deliberately partial 063 parent table can make an existing child FK a
    // temporary "foreign key mismatch". The canonical rebuild validates every
    // context relationship itself, then runs the full check once the target
    // parent keys exist again. Any other preflight failure still refuses repair.
    if (phase === "preflight" && error instanceof Error && /foreign key mismatch/i.test(error.message)) return;
    throw error;
  }
  if (foreignKeyRows.length > 0) {
    throw contextRepairError(`${phase} foreign_key_check found ${foreignKeyRows.length} violation(s)`);
  }
}

function contextSourceSchemaHash(db: Database.Database): string {
  const names = [
    "context_conversations",
    "context_messages",
    "context_messages_fts",
    "context_checkpoints",
    "context_checkpoint_rag_sources",
  ];
  const placeholders = names.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
     FROM sqlite_master WHERE name IN (${placeholders}) ORDER BY type, name`,
  ).all(...names) as Array<{ type: string; name: string; tbl_name: string; sql: string }>;
  return contextRepairHash(JSON.stringify(rows));
}

function assignMissingContextSequences<T extends { sequence?: number; created_at: string; rowid: number }>(
  rows: T[],
  label: string,
): void {
  const used = new Set<number>();
  for (const row of rows) {
    if (row.sequence === undefined) continue;
    if (used.has(row.sequence)) throw contextRepairError(`${label} contains duplicate sequence values`);
    used.add(row.sequence);
  }
  const missing = rows.filter((row) => row.sequence === undefined)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.rowid - right.rowid);
  let candidate = 0;
  for (const row of missing) {
    while (used.has(candidate)) candidate += 1;
    row.sequence = candidate;
    used.add(candidate);
    candidate += 1;
  }
}

function assertUniqueContextValues(values: Array<string>, label: string): void {
  if (new Set(values).size !== values.length) {
    throw contextRepairError(`${label} contains duplicate values that the repaired schema forbids`);
  }
}

/**
 * Project legacy/partial 063 rows into the canonical schema without mutating the
 * source tables. Any value that cannot be represented safely makes preflight
 * refuse before the transactional rebuild starts.
 */
function buildContextMigrationRepairData(db: Database.Database): ContextMigrationRepairData {
  const conversationColumns = contextTableColumns(db, "context_conversations");
  const messageColumns = contextTableColumns(db, "context_messages");
  const checkpointColumns = contextTableColumns(db, "context_checkpoints");
  const checkpointRagSourceColumns = contextTableColumns(db, "context_checkpoint_rag_sources");
  const conversationRows = contextRepairRows(db, "context_conversations");
  const messageRows = contextRepairRows(db, "context_messages");
  const checkpointRows = contextRepairRows(db, "context_checkpoints");
  const checkpointRagSourceRows = contextRepairRows(db, "context_checkpoint_rag_sources");

  if (conversationRows.length > 0 && !conversationColumns.has("project_id")) {
    throw contextRepairError("context_conversations.project_id is absent on non-empty data; ownership cannot be inferred safely");
  }
  if (messageRows.length > 0 && !messageColumns.has("conversation_id")) {
    throw contextRepairError("context_messages.conversation_id is absent on non-empty data; message ownership cannot be inferred safely");
  }
  if (checkpointRows.length > 0 && !checkpointColumns.has("conversation_id") && !checkpointColumns.has("through_message_id")) {
    throw contextRepairError("context_checkpoints lacks both conversation_id and through_message_id on non-empty data");
  }
  if (checkpointRagSourceRows.length > 0 && !checkpointRagSourceColumns.has("checkpoint_id")) {
    throw contextRepairError("context_checkpoint_rag_sources.checkpoint_id is absent on non-empty data");
  }
  assertContextRepairDatabaseIntegrity(db, "preflight");

  const projectIds = new Set((db.prepare("SELECT id FROM projects").all() as Array<{ id: string }>).map((row) => row.id));
  const conversations = conversationRows.map((row) => {
    const id = requiredContextString(contextColumnValue(row, conversationColumns, "id"), "context_conversations.id");
    const projectId = requiredContextString(
      contextColumnValue(row, conversationColumns, "project_id"),
      "context_conversations.project_id",
    );
    if (!projectIds.has(projectId)) {
      throw contextRepairError(`context_conversations ${id} references missing project ${projectId}`);
    }
    const title = requiredContextString(
      contextColumnValue(row, conversationColumns, "title"),
      "context_conversations.title",
      `Recovered context conversation ${id}`.slice(0, 256),
    );
    if (title.length > 256) throw contextRepairError(`context_conversations ${id} title exceeds 256 characters`);
    const tags = contextJsonValue(
      contextColumnValue(row, conversationColumns, "tags"),
      `context_conversations ${id} tags`,
      "array",
      4096,
      "[]",
    );
    const priority = boundedContextInteger(
      contextColumnValue(row, conversationColumns, "priority"),
      `context_conversations ${id} priority`,
      0,
      10,
      5,
    );
    const metadata = contextJsonValue(
      contextColumnValue(row, conversationColumns, "metadata"),
      `context_conversations ${id} metadata`,
      "object",
      16384,
      "{}",
    );
    return {
      id,
      project_id: projectId,
      title,
      request_hash: contextHashValue(
        contextColumnValue(row, conversationColumns, "request_hash"),
        requestHashForContextRepair({ title, tags: JSON.parse(tags), priority, metadata: JSON.parse(metadata) }),
        `context_conversations ${id} request_hash`,
      ),
      idempotency_key: nullableIdempotencyKey(
        contextColumnValue(row, conversationColumns, "idempotency_key"),
        `context_conversations ${id} idempotency_key`,
      ),
      tags,
      priority,
      metadata,
      created_at: contextCreatedAt(contextColumnValue(row, conversationColumns, "created_at"), `context_conversations ${id} created_at`),
    };
  });
  assertUniqueContextValues(conversations.map((row) => row.id), "context_conversations.id");
  assertUniqueContextValues(
    conversations.filter((row) => row.idempotency_key !== null)
      .map((row) => `${row.project_id}\u0000${row.idempotency_key}`),
    "context_conversations project/idempotency keys",
  );
  const conversationById = new Map(conversations.map((row) => [row.id, row]));

  const messageDrafts = messageRows.map((row) => {
    const id = requiredContextString(contextColumnValue(row, messageColumns, "id"), "context_messages.id");
    const conversationId = requiredContextString(
      contextColumnValue(row, messageColumns, "conversation_id"),
      `context_messages ${id} conversation_id`,
    );
    const conversation = conversationById.get(conversationId);
    if (!conversation) throw contextRepairError(`context_messages ${id} references missing conversation ${conversationId}`);
    const projectId = requiredContextString(
      contextColumnValue(row, messageColumns, "project_id"),
      `context_messages ${id} project_id`,
      conversation.project_id,
    );
    if (projectId !== conversation.project_id) {
      throw contextRepairError(`context_messages ${id} project_id does not match its conversation`);
    }
    const content = requiredContextString(contextColumnValue(row, messageColumns, "content"), `context_messages ${id} content`);
    if (content.length > 262144) throw contextRepairError(`context_messages ${id} content exceeds 262144 characters`);
    const role = requiredContextString(contextColumnValue(row, messageColumns, "role"), `context_messages ${id} role`);
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      throw contextRepairError(`context_messages ${id} has an unsupported role`);
    }
    const tags = contextJsonValue(contextColumnValue(row, messageColumns, "tags"), `context_messages ${id} tags`, "array", 4096, "[]");
    const priority = boundedContextInteger(contextColumnValue(row, messageColumns, "priority"), `context_messages ${id} priority`, 0, 10, 5);
    const metadata = contextJsonValue(contextColumnValue(row, messageColumns, "metadata"), `context_messages ${id} metadata`, "object", 16384, "{}");
    const sequenceValue = contextColumnValue(row, messageColumns, "sequence");
    const sequence = sequenceValue === undefined || sequenceValue === null
      ? undefined
      : boundedContextInteger(sequenceValue, `context_messages ${id} sequence`, 0, Number.MAX_SAFE_INTEGER);
    const createdAt = contextCreatedAt(contextColumnValue(row, messageColumns, "created_at"), `context_messages ${id} created_at`);
    return {
      id,
      project_id: projectId,
      conversation_id: conversationId,
      sequence,
      role,
      content,
      content_hash: contextHashValue(
        contextColumnValue(row, messageColumns, "content_hash"),
        contextRepairHash(content),
        `context_messages ${id} content_hash`,
      ),
      request_hash: contextColumnValue(row, messageColumns, "request_hash"),
      idempotency_key: nullableIdempotencyKey(contextColumnValue(row, messageColumns, "idempotency_key"), `context_messages ${id} idempotency_key`),
      tags,
      priority,
      metadata,
      created_at: createdAt,
      rowid: typeof row.__repair_rowid === "number" ? row.__repair_rowid : 0,
    };
  });
  assertUniqueContextValues(messageDrafts.map((row) => row.id), "context_messages.id");
  const messageDraftsByConversation = new Map<string, typeof messageDrafts>();
  for (const draft of messageDrafts) {
    const entries = messageDraftsByConversation.get(draft.conversation_id) ?? [];
    entries.push(draft);
    messageDraftsByConversation.set(draft.conversation_id, entries);
  }
  for (const [conversationId, drafts] of messageDraftsByConversation) {
    assignMissingContextSequences(drafts, `context_messages for conversation ${conversationId}`);
  }
  const messages = messageDrafts.map((draft) => {
    const sequence = draft.sequence;
    if (sequence === undefined) throw new Error("Context message repair sequence assignment failed");
    const requestHash = contextHashValue(
      draft.request_hash,
      requestHashForContextRepair({
        role: draft.role,
        contentHash: draft.content_hash,
        tags: JSON.parse(draft.tags),
        priority: draft.priority,
        metadata: JSON.parse(draft.metadata),
        expectedRevision: sequence,
      }),
      `context_messages ${draft.id} request_hash`,
    );
    const { rowid: _rowid, ...message } = draft;
    return { ...message, sequence, request_hash: requestHash };
  });
  assertUniqueContextValues(
    messages.map((row) => `${row.project_id}\u0000${row.conversation_id}\u0000${row.sequence}`),
    "context_messages conversation/sequence values",
  );
  assertUniqueContextValues(
    messages.filter((row) => row.idempotency_key !== null)
      .map((row) => `${row.project_id}\u0000${row.conversation_id}\u0000${row.idempotency_key}`),
    "context_messages conversation/idempotency keys",
  );
  const messagesByConversation = new Map<string, RepairedContextMessage[]>();
  for (const message of messages) {
    const entries = messagesByConversation.get(message.conversation_id) ?? [];
    entries.push(message);
    messagesByConversation.set(message.conversation_id, entries);
  }
  for (const entries of messagesByConversation.values()) entries.sort((left, right) => left.sequence - right.sequence);
  const messageById = new Map(messages.map((row) => [row.id, row]));

  const checkpointDrafts = checkpointRows.map((row) => {
    const id = requiredContextString(contextColumnValue(row, checkpointColumns, "id"), "context_checkpoints.id");
    const throughMessageId = contextColumnValue(row, checkpointColumns, "through_message_id");
    const derivedConversationId = typeof throughMessageId === "string" ? messageById.get(throughMessageId)?.conversation_id : undefined;
    const conversationId = requiredContextString(
      contextColumnValue(row, checkpointColumns, "conversation_id"),
      `context_checkpoints ${id} conversation_id`,
      derivedConversationId,
    );
    const conversation = conversationById.get(conversationId);
    if (!conversation) throw contextRepairError(`context_checkpoints ${id} references missing conversation ${conversationId}`);
    const projectId = requiredContextString(
      contextColumnValue(row, checkpointColumns, "project_id"),
      `context_checkpoints ${id} project_id`,
      conversation.project_id,
    );
    if (projectId !== conversation.project_id) {
      throw contextRepairError(`context_checkpoints ${id} project_id does not match its conversation`);
    }
    const sequenceValue = contextColumnValue(row, checkpointColumns, "sequence");
    const sequence = sequenceValue === undefined || sequenceValue === null
      ? undefined
      : boundedContextInteger(sequenceValue, `context_checkpoints ${id} sequence`, 0, Number.MAX_SAFE_INTEGER);
    const messageCountValue = contextColumnValue(row, checkpointColumns, "message_count");
    const messageCount = messageCountValue === undefined || messageCountValue === null
      ? undefined
      : boundedContextInteger(messageCountValue, `context_checkpoints ${id} message_count`, 1, Number.MAX_SAFE_INTEGER);
    return {
      id,
      project_id: projectId,
      conversation_id: conversationId,
      sequence,
      through_message_id: throughMessageId,
      message_count: messageCount,
      state_hash: contextColumnValue(row, checkpointColumns, "state_hash"),
      request_hash: contextColumnValue(row, checkpointColumns, "request_hash"),
      idempotency_key: nullableIdempotencyKey(contextColumnValue(row, checkpointColumns, "idempotency_key"), `context_checkpoints ${id} idempotency_key`),
      metadata: contextJsonValue(contextColumnValue(row, checkpointColumns, "metadata"), `context_checkpoints ${id} metadata`, "object", 16384, "{}"),
      created_at: contextCreatedAt(contextColumnValue(row, checkpointColumns, "created_at"), `context_checkpoints ${id} created_at`),
      rowid: typeof row.__repair_rowid === "number" ? row.__repair_rowid : 0,
    };
  });
  assertUniqueContextValues(checkpointDrafts.map((row) => row.id), "context_checkpoints.id");
  const checkpointDraftsByConversation = new Map<string, typeof checkpointDrafts>();
  for (const draft of checkpointDrafts) {
    const entries = checkpointDraftsByConversation.get(draft.conversation_id) ?? [];
    entries.push(draft);
    checkpointDraftsByConversation.set(draft.conversation_id, entries);
  }
  for (const [conversationId, drafts] of checkpointDraftsByConversation) {
    assignMissingContextSequences(drafts, `context_checkpoints for conversation ${conversationId}`);
  }
  const checkpoints = checkpointDrafts.map((draft) => {
    const conversationMessages = messagesByConversation.get(draft.conversation_id) ?? [];
    const rawThroughMessageId = draft.through_message_id;
    const throughMessageIndex = typeof rawThroughMessageId === "string"
      ? conversationMessages.findIndex((message) => message.id === rawThroughMessageId)
      : -1;
    const messageCount = draft.message_count ?? (throughMessageIndex >= 0 ? throughMessageIndex + 1 : conversationMessages.length);
    const checkpointMessages = conversationMessages.filter((message) => message.sequence < messageCount);
    const checkpointTail = checkpointMessages[checkpointMessages.length - 1];
    if (checkpointMessages.length !== messageCount || !checkpointTail) {
      throw contextRepairError(`context_checkpoints ${draft.id} cannot be matched to a complete message prefix`);
    }
    const throughMessageId = requiredContextString(rawThroughMessageId, `context_checkpoints ${draft.id} through_message_id`, checkpointTail.id);
    if (throughMessageId !== checkpointTail.id) {
      throw contextRepairError(`context_checkpoints ${draft.id} through_message_id does not match its message prefix`);
    }
    const stateHash = contextHashValue(
      draft.state_hash,
      contextRepairHash(JSON.stringify(checkpointMessages.map((message) => ({
        sequence: message.sequence,
        role: message.role,
        content_hash: message.content_hash,
        tags: message.tags,
        priority: message.priority,
        metadata: message.metadata,
      })))),
      `context_checkpoints ${draft.id} state_hash`,
    );
    if (draft.sequence === undefined) throw new Error("Context checkpoint repair sequence assignment failed");
    return {
      id: draft.id,
      project_id: draft.project_id,
      conversation_id: draft.conversation_id,
      sequence: draft.sequence,
      through_message_id: throughMessageId,
      message_count: messageCount,
      state_hash: stateHash,
      request_hash: "",
      idempotency_key: draft.idempotency_key,
      metadata: draft.metadata,
      created_at: draft.created_at,
      repair_request_hash: draft.request_hash === undefined || draft.request_hash === null
        ? undefined
        : contextHashValue(draft.request_hash, "", `context_checkpoints ${draft.id} request_hash`),
    };
  });
  assertUniqueContextValues(
    checkpoints.map((row) => `${row.project_id}\u0000${row.conversation_id}\u0000${row.sequence}`),
    "context_checkpoints conversation/sequence values",
  );
  assertUniqueContextValues(
    checkpoints.filter((row) => row.idempotency_key !== null)
      .map((row) => `${row.project_id}\u0000${row.conversation_id}\u0000${row.idempotency_key}`),
    "context_checkpoints conversation/idempotency keys",
  );
  const checkpointById = new Map(checkpoints.map((row) => [row.id, row]));

  const ragSources = new Map((db.prepare("SELECT id, project_id FROM rag_sources").all() as Array<{ id: string; project_id: string }>)
    .map((row) => [row.id, row.project_id]));
  const checkpointRagSourceDrafts = checkpointRagSourceRows.map((row) => {
    const checkpointId = requiredContextString(
      contextColumnValue(row, checkpointRagSourceColumns, "checkpoint_id"),
      "context_checkpoint_rag_sources.checkpoint_id",
    );
    const checkpoint = checkpointById.get(checkpointId);
    if (!checkpoint) throw contextRepairError(`context_checkpoint_rag_sources references missing checkpoint ${checkpointId}`);
    const projectId = requiredContextString(
      contextColumnValue(row, checkpointRagSourceColumns, "project_id"),
      `context_checkpoint_rag_sources ${checkpointId} project_id`,
      checkpoint.project_id,
    );
    if (projectId !== checkpoint.project_id) {
      throw contextRepairError(`context_checkpoint_rag_sources ${checkpointId} project_id does not match its checkpoint`);
    }
    const ragSourceId = requiredContextString(
      contextColumnValue(row, checkpointRagSourceColumns, "rag_source_id"),
      `context_checkpoint_rag_sources ${checkpointId} rag_source_id`,
    );
    if (ragSources.get(ragSourceId) !== projectId) {
      throw contextRepairError(`context_checkpoint_rag_sources ${checkpointId} references a missing or cross-project RAG source`);
    }
    const ordinalValue = contextColumnValue(row, checkpointRagSourceColumns, "ordinal");
    const ordinal = ordinalValue === undefined || ordinalValue === null
      ? undefined
      : boundedContextInteger(ordinalValue, `context_checkpoint_rag_sources ${checkpointId} ordinal`, 0, Number.MAX_SAFE_INTEGER);
    return {
      project_id: projectId,
      checkpoint_id: checkpointId,
      rag_source_id: ragSourceId,
      sequence: ordinal,
      metadata: contextJsonValue(contextColumnValue(row, checkpointRagSourceColumns, "metadata"), `context_checkpoint_rag_sources ${checkpointId} metadata`, "object", 16384, "{}"),
      created_at: contextCreatedAt(
        contextColumnValue(row, checkpointRagSourceColumns, "created_at"),
        `context_checkpoint_rag_sources ${checkpointId} created_at`,
      ),
      rowid: typeof row.__repair_rowid === "number" ? row.__repair_rowid : 0,
    };
  });
  const checkpointRagSourceDraftsByCheckpoint = new Map<string, typeof checkpointRagSourceDrafts>();
  for (const draft of checkpointRagSourceDrafts) {
    const entries = checkpointRagSourceDraftsByCheckpoint.get(draft.checkpoint_id) ?? [];
    entries.push(draft);
    checkpointRagSourceDraftsByCheckpoint.set(draft.checkpoint_id, entries);
  }
  for (const [checkpointId, drafts] of checkpointRagSourceDraftsByCheckpoint) {
    assignMissingContextSequences(drafts, `context_checkpoint_rag_sources for checkpoint ${checkpointId}`);
  }
  const checkpointRagSources = checkpointRagSourceDrafts.map((draft) => {
    if (draft.sequence === undefined) throw new Error("Context checkpoint RAG repair ordinal assignment failed");
    const { rowid: _rowid, sequence, ...link } = draft;
    return { ...link, ordinal: sequence };
  });
  assertUniqueContextValues(
    checkpointRagSources.map((row) => `${row.project_id}\u0000${row.checkpoint_id}\u0000${row.rag_source_id}`),
    "context_checkpoint_rag_sources checkpoint/source values",
  );
  assertUniqueContextValues(
    checkpointRagSources.map((row) => `${row.project_id}\u0000${row.checkpoint_id}\u0000${row.ordinal}`),
    "context_checkpoint_rag_sources checkpoint/ordinal values",
  );

  for (const checkpoint of checkpoints) {
    const ragSourceIds = checkpointRagSources
      .filter((link) => link.checkpoint_id === checkpoint.id)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((link) => link.rag_source_id);
    checkpoint.request_hash = checkpoint.repair_request_hash ?? requestHashForContextRepair({
      ragSourceIds,
      metadata: JSON.parse(checkpoint.metadata),
      expectedRevision: checkpoint.message_count,
    });
    delete checkpoint.repair_request_hash;
  }

  return {
    conversations,
    messages,
    checkpoints,
    checkpointRagSources,
    sourceSchemaHash: contextSourceSchemaHash(db),
  };
}

const CONTEXT_MIGRATION_REPAIR_STAGING_SQL = `
CREATE TABLE context_conversations__g3 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array' AND length(CAST(tags AS BLOB)) <= 4096),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 0 AND 10),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata) = 'object' AND length(CAST(metadata AS BLOB)) <= 16384),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);
CREATE TABLE context_messages__g3 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 262144),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array' AND length(CAST(tags AS BLOB)) <= 4096),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 0 AND 10),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata) = 'object' AND length(CAST(metadata AS BLOB)) <= 16384),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, conversation_id, id),
  UNIQUE(project_id, conversation_id, sequence),
  UNIQUE(project_id, conversation_id, idempotency_key),
  FOREIGN KEY(project_id, conversation_id) REFERENCES context_conversations__g3(project_id, id) ON DELETE RESTRICT
);
CREATE TABLE context_checkpoints__g3 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  through_message_id TEXT NOT NULL,
  message_count INTEGER NOT NULL CHECK(message_count >= 1),
  state_hash TEXT NOT NULL CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*')),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata) = 'object' AND length(CAST(metadata AS BLOB)) <= 16384),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, conversation_id, sequence),
  UNIQUE(project_id, conversation_id, idempotency_key),
  FOREIGN KEY(project_id, conversation_id) REFERENCES context_conversations__g3(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id, through_message_id) REFERENCES context_messages__g3(project_id, conversation_id, id) ON DELETE RESTRICT
);
CREATE TABLE context_checkpoint_rag_sources__g3 (
  project_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  rag_source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata) = 'object' AND length(CAST(metadata AS BLOB)) <= 16384),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, checkpoint_id, rag_source_id),
  UNIQUE(project_id, checkpoint_id, ordinal),
  FOREIGN KEY(project_id, checkpoint_id) REFERENCES context_checkpoints__g3(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, rag_source_id) REFERENCES rag_sources(project_id, id) ON DELETE RESTRICT
);
`;

const CONTEXT_MIGRATION_REPAIR_FINALIZE_SQL = `
DROP TRIGGER IF EXISTS context_conversations_immutable_update;
DROP TRIGGER IF EXISTS context_conversations_immutable_delete;
DROP TRIGGER IF EXISTS context_messages_immutable_update;
DROP TRIGGER IF EXISTS context_messages_immutable_delete;
DROP TRIGGER IF EXISTS context_messages_fts_insert;
DROP TRIGGER IF EXISTS context_checkpoints_immutable_update;
DROP TRIGGER IF EXISTS context_checkpoints_immutable_delete;
DROP TRIGGER IF EXISTS context_checkpoint_rag_sources_immutable_update;
DROP TRIGGER IF EXISTS context_checkpoint_rag_sources_immutable_delete;
DROP TRIGGER IF EXISTS rag_sources_context_checkpoint_immutable_update;
DROP TRIGGER IF EXISTS rag_sources_context_checkpoint_immutable_delete;
DROP TRIGGER IF EXISTS rag_chunks_context_checkpoint_immutable_insert;
DROP TRIGGER IF EXISTS rag_chunks_context_checkpoint_immutable_update;
DROP TRIGGER IF EXISTS rag_chunks_context_checkpoint_immutable_delete;
DROP TABLE IF EXISTS context_messages_fts;
DROP TABLE IF EXISTS context_checkpoint_rag_sources;
DROP TABLE IF EXISTS context_checkpoints;
DROP TABLE IF EXISTS context_messages;
DROP TABLE IF EXISTS context_conversations;
ALTER TABLE context_conversations__g3 RENAME TO context_conversations;
ALTER TABLE context_messages__g3 RENAME TO context_messages;
ALTER TABLE context_checkpoints__g3 RENAME TO context_checkpoints;
ALTER TABLE context_checkpoint_rag_sources__g3 RENAME TO context_checkpoint_rag_sources;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_sources_project_id ON rag_sources(project_id, id);
CREATE INDEX idx_context_conversations_project_created ON context_conversations(project_id, created_at DESC, id DESC);
CREATE INDEX idx_context_messages_conversation_sequence ON context_messages(project_id, conversation_id, sequence ASC);
CREATE INDEX idx_context_checkpoints_conversation_sequence ON context_checkpoints(project_id, conversation_id, sequence DESC);
CREATE INDEX idx_context_checkpoint_rag_sources_source ON context_checkpoint_rag_sources(project_id, rag_source_id);
CREATE VIRTUAL TABLE context_messages_fts USING fts5(content, content='context_messages', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER context_conversations_immutable_update BEFORE UPDATE ON context_conversations BEGIN SELECT RAISE(ABORT, 'context_conversations rows are immutable — UPDATE rejected'); END;
CREATE TRIGGER context_conversations_immutable_delete BEFORE DELETE ON context_conversations BEGIN SELECT RAISE(ABORT, 'context_conversations rows are immutable — DELETE rejected'); END;
CREATE TRIGGER context_messages_immutable_update BEFORE UPDATE ON context_messages BEGIN SELECT RAISE(ABORT, 'context_messages rows are immutable — UPDATE rejected'); END;
CREATE TRIGGER context_messages_immutable_delete BEFORE DELETE ON context_messages BEGIN SELECT RAISE(ABORT, 'context_messages rows are immutable — DELETE rejected'); END;
CREATE TRIGGER context_messages_fts_insert AFTER INSERT ON context_messages BEGIN INSERT INTO context_messages_fts(rowid, content) VALUES (new.rowid, new.content); END;
CREATE TRIGGER context_checkpoints_immutable_update BEFORE UPDATE ON context_checkpoints BEGIN SELECT RAISE(ABORT, 'context_checkpoints rows are immutable — UPDATE rejected'); END;
CREATE TRIGGER context_checkpoints_immutable_delete BEFORE DELETE ON context_checkpoints BEGIN SELECT RAISE(ABORT, 'context_checkpoints rows are immutable — DELETE rejected'); END;
CREATE TRIGGER context_checkpoint_rag_sources_immutable_update BEFORE UPDATE ON context_checkpoint_rag_sources BEGIN SELECT RAISE(ABORT, 'context_checkpoint_rag_sources rows are immutable — UPDATE rejected'); END;
CREATE TRIGGER context_checkpoint_rag_sources_immutable_delete BEFORE DELETE ON context_checkpoint_rag_sources BEGIN SELECT RAISE(ABORT, 'context_checkpoint_rag_sources rows are immutable — DELETE rejected'); END;
CREATE TRIGGER rag_sources_context_checkpoint_immutable_update BEFORE UPDATE ON rag_sources WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link WHERE link.project_id = old.project_id AND link.rag_source_id = old.id) BEGIN SELECT RAISE(ABORT, 'checkpoint RAG sources are immutable — UPDATE rejected'); END;
CREATE TRIGGER rag_sources_context_checkpoint_immutable_delete BEFORE DELETE ON rag_sources WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link WHERE link.project_id = old.project_id AND link.rag_source_id = old.id) BEGIN SELECT RAISE(ABORT, 'checkpoint RAG sources are immutable — DELETE rejected'); END;
CREATE TRIGGER rag_chunks_context_checkpoint_immutable_insert BEFORE INSERT ON rag_chunks WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link JOIN rag_sources source ON source.id = link.rag_source_id WHERE source.id = new.source_id) BEGIN SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — INSERT rejected'); END;
CREATE TRIGGER rag_chunks_context_checkpoint_immutable_update BEFORE UPDATE ON rag_chunks WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link JOIN rag_sources source ON source.id = link.rag_source_id WHERE source.id = old.source_id) BEGIN SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — UPDATE rejected'); END;
CREATE TRIGGER rag_chunks_context_checkpoint_immutable_delete BEFORE DELETE ON rag_chunks WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link JOIN rag_sources source ON source.id = link.rag_source_id WHERE source.id = old.source_id) BEGIN SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — DELETE rejected'); END;
INSERT INTO context_messages_fts(context_messages_fts) VALUES ('rebuild');
`;

function contextRepairArtifactsExist(db: Database.Database): boolean {
  const artifacts = [
    "context_conversations__g3",
    "context_messages__g3",
    "context_checkpoints__g3",
    "context_checkpoint_rag_sources__g3",
  ];
  return artifacts.some((artifact) => contextTableExists(db, artifact));
}

/**
 * Repair a partially applied migration 063 in one SQLite transaction. The
 * old tables are not altered in place: canonical staging tables receive an
 * exact projection first, and source tables are replaced only after every row
 * has been accepted by the target constraints.
 */
function repairContextConversationMigration(
  db: Database.Database,
  migrationsDir: string,
): void {
  if (contextRepairArtifactsExist(db)) {
    throw contextRepairError("reserved G3 staging artifacts already exist; preserve the database and restore from a verified backup");
  }
  const repair = buildContextMigrationRepairData(db);
  const migrationSql = readFileSync(resolve(migrationsDir, "067_context_migration_repair.sql"), "utf-8");
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(migrationSql);
      db.exec(CONTEXT_MIGRATION_REPAIR_STAGING_SQL);

      const insertConversation = db.prepare(
        `INSERT INTO context_conversations__g3
         (id, project_id, title, request_hash, idempotency_key, tags, priority, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of repair.conversations) {
        insertConversation.run(
          row.id, row.project_id, row.title, row.request_hash, row.idempotency_key,
          row.tags, row.priority, row.metadata, row.created_at,
        );
      }

      const insertMessage = db.prepare(
        `INSERT INTO context_messages__g3
         (id, project_id, conversation_id, sequence, role, content, content_hash, request_hash,
          idempotency_key, tags, priority, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of repair.messages) {
        insertMessage.run(
          row.id, row.project_id, row.conversation_id, row.sequence, row.role, row.content,
          row.content_hash, row.request_hash, row.idempotency_key, row.tags, row.priority,
          row.metadata, row.created_at,
        );
      }

      const insertCheckpoint = db.prepare(
        `INSERT INTO context_checkpoints__g3
         (id, project_id, conversation_id, sequence, through_message_id, message_count, state_hash,
          request_hash, idempotency_key, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of repair.checkpoints) {
        insertCheckpoint.run(
          row.id, row.project_id, row.conversation_id, row.sequence, row.through_message_id,
          row.message_count, row.state_hash, row.request_hash, row.idempotency_key,
          row.metadata, row.created_at,
        );
      }

      const insertCheckpointRagSource = db.prepare(
        `INSERT INTO context_checkpoint_rag_sources__g3
         (project_id, checkpoint_id, rag_source_id, ordinal, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const row of repair.checkpointRagSources) {
        insertCheckpointRagSource.run(
          row.project_id, row.checkpoint_id, row.rag_source_id, row.ordinal, row.metadata, row.created_at,
        );
      }

      db.exec(CONTEXT_MIGRATION_REPAIR_FINALIZE_SQL);
      db.prepare(
        `INSERT INTO context_migration_repairs (id, repaired_at, source_schema_hash, row_counts)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           repaired_at = excluded.repaired_at,
           source_schema_hash = excluded.source_schema_hash,
           row_counts = excluded.row_counts`,
      ).run(
        new Date().toISOString(),
        repair.sourceSchemaHash,
        JSON.stringify({
          conversations: repair.conversations.length,
          messages: repair.messages.length,
          checkpoints: repair.checkpoints.length,
          checkpointRagSources: repair.checkpointRagSources.length,
        }),
      );

      const state = inspectContextConversationMigration(db);
      if (!state.complete) {
        throw contextRepairError(`post-repair schema probe is incomplete: ${state.missing.join(", ")}`);
      }
      assertContextRepairDatabaseIntegrity(db, "post-repair");
    })();
  } finally {
    db.pragma(foreignKeys.foreign_keys === 1 ? "foreign_keys = ON" : "foreign_keys = OFF");
  }
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
  mkdirSync(dir, { recursive: true });

  db = new Database(resolvedDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  // The fixed root restore executor must inspect the live database before it
  // stops appuser processes. Running schema migrations at that point can
  // rebuild a table while those processes still hold the database open. The
  // executor swaps a previously validated snapshot; the restarted API applies
  // any pending migrations as appuser after the swap.
  const isRootRestoreMaintenance = process.env.INGENIUM_RESTORE_MAINTENANCE_MODE === "execute"
    && typeof process.getuid === "function" && process.getuid() === 0;
  if (!isRootRestoreMaintenance) runMigrations(db);
  return db;
}

export function getAuthenticationFoundationMigrationStatus(): Record<"093" | "094" | "095" | "096" | "097", AuthenticationFoundationMigrationState> {
  const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
  return {
    "093": inspectIdentityTenancyMigration(database),
    "094": inspectAuthenticationMigration(database),
    "095": inspectAuthorizationAuditMigration(database),
    "096": inspectResourceOwnershipMigration(database),
    "097": inspectMailTenancyMigration(database),
  };
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
        for (const file of ["001_init.sql", "002_archive.sql", "003_agents.sql", "004_learnings_status.sql", "005_skills_metadata.sql", "006_skill_file_tree.sql", "007_observations.sql", "008_personality_traits.sql", "009_pipeline_events.sql", "010_commands.sql", "011_server_source.sql", "012_project_is_global.sql", "013_fix_plugins_unique.sql", "014_configs.sql", "015_auto_observer_source.sql", "016_mcp_tool_states.sql", "017_fix_trait_fk.sql", "018_extraction_pipeline_events.sql", "019_trait_exemplar_fk_setnull.sql", "020_kanban_board.sql", "021_jobs.sql", "022_email_cache.sql", "023_fix_servers_unique.sql", "024_skills_unique_per_project.sql", "025_email_string_ids.sql", "026_email_suggestions.sql", "027_email_summaries.sql", "028_email_suggestion_queue.sql", "029_docs_spaces.sql", "030_docs_pages.sql", "031_docs_pages_fts.sql", "032_docs_drafts.sql", "033_docs_versions.sql", "034_docs_tags.sql", "035_docs_links.sql", "036_docs_comments.sql", "037_docs_project_links.sql", "038_docs_attachments.sql", "039_docs_templates.sql", "040_docs_integrity.sql", "041_skill_maintenance_locks.sql", "042_skill_versions.sql", "043_skill_lineage.sql", "044_skill_proposals.sql", "045_pipeline_event_types.sql", "046_vault.sql", "047_backups.sql", "048_docs_rag.sql", "049_workspace_project_migration.sql", "050_context_rag_phase3.sql", "051_thread_retirement.sql", "052_agent_category_integrity.sql", "053_global_project_integrity_and_protected_settings.sql", "054_agent_frontmatter_metadata.sql", "055_reserved_broker_delete_protection.sql", "056_reserved_broker_rename_protection.sql", "057_reserved_broker_immutable.sql", "058_reserved_broker_connection_independent.sql", "059_repository_docs_onboarding.sql", "060_repository_resource_sync.sql", "061_global_backup_ownership.sql", "062_child_mcp_definitions.sql", "063_immutable_context_conversations.sql", "064_child_mcp_tool_categories.sql", "065_context_rag_ingestion.sql", "066_context_checkpoint_governance.sql", "067_context_migration_repair.sql"]) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
      db.exec(sql);
      logger.info("db", `Applied migration ${file}`);
    }
    for (const file of [
      "068_usage_telemetry.sql",
      "069_context_conversation_snapshot_imports.sql",
      "070_drop_legacy_rag_embeddings.sql",
      "071_context_rag_session_source_reference.sql",
      "072_task_source_references.sql",
      "073_task_coordination.sql",
      "074_task_reservation_tokens.sql",
        "075_coordination_registry.sql",
        "076_trusted_job_events.sql",
        "077_job_event_deliveries.sql",
        "078_usage_advisory_thresholds.sql",
        "079_usage_attention_items.sql",
        "080_job_vault_references.sql",
        "081_vault_job_runs.sql",
        "082_job_vault_revision_audit.sql",
        "083_restore_plans.sql",
        "084_restore_executor.sql",
         "085_restore_executor_phase_events.sql",
         "086_server_global_project_provenance.sql",
         "087_job_timeout_guard.sql",
          "088_email_suggestion_queue_leases.sql",
          "089_synthesis_batch_phases.sql",
           "090_backup_deletion_reservations.sql",
           "091_skill_proposal_retention_pagination.sql",
            "092_email_watcher_markers.sql",
            "093_identity_tenancy.sql",
            "094_authentication.sql",
            "095_authorization_audit.sql",
            "096_resource_ownership.sql",
            "097_mail_tenancy.sql",
    ]) {
      db.exec(readFileSync(resolve(migrationsDir, file), "utf-8"));
      logger.info("db", `Applied migration ${file}`);
    }
    // Verify and rebuild skills_fts after all migrations (including 024 + 041)
    verifyAndRebuildSkillsFts(db);
  } else {
    assertNoPartialRestoreMigrations(db);

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
    // intentionally separate from mutable context_entries. Migration 067 owns
    // a forward-only transactional repair for historical partial 063 shapes,
    // so it must run before 065/066 add dependent context tables.
    const contextConversationMigration = inspectContextConversationMigration(db);
    if (contextConversationMigration.any && !contextConversationMigration.complete) {
      repairContextConversationMigration(db, migrationsDir);
      logger.info("db", "Applied migration 067_context_migration_repair.sql", {
        repairedComponents: contextConversationMigration.missing,
      });
    }
    const repairedContextConversationMigration = inspectContextConversationMigration(db);
    if (!repairedContextConversationMigration.complete) {
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

    // Migration 067 records repair provenance. The repair itself executes above
    // before 065/066 when a partial 063 schema is detected; a complete database
    // only receives this idempotent audit table.
    const contextRepairAuditCheck = db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'context_migration_repairs'",
    ).get() as { count: number };
    if (contextRepairAuditCheck.count === 0) {
      db.exec(readFileSync(resolve(migrationsDir, "067_context_migration_repair.sql"), "utf-8"));
      logger.info("db", "Applied migration 067_context_migration_repair.sql");
    }
  }

  // Migration 068: provider-neutral usage telemetry. The migration is
  // intentionally metadata-only and applies after both fresh and upgrade paths
  // without depending on a global-project fallback.
  const usageMigrationTables = ["usage_project_mappings", "usage_events", "usage_sync_state"];
  const usageMigrationMissing = usageMigrationTables.some((table) => (
    (db.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table) as { count: number }).count === 0
  ));
  if (usageMigrationMissing) {
    db.exec(readFileSync(resolve(migrationsDir, "068_usage_telemetry.sql"), "utf-8"));
    logger.info("db", "Applied migration 068_usage_telemetry.sql");
  }

  // Migration 069: a source mapping and its immutable hash-only entry evidence
  // must arrive together. A partial shape could accept an unverified prefix,
  // so fail closed rather than attempting a lossy table repair.
  const contextSnapshotImportMigration = inspectContextSnapshotImportMigration(db);
  if (contextSnapshotImportMigration.any && !contextSnapshotImportMigration.complete) {
    throw new Error(
      "Migration 069 is in a PARTIAL state. Missing required components: "
      + contextSnapshotImportMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!contextSnapshotImportMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "069_context_conversation_snapshot_imports.sql"), "utf-8"));
    logger.info("db", "Applied migration 069_context_conversation_snapshot_imports.sql");
  }

  // Migration 070: retire the unused deterministic embedding store. Canonical
  // source/chunk ingestion and FTS retrieval remain intact.
  const ragEmbeddingsCheck = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rag_embeddings'",
  ).get() as { count: number };
  if (ragEmbeddingsCheck.count > 0) {
    db.exec(readFileSync(resolve(migrationsDir, "070_drop_legacy_rag_embeddings.sql"), "utf-8"));
    logger.info("db", "Applied migration 070_drop_legacy_rag_embeddings.sql");
  }

  // Migration 071: the source-reference column and every immutable source/chunk
  // guard must arrive together; repair would weaken the append-only boundary.
  const contextRagSessionMigration = inspectContextRagSessionMigration(db);
  if (contextRagSessionMigration.any && !contextRagSessionMigration.complete) {
    throw new Error(
      "Migration 071 is in a PARTIAL state. Missing required components: "
      + contextRagSessionMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!contextRagSessionMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "071_context_rag_session_source_reference.sql"), "utf-8"));
    logger.info("db", "Applied migration 071_context_rag_session_source_reference.sql");
  }

  // Migration 072: task source references must retain their composite task
  // scope, duplicate identity guard, and immutable display snapshot together.
  const taskSourceReferencesMigration = inspectTaskSourceReferencesMigration(db);
  if (taskSourceReferencesMigration.any && !taskSourceReferencesMigration.complete) {
    throw new Error(
      "Migration 072 is in a PARTIAL state. Missing required components: "
      + taskSourceReferencesMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!taskSourceReferencesMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "072_task_source_references.sql"), "utf-8"));
    logger.info("db", "Applied migration 072_task_source_references.sql");
  }

  // Migration 073: revision/CAS, immutable idempotency receipts, and managed
  // reservation state must be complete together. A partial state cannot safely
  // enforce task coordination, so fail closed instead of attempting repair.
  const taskCoordinationMigration = inspectTaskCoordinationMigration(db);
  if (taskCoordinationMigration.any && !taskCoordinationMigration.complete) {
    throw new Error(
      "Migration 073 is in a PARTIAL state. Missing required components: "
      + taskCoordinationMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!taskCoordinationMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "073_task_coordination.sql"), "utf-8"));
    logger.info("db", "Applied migration 073_task_coordination.sql");
  }

  const taskReservationTokenMigration = inspectTaskReservationTokenMigration(db);
  if (!taskReservationTokenMigration.complete) {
    const tokenColumnExists = !taskReservationTokenMigration.missing.includes("tasks reservation_token_hash column");
    if (tokenColumnExists) {
      throw new Error(
        "Migration 074 is in a PARTIAL state. Missing required components: "
        + taskReservationTokenMigration.missing.join(", ")
        + ". Restore the migration's complete schema before retrying.",
      );
    }
    db.exec(readFileSync(resolve(migrationsDir, "074_task_reservation_tokens.sql"), "utf-8"));
    logger.info("db", "Applied migration 074_task_reservation_tokens.sql");
  }

  // Migration 075: durable fences, hashed ownership, retained claims, and
  // immutable receipts are inseparable. Any partial registry is unsafe to rerun.
  const coordinationRegistryMigration = inspectCoordinationRegistryMigration(db);
  if (coordinationRegistryMigration.any && !coordinationRegistryMigration.complete) {
    throw new Error(
      "Migration 075 is in a PARTIAL state. Missing required components: "
      + coordinationRegistryMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!coordinationRegistryMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "075_coordination_registry.sql"), "utf-8"));
    logger.info("db", "Applied migration 075_coordination_registry.sql");
  }

  // Migration 076 is additive: legacy arbitrary job trigger_event strings
  // remain readable, while SQL triggers constrain only new/changed values.
  const trustedJobEventsMigration = inspectTrustedJobEventsMigration(db);
  if (trustedJobEventsMigration.any && !trustedJobEventsMigration.complete) {
    throw new Error(
      "Migration 076 is in a PARTIAL state. Missing required components: "
      + trustedJobEventsMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!trustedJobEventsMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "076_trusted_job_events.sql"), "utf-8"));
    logger.info("db", "Applied migration 076_trusted_job_events.sql");
  }

  const jobEventDeliveriesMigration = inspectJobEventDeliveriesMigration(db);
  if (jobEventDeliveriesMigration.any && !jobEventDeliveriesMigration.complete) {
    throw new Error(
      "Migration 077 is in a PARTIAL state. Missing required components: "
      + jobEventDeliveriesMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!jobEventDeliveriesMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "077_job_event_deliveries.sql"), "utf-8"));
    logger.info("db", "Applied migration 077_job_event_deliveries.sql");
  }

  const usageAdvisoryThresholdsCheck = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'usage_advisory_thresholds'",
  ).get() as { count: number };
  if (usageAdvisoryThresholdsCheck.count === 0) {
    db.exec(readFileSync(resolve(migrationsDir, "078_usage_advisory_thresholds.sql"), "utf-8"));
    logger.info("db", "Applied migration 078_usage_advisory_thresholds.sql");
  }

  const usageAttentionMigration = inspectUsageAttentionMigration(db);
  if (usageAttentionMigration.any && !usageAttentionMigration.complete) {
    throw new Error(
      "Migration 079 is in a PARTIAL state. Missing required components: "
      + usageAttentionMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!usageAttentionMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "079_usage_attention_items.sql"), "utf-8"));
    logger.info("db", "Applied migration 079_usage_attention_items.sql");
  }

  const jobVaultReferencesMigration = inspectJobVaultReferencesMigration(db);
  if (jobVaultReferencesMigration.any && !jobVaultReferencesMigration.complete) {
    throw new Error(
      "Migration 080 is in a PARTIAL state. Missing required components: "
      + jobVaultReferencesMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!jobVaultReferencesMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "080_job_vault_references.sql"), "utf-8"));
    logger.info("db", "Applied migration 080_job_vault_references.sql");
  }

  const vaultJobRunsMigration = inspectVaultJobRunsMigration(db);
  if (vaultJobRunsMigration.any && !vaultJobRunsMigration.complete) {
    throw new Error(
      "Migration 081 is in a PARTIAL state. Missing required components: "
      + vaultJobRunsMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!vaultJobRunsMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "081_vault_job_runs.sql"), "utf-8"));
    logger.info("db", "Applied migration 081_vault_job_runs.sql");
  }

  const jobVaultRevisionAuditMigration = inspectJobVaultRevisionAuditMigration(db);
  if (jobVaultRevisionAuditMigration.any && !jobVaultRevisionAuditMigration.complete) {
    throw new Error(
      "Migration 082 is in a PARTIAL state. Missing required components: "
      + jobVaultRevisionAuditMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!jobVaultRevisionAuditMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "082_job_vault_revision_audit.sql"), "utf-8"));
    logger.info("db", "Applied migration 082_job_vault_revision_audit.sql");
  }

  const restorePlansMigration = inspectRestorePlansMigration(db);
  if (restorePlansMigration.any && !restorePlansMigration.complete) {
    throw restoreMigrationPartialStateError("083", restorePlansMigration.missing);
  }
  if (!restorePlansMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "083_restore_plans.sql"), "utf-8"));
    logger.info("db", "Applied migration 083_restore_plans.sql");
  }

  const restoreExecutorMigration = inspectRestoreExecutorMigration(db);
  if (restoreExecutorMigration.any && !restoreExecutorMigration.complete) {
    throw restoreMigrationPartialStateError("084", restoreExecutorMigration.missing);
  }
  if (!restoreExecutorMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "084_restore_executor.sql"), "utf-8"));
    logger.info("db", "Applied migration 084_restore_executor.sql");
  }

  const restorePhaseEventsMigration = inspectRestoreExecutorPhaseEventsMigration(db);
  if (restorePhaseEventsMigration.any && !restorePhaseEventsMigration.complete) {
    throw restoreMigrationPartialStateError("085", restorePhaseEventsMigration.missing);
  }
  if (!restorePhaseEventsMigration.complete) {
    const restorePlansPrerequisite = inspectRestorePlansMigration(db);
    const restoreExecutorPrerequisite = inspectRestoreExecutorMigration(db);
    const missing = [
      ...(!restorePlansPrerequisite.complete ? ["migration 083 prerequisite schema"] : []),
      ...(!restoreExecutorPrerequisite.complete ? ["migration 084 prerequisite schema"] : []),
    ];
    if (missing.length > 0) throw restoreMigrationPartialStateError("085", missing);
    db.exec(readFileSync(resolve(migrationsDir, "085_restore_executor_phase_events.sql"), "utf-8"));
    logger.info("db", "Applied migration 085_restore_executor_phase_events.sql");
  }

  const globalProvenanceTableCheck = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'server_global_project_provenance'",
  ).get() as { count: number };
  if (globalProvenanceTableCheck.count > 0) {
    const requiredColumns = ["id", "source_project_id", "event_type", "occurred_at"];
    const missingColumns = requiredColumns.filter((column) => {
      const found = db.prepare(
        "SELECT count(*) AS count FROM pragma_table_info('server_global_project_provenance') WHERE name = ?",
      ).get(column) as { count: number };
      return found.count === 0;
    });
    if (missingColumns.length > 0) {
      throw new Error(
        "Migration 086 is in a PARTIAL state: server_global_project_provenance is missing required columns: "
        + missingColumns.join(", "),
      );
    }
  }
  const globalProvenanceIndexCheck = db.prepare(
    "SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_server_global_project_provenance_recovery'",
  ).get() as { count: number };
  if (globalProvenanceTableCheck.count === 0 || globalProvenanceIndexCheck.count === 0) {
    db.exec(readFileSync(resolve(migrationsDir, "086_server_global_project_provenance.sql"), "utf-8"));
    logger.info("db", "Applied migration 086_server_global_project_provenance.sql");
  }

  const jobTimeoutGuardColumn = db.prepare(
    "SELECT count(*) AS count FROM pragma_table_xinfo('jobs') WHERE name = 'timeout_minutes_guard'",
  ).get() as { count: number };
  if (jobTimeoutGuardColumn.count === 0) {
    db.exec(readFileSync(resolve(migrationsDir, "087_job_timeout_guard.sql"), "utf-8"));
    logger.info("db", "Applied migration 087_job_timeout_guard.sql");
  }

  const suggestionQueueLeaseColumns = ["lease_state", "lease_owner", "lease_expires_at"];
  const presentSuggestionQueueLeaseColumns = suggestionQueueLeaseColumns.filter((column) => (
    db.prepare(
      "SELECT count(*) AS count FROM pragma_table_info('email_suggestion_queue') WHERE name = ?",
    ).get(column) as { count: number }
  ).count > 0);
  if (presentSuggestionQueueLeaseColumns.length > 0
    && presentSuggestionQueueLeaseColumns.length < suggestionQueueLeaseColumns.length) {
    throw new Error(
      "Migration 088 is in a PARTIAL state: email_suggestion_queue is missing lease columns: "
      + suggestionQueueLeaseColumns.filter((column) => !presentSuggestionQueueLeaseColumns.includes(column)).join(", "),
    );
  }
  if (presentSuggestionQueueLeaseColumns.length === 0) {
    db.exec(readFileSync(resolve(migrationsDir, "088_email_suggestion_queue_leases.sql"), "utf-8"));
    logger.info("db", "Applied migration 088_email_suggestion_queue_leases.sql");
  }

  const synthesisBatchMigration = inspectSynthesisBatchMigration(db);
  if (synthesisBatchMigration.any && !synthesisBatchMigration.complete) {
    throw new Error(
      "Migration 089 is in a PARTIAL state. Missing required components: "
      + synthesisBatchMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!synthesisBatchMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "089_synthesis_batch_phases.sql"), "utf-8"));
    logger.info("db", "Applied migration 089_synthesis_batch_phases.sql");
  }

  const backupDeletionReservationsMigration = inspectBackupDeletionReservationsMigration(db);
  if (backupDeletionReservationsMigration.any && !backupDeletionReservationsMigration.complete) {
    throw restoreMigrationPartialStateError("090", backupDeletionReservationsMigration.missing);
  }
  if (!backupDeletionReservationsMigration.complete) {
    const restorePlansPrerequisite = inspectRestorePlansMigration(db);
    if (!restorePlansPrerequisite.complete) {
      throw restoreMigrationPartialStateError("090", ["migration 083 prerequisite schema"]);
    }
    db.exec(readFileSync(resolve(migrationsDir, "090_backup_deletion_reservations.sql"), "utf-8"));
    logger.info("db", "Applied migration 090_backup_deletion_reservations.sql");
  }

  const skillProposalRetentionPaginationMigration = inspectSkillProposalRetentionPaginationMigration(db);
  if (skillProposalRetentionPaginationMigration.any && !skillProposalRetentionPaginationMigration.complete) {
    throw new Error(
      "Migration 091 is in a PARTIAL state. Missing required components: "
      + skillProposalRetentionPaginationMigration.missing.join(", ")
      + ". Restore the migration's complete schema before retrying.",
    );
  }
  if (!skillProposalRetentionPaginationMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "091_skill_proposal_retention_pagination.sql"), "utf-8"));
    logger.info("db", "Applied migration 091_skill_proposal_retention_pagination.sql");
  }

  const emailWatcherMarkersMigration = inspectEmailWatcherMarkersMigration(db);
  if (emailWatcherMarkersMigration.any && !emailWatcherMarkersMigration.complete) {
    throw restoreMigrationPartialStateError("092", emailWatcherMarkersMigration.missing);
  }
  if (!emailWatcherMarkersMigration.complete) {
    db.exec(readFileSync(resolve(migrationsDir, "092_email_watcher_markers.sql"), "utf-8"));
    logger.info("db", "Applied migration 092_email_watcher_markers.sql");
  }

  const authenticationFoundations = [
    ["093", "093_identity_tenancy.sql", inspectIdentityTenancyMigration],
    ["094", "094_authentication.sql", inspectAuthenticationMigration],
    ["095", "095_authorization_audit.sql", inspectAuthorizationAuditMigration],
  ] as const;
  for (const [migration, file, inspect] of authenticationFoundations) {
    const state = inspect(db);
    if (state.any && !state.complete) {
      const auth100Upgrade = migration === "094"
        && state.missing.includes("users.email_verified_at column")
        && state.missing.includes("oidc_providers table")
        && isAuth100AuthenticationSchema(db);
      const authorization100Upgrade = migration === "095"
        && state.missing.includes("scoped_api_tokens required columns")
        && state.missing.includes("scoped_api_tokens_project_organization_insert trigger")
        && state.missing.includes("organization_invitations_consume_once trigger");
      const authorization101Upgrade = migration === "095"
        && state.missing.length === 1
        && state.missing[0] === "organization_invitations_consume_once definition";
      if (auth100Upgrade) {
        db.exec(readFileSync(resolve(migrationsDir, "094_authentication_auth101_upgrade.sql"), "utf-8"));
      } else if (authorization100Upgrade) {
        db.exec(readFileSync(resolve(migrationsDir, "095_authorization_auth101_upgrade.sql"), "utf-8"));
      } else if (authorization101Upgrade) {
        db.exec(readFileSync(resolve(migrationsDir, "095_authorization_auth103_upgrade.sql"), "utf-8"));
      } else {
        throw restoreMigrationPartialStateError(migration, state.missing);
      }
      const upgraded = inspect(db);
      if (!upgraded.complete) throw restoreMigrationPartialStateError(migration, upgraded.missing);
      if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
        throw restoreMigrationPartialStateError(migration, ["foreign key integrity"]);
      }
      logger.info("db", `Applied authentication upgrade for migration ${migration}`);
      continue;
    }
    if (!state.complete) {
      if (migration !== "093" && !inspectIdentityTenancyMigration(db).complete) {
        throw restoreMigrationPartialStateError(migration, ["migration 093 prerequisite schema"]);
      }
      if (migration === "095" && !inspectAuthenticationMigration(db).complete) {
        throw restoreMigrationPartialStateError(migration, ["migration 094 prerequisite schema"]);
      }
      db.exec(readFileSync(resolve(migrationsDir, file), "utf-8"));
      const applied = inspect(db);
      if (!applied.complete) throw restoreMigrationPartialStateError(migration, applied.missing);
      logger.info("db", `Applied migration ${file}`);
    }
  }

  const resourceTenancy = [
    ["096", "096_resource_ownership.sql", inspectResourceOwnershipMigration],
    ["097", "097_mail_tenancy.sql", inspectMailTenancyMigration],
  ] as const;
  for (const [migration, file, inspect] of resourceTenancy) {
    const state = inspect(db);
    if (state.any && !state.complete) throw restoreMigrationPartialStateError(migration, state.missing);
    if (state.complete) continue;
    if (migration === "096" && !inspectAuthorizationAuditMigration(db).complete) {
      throw restoreMigrationPartialStateError(migration, ["migration 095 prerequisite schema"]);
    }
    if (migration === "097" && !inspectResourceOwnershipMigration(db).complete) {
      throw restoreMigrationPartialStateError(migration, ["migration 096 prerequisite schema"]);
    }
    db.exec(readFileSync(resolve(migrationsDir, file), "utf-8"));
    const applied = inspect(db);
    if (!applied.complete) throw restoreMigrationPartialStateError(migration, applied.missing);
    if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw restoreMigrationPartialStateError(migration, ["foreign key integrity"]);
    }
    logger.info("db", `Applied migration ${file}`);
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

/** Close the singleton before RESTORE-101 scans for database holders. */
export function closeDbForMaintenance(): void {
  if (db) {
    db.close();
    db = null;
  }
  writeCount = 0;
}

/**
 * Reset the singleton database connection.
 * For test use only — closes the current connection and clears the singleton
 * so the next getDb() call creates a fresh connection to a new path.
 */
export function resetDbForTest(): void {
  closeDbForMaintenance();
}
