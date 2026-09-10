---
name: database-migration-management
description: ""
---

# Database Migration Management

> Skill for authoring, reviewing, and debugging SQLite migrations in the Ingenium pipeline. All migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files.

## 🔴 HARD RULEs

1. **Every migration MUST have a guard condition** preventing re-application. Use `IF NOT EXISTS`, `SELECT count(*) FROM sqlite_master`, or comment markers.
2. **Comment markers in CREATE TABLE** (`-- 017_rebuilt`, `-- 019_fk_setnull`) are the primary detection mechanism for conditional migrations — never omit them.
3. **`checkpointAfterWrite()` must NEVER be called inside `execTransaction()`.** WAL checkpoint acquires a read lock on all pages while the transaction holds a write lock → `SQLITE_LOCKED`.
4. **For CHECK constraint changes**, SQLite doesn't support `ALTER CONSTRAINT`. Use the RENAME → CREATE → COPY → DROP pattern to rebuild the table.
5. **FTS5 virtual tables require special handling.** After table rebuild: drop FTS, recreate with triggers, rebuild index. FK operations around FTS must use `PRAGMA foreign_keys = OFF/ON`.
6. **Foreign key constraints should use `ON DELETE SET NULL`** for resilience — never block deletes on FK references.

## Safe Migration Pattern (RENAME → CREATE → COPY → DROP)

Used when a table's schema changes in a way SQLite `ALTER TABLE` can't handle:

```sql
-- Step 1: Save old data
ALTER TABLE target_table RENAME TO target_table_old;

-- Step 2: Drop FTS virtual table (if content-sync FTS exists)
DROP TABLE IF EXISTS target_table_fts;

-- Step 3: Recreate with updated schema + comment marker
CREATE TABLE IF NOT EXISTS target_table (
    -- 0XX_marker
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- ... updated columns/constraints ...
);

-- Step 4: Restore data
INSERT INTO target_table SELECT * FROM target_table_old;

-- Step 5: Cleanup
DROP TABLE IF EXISTS target_table_old;

-- Step 6: Rebuild FTS + triggers + index
CREATE VIRTUAL TABLE IF NOT EXISTS target_table_fts USING fts5(...);
-- ... recreate insert/delete/update triggers ...
INSERT INTO target_table_fts(target_table_fts) VALUES('rebuild');
```

## WAL Safety Pattern

Every tool module follows this pattern:

```typescript
const result = execTransaction(() => {
  // All DB writes inside the transaction
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after transaction commits
return result;
```

**Violation detection**: If you see `SQLITE_LOCKED` errors, first check whether `checkpointAfterWrite()` is inside an `execTransaction()` callback.

## Anti-Corruption Guard

After migrations that rebuild tables (015), critical SQL references are **re-read** (`observationsCreateSql`) so subsequent migration condition checks use the current schema, not a stale reference. This guards against partially-failed migration sequences (e.g., `observations_old` with dangling FTS triggers causing "FOREIGN KEY constraint failed").

## Critical Migration Sequence (015 → 017 → 019)

| Migration | Purpose | Risk |
|-----------|---------|------|
| `015_auto_observer_source.sql` | Rebuilds `observations` to add `auto-observer` to source CHECK | Partially failing leaves `observations_old` with dangling FTS triggers |
| `017_fix_trait_fk.sql` | Rebuilds `personality_traits` to refresh FK reference after 015's rename cycle | Uses `PRAGMA foreign_keys = OFF/ON` to prevent cascading FTS errors |
| `019_trait_fk_set_null.sql` | Changes `personality_traits.exemplar_observation_id` FK to `ON DELETE SET NULL` | Safe; uses same PRAGMA wrapper |

## PRAGMA Management

- `PRAGMA foreign_keys = OFF` before table rebuild migrations that interact with FTS5 content-sync tables
- `PRAGMA foreign_keys = ON` immediately after
- `PRAGMA wal_checkpoint(PASSIVE)` — passive, non-blocking checkpoint every 50 writes
- Never use `TRUNCATE` or `RESTART` checkpoint modes — they block all readers

## Migration File Format

- Numbered sequentially: `001_init.sql`, `002_archive.sql`, ...
- Applied conditionally by `runMigrations()` in `db.ts`
- Each checks for existing table/column/signature before running
- Comment at top explaining purpose and detection strategy

## Manual DB Repair

If migrations partially fail:
1. Drop `observations_old` (leftover from failed migration 015)
2. Recreate `observations_fts` with triggers
3. Rebuild `personality_traits` FK via migration 017's SQL
