-- COORD-100: additive coordination boundary for project-scoped task mutations.
-- Existing tasks remain unmanaged-compatible: revision 0 and available state.

ALTER TABLE tasks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE tasks ADD COLUMN reservation_state TEXT NOT NULL DEFAULT 'available'
  CHECK(reservation_state IN ('available', 'reserved', 'quarantined'));
ALTER TABLE tasks ADD COLUMN reservation_owner TEXT;
ALTER TABLE tasks ADD COLUMN reservation_worktree TEXT;

CREATE TRIGGER IF NOT EXISTS tasks_reservation_consistency_insert
BEFORE INSERT ON tasks
WHEN NOT (
  (NEW.reservation_state = 'available' AND NEW.reservation_owner IS NULL AND NEW.reservation_worktree IS NULL)
  OR
  (NEW.reservation_state IN ('reserved', 'quarantined')
    AND NEW.reservation_owner IS NOT NULL AND length(NEW.reservation_owner) BETWEEN 1 AND 256
    AND NEW.reservation_worktree IS NOT NULL AND length(NEW.reservation_worktree) BETWEEN 1 AND 512)
)
BEGIN
  SELECT RAISE(ABORT, 'task reservation owner/worktree is inconsistent with reservation_state');
END;

CREATE TRIGGER IF NOT EXISTS tasks_reservation_consistency_update
BEFORE UPDATE OF reservation_state, reservation_owner, reservation_worktree ON tasks
WHEN NOT (
  (NEW.reservation_state = 'available' AND NEW.reservation_owner IS NULL AND NEW.reservation_worktree IS NULL)
  OR
  (NEW.reservation_state IN ('reserved', 'quarantined')
    AND NEW.reservation_owner IS NOT NULL AND length(NEW.reservation_owner) BETWEEN 1 AND 256
    AND NEW.reservation_worktree IS NOT NULL AND length(NEW.reservation_worktree) BETWEEN 1 AND 512)
)
BEGIN
  SELECT RAISE(ABORT, 'task reservation owner/worktree is inconsistent with reservation_state');
END;

CREATE TABLE IF NOT EXISTS task_mutation_receipts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(length(operation) BETWEEN 1 AND 64),
  idempotency_key TEXT NOT NULL CHECK(
    length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 16384),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_task_mutation_receipts_project_task_created
  ON task_mutation_receipts(project_id, task_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS task_mutation_receipts_immutable_update
BEFORE UPDATE ON task_mutation_receipts
BEGIN
  SELECT RAISE(ABORT, 'task mutation receipts are immutable — UPDATE rejected');
END;
