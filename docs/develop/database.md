---
title: Database Migrations
description: Complete reference for SQLite database migrations, WAL safety, PRAGMA management, and manual repair procedures.
---

# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

## Migration File List (001–045)

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

### Critical Migration Sequence (015–019)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 015 | `015_auto_observer_source.sql` | ⚠️ Rebuilds `observations` table to add `'auto-observer'` to the source CHECK constraint | **High** |
| 016 | `016_mcp_tool_states.sql` | Creates `mcp_tool_states` table for per-project tool enable/disable |
| 017 | `017_fix_trait_fk.sql` | ⚠️ Rebuilds `personality_traits` to refresh FK reference to current `observations` table | **Medium** |
| 018 | `018_extraction_pipeline_events.sql` | Adds extraction event types to `pipeline_events` CHECK constraint | **Low** |
| 019 | `019_trait_exemplar_fk_setnull.sql` | Changes FK to `ON DELETE SET NULL` | **Low** |

---

*Full migration list continues through 045. See the companion file at `packages/ingenium-core/data/migrations/` for individual migration SQL.*

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
