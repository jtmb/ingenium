-- CTX-004: governance for immutable context conversations and checkpoints.
-- Maintenance never mutates or deletes immutable records. Archive state is
-- derived from append-only audit events, while one-time authorization records
-- bind an explicit confirmation token to a project-owned target and revision.

CREATE TABLE IF NOT EXISTS context_checkpoint_maintenance_authorizations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN (
    'archive_conversation', 'unarchive_conversation', 'restore_checkpoint'
  )),
  conversation_id TEXT NOT NULL,
  checkpoint_id TEXT,
  expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
  confirmation_hash TEXT NOT NULL CHECK(
    length(confirmation_hash) = 64
    AND confirmation_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, confirmation_hash),
  CHECK(
    (operation = 'restore_checkpoint' AND checkpoint_id IS NOT NULL)
    OR (operation IN ('archive_conversation', 'unarchive_conversation') AND checkpoint_id IS NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, checkpoint_id)
    REFERENCES context_checkpoints(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_checkpoint_maintenance_authorizations_target
  ON context_checkpoint_maintenance_authorizations(
    project_id, conversation_id, checkpoint_id, operation, expires_at
  );

CREATE TABLE IF NOT EXISTS context_checkpoint_audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'conversation_archived', 'conversation_unarchived', 'checkpoint_restored_as_new'
  )),
  conversation_id TEXT NOT NULL,
  checkpoint_id TEXT,
  target_conversation_id TEXT,
  expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
  checkpoint_state_hash TEXT CHECK(
    checkpoint_state_hash IS NULL OR (
      length(checkpoint_state_hash) = 64
      AND checkpoint_state_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  authorization_id TEXT NOT NULL,
  archive_sequence INTEGER CHECK(archive_sequence IS NULL OR archive_sequence >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, conversation_id, archive_sequence),
  CHECK(
    (event_type IN ('conversation_archived', 'conversation_unarchived')
      AND checkpoint_id IS NULL
      AND target_conversation_id IS NULL
      AND checkpoint_state_hash IS NULL
      AND archive_sequence IS NOT NULL)
    OR (event_type = 'checkpoint_restored_as_new'
      AND checkpoint_id IS NOT NULL
      AND target_conversation_id IS NOT NULL
      AND checkpoint_state_hash IS NOT NULL
      AND archive_sequence IS NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, checkpoint_id)
    REFERENCES context_checkpoints(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, target_conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, authorization_id)
    REFERENCES context_checkpoint_maintenance_authorizations(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_checkpoint_audit_events_project_created
  ON context_checkpoint_audit_events(project_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_context_checkpoint_audit_events_restore_branches
  ON context_checkpoint_audit_events(project_id, conversation_id, checkpoint_id, target_conversation_id)
  WHERE event_type = 'checkpoint_restored_as_new';

CREATE TRIGGER IF NOT EXISTS context_checkpoint_audit_events_immutable_update
BEFORE UPDATE ON context_checkpoint_audit_events
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_audit_events rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoint_audit_events_immutable_delete
BEFORE DELETE ON context_checkpoint_audit_events
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_audit_events rows are immutable — DELETE rejected');
END;
