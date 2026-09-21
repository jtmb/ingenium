-- Migration 091: retain every skill proposal and support bounded keyset reads.
-- Guard: db.ts requires the exact index and delete-rejection trigger together.

BEGIN IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_skill_proposals_project_status_created_id
  ON skill_proposals(project_id, status, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS skill_proposals_retain_before_delete
BEFORE DELETE ON skill_proposals
BEGIN
  SELECT RAISE(ABORT, 'skill proposals are retained');
END;

COMMIT;
