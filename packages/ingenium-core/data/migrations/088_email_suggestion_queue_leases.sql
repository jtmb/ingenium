-- Migration 088: add durable claim leases without rewriting queued jobs.
-- Guard: db.ts applies this only when all lease columns are absent.

BEGIN IMMEDIATE;

ALTER TABLE email_suggestion_queue ADD COLUMN lease_state TEXT NOT NULL DEFAULT 'queued'
  CHECK(lease_state IN ('queued', 'claimed'));
ALTER TABLE email_suggestion_queue ADD COLUMN lease_owner TEXT;
ALTER TABLE email_suggestion_queue ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_esq_claimable
  ON email_suggestion_queue(lease_state, next_attempt_at, lease_expires_at, created_at, id);

COMMIT;
