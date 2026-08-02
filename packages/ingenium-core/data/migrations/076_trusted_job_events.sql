-- JOB-100: durable, append-only trusted events for the job dispatcher.
-- Existing jobs may retain historical trigger_event values. The jobs triggers
-- only constrain new rows and actual changes to trigger_event.

BEGIN IMMEDIATE;

CREATE TABLE trusted_job_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'context.conversation.archived',
    'context.conversation.unarchived',
    'context.checkpoint.restored_as_new'
  )),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  producer TEXT NOT NULL CHECK(producer = 'context.maintenance'),
  source_audit_event_id TEXT NOT NULL CHECK(length(source_audit_event_id) = 36),
  dedupe_key TEXT NOT NULL CHECK(
    length(dedupe_key) = 36
    AND dedupe_key = source_audit_event_id
  ),
  payload TEXT NOT NULL CHECK(
    json_valid(payload)
    AND json_type(payload) = 'object'
    AND length(CAST(payload AS BLOB)) <= 2048
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, event_type, dedupe_key),
  UNIQUE(project_id, source_audit_event_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, source_audit_event_id)
    REFERENCES context_checkpoint_audit_events(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_trusted_job_events_project_created
  ON trusted_job_events(project_id, created_at DESC, id DESC);

-- SQL remains the final trust boundary for callers that bypass TypeScript. The
-- JSON key set is exact for each catalog event and values are content-free.
CREATE TRIGGER trusted_job_events_payload_contract
BEFORE INSERT ON trusted_job_events
BEGIN
  SELECT CASE WHEN
    (
      NEW.event_type IN ('context.conversation.archived', 'context.conversation.unarchived')
      AND NOT (
        json_type(NEW.payload, '$.conversationId') = 'text'
        AND length(json_extract(NEW.payload, '$.conversationId')) = 36
        AND json_type(NEW.payload, '$.expectedRevision') = 'integer'
        AND json_extract(NEW.payload, '$.expectedRevision') >= 0
        AND json_type(NEW.payload, '$.archiveSequence') = 'integer'
        AND json_extract(NEW.payload, '$.archiveSequence') >= 0
        AND json_remove(
          NEW.payload,
          '$.conversationId',
          '$.expectedRevision',
          '$.archiveSequence'
        ) = '{}'
      )
    )
    OR (
      NEW.event_type = 'context.checkpoint.restored_as_new'
      AND NOT (
        json_type(NEW.payload, '$.sourceConversationId') = 'text'
        AND length(json_extract(NEW.payload, '$.sourceConversationId')) = 36
        AND json_type(NEW.payload, '$.sourceCheckpointId') = 'text'
        AND length(json_extract(NEW.payload, '$.sourceCheckpointId')) = 36
        AND json_type(NEW.payload, '$.targetConversationId') = 'text'
        AND length(json_extract(NEW.payload, '$.targetConversationId')) = 36
        AND json_type(NEW.payload, '$.expectedRevision') = 'integer'
        AND json_extract(NEW.payload, '$.expectedRevision') >= 0
        AND json_remove(
          NEW.payload,
          '$.sourceConversationId',
          '$.sourceCheckpointId',
          '$.targetConversationId',
          '$.expectedRevision'
        ) = '{}'
      )
    )
  THEN RAISE(ABORT, 'trusted_job_events payload violates its catalog contract') END;
END;

-- Provenance is not merely descriptive: every event is tied to its immutable
-- Context audit row, a consumed one-time authorization, and matching
-- content-free payload values. This remains the SQL trust boundary for direct
-- database callers that bypass Context maintenance helpers.
CREATE TRIGGER trusted_job_events_context_provenance
BEFORE INSERT ON trusted_job_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM context_checkpoint_audit_events audit
    JOIN context_checkpoint_maintenance_authorizations authorization
      ON authorization.project_id = audit.project_id
      AND authorization.id = audit.authorization_id
    WHERE audit.project_id = NEW.project_id
      AND audit.id = NEW.source_audit_event_id
      AND authorization.conversation_id = audit.conversation_id
      AND authorization.expected_revision = audit.expected_revision
      AND authorization.consumed_at IS NOT NULL
      AND authorization.created_at <= authorization.consumed_at
      AND authorization.consumed_at < authorization.expires_at
      AND audit.created_at >= authorization.consumed_at
      AND NOT EXISTS (
        SELECT 1
        FROM context_checkpoint_audit_events replay
        WHERE replay.project_id = audit.project_id
          AND replay.authorization_id = audit.authorization_id
          AND replay.id <> audit.id
      )
      AND (
        (
          NEW.event_type = 'context.conversation.archived'
          AND audit.event_type = 'conversation_archived'
          AND authorization.operation = 'archive_conversation'
          AND authorization.checkpoint_id IS NULL
          AND audit.checkpoint_id IS NULL
          AND json_extract(NEW.payload, '$.conversationId') = audit.conversation_id
          AND json_extract(NEW.payload, '$.expectedRevision') = audit.expected_revision
          AND json_extract(NEW.payload, '$.archiveSequence') = audit.archive_sequence
        )
        OR (
          NEW.event_type = 'context.conversation.unarchived'
          AND audit.event_type = 'conversation_unarchived'
          AND authorization.operation = 'unarchive_conversation'
          AND authorization.checkpoint_id IS NULL
          AND audit.checkpoint_id IS NULL
          AND json_extract(NEW.payload, '$.conversationId') = audit.conversation_id
          AND json_extract(NEW.payload, '$.expectedRevision') = audit.expected_revision
          AND json_extract(NEW.payload, '$.archiveSequence') = audit.archive_sequence
        )
        OR (
          NEW.event_type = 'context.checkpoint.restored_as_new'
          AND audit.event_type = 'checkpoint_restored_as_new'
          AND authorization.operation = 'restore_checkpoint'
          AND authorization.checkpoint_id = audit.checkpoint_id
          AND json_extract(NEW.payload, '$.sourceConversationId') = audit.conversation_id
          AND json_extract(NEW.payload, '$.sourceCheckpointId') = audit.checkpoint_id
          AND json_extract(NEW.payload, '$.targetConversationId') = audit.target_conversation_id
          AND json_extract(NEW.payload, '$.expectedRevision') = audit.expected_revision
        )
      )
  ) THEN RAISE(ABORT, 'trusted_job_events source audit provenance mismatch') END;
