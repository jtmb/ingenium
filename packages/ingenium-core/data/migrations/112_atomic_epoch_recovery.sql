-- Bind claims and quarantine ownership to accepted epochs so recovery can retire
-- only the crashed owner's state without opening a takeover window.
BEGIN IMMEDIATE;

ALTER TABLE coordination_claims ADD COLUMN accepted_epoch INTEGER CHECK(
  accepted_epoch IS NULL OR accepted_epoch >= 1
);

UPDATE coordination_claims
SET accepted_epoch = COALESCE(
  (SELECT accepted_epoch
   FROM coordination_worktree_epochs
   WHERE coordination_worktree_epochs.project_id = coordination_claims.project_id
     AND coordination_worktree_epochs.worktree_id = coordination_claims.worktree_id),
  1
);

CREATE INDEX idx_coordination_claims_epoch_owner
  ON coordination_claims(
    project_id, worktree_id, accepted_epoch, coordination_session_id, state
  );

CREATE TRIGGER coordination_claims_require_accepted_epoch_insert
BEFORE INSERT ON coordination_claims
WHEN NEW.accepted_epoch IS NULL
BEGIN
  SELECT RAISE(ABORT, 'coordination claim accepted epoch required');
END;

CREATE TRIGGER coordination_claims_accepted_epoch_immutable
BEFORE UPDATE OF accepted_epoch ON coordination_claims
WHEN NEW.accepted_epoch IS NULL OR NEW.accepted_epoch <> OLD.accepted_epoch
BEGIN
  SELECT RAISE(ABORT, 'coordination claim accepted epoch is immutable');
END;

ALTER TABLE coordination_worktree_epochs ADD COLUMN quarantined_coordination_session_id TEXT CHECK(
  quarantined_coordination_session_id IS NULL OR length(quarantined_coordination_session_id) = 36
);
ALTER TABLE coordination_worktree_epochs ADD COLUMN quarantined_incarnation INTEGER CHECK(
  quarantined_incarnation IS NULL OR quarantined_incarnation >= 1
);
ALTER TABLE coordination_worktree_epochs ADD COLUMN quarantined_fence INTEGER CHECK(
  quarantined_fence IS NULL OR quarantined_fence >= 1
);
ALTER TABLE coordination_worktree_epochs ADD COLUMN reconciliation_footprint_hash TEXT CHECK(
  reconciliation_footprint_hash IS NULL OR (
    length(reconciliation_footprint_hash) = 64
    AND reconciliation_footprint_hash NOT GLOB '*[^0-9a-f]*'
  )
);

UPDATE coordination_worktree_epochs
SET quarantined_coordination_session_id = (
      SELECT id FROM coordination_sessions
      WHERE coordination_sessions.project_id = coordination_worktree_epochs.project_id
        AND coordination_sessions.worktree_id = coordination_worktree_epochs.worktree_id
        AND coordination_sessions.state = 'quarantined'
      ORDER BY coordination_sessions.updated_at DESC, coordination_sessions.id DESC LIMIT 1
    ),
    quarantined_incarnation = (
      SELECT incarnation FROM coordination_sessions
      WHERE coordination_sessions.project_id = coordination_worktree_epochs.project_id
        AND coordination_sessions.worktree_id = coordination_worktree_epochs.worktree_id
        AND coordination_sessions.state = 'quarantined'
      ORDER BY coordination_sessions.updated_at DESC, coordination_sessions.id DESC LIMIT 1
    ),
    quarantined_fence = (
      SELECT fence FROM coordination_sessions
      WHERE coordination_sessions.project_id = coordination_worktree_epochs.project_id
        AND coordination_sessions.worktree_id = coordination_worktree_epochs.worktree_id
        AND coordination_sessions.state = 'quarantined'
      ORDER BY coordination_sessions.updated_at DESC, coordination_sessions.id DESC LIMIT 1
    )
WHERE state = 'quarantined';

CREATE TRIGGER coordination_epochs_require_quarantine_owner
BEFORE UPDATE OF state, quarantined_coordination_session_id, quarantined_incarnation, quarantined_fence
ON coordination_worktree_epochs
WHEN NEW.state = 'quarantined' AND (
  NEW.quarantined_coordination_session_id IS NULL
  OR NEW.quarantined_incarnation IS NULL
  OR NEW.quarantined_fence IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'coordination quarantine owner required');
END;

CREATE TRIGGER coordination_epochs_clear_recovery_proof
BEFORE UPDATE OF state, quarantined_coordination_session_id, quarantined_incarnation,
  quarantined_fence, reconciliation_footprint_hash
ON coordination_worktree_epochs
WHEN NEW.state = 'active' AND (
  NEW.quarantined_coordination_session_id IS NOT NULL
  OR NEW.quarantined_incarnation IS NOT NULL
  OR NEW.quarantined_fence IS NOT NULL
  OR NEW.reconciliation_footprint_hash IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'coordination active epoch retains recovery proof');
END;

COMMIT;
