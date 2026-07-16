# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

> **Note:** The AGENTS.md file contains a summary of critical migrations only. This file documents every migration.

---

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

---

## Migration File List (001–039)

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
| 015 | `015_auto_observer_source.sql` | ⚠️ Rebuilds `observations` table to add `'auto-observer'` to the source CHECK constraint. Uses RENAME → DROP FTS → RECREATE → RESTORE pattern. | **High** — Partially failing leaves `observations_old` with dangling FTS triggers, causing "FOREIGN KEY constraint failed" during synthesis |
| 016 | `016_mcp_tool_states.sql` | Creates `mcp_tool_states` table for per-project tool enable/disable |
| 017 | `017_fix_trait_fk.sql` | ⚠️ Rebuilds `personality_traits` to refresh FK reference to current `observations` table after 015's rename cycle. Comment marker `-- 017_rebuilt` in CREATE TABLE prevents re-application. | **Medium** — Runs inside `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS trigger errors |
| 018 | `018_extraction_pipeline_events.sql` | Adds `extraction_completed` and `extraction_failed` to `pipeline_events` event_type CHECK constraint | **Low** — Just expands CHECK constraint |
| 019 | `019_trait_exemplar_fk_setnull.sql` | Changes `personality_traits.exemplar_observation_id` FK to `ON DELETE SET NULL` so observation deletes never fail on FK constraints | **Low** — Runs inside `PRAGMA foreign_keys = OFF/ON`; safe |

### Kanban & Jobs (020–021)

| # | File | Purpose |
|---|------|---------|
| 020 | `020_kanban_board.sql` | Expands `tasks` table with hierarchy (parent_id), issue_type CHECK, time tracking, comments, activity, links, notifications, board_config |
| 021 | `021_jobs.sql` | Creates `jobs`, `job_runs`, and `job_run_logs` tables for the agent job scheduler/runner |

### Email System (022–028)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 022 | `022_email_cache.sql` | Creates `email_cache` and `email_bodies` tables for IMAP email caching; `email_sync_state` for folder sync tracking; `email_accounts` for credential storage |
| 023 | `023_fix_servers_unique.sql` | Rebuilds `servers` table with `UNIQUE(project_id, name)` instead of `UNIQUE(name)`; same rebuild pattern as 013 |
| 024 | `024_skills_unique_per_project.sql` | ⚠️ Rebuilds `skills` table to change `UNIQUE(name)` → `UNIQUE(project_id, name)`. Same safe pattern (PRAGMA OFF/ON, rename→recreate→restore, FTS rebuild). Comment marker `-- 024_rebuilt`. | **Medium** — FTS trigger recreation must be verified; same corruption risk as 015/017 if interrupted |
| 025 | `025_email_string_ids.sql` | ⚠️ Rebuilds `email_cache` + `email_bodies` with `uid TEXT` (was INTEGER). Adds `labels_json` to `email_cache`, `history_id` + `provider` to `email_sync_state`. | **Medium** — FK recreation must be verified; all cached emails keyed by string ID from Gmail API |
| 026 | `026_email_suggestions.sql` | Creates `email_suggestions` table for LLM-generated email reply suggestions. FK to `email_cache ON DELETE CASCADE`. Uses defensive parent-existence check pattern. | **Low** — Defensive pattern prevents FK failures during concurrent account deletion |
| 027 | `027_email_summaries.sql` | Creates `email_summaries` table for cached AI-generated email summaries. Same PK shape and FK cascade as `email_suggestions`. | **Low** — Same defensive pattern as 026 |
| 028 | `028_email_suggestion_queue.sql` | Creates `email_suggestion_queue` for background suggestion generation | **Low** |

### Docs Workspace (029–039)

| # | File | Purpose |
|---|------|---------|
| 029 | `029_docs_spaces.sql` | Creates `docs_spaces` table — global documentation spaces (e.g., "Engineering", "Personal") |
| 030 | `030_docs_pages.sql` | Creates `docs_pages` table with hierarchy (parent_page_id), revision counter, status (draft/published/archived), favorites |
| 031 | `031_docs_pages_fts.sql` | Creates FTS5 virtual table `docs_pages_fts` on title+content with sync triggers |
| 032 | `032_docs_drafts.sql` | Creates `docs_page_drafts` table — autosave drafts per page (1:1 with pages) |
| 033 | `033_docs_versions.sql` | Creates `docs_page_versions` table — page revision history with snapshot per save |
| 034 | `034_docs_tags.sql` | Creates `docs_tags` and `docs_page_tags` tables for page tagging |
| 035 | `035_docs_links.sql` | Creates `docs_page_links` table — backlinks between pages (`[[page-slug]]` references) |
| 036 | `036_docs_comments.sql` | Creates `docs_comments` table — inline comments with selection tracking, threaded replies, resolve state |
| 037 | `037_docs_project_links.sql` | Creates `docs_page_projects` table — optional project associations for pages |
| 038 | `038_docs_attachments.sql` | Creates `docs_attachments` table — file attachments per page with MIME type, size, storage path |
| 039 | `039_docs_templates.sql` | Creates `docs_templates` table — reusable page templates with category |

