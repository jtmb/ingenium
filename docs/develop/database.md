---
title: Database Migrations
description: Complete reference for SQLite database migrations, WAL safety, PRAGMA management, and manual repair procedures.
---

# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

## Migration File List (001–048)

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

### Feature Migrations (045–048)

| # | File | Purpose |
|---|------|---------|
| 045 | `045_pipeline_event_types.sql` | Adds `skill_created`, `skill_updated`, and proposal event types to `pipeline_events` CHECK constraint |
| 046 | `046_vault.sql` | Creates `vault_config`, `vault_folders`, `vault_items`, and `vault_audit_log` — encrypted secrets vault with scrypt key derivation, AES-256-GCM envelope encryption, and full audit trail |
| 047 | `047_backups.sql` | Creates `backup_records` and `backup_restore_jobs` — dual-snapshot (Ingenium + OpenCode DB) backup/restore with SHA-256 manifest validation and migration-compatibility checks |
| 048 | `048_docs_rag.sql` | Creates `rag_sources`, `rag_chunks`, `rag_chunks_fts` (FTS5), `rag_embeddings`, `rag_ingestion_state`, and `rag_thread_imports` — RAG pipeline with token-aware chunking, embedding storage, and resumable Thread imports |

*See the companion file at `packages/ingenium-core/data/migrations/` for individual migration SQL.*

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

## 🔴 Email FK Defensive Pattern

Any upsert function that writes to a FK-constrained child table must check for the parent row **before** inserting:

```typescript
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) return; // parent removed — skip silently
```

## Manual DB Repair

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
