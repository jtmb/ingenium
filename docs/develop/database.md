---
title: Database Migrations
description: Complete reference for SQLite database migrations, WAL safety, PRAGMA management, and manual repair procedures.
---

# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

## Canonical deployed database path

Production Compose sets `INGENIUM_CORE_DB_PATH=/app/.ingenium/data`. This file
is on the `ingenium-data` named volume and uses WAL mode. The resolver normalizes
historical fallback spellings instead of creating a sibling `data.db`; operators
must not manually introduce a second database under `/app/.ingenium/data.db` or
another Compose project volume.

## Migration File List

### Foundation (001–014)

| # | File | Purpose |
|---|------|---------|
| 001 | `001_init.sql` | Core schema: `projects`, `sessions`, `skills`, `plugins`, `servers`, `learnings`, `tasks` tables |
| 002 | `002_archive.sql` | Adds soft-delete support (`archived_at` column) to `projects`; creates `settings` table |
| 003 | `003_agents.sql` | Creates `agents` table with project_id FK, permissions, model config |
| 004 | `004_learnings_status.sql` | Adds `status` column to `learnings` table; creates index on status |
| 005 | `005_skills_metadata.sql` | Adds `tags` and `always_apply` columns to `skills` |
| 006 | `006_skill_file_tree.sql` | Adds `file_tree` column to `skills` for round-trip split-skill persistence |
| 007 | `007_observations.sql` | Creates `observations` table (replaces old learnings system); 10 observation types with CHECK constraint |
| 008 | `008_personality_traits.sql` | Creates `personality_traits` table; 10 trait types with CHECK constraint; FK to observations |
| 009 | `009_pipeline_events.sql` | Creates `pipeline_events` table for observability timeline |
| 010 | `010_commands.sql` | Creates `commands` table for OpenCode slash-command management |
| 011 | `011_server_source.sql` | Adds `source` column to `servers` (default: `'opencode'`) |
| 012 | `012_project_is_global.sql` | Adds `is_global` column to `projects` |
| 013 | `013_fix_plugins_unique.sql` | Rebuilds `plugins` table with `UNIQUE(project_id, name)` instead of `UNIQUE(name)` |
| 014 | `014_configs.sql` | Creates `configs` table for opencode.json content round-trip editing |

### Governance Migrations (020–044)

| # | File | Purpose |
|---|------|---------|
| 020 | `020_kanban_board.sql` | Creates `kanban_boards` and `kanban_columns` tables for task board config |
| 021 | `021_jobs.sql` | Creates `jobs` table with cron scheduling, event triggers, and timeout support |
| 022 | `022_email_cache.sql` | Creates `email_cache` table for IMAP email headers + body caching |
| 023 | `023_fix_servers_unique.sql` | Rebuilds `servers` table with `UNIQUE(project_id, name)` |
| 024 | `024_skills_unique_per_project.sql` | ⚠️ Rebuilds `skills` table to add `UNIQUE(project_id, name)` — resolves 120-error sync storms | **High** |
| 025 | `025_email_string_ids.sql` | ⚠️ Rebuilds email tables with string IDs (Gmail REST API transition) | **High** |
| 026 | `026_email_suggestions.sql` | Creates `email_suggestions` cache table for smart replies |
| 027 | `027_email_summaries.sql` | Creates `email_summaries` cache table for LLM summaries |
| 028 | `028_email_suggestion_queue.sql` | Creates `email_suggestion_queue` for batched suggestion processing |
| 029 | `029_docs_spaces.sql` | Creates `docs_spaces` table for documentation workspace spaces |
| 030 | `030_docs_pages.sql` | Creates `docs_pages` with revision tracking, FTS, and tree hierarchy |
| 031 | `031_docs_pages_fts.sql` | Creates FTS5 virtual table for docs pages full-text search |
| 032 | `032_docs_drafts.sql` | Creates `docs_drafts` table for autosave support |
| 033 | `033_docs_versions.sql` | Creates `docs_versions` for page revision history |
| 034 | `034_docs_tags.sql` | Creates `docs_tags` and `page_tags` for tag management |
| 035 | `035_docs_links.sql` | Creates `docs_links` for inter-page backlinks |
| 036 | `036_docs_comments.sql` | Creates `docs_comments` for threaded page comments |
| 037 | `037_docs_project_links.sql` | Creates `page_projects` for linking pages to projects |
| 038 | `038_docs_attachments.sql` | Creates `docs_attachments` with path traversal prevention |
| 039 | `039_docs_templates.sql` | Creates `docs_templates` for page templates |
| 040 | `040_docs_integrity.sql` | Adds FK + CHECK constraints for docs referential integrity |
| 041 | `041_skill_maintenance_locks.sql` | Creates `skill_maintenance_locks` for concurrent skill maintenance |
| 042 | `042_skill_versions.sql` | Creates `skill_versions` for skill rollback history |
| 043 | `043_skill_lineage.sql` | Creates `skill_lineage` for provenance tracking across merges |
| 044 | `044_skill_proposals.sql` | Creates `skill_proposals` table — governance proposal lifecycle with review/rejection/rollback |

