-- Migration 041: Add maintenance_locks table for atomic lease-based skill maintenance coordination.
--
-- Purpose: Prevent concurrent skill maintenance operations (synthesis, sync, cleanup)
-- from racing against each other. A resource-level lock with project scoping enables
-- global/exclusive locks (* project_id) and per-project locks.
--
-- Conflict rules (enforced in application code):
--   1. A project lock conflicts with an active global lock on the same resource.
--   2. A global lock conflicts with ANY active lock on the same resource.
--   3. Same (resource, project_id) can only be held by one owner at a time (UNIQUE constraint).
--
-- No INSERT OR REPLACE anywhere — all upserts use application-level acquire/release logic
-- with explicit conflict checks before INSERT.
--
-- SQL CHECK constraints enforce input validation at the database level:
--   resource/project_id: non-empty, max 256 chars
--   owner_token: non-empty, max 64 chars

CREATE TABLE IF NOT EXISTS maintenance_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource TEXT NOT NULL CHECK(length(resource) > 0 AND length(resource) <= 256),
    project_id TEXT NOT NULL DEFAULT '*' CHECK(length(project_id) > 0 AND length(project_id) <= 256),
    owner_token TEXT NOT NULL CHECK(length(owner_token) > 0 AND length(owner_token) <= 64),
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(resource, project_id)
);

-- Index for conflict-check queries: find locks by resource (used by acquireLock)
CREATE INDEX IF NOT EXISTS idx_maintenance_locks_resource ON maintenance_locks(resource);

-- Index for expiry-based cleanup: prune expired locks efficiently
CREATE INDEX IF NOT EXISTS idx_maintenance_locks_expires ON maintenance_locks(expires_at);

-- NOTE: skills_fts integrity verification and rebuild is performed in db.ts
-- after this migration is applied. The raw SQL here is intentionally limited to
-- the maintenance_locks table only — FTS rebuild is done programmatically in
-- db.ts after querying sqlite_master to verify the virtual table and all three
-- migration-024 triggers exist. If any are missing, db.ts throws an actionable error.
