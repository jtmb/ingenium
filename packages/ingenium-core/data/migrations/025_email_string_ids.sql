-- Migration 025: Rebuild email_cache + email_bodies with uid TEXT (was INTEGER).
-- Gmail and Graph API use string IDs (e.g., "18a9b3c4d5e6f7g8"), not integers.
-- Also adds labels_json (Gmail labels) to email_cache and history_id/provider
-- for Gmail delta sync support to email_sync_state.
-- Follows the safe rebuild pattern from migrations 015, 017, and 024.

-- Guard: checked in db.ts before execution — looks for -- 025_rebuilt comment
-- marker in email_cache CREATE TABLE SQL.

PRAGMA foreign_keys = OFF;

-- ── 1. Rename existing tables ──────────────────────────────────────────

ALTER TABLE email_cache RENAME TO email_cache_old;
ALTER TABLE email_bodies RENAME TO email_bodies_old;

-- ── 2. Create new email_cache with uid TEXT + labels_json ──────────────

CREATE TABLE IF NOT EXISTS email_cache (
    -- 025_rebuilt
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid TEXT NOT NULL,
    subject TEXT,
    from_name TEXT,
    from_addr TEXT,
    date TEXT,
    snippet TEXT,
    flags TEXT DEFAULT '[]',
    has_attachments INTEGER DEFAULT 0,
    envelope_json TEXT,
    labels_json TEXT,
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, folder, uid)
);

-- ── 3. Create new email_bodies with uid TEXT ───────────────────────────

CREATE TABLE IF NOT EXISTS email_bodies (
    -- 025_rebuilt
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid TEXT NOT NULL,
    html TEXT,
    text TEXT,
    headers_json TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, folder, uid),
    FOREIGN KEY (account_id, folder, uid) REFERENCES email_cache(account_id, folder, uid) ON DELETE CASCADE
);

-- ── 4. Restore data from old tables (implicit INTEGER→TEXT cast is safe) ──

INSERT INTO email_cache (id, account_id, folder, uid, subject, from_name, from_addr, date, snippet, flags, has_attachments, envelope_json, cached_at)
  SELECT id, account_id, folder, CAST(uid AS TEXT), subject, from_name, from_addr, date, snippet, flags, has_attachments, envelope_json, cached_at
  FROM email_cache_old;

INSERT INTO email_bodies (id, account_id, folder, uid, html, text, headers_json, fetched_at)
  SELECT id, account_id, folder, CAST(uid AS TEXT), html, text, headers_json, fetched_at
  FROM email_bodies_old;

-- ── 5. Recreate indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_email_cache_account_folder ON email_cache(account_id, folder);
CREATE INDEX IF NOT EXISTS idx_email_cache_date ON email_cache(date DESC);

-- ── 6. Drop old tables ─────────────────────────────────────────────────

DROP TABLE IF EXISTS email_bodies_old;
DROP TABLE IF EXISTS email_cache_old;

-- ── 7. Add new columns to email_sync_state ─────────────────────────────
--    Use ALTER TABLE ADD COLUMN — each checked individually for idempotence.

-- Check for history_id column
-- (SQLite does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN,
--  so we use a workaround: try adding, ignore "duplicate column" errors.
--  In practice, db.ts guards with the -- 025_rebuilt marker, so this
--  only runs once. The migration is idempotent because the 025_rebuilt
--  marker prevents re-execution of steps 1–6.)

ALTER TABLE email_sync_state ADD COLUMN history_id TEXT;
ALTER TABLE email_sync_state ADD COLUMN provider TEXT DEFAULT 'imap';

PRAGMA foreign_keys = ON;