END;

CREATE TRIGGER trusted_job_events_immutable_update
BEFORE UPDATE ON trusted_job_events
BEGIN
  SELECT RAISE(ABORT, 'trusted_job_events rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER trusted_job_events_immutable_delete
BEFORE DELETE ON trusted_job_events
BEGIN
  SELECT RAISE(ABORT, 'trusted_job_events rows are immutable — DELETE rejected');
END;

CREATE TRIGGER jobs_trigger_event_catalog_insert
BEFORE INSERT ON jobs
WHEN NEW.trigger_event IS NOT NULL
  AND NEW.trigger_event NOT IN (
    'context.conversation.archived',
    'context.conversation.unarchived',
    'context.checkpoint.restored_as_new'
  )
BEGIN
  SELECT RAISE(ABORT, 'jobs trigger_event must be a trusted job event catalog value or NULL');
END;

CREATE TRIGGER jobs_trigger_event_catalog_update
BEFORE UPDATE OF trigger_event ON jobs
WHEN NEW.trigger_event IS NOT OLD.trigger_event
  AND NEW.trigger_event IS NOT NULL
  AND NEW.trigger_event NOT IN (
    'context.conversation.archived',
    'context.conversation.unarchived',
    'context.checkpoint.restored_as_new'
  )
BEGIN
  SELECT RAISE(ABORT, 'jobs trigger_event must be a trusted job event catalog value or NULL');
END;

COMMIT;
