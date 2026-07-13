-- Migration 022: Email cache for instant inbox loads.
-- Caches IMAP email listings and bodies so the mail dashboard
-- loads from DB instead of hitting IMAP on every page view.

-- ============================================================
-- 1. Email listing cache
-- ============================================================

CREATE TABLE IF NOT EXISTS email_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    subject TEXT,
    from_name TEXT,
    from_addr TEXT,
    date TEXT,
    snippet TEXT,
    flags TEXT DEFAULT '[]',
    has_attachments INTEGER DEFAULT 0,
    envelope_json TEXT,
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, folder, uid)
);

CREATE INDEX IF NOT EXISTS idx_email_cache_account_folder ON email_cache(account_id, folder);
CREATE INDEX IF NOT EXISTS idx_email_cache_date ON email_cache(date DESC);

-- ============================================================
-- 2. Email body cache (full HTML/text content)
-- ============================================================

CREATE TABLE IF NOT EXISTS email_bodies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    html TEXT,
    text TEXT,
    headers_json TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, folder, uid),
    FOREIGN KEY (account_id, folder, uid) REFERENCES email_cache(account_id, folder, uid) ON DELETE CASCADE
);

-- ============================================================
-- 3. IMAP sync state (UIDNEXT / UIDVALIDITY tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS email_sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    folder TEXT NOT NULL,
    last_uid INTEGER DEFAULT 0,
    uidvalidity INTEGER DEFAULT 0,
    last_synced_at TEXT,
    UNIQUE(account_id, folder)
);
