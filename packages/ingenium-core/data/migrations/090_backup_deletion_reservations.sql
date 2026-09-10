-- 090_backup_deletion_reservations: durable, bounded state prevents a restore
-- preview from racing bundle removal. db.ts refuses partial installations.
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS backup_deletion_reservations (
  -- 090_backup_deletion_reservations
  project_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved', 'deleting')),
  attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 2147483647),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, backup_id),
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backup_deletion_reservations_state
  ON backup_deletion_reservations(state, updated_at, project_id, backup_id);

CREATE TRIGGER IF NOT EXISTS backup_deletion_reservations_reject_referenced_backup
BEFORE INSERT ON backup_deletion_reservations
WHEN EXISTS (
  SELECT 1 FROM backup_restore_plans
  WHERE project_id = NEW.project_id AND backup_id = NEW.backup_id
)
BEGIN SELECT RAISE(ABORT, 'backup deletion reservation requires an unreferenced backup'); END;

CREATE TRIGGER IF NOT EXISTS backup_restore_plans_reject_deleting_backup
BEFORE INSERT ON backup_restore_plans
WHEN EXISTS (
  SELECT 1 FROM backup_deletion_reservations
  WHERE project_id = NEW.project_id AND backup_id = NEW.backup_id
    AND state IN ('reserved', 'deleting')
)
BEGIN SELECT RAISE(ABORT, 'backup deletion reservation blocks restore preview'); END;

COMMIT;
