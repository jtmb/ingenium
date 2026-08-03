-- VAULT-101: durable, metadata-only provenance for every vault-backed job run.
-- Plaintext secrets, paths, configuration, and nonces never enter this schema.

BEGIN IMMEDIATE;

CREATE TABLE job_vault_runs (
  run_id TEXT PRIMARY KEY CHECK(length(run_id) = 36),
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared', 'spawned', 'teardown_pending', 'cleaned', 'failed')),
  deadline_at INTEGER NOT NULL CHECK(deadline_at > 0),
  process_nonce_hash TEXT NOT NULL CHECK(
    length(process_nonce_hash) = 64 AND process_nonce_hash NOT GLOB '*[^0-9a-f]*'
  ),
  process_id INTEGER,
  process_group_id INTEGER,
  process_start_time TEXT,
  process_executable TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  prepared_at TEXT NOT NULL CHECK(length(prepared_at) BETWEEN 1 AND 64),
  spawned_at TEXT,
  teardown_started_at TEXT,
  cleaned_at TEXT,
  failed_at TEXT,
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK(
    (process_id IS NULL AND process_group_id IS NULL AND process_start_time IS NULL AND process_executable IS NULL)
    OR (process_id > 0 AND process_group_id > 0
      AND length(process_start_time) BETWEEN 1 AND 128
      AND length(process_executable) BETWEEN 1 AND 512)
  ),
  UNIQUE(project_id, run_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, run_id) REFERENCES job_runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE job_vault_run_items (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  authorized_item_version INTEGER NOT NULL CHECK(authorized_item_version >= 1),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, run_id, item_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, run_id) REFERENCES job_vault_runs(project_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_job_vault_runs_recovery
  ON job_vault_runs(state, deadline_at, project_id, run_id);
CREATE INDEX idx_job_vault_run_items_project_run
  ON job_vault_run_items(project_id, run_id, item_id);

CREATE TRIGGER job_vault_runs_identity_immutable_update
BEFORE UPDATE OF run_id, project_id, job_id, deadline_at, process_nonce_hash ON job_vault_runs
BEGIN
  SELECT RAISE(ABORT, 'job vault run identity is immutable');
END;

CREATE TRIGGER job_vault_runs_process_identity_immutable_update
BEFORE UPDATE OF process_id, process_group_id, process_start_time, process_executable ON job_vault_runs
WHEN OLD.process_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'job vault run process identity is immutable');
END;

CREATE TRIGGER job_vault_runs_state_transition_update
BEFORE UPDATE OF state ON job_vault_runs
WHEN NOT (
  (OLD.state = 'prepared' AND NEW.state IN ('spawned', 'teardown_pending', 'cleaned', 'failed'))
  OR (OLD.state = 'spawned' AND NEW.state IN ('teardown_pending', 'cleaned', 'failed'))
  OR (OLD.state = 'teardown_pending' AND NEW.state IN ('cleaned', 'failed'))
  OR (OLD.state = 'failed' AND NEW.state IN ('teardown_pending', 'cleaned'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid job vault run state transition');
END;

CREATE TRIGGER job_vault_runs_spawn_requires_identity
BEFORE UPDATE OF state ON job_vault_runs
WHEN NEW.state = 'spawned' AND NEW.process_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'spawned job vault run requires process identity');
END;

CREATE TRIGGER job_vault_runs_revision_cas_update
BEFORE UPDATE ON job_vault_runs
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'job vault run revision must advance by one');
END;

CREATE TRIGGER job_vault_run_items_immutable_update
BEFORE UPDATE ON job_vault_run_items
BEGIN
  SELECT RAISE(ABORT, 'job vault run item snapshot is immutable');
END;

CREATE TRIGGER job_vault_run_items_immutable_delete
BEFORE DELETE ON job_vault_run_items
BEGIN
  SELECT RAISE(ABORT, 'job vault run item snapshot is immutable');
END;

CREATE TRIGGER job_vault_run_items_matches_run
BEFORE INSERT ON job_vault_run_items
WHEN NOT EXISTS (
  SELECT 1 FROM job_vault_runs run
  WHERE run.project_id = NEW.project_id AND run.run_id = NEW.run_id AND run.job_id = NEW.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'job vault run item must match its run');
END;

COMMIT;
