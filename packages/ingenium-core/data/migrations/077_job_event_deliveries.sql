-- JOB-101: durable, exact-match delivery queue for trusted job events.
-- This is deliberately additive: legacy jobs, runs, and logs are retained.

BEGIN IMMEDIATE;

-- Existing runs predate project-scoped run access. Backfill the immutable job
-- owner before adding new scoped event-attempt provenance.
ALTER TABLE job_runs ADD COLUMN project_id TEXT;
UPDATE job_runs
SET project_id = (SELECT project_id FROM jobs WHERE jobs.id = job_runs.job_id)
WHERE project_id IS NULL;

-- Keep deleted event jobs as disabled historical parents so delivery and attempt
-- provenance remains referentially intact after the public delete operation.
ALTER TABLE jobs ADD COLUMN deleted_at TEXT CHECK(
  deleted_at IS NULL OR length(deleted_at) BETWEEN 1 AND 64
);

CREATE UNIQUE INDEX idx_jobs_project_id_id ON jobs(project_id, id);
CREATE UNIQUE INDEX idx_job_runs_project_id_id ON job_runs(project_id, id);

CREATE TRIGGER job_runs_project_scope_insert
BEFORE INSERT ON job_runs
WHEN NEW.project_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs WHERE id = NEW.job_id AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'job_runs project_id must match its job');
END;

CREATE TRIGGER job_runs_project_scope_update
BEFORE UPDATE OF project_id, job_id ON job_runs
WHEN NEW.project_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs WHERE id = NEW.job_id AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'job_runs project_id must match its job');
END;

-- A snapshot is recorded even when it fans out to zero jobs. This prevents a
-- later-created job from retroactively receiving an old trusted event.
CREATE TABLE job_event_dispatches (
  project_id TEXT NOT NULL,
  trusted_event_id TEXT NOT NULL,
  snapshotted_at TEXT NOT NULL CHECK(length(snapshotted_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, trusted_event_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, trusted_event_id)
    REFERENCES trusted_job_events(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE job_event_deliveries (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  trusted_event_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued', 'leased', 'retry_wait', 'succeeded', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  next_attempt_at TEXT,
  lease_revision INTEGER NOT NULL DEFAULT 0 CHECK(lease_revision >= 0),
  lease_expires_at TEXT,
  lease_owner_hash TEXT CHECK(
    lease_owner_hash IS NULL OR (
      length(lease_owner_hash) = 64
      AND lease_owner_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 64),
  last_error_message TEXT CHECK(
    last_error_message IS NULL OR (
      length(last_error_message) BETWEEN 1 AND 512
      AND instr(last_error_message, char(0)) = 0
      AND instr(last_error_message, char(10)) = 0
      AND instr(last_error_message, char(13)) = 0
    )
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK(
    (state = 'queued'
      AND attempt_count = 0 AND next_attempt_at IS NOT NULL
      AND lease_expires_at IS NULL AND lease_owner_hash IS NULL)
    OR (state = 'leased'
      AND attempt_count BETWEEN 1 AND 5 AND next_attempt_at IS NULL
      AND lease_revision >= 1 AND lease_expires_at IS NOT NULL AND lease_owner_hash IS NOT NULL)
    OR (state = 'retry_wait'
      AND attempt_count BETWEEN 1 AND 4 AND next_attempt_at IS NOT NULL
      AND lease_expires_at IS NULL AND lease_owner_hash IS NULL)
    OR (state = 'succeeded'
      AND attempt_count BETWEEN 1 AND 5 AND next_attempt_at IS NULL
      AND lease_expires_at IS NULL AND lease_owner_hash IS NULL)
    OR (state = 'dead_letter'
      AND attempt_count BETWEEN 0 AND 5 AND next_attempt_at IS NULL
      AND lease_expires_at IS NULL AND lease_owner_hash IS NULL)
  ),
  UNIQUE(project_id, id),
  UNIQUE(project_id, trusted_event_id, job_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, trusted_event_id)
    REFERENCES trusted_job_events(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE job_event_attempts (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 5),
  run_id TEXT NOT NULL,
  process_id INTEGER,
  process_group_id INTEGER,
  process_start_time TEXT,
  process_executable TEXT,
  process_nonce_hash TEXT CHECK(
    process_nonce_hash IS NULL OR (
      length(process_nonce_hash) = 64
      AND process_nonce_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK(
    (process_id IS NULL AND process_group_id IS NULL AND process_start_time IS NULL
      AND process_executable IS NULL AND process_nonce_hash IS NULL)
    OR (process_id > 0 AND process_group_id > 0
      AND length(process_start_time) BETWEEN 1 AND 128
      AND length(process_executable) BETWEEN 1 AND 512
      AND process_nonce_hash IS NOT NULL)
  ),
  UNIQUE(project_id, id),
  UNIQUE(project_id, delivery_id, attempt_number),
  UNIQUE(project_id, run_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, delivery_id)
    REFERENCES job_event_deliveries(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, run_id) REFERENCES job_runs(project_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER job_event_dispatches_immutable_update
BEFORE UPDATE ON job_event_dispatches
BEGIN
  SELECT RAISE(ABORT, 'job event dispatch markers are immutable');
END;

CREATE TRIGGER job_event_dispatches_immutable_delete
BEFORE DELETE ON job_event_dispatches
BEGIN
  SELECT RAISE(ABORT, 'job event dispatch markers are immutable');
END;

CREATE TRIGGER job_event_attempts_run_matches_delivery
BEFORE INSERT ON job_event_attempts
WHEN NOT EXISTS (
  SELECT 1
  FROM job_event_deliveries delivery
  JOIN job_runs run ON run.id = NEW.run_id AND run.project_id = NEW.project_id
  WHERE delivery.id = NEW.delivery_id
    AND delivery.project_id = NEW.project_id
    AND run.job_id = delivery.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'job event attempt run must match its delivery job');
END;

CREATE TRIGGER job_event_attempts_immutable_linkage_update
BEFORE UPDATE OF project_id, delivery_id, attempt_number, run_id ON job_event_attempts
BEGIN
  SELECT RAISE(ABORT, 'job event attempt linkage is immutable');
END;

CREATE INDEX idx_job_event_dispatches_project_snapshot
  ON job_event_dispatches(project_id, snapshotted_at DESC, trusted_event_id DESC);
CREATE INDEX idx_job_event_deliveries_claim
  ON job_event_deliveries(project_id, state, next_attempt_at, id);
CREATE INDEX idx_job_event_deliveries_expiry
  ON job_event_deliveries(project_id, state, lease_expires_at, id);
CREATE INDEX idx_job_event_deliveries_project_updated
  ON job_event_deliveries(project_id, updated_at DESC, id DESC);
CREATE INDEX idx_job_event_attempts_delivery
  ON job_event_attempts(project_id, delivery_id, attempt_number);

COMMIT;
