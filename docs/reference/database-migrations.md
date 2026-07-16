# Database Migrations Reference

This document is the canonical reference for all SQLite database migrations in the Ingenium project.

> **Note:** The AGENTS.md file contains a summary of critical migrations only. This file documents every migration.

---

## Overview

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. They are applied conditionally by `runMigrations()` in `db.ts` — each checks for an existing table/column/signature before running. Migrations are idempotent and run on every API startup.

**Dockerfile note:** The Dockerfile runtime stage does not copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs.

---

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

### Docs Workspace (029–040)

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
| 037 | `037_docs_project_links.sql` | Creates `docs_page_projects` table — optional project associations for pages. **Defect**: project_id declared as `INTEGER` but `projects.id` is `TEXT`. |
| 038 | `038_docs_attachments.sql` | Creates `docs_attachments` table — file attachments per page with MIME type, size, storage path |
| 039 | `039_docs_templates.sql` | Creates `docs_templates` table — reusable page templates with category |
| 040 | `040_docs_integrity.sql` | **W0/W1A contract repair migration.** Rebuilds `docs_page_projects.project_id` as TEXT (FK to projects.id), deduplicates `docs_page_versions` and adds `UNIQUE(page_id, revision)` index, adds `title`, `slug`, `base_revision` columns to `docs_page_drafts` for draft-first lifecycle. Guard: checks for `title` column in `docs_page_drafts` (applied by `db.ts` lines 443–453). Runs inside `PRAGMA foreign_keys = OFF/ON`. |

### Maintenance Locks (041)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 041 | `041_skill_maintenance_locks.sql` | Creates `maintenance_locks` table for atomic lease-based skill maintenance coordination. Enables project/global locks with conflict rules: project lock conflicts with active global lock on same resource; global lock conflicts with ANY active lock. UUID-scoped owner token with expiry. All upserts use application-level acquire/release — no `INSERT OR REPLACE`. SQL CHECK constraints enforce input validation at DB level. `db.ts` runs post-migration FTS integrity check: verifies `skills_fts` virtual table + all 3 migration-024 triggers exist, throws actionable error if missing. | **Low** — additive table only, no rebuilds. FTS check is diagnostic-only (no data mutation). |

### Skill Lifecycle — Versions (042)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 042 | `042_skill_versions.sql` | Adds `revision` (non-negative integer, default 0) and `archived_at` (nullable ISO timestamp) columns to `skills`. Creates `skill_versions` table for immutable version snapshots: `skill_id TEXT FK`, `revision INTEGER`, `name`, `description`, `content`, `category`, `tags`, `always_apply`, `file_tree`, `enabled`, `archived_at`, `created_at`. An `AFTER INSERT` trigger snapshots revision 0 for new skills; an `AFTER UPDATE` trigger snapshots whenever `revision` changes. `BEFORE UPDATE` and `BEFORE DELETE` triggers reject modification of version rows. Seeds revision 0 for all pre-existing skills. | **Low** — additive columns + new table. Comment marker `-- 042_versions` prevents re-apply. The seed uses `ON CONFLICT(skill_id,revision) DO NOTHING` to avoid duplicating revision 0 rows. |

### Skill Lineage — Provenance (043)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 043 | `043_skill_lineage.sql` | Creates `skill_lineage` table for provenance tracking: `id INTEGER PK AUTOINCREMENT`, `project_id TEXT`, `source_project_id TEXT`, `source_name TEXT`, `target_skill_id TEXT FK`, `source_hash TEXT`, `merged_file_paths TEXT NOT NULL` (JSON array of strings, default `[]`), `tombstone_path TEXT`, `reason TEXT`, `created_at`, `updated_at`. UNIQUE constraint on `(project_id, source_project_id, source_name, target_skill_id)`. `ON CONFLICT DO UPDATE` for upsert (sets `source_hash`, `merged_file_paths`, `tombstone_path`, `reason`, `updated_at`). Comment marker `-- 043_lineage`. | **Low** — additive only, no rebuilds. |

### Skill Proposals — Governance State Machine (044)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 044 | `044_skill_proposals.sql` | Creates `skill_proposals` table for the full proposal lifecycle: `id TEXT PK` (UUID), `project_id TEXT`, `status TEXT` (CHECK: draft/pending/approved/rejected/applied/rolled_back/stale), `proposal_type TEXT` (CHECK: create/update/merge/archive), `target_skill_id TEXT FK`, `target_name TEXT`, `source_project_id TEXT`, `source_name TEXT`, `expected_revision INTEGER`, `expected_source_revision INTEGER`, `target_revision_before INTEGER`, `source_revision_before INTEGER`, `target_created INTEGER` (boolean), `proposed_state TEXT` (JSON), `evidence_json TEXT` (JSON array, default `[]`), `observation_ids TEXT` (JSON array, default `[]`), `quality_score REAL`, `novelty_score REAL`, `contradiction_flag INTEGER` (boolean), `candidate_group_key TEXT`, `always_apply INTEGER` (boolean), `reviewer TEXT`, `review_reason TEXT`, `reviewed_at TEXT`, `applied_at TEXT`, `created_at`, `updated_at`. The application transitions pending proposals directly to `applied`; `approved` remains allowed by the SQL constraint and active-candidate dedup index for compatibility. Partial indexes on `(project_id, status)` and `(project_id, candidate_group_key)` allow one draft/pending/approved proposal per candidate group key. Comment marker `-- 044_proposals`. | **Low** — additive only, no rebuilds. Partial unique index provides dedup guard at DB level. |