---

## Critical Migration Sequences

### The 015 → 017 → 019 Chain

These three migrations form an interdependent sequence that must run in order:

1. **015** rebuilds `observations` — this creates a new `observations` table and renames the old one to `observations_old`
2. **017** rebuilds `personality_traits` — its FK to `observations` now points at the NEW table (post-015), not `observations_old`. Uses `-- 017_rebuilt` comment marker to prevent re-application.
3. **019** changes the FK on `personality_traits.exemplar_observation_id` to `ON DELETE SET NULL`

**Anti-corruption guard (db.ts lines 183–213):**
1. After migration 015 runs, `observationsCreateSql` is **re-read** so migration 017's condition (`observationsCreateSql.sql.includes("auto-observer")`) triggers correctly
2. Migration 017 is wrapped in `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS errors
3. Manual DB repair: drop `observations_old`, recreate `observations_fts` + triggers, rebuild `personality_traits` FK

### The 024 → 025 Chain

1. **024** rebuilds `skills` with `UNIQUE(project_id, name)` — same safe rename→recreate pattern as 015/017
2. **025** rebuilds `email_cache` + `email_bodies` with string UIDs — same safe pattern

Both require FTS trigger recreation verification.

### The 026 → 027 → 028 Chain (Email Cache Dependencies)

1. **026** creates `email_suggestions` with FK to `email_cache ON DELETE CASCADE`
2. **027** creates `email_summaries` with FK to `email_cache ON DELETE CASCADE`
3. **028** creates `email_suggestion_queue` for background processing

All use the defensive parent-existence check pattern.

### The 029 → 039 Chain (Docs Workspace)

Migrations 029–039 are additive and independent (each creates new tables). They were designed to be applied in any order, though the canonical order is:

1. `029_docs_spaces.sql` — spaces (containers)
2. `030_docs_pages.sql` — pages (content units)
3. `031_docs_pages_fts.sql` — full-text search
4. `032_docs_drafts.sql` — draft persistence
5. `033_docs_versions.sql` — version history
6. `034_docs_tags.sql` — tagging system
7. `035_docs_links.sql` — backlinks
8. `036_docs_comments.sql` — inline comments
9. `037_docs_project_links.sql` — project associations
10. `038_docs_attachments.sql` — file attachments
11. `039_docs_templates.sql` — page templates

---

## 🔴 WAL Safety — checkpointAfterWrite Outside Transaction

`checkpointAfterWrite()` (triggers a passive WAL checkpoint every 50 writes) must never be called **inside** `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED` because WAL checkpoint acquires a read lock on all pages while the transaction holds a write lock.

**Pattern** (used in `personality.ts`, `observations.ts`, and all tool modules):

```typescript
const result = execTransaction(() => {
  // All DB writes inside the transaction
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after the transaction commits
return result;
```

> 🔴 **Violation detection**: If you see `SQLITE_LOCKED` errors, the first thing to check is whether `checkpointAfterWrite()` is being called inside an `execTransaction()` callback. It must always follow the transaction, never be inside it.

---

## Safe Migration Pattern (RENAME → CREATE → COPY → DROP)

SQLite does not support `ALTER TABLE DROP CONSTRAINT` or `ALTER TABLE ADD CONSTRAINT`. When a migration needs to change a constraint (UNIQUE, CHECK, FK), the standard pattern is:

```sql
-- 1. Disable FK enforcement (previents cascading FTS errors)
PRAGMA foreign_keys = OFF;

-- 2. Rename old table
ALTER TABLE existing_table RENAME TO existing_table_old;

-- 3. Create new table with desired constraints
CREATE TABLE existing_table (
    -- ... same columns with updated constraints
);

-- 4. Copy data
INSERT INTO existing_table (...) SELECT ... FROM existing_table_old;

-- 5. Recreate FTS triggers if applicable
CREATE TRIGGER IF NOT EXISTS ... ;

-- 6. Re-enable FK enforcement
PRAGMA foreign_keys = ON;

-- 7. Verify data integrity before dropping
DROP TABLE existing_table_old;
```

**Safety notes:**
- Always use `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS trigger errors
- Mark rebuilt tables with a comment (`-- 024_rebuilt`) in CREATE TABLE to prevent re-application
- Verify data integrity before dropping the old table
- If interrupted mid-migration, manual DB repair is needed (see below)

---

## PRAGMA Management

### foreign_keys

```sql
PRAGMA foreign_keys = OFF;  -- Before table rebuild
PRAGMA foreign_keys = ON;   -- After table rebuild and data copy
```

Used in migrations: 015, 017, 019, 024, 025

> 🔴 **Always re-enable after any OFF.** If `foreign_keys = OFF` is left on, the DB will silently accept invalid FK references.

### journal_mode (WAL)

The database is opened with WAL journal mode for concurrent read/write access. Set at connection time in `db.ts`, not per-migration.

---

## 🔴 Email FK Defensive Pattern — Parent-Existence Check

Any upsert function that writes to a FK-constrained child table must check for the parent row **before** inserting:

```typescript
// Defensive: check parent row exists before inserting into FK-constrained child table.
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) {
  return; // parent removed — skip silently
}
// Safe to upsert into FK-constrained child table
```

This pattern is used in `upsertEmailBody()`, `upsertEmailSuggestions()`, and `upsertEmailSummaries()`.

> 🔴 **`folder` value must be threaded through unchanged from `email.folder`.** Defaulting the folder anywhere in the call chain (e.g., `?? "INBOX"`) causes a 100% cache miss.

---

## Anti-Corruption Guard (db.ts lines 183–213)

The `runMigrations()` function includes an anti-corruption guard specifically for the 015→017→019 sequence:

1. **Post-015 re-read**: After migration 015 runs, `observationsCreateSql` is re-read from the new `observations` table so migration 017's condition (`observationsCreateSql.sql.includes("auto-observer")`) triggers correctly
2. **PRAGMA wrapping**: Migration 017 is wrapped in `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS errors from the renamed `observations_old` table
3. **Manual repair fallback**: If corruption occurs, the manual repair procedure must:
   a. Drop `observations_old` table
   b. Recreate `observations_fts` virtual table + triggers
   c. Rebuild `personality_traits` FK references

---

## Manual DB Repair Instructions

If a migration fails partway (especially 015 or 024), the database may be in a corrupted state with dangling FTS triggers. Follow these steps:

### Check for corruption

```bash
# Check for orphaned old tables
sqlite3 .ingenium/data.db ".tables" | grep "_old$"

# Check for dangling FTS triggers
sqlite3 .ingenium/data.db ".tables" | grep "fts"

# Try a query
sqlite3 .ingenium/data.db "SELECT COUNT(*) FROM observations;"
```

### Repair a failed 015 migration

```sql
-- 1. Drop the old table
DROP TABLE IF EXISTS observations_old;

-- 2. Recreate FTS virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
    content,
    content='observations',
    content_rowid='id'
);

-- 3. Recreate FTS sync triggers
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO observations_fts(rowid, content) VALUES (new.id, new.content);
END;

-- 4. Rebuild FTS index
INSERT INTO observations_fts(observations_fts) VALUES('rebuild');

-- 5. Rebuild personality_traits FK (if needed)
-- This requires dropping and recreating the personality_traits table
-- Use the safe pattern: PRAGMA foreign_keys = OFF → RENAME → CREATE → COPY → DROP → PRAGMA foreign_keys = ON
```

### Repair a failed 024 migration

```sql
-- Same pattern as 015
DROP TABLE IF EXISTS skills_old;

-- Recreate FTS
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(name, description, content, tags, content='skills', content_rowid='rowid');
-- Recreate triggers...
INSERT INTO skills_fts(skills_fts) VALUES('rebuild');
```

### Verify repair

```sql
-- Check FTS works
SELECT * FROM observations_fts WHERE observations_fts MATCH 'test';

-- Check FK integrity
PRAGMA foreign_key_check;

-- Check personality_traits FK reference
SELECT sql FROM sqlite_master WHERE type='table' AND name='personality_traits';
```

> 🔴 **Always back up the database file before attempting manual repair.** Copy the `.ingenium/data.db` file to a safe location first.

---

## 🔴 Hard Rules

1. **`checkpointAfterWrite()` must never be inside `execTransaction()`** — always place it after the transaction closes
2. **New migrations must be manually placed in the Docker container** — the Dockerfile runtime stage does not copy `data/migrations/`
3. **Always use `ON CONFLICT DO UPDATE`** for email cache upserts — never `INSERT OR REPLACE` (which cascades to delete child FK rows)
4. **Always wrap table rebuilds in `PRAGMA foreign_keys = OFF/ON`**
5. **Mark rebuilt tables** with a unique comment marker (`-- NNN_rebuilt`) to prevent re-application
6. **Re-read create SQL after 015** so subsequent migrations detect the updated schema correctly
