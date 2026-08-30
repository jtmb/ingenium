-- Migration 092: durable, bounded duplicate suppression for IMAP watchers.
-- Guard: db.ts requires the table, project FK, guarded columns, and retention index together.

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS email_watcher_markers (
  -- 092_email_watcher_markers
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL CHECK(length(project_id) BETWEEN 1 AND 128)
    REFERENCES projects(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  folder TEXT NOT NULL CHECK(length(folder) BETWEEN 1 AND 512),
  uid TEXT NOT NULL CHECK(length(uid) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, account_id, folder, uid)
);

CREATE INDEX IF NOT EXISTS idx_email_watcher_markers_scope_newest
  ON email_watcher_markers(project_id, account_id, folder, updated_at DESC, id DESC);

COMMIT;