### Pipeline Event Types (045)

| # | File | Purpose | Risk |
|---|------|---------|------|
| 045 | `045_pipeline_event_types.sql` | Expands the `pipeline_events` event_type CHECK constraint to include `skill_created`, `skill_updated`, `proposal_created`, `proposal_submitted`, `proposal_approved`, `proposal_rejected`, `proposal_applied`, and `proposal_rolled_back` event types. The TypeScript `PipelineEventSchema` already included `skill_created` and `skill_updated`, but the SQL CHECK constraint was missing them, causing `synthesis.ts` emissions to be silently swallowed by `SQLITE_CONSTRAINT`. Uses the standard safe rebuild pattern: PRAGMA foreign_keys=OFF, RENAME old table, CREATE new table with updated CHECK, COPY data, RECREATE indexes, DROP old table. Comment marker `-- 045_pipeline_event_types`. | **Medium** — table rebuild pattern (safe when done correctly). All existing event types are compatible with the new constraint. |

### Partial-State Guard (044)

When a pending proposal is approved, the `approveProposal()` function in `skill-governance.ts` checks for stale state before applying: target revision mismatch, target missing, or target archived each transition the proposal to `stale` with the system cause recorded. A successful approval applies the mutation and sets status to `applied`. This prevents applying proposals against a changed baseline. Race-time candidate-group duplicates are also caught via SQLITE_CONSTRAINT in `createProposal()` and mapped to a `DUPLICATE_PROPOSAL` error.

---

## Critical Migration Sequences

### Post-Migration 041 FTS Integrity Verification

After migration 041 applies, `db.ts` performs a **diagnostic FTS integrity check** (not a migration, but part of the startup sequence):

1. Queries `sqlite_master` to verify `skills_fts` virtual table exists
2. Queries `sqlite_master` to verify all 3 migration-024 triggers exist: `skills_fts_insert`, `skills_fts_delete`, `skills_fts_update`
3. If any are missing, `db.ts` throws an actionable error with the exact missing object name

This is NOT an automatic rebuild — it only verifies and reports. Manual repair follows the [failed 024 migration pattern](#repair-a-failed-024-migration).

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

### The 029 → 040 Chain (Docs Workspace)

Migrations 029–039 are additive and independent (each creates new tables). Migration **040** is a **contract repair** that fixes schema defects discovered during W0/W1A audit:

| Migration | Fix | Reason |
|-----------|-----|--------|
| 040 (Section 1) | Rebuilds `docs_page_projects.project_id` as TEXT | `projects.id` is TEXT PRIMARY KEY; FK must match type |
| 040 (Section 2) | Deduplicates `docs_page_versions` + adds UNIQUE index | Guard against duplicate version rows from race conditions |
| 040 (Section 3) | Adds `title`, `slug`, `base_revision` to `docs_page_drafts` | Enables draft-first lifecycle with title/slug preview before publish |

Canonical order:

1. `029_docs_spaces.sql` — spaces (containers)
2. `030_docs_pages.sql` — pages (content units)
3. `031_docs_pages_fts.sql` — full-text search
4. `032_docs_drafts.sql` — draft persistence
5. `033_docs_versions.sql` — version history
6. `034_docs_tags.sql` — tagging system
7. `035_docs_links.sql` — backlinks
8. `036_docs_comments.sql` — inline comments
9. `037_docs_project_links.sql` — project associations (INTEGER defect — fixed by 040)
10. `038_docs_attachments.sql` — file attachments
11. `039_docs_templates.sql` — page templates
12. `040_docs_integrity.sql` — contract repair (TEXT FK, dedup, draft metadata)

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

Used in migrations: 015, 017, 019, 024, 025, 040
**Not needed for additive migrations** (e.g., 041 `maintenance_locks` creates a new table with no FK references to rebuild).

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
7. **Verify FTS integrity after migration 041** — `db.ts` checks `skills_fts` virtual table + all 3 triggers exist on startup; throws actionable error if missing
8. **Never manually write `skills_fts` in application code** — migration 024 triggers are the sole authority; manual writes cause dual-write corruption
