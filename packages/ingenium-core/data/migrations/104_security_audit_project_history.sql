-- Keep immutable security audit project UUIDs as historical references after project purge.
-- Guard: db.ts applies this migration only while security_audit_events has a projects FK.
BEGIN IMMEDIATE;

DROP TRIGGER security_audit_events_immutable_update;
DROP TRIGGER security_audit_events_immutable_delete;
DROP TRIGGER security_audit_events_project_organization_insert;
DROP INDEX idx_security_audit_scope;

ALTER TABLE security_audit_events RENAME TO security_audit_events__project_fk;

CREATE TABLE security_audit_events (
  -- 104_project_history
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system')),
  actor_id TEXT CHECK(actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'failure')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(metadata_json = '{}'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

INSERT INTO security_audit_events
  (id, actor_type, actor_id, action, organization_id, project_id, outcome, metadata_json, created_at)
SELECT id, actor_type, actor_id, action, organization_id, project_id, outcome, metadata_json, created_at
FROM security_audit_events__project_fk;

DROP TABLE security_audit_events__project_fk;

CREATE INDEX idx_security_audit_scope ON security_audit_events(organization_id, project_id, created_at DESC, id DESC);

CREATE TRIGGER security_audit_events_immutable_update BEFORE UPDATE ON security_audit_events
BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END;

CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events
BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END;

CREATE TRIGGER security_audit_events_primary_key_collision
BEFORE INSERT ON security_audit_events
WHEN EXISTS (SELECT 1 FROM security_audit_events WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'security audit event id already exists'); END;

CREATE TRIGGER security_audit_events_project_organization_insert
BEFORE INSERT ON security_audit_events
WHEN NEW.organization_id IS NOT NULL AND NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'security audit project must belong to organization'); END;

COMMIT;
