-- Migration 026: Create email_suggestions table for LLM-generated smart replies.
-- Stores cached suggestion JSON per email (account+ folder+ uid), keyed to
-- email_cache for cascade deletion.

CREATE TABLE IF NOT EXISTS email_suggestions (
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  model TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, folder, uid),
  FOREIGN KEY (account_id, folder, uid) REFERENCES email_cache(account_id, folder, uid) ON DELETE CASCADE
);
