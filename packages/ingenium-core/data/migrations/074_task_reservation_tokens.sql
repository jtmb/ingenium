-- COORD-100: opaque reservation tokens are persisted only as SHA-256 hashes.
-- Existing reservations cannot prove possession of a token, so fail closed.

BEGIN IMMEDIATE;

ALTER TABLE tasks ADD COLUMN reservation_token_hash TEXT;

UPDATE tasks
SET reservation_state = 'quarantined',
    reservation_token_hash = 'c29806b9de6bc8d2cf765e1d5722de067fa85d423fe3fb67b7d96ee55e2cbcd2'
WHERE reservation_state != 'available';

DROP TRIGGER IF EXISTS tasks_reservation_consistency_insert;
DROP TRIGGER IF EXISTS tasks_reservation_consistency_update;
DROP TRIGGER IF EXISTS task_mutation_receipts_immutable_delete;

CREATE TRIGGER tasks_reservation_consistency_insert
BEFORE INSERT ON tasks
WHEN NOT (
  (NEW.reservation_state = 'available'
    AND NEW.reservation_owner IS NULL
    AND NEW.reservation_worktree IS NULL
    AND NEW.reservation_token_hash IS NULL)
  OR
  (NEW.reservation_state IN ('reserved', 'quarantined')
    AND NEW.reservation_owner IS NOT NULL AND length(NEW.reservation_owner) BETWEEN 1 AND 256
    AND NEW.reservation_worktree IS NOT NULL AND length(NEW.reservation_worktree) BETWEEN 1 AND 512
    AND NEW.reservation_token_hash IS NOT NULL
    AND length(NEW.reservation_token_hash) = 64
    AND NEW.reservation_token_hash NOT GLOB '*[^0-9a-f]*')
)
BEGIN
  SELECT RAISE(ABORT, 'task reservation owner/worktree/token is inconsistent with reservation_state');
END;

CREATE TRIGGER tasks_reservation_consistency_update
BEFORE UPDATE OF reservation_state, reservation_owner, reservation_worktree, reservation_token_hash ON tasks
WHEN NOT (
  (NEW.reservation_state = 'available'
    AND NEW.reservation_owner IS NULL
    AND NEW.reservation_worktree IS NULL
    AND NEW.reservation_token_hash IS NULL)
  OR
  (NEW.reservation_state IN ('reserved', 'quarantined')
    AND NEW.reservation_owner IS NOT NULL AND length(NEW.reservation_owner) BETWEEN 1 AND 256
    AND NEW.reservation_worktree IS NOT NULL AND length(NEW.reservation_worktree) BETWEEN 1 AND 512
    AND NEW.reservation_token_hash IS NOT NULL
    AND length(NEW.reservation_token_hash) = 64
    AND NEW.reservation_token_hash NOT GLOB '*[^0-9a-f]*')
)
BEGIN
  SELECT RAISE(ABORT, 'task reservation owner/worktree/token is inconsistent with reservation_state');
END;

COMMIT;
