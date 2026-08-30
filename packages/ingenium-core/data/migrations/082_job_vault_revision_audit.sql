-- VAULT-102: revisioned job authorization and structured job-vault audit.
-- This is additive: deleted jobs and historical authorization evidence remain.

BEGIN IMMEDIATE;

ALTER TABLE jobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);

-- Every mutable job row must advance its revision exactly once. This protects
-- direct SQL maintenance paths from silently invalidating API CAS clients.
CREATE TRIGGER jobs_revision_monotonic_update
BEFORE UPDATE ON jobs
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'job revision must advance by one');
END;

CREATE TABLE job_vault_runtime_audit (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  item_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('secret_read', 'access_denied')),
  run_id TEXT NOT NULL,
  authorized_item_version INTEGER,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  CHECK(
    (action = 'secret_read' AND item_id IS NOT NULL AND authorized_item_version >= 1)
    OR (action = 'access_denied' AND item_id IS NULL AND authorized_item_version IS NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, run_id) REFERENCES job_runs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_job_vault_runtime_audit_project_job_created
  ON job_vault_runtime_audit(project_id, job_id, created_at DESC, id DESC);

-- A runtime audit entry is accepted only for the exact project/job/run tuple;
-- never infer linkage from an actor string or a partial identifier.
CREATE TRIGGER job_vault_runtime_audit_run_matches_job
BEFORE INSERT ON job_vault_runtime_audit
WHEN NOT EXISTS (
  SELECT 1
  FROM job_runs run
  JOIN jobs job ON job.project_id = run.project_id AND job.id = run.job_id
  WHERE run.project_id = NEW.project_id
    AND run.id = NEW.run_id
    AND job.id = NEW.job_id
)
BEGIN
  SELECT RAISE(ABORT, 'job vault runtime audit run must match its job');
END;

CREATE TRIGGER job_vault_runtime_audit_immutable_update
BEFORE UPDATE ON job_vault_runtime_audit
BEGIN
  SELECT RAISE(ABORT, 'job vault runtime audit is immutable');
END;

CREATE TRIGGER job_vault_runtime_audit_immutable_delete
BEFORE DELETE ON job_vault_runtime_audit
BEGIN
  SELECT RAISE(ABORT, 'job vault runtime audit is immutable');
END;

COMMIT;