### Critical Migration Sequence (015–019)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 015 | `015_auto_observer_source.sql` | ⚠️ Rebuilds `observations` table to add `'auto-observer'` to the source CHECK constraint | **High** |
| 016 | `016_mcp_tool_states.sql` | Creates `mcp_tool_states` table for per-project tool enable/disable |
| 017 | `017_fix_trait_fk.sql` | ⚠️ Rebuilds `personality_traits` to refresh FK reference to current `observations` table | **Medium** |
| 018 | `018_extraction_pipeline_events.sql` | Adds extraction event types to `pipeline_events` CHECK constraint | **Low** |
| 019 | `019_trait_exemplar_fk_setnull.sql` | Changes FK to `ON DELETE SET NULL` | **Low** |

---

### Feature Migrations (045–068)

| # | File | Purpose |
|---|------|---------|
| 045 | `045_pipeline_event_types.sql` | Adds `skill_created`, `skill_updated`, and proposal event types to `pipeline_events` CHECK constraint |
| 046 | `046_vault.sql` | Creates `vault_config`, `vault_folders`, `vault_items`, and `vault_audit_log` — encrypted secrets vault with scrypt key derivation, AES-256-GCM envelope encryption, and full audit trail |
| 047 | `047_backups.sql` | Creates `backup_records` and `backup_restore_jobs` — dual-snapshot (Ingenium + OpenCode DB) backup/restore with SHA-256 manifest validation and migration-compatibility checks |
| 048 | `048_docs_rag.sql` | Creates the original RAG tables, FTS5 index, embeddings, ingestion state, and a legacy import checkpoint table |
| 049 | `049_workspace_project_migration.sql` | Creates `project_migration_manifests` audit table — transactional DB-only migration of historical `/workspace` project into `global-default` with hash verification, child row protection, and rollback safety |
| 050 | `050_context_rag_phase3.sql` | Adds `source`, `metadata`, `updated_at` to `context_entries` with source CHECK constraint and index; adds unique index `idx_rag_sources_project_path` for canonical path-based idempotency in `rag_sources` — Phase 3 context/RAG ingestion and validation |
| 051 | `051_thread_retirement.sql` | Removes the verified-empty legacy checkpoint table and rebuilds `rag_sources` without the retired source type; the runner refuses non-zero legacy data before schema changes |
| 052 | `052_agent_category_integrity.sql` | Normalizes historical agent categories and adds a `CHECK(category IN ('primary','execution','research','security','chat'))` constraint via the `RENAME → CREATE → COPY → DROP` safe pattern; adds `chat` to the Zod schema enum; updates `enabled`-aware agents tooling with safe-name validation and `opencode.json`-based runtime model assignment — disabled agents are excluded from disk writes |
| 053 | `053_global_project_integrity_and_protected_settings.sql` | Enforces at most one active global project and creates protected settings metadata for vault-backed OAuth application secrets |
| 054 | `054_agent_frontmatter_metadata.sql` | Adds persisted agent metadata; backfills `ingenium-llm-broker` to exact `hidden: true` and `{"*":"deny"}` state, then installs `AFTER INSERT`/`AFTER UPDATE` triggers that retain those reserved fields across direct persistence writes. Agent lifecycle code separately refuses broker deletion. |
| 055 | `055_reserved_broker_delete_protection.sql` | Adds a `BEFORE DELETE` trigger that rejects direct deletion of the reserved broker while its project row exists. Normal project deletion remains child-safe: Ingenium refuses projects with child rows before the parent delete, so the trigger does not replace or bypass project lifecycle checks. |
| 056 | `056_reserved_broker_rename_protection.sql` | Adds a `BEFORE UPDATE OF name` trigger that rejects direct renames of `ingenium-llm-broker`, preventing a low-level SQL write from bypassing the canonical broker invariant and escaping under a permissive new name. |
| 057 | `057_reserved_broker_immutable.sql` | Historical broker immutability migration. It remains in the upgrade sequence for prior installations; migration 058 supersedes its recursive-trigger-dependent protections. |
| 058 | `058_reserved_broker_connection_independent.sql` | Backfills every broker to the exact canonical bootstrap template and installs non-recursive `BEFORE INSERT`/`BEFORE UPDATE` collision and immutable guards. `INSERT OR REPLACE` and `UPDATE OR REPLACE` are rejected even when a raw SQLite connection has `recursive_triggers=0`. Only the dedicated internal core bootstrap emits the admitted template; public API and resource sync cannot provision a broker. |
| 059 | `059_repository_docs_onboarding.sql` | Creates repository-authoritative Docs page identity metadata that survives archive and later reappearance. |
| 060 | `060_repository_resource_sync.sql` | Creates repository-authoritative synchronization state for skills, agents, and plugins, including semantic payload and source hashes. |
| 061 | `061_global_backup_ownership.sql` | Creates an idempotent migration marker and backfills legacy backup records and restore jobs to the sole active global project. Startup retries the backfill after global-project initialization. |
| 063 | `063_immutable_context_conversations.sql` | Creates immutable project-scoped conversations, messages, checkpoints, checkpoint RAG links, the message FTS5 index, scoped foreign keys, indexes, and immutability triggers. |
| 064 | `064_child_mcp_tool_categories.sql` | Rebuilds child MCP discovery metadata so category values are server-specific. |
| 065 | `065_context_rag_ingestion.sql` | Creates project-scoped direct/chunked context-upload state and durable provenance rows, freezes checkpoint-linked RAG sources/chunks, and stores immutable checkpoint citation snapshots. |
| 066 | `066_context_checkpoint_governance.sql` | Creates short-lived, one-time project-scoped maintenance authorizations plus append-only archive/unarchive/restore-as-new audit records. Archive state is derived from events; checkpoints are never deleted. |
| 067 | `067_context_migration_repair.sql` | Repairs recoverable legacy or partial 063 shapes before 065/066 are evaluated. The runner projects rows into canonical staging tables in one transaction, restores indexes/FTS/triggers/foreign keys, validates integrity, and records only a content-free schema hash plus row counts in `context_migration_repairs`. |
| 068 | `068_usage_telemetry.sql` | Creates metadata-only provider-neutral usage events, explicit OpenCode-to-Ingenium project mappings (including unmapped quarantine), and per-project composite usage sync state. Events preserve raw provider/model IDs, nullable assistant-agent attribution, and numeric reasoning-token metadata. They have a replay-safe `(source_instance, source_part_id)` key and contain no message text, reasoning content, tool payload, credential, or raw payload columns. |

