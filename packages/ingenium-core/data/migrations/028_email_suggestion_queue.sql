CREATE TABLE IF NOT EXISTS email_suggestion_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error TEXT,
  UNIQUE(account_id, folder, uid)
);

CREATE INDEX IF NOT EXISTS idx_esq_next ON email_suggestion_queue(next_attempt_at, attempts);
