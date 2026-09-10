-- Backups are server-owned resources. Keep the legacy rows but move their
-- ownership metadata to the sole active global project. The update is guarded
-- so a database without a configured global project remains recoverable; the
-- startup backfill retries after ensureGlobalProject() creates one.
CREATE TABLE IF NOT EXISTS backup_ownership_migrations (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO backup_ownership_migrations (id)
VALUES (1)
ON CONFLICT(id) DO NOTHING;

UPDATE backup_records
SET project_id = (
  SELECT id FROM projects
  WHERE is_global = 1 AND archived_at IS NULL
)
WHERE EXISTS (
  SELECT 1 FROM projects
  WHERE is_global = 1 AND archived_at IS NULL
);

UPDATE backup_restore_jobs
SET project_id = (
  SELECT id FROM projects
  WHERE is_global = 1 AND archived_at IS NULL
)
WHERE EXISTS (
  SELECT 1 FROM projects
  WHERE is_global = 1 AND archived_at IS NULL
);