*See the companion file at `packages/ingenium-core/data/migrations/` for individual migration SQL.*

The reserved broker is normalized at database startup and remains enabled; it
does not support the ordinary lifecycle. Resource sync accepts an API broker
only after every material field matches the static canonical template, then
rewrites the static disk profile. Disk-only or arbitrary API broker content is
quarantined. Do not repair this profile by editing markdown or issuing direct
SQL.

## 🔴 WAL Safety — checkpointAfterWrite Outside Transaction

`checkpointAfterWrite()` must never be called **inside** `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED`.

```typescript
const result = execTransaction(() => {
  // All DB writes inside the transaction
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after the transaction commits
return result;
```

## Safe Migration Pattern (RENAME → CREATE → COPY → DROP)

SQLite does not support `ALTER TABLE DROP CONSTRAINT`. When a migration needs to change a constraint, the standard pattern is:

```sql
PRAGMA foreign_keys = OFF;
ALTER TABLE existing_table RENAME TO existing_table_old;
CREATE TABLE existing_table (...);
INSERT INTO existing_table (...) SELECT ... FROM existing_table_old;
DROP TABLE existing_table_old;
PRAGMA foreign_keys = ON;
```

The Phase 4 mail-account migration is all-or-nothing: it resolves the active
global project, verifies encryption continuity, copies each account's complete
setting group, byte-verifies the destination, and only then deletes source rows.
Collisions remain in the source project for review; failed writes retain source
settings. A key mismatch or unavailable key skips migration without modifying
encrypted mail data.

