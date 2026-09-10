-- RESTORE-101 bounded, content-free executor diagnostics.
BEGIN IMMEDIATE;

CREATE TABLE backup_restore_execution_phase_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase_code TEXT NOT NULL CHECK(phase_code IN (
    'claim', 'artifact', 'parent-lock', 'holder-scan', 'safety',
    'install_ingenium', 'install_opencode', 'capsule', 'verify', 'restart',
    'rollback_prepare', 'rollback_ingenium', 'rollback_opencode', 'rollback_complete'
  )),
  status TEXT NOT NULL CHECK(status IN ('entered', 'failed', 'completed')),
  error_code TEXT CHECK(error_code IS NULL OR error_code IN (
    'DEADLINE_EXCEEDED', 'HOLDER_REFUSED', 'SAFETY_SNAPSHOT_FAILED',
    'BUFFER_WRITE_FAILED', 'SWAP_FAILED', 'VERIFY_FAILED', 'HEALTH_FAILED',
    'ROLLBACK_FAILED', 'JOURNAL_INVALID', 'SUPERVISOR_FAILED', 'EXECUTOR_SETUP_FAILED'
  )),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_backup_restore_execution_phase_events_plan
  ON backup_restore_execution_phase_events(project_id, plan_id, created_at DESC, id DESC);

CREATE TRIGGER backup_restore_execution_phase_events_validate_insert
BEFORE INSERT ON backup_restore_execution_phase_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_runs
    WHERE project_id = NEW.project_id AND id = NEW.run_id
      AND plan_id = NEW.plan_id AND backup_id = NEW.backup_id
  ) THEN RAISE(ABORT, 'restore phase event must match execution run') END;
  SELECT CASE WHEN NEW.status != 'failed' AND NEW.error_code IS NOT NULL
    THEN RAISE(ABORT, 'only failed restore phase events may contain an error code') END;
  SELECT CASE WHEN NEW.status = 'failed' AND NEW.error_code IS NULL
    THEN RAISE(ABORT, 'failed restore phase events require an error code') END;
END;

CREATE TRIGGER backup_restore_execution_phase_events_immutable_update
BEFORE UPDATE ON backup_restore_execution_phase_events
BEGIN SELECT RAISE(ABORT, 'restore phase events are immutable'); END;

CREATE TRIGGER backup_restore_execution_phase_events_immutable_delete
BEFORE DELETE ON backup_restore_execution_phase_events
BEGIN SELECT RAISE(ABORT, 'restore phase events are immutable'); END;

COMMIT;
