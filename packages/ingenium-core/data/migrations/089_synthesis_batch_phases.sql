-- Migration 089: durable, crash-resumable synthesis batches.
-- Guard: db.ts requires both tables, state-machine triggers, FKs, and indexes.

BEGIN IMMEDIATE;

-- The composite key lets batch membership enforce that an observation belongs
-- to the same project as its batch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_project_id_id
  ON observations(project_id, id);

CREATE TABLE IF NOT EXISTS synthesis_batches (
  -- 089_synthesis_batches
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'created'
    CHECK(stage IN ('created', 'traits_applied', 'proposals_applied', 'complete')),
  observation_count INTEGER NOT NULL CHECK(observation_count BETWEEN 1 AND 50),
  owner_token TEXT CHECK(owner_token IS NULL OR length(owner_token) BETWEEN 1 AND 64),
  lease_expires_at TEXT,
  proposal_plan TEXT CHECK(
    proposal_plan IS NULL OR (
      json_valid(proposal_plan)
      AND length(CAST(proposal_plan AS BLOB)) <= 131072
    )
  ),
  last_error_code TEXT CHECK(last_error_code IS NULL OR length(CAST(last_error_code AS BLOB)) <= 64),
  last_error_message TEXT CHECK(last_error_message IS NULL OR length(CAST(last_error_message AS BLOB)) <= 1024),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  traits_applied_at TEXT,
  proposals_applied_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, project_id),
  CHECK(
    (owner_token IS NULL AND lease_expires_at IS NULL)
    OR (owner_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CHECK(stage <> 'complete' OR (owner_token IS NULL AND lease_expires_at IS NULL)),
  CHECK(
    (stage = 'created'
      AND traits_applied_at IS NULL
      AND proposals_applied_at IS NULL
      AND completed_at IS NULL
      AND proposal_plan IS NULL)
    OR (stage = 'traits_applied'
      AND traits_applied_at IS NOT NULL
      AND proposals_applied_at IS NULL
      AND completed_at IS NULL)
    OR (stage = 'proposals_applied'
      AND traits_applied_at IS NOT NULL
      AND proposals_applied_at IS NOT NULL
      AND completed_at IS NULL
      AND proposal_plan IS NOT NULL)
    OR (stage = 'complete'
      AND traits_applied_at IS NOT NULL
      AND proposals_applied_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND proposal_plan IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS synthesis_batch_observations (
  -- 089_synthesis_batch_observations
  batch_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  observation_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 49),
  PRIMARY KEY(batch_id, observation_id),
  UNIQUE(batch_id, ordinal),
  FOREIGN KEY(batch_id, project_id)
    REFERENCES synthesis_batches(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, observation_id)
    REFERENCES observations(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_synthesis_batches_incomplete
  ON synthesis_batches(project_id, created_at, id)
  WHERE stage <> 'complete';
CREATE INDEX IF NOT EXISTS idx_synthesis_batch_observations_project_observation
  ON synthesis_batch_observations(project_id, observation_id, batch_id);

CREATE TRIGGER IF NOT EXISTS synthesis_batches_validate_insert
BEFORE INSERT ON synthesis_batches
FOR EACH ROW
WHEN NEW.stage <> 'created'
BEGIN
  SELECT RAISE(ABORT, 'synthesis batch must start at created');
END;

CREATE TRIGGER IF NOT EXISTS synthesis_batches_validate_stage
BEFORE UPDATE OF stage ON synthesis_batches
FOR EACH ROW
WHEN NEW.stage <> OLD.stage
BEGIN
  SELECT CASE
    WHEN NOT (
      (OLD.stage = 'created' AND NEW.stage = 'traits_applied')
      OR (OLD.stage = 'traits_applied' AND NEW.stage = 'proposals_applied')
      OR (OLD.stage = 'proposals_applied' AND NEW.stage = 'complete')
    ) THEN RAISE(ABORT, 'invalid synthesis batch stage transition')
  END;
  SELECT CASE
    WHEN (
      SELECT COUNT(*)
      FROM synthesis_batch_observations
      WHERE batch_id = NEW.id AND project_id = NEW.project_id
    ) <> NEW.observation_count
    THEN RAISE(ABORT, 'synthesis batch observation membership is incomplete')
  END;
  SELECT CASE
    WHEN NEW.stage = 'complete' AND EXISTS (
      SELECT 1
      FROM synthesis_batch_observations AS membership
      JOIN observations AS observation
        ON observation.project_id = membership.project_id
       AND observation.id = membership.observation_id
      WHERE membership.batch_id = NEW.id
        AND membership.project_id = NEW.project_id
        AND observation.status <> 'processed'
    ) THEN RAISE(ABORT, 'synthesis batch observations must be processed before completion')
  END;
END;

COMMIT;
