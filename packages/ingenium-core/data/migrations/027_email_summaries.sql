-- Migration 027: Create email_summaries table for LLM-generated email summaries.
-- Stores cached summary text per email (account+ folder+ uid), keyed to
-- email_cache for cascade deletion. Same FK defensive pattern as email_suggestions.

CREATE TABLE IF NOT EXISTS email_summaries (
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  model TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, folder, uid),
  FOREIGN KEY (account_id, folder, uid) REFERENCES email_cache(account_id, folder, uid) ON DELETE CASCADE
);