## 🔴 Email FK Defensive Pattern

Any upsert function that writes to a FK-constrained child table must check for the parent row **before** inserting:

```typescript
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) return; // parent removed — skip silently
```

## Manual DB Repair

### G3 context migration repair (067)

Migration 067 is a **forward-only** startup repair for incomplete migration-063
schemas. It is not a data reset and does not delete conversation, message,
checkpoint, or checkpoint-RAG-link rows: rows are copied to canonical staging
tables, source tables are replaced only after every copied row satisfies the
target constraints, then the transaction verifies `PRAGMA integrity_check` and
`PRAGMA foreign_key_check` before it commits. It runs before the normal 065 and
066 probes so their dependent context tables can be applied afterward.

The repair can fill only data that was absent because of the partial schema:
missing hashes are deterministically generated, missing JSON metadata/tags use
the schema defaults, missing sequences/ordinals receive stable values, and a
missing link project is derived from its checkpoint. It refuses rather than
guessing when project ownership, message/checkpoint linkage, required content,
or a target uniqueness/constraint cannot be preserved. It also refuses a
pre-existing integrity or foreign-key failure that is unrelated to the temporary
partial-063 parent-key mismatch.

#### Operator preflight

Do not run the application against a production database until a maintenance
window has prevented competing writers. These commands are examples for an
operator with the `sqlite3` CLI; they are not executed by the migration itself.

```bash
# Point this at the single canonical database file, never at a new sibling .db.
DB_PATH="/app/.ingenium/data"

# Capture the current health and the context schema signature before startup.
sqlite3 "$DB_PATH" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
sqlite3 "$DB_PATH" \
  "SELECT type, name FROM sqlite_master WHERE name LIKE 'context_%' ORDER BY type, name;"
```

`integrity_check` must return only `ok`; investigate any foreign-key rows before
continuing. A partial 063 schema may report a temporary `foreign key mismatch`
because a child table references a missing parent key; 067 validates the copied
context relationships and repeats the foreign-key check after rebuilding.

#### Backup and startup

Create a consistent SQLite backup with the SQLite backup API rather than copying
a live WAL database file. Keep the original backup immutable and verify it
before starting the release containing migration 067.

```bash
DB_PATH="/app/.ingenium/data"
BACKUP_PATH="/secure/backups/ingenium-pre-g3-$(date -u +%Y%m%dT%H%M%SZ).sqlite"

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

On startup, inspect the structured database log for
`Applied migration 067_context_migration_repair.sql`. A successful actual repair
adds one content-free `context_migration_repairs` row with the source schema
hash and copied row counts. Re-run `PRAGMA integrity_check` and
`PRAGMA foreign_key_check` after startup; both must be clean.

#### Failure and rollback

If preflight or the in-transaction post-check fails, SQLite rolls back the
entire 067 rebuild: source context tables and rows remain untouched. Preserve the
failed database and logs for diagnosis; do not hand-drop context tables or
re-run the migration against a changed copy.

After a committed repair there is no supported destructive down-migration.
To return to the prior database, stop all writers, preserve the committed file
for forensics, restore the verified pre-G3 backup through the operator's normal
database recovery procedure, and validate it with both pragmas before allowing
the prior application version to write. This repository change does not perform
that live restore, deploy services, or modify Docker configuration.

### Repair a failed 015 migration

```sql
DROP TABLE IF EXISTS observations_old;
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(...);
CREATE TRIGGER ... ;
INSERT INTO observations_fts(observations_fts) VALUES('rebuild');
```

### Verify repair

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

---

*See also: `packages/ingenium-core/lib/db.ts`, `packages/ingenium-core/data/migrations/`*
