-- Allow a revoked workspace binding to remain as an audit tombstone while a
-- replacement binding authorizes the same canonical storage path.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE authorized_workspaces_109 (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256 AND id = trim(id)),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL CHECK(length(storage_path) BETWEEN 1 AND 1024 AND storage_path = trim(storage_path) AND substr(storage_path, 1, 1) = '/'),
  storage_mapping_hash TEXT NOT NULL CHECK(length(storage_mapping_hash) = 64 AND storage_mapping_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL DEFAULT 'authorized' CHECK(status IN ('authorized', 'revoked')),
  security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(id, organization_id, project_id, owner_user_id)
);

INSERT INTO authorized_workspaces_109
  (id, organization_id, project_id, owner_user_id, storage_path, storage_mapping_hash,
   status, security_epoch, created_at, updated_at)
SELECT id, organization_id, project_id, owner_user_id, storage_path, storage_mapping_hash,
       status, security_epoch, created_at, updated_at
FROM authorized_workspaces;

DROP TRIGGER runtime_instances_scope_insert;
DROP TRIGGER runtime_launch_ticket_scope_insert;
DROP TRIGGER runtime_browser_ticket_scope_insert;
DROP TABLE authorized_workspaces;
ALTER TABLE authorized_workspaces_109 RENAME TO authorized_workspaces;

CREATE UNIQUE INDEX idx_authorized_workspaces_active_storage
  ON authorized_workspaces(storage_path) WHERE status = 'authorized';

CREATE TRIGGER authorized_workspaces_scope_insert
BEFORE INSERT ON authorized_workspaces
WHEN NOT EXISTS (
  SELECT 1 FROM projects p JOIN organization_memberships m ON m.organization_id = p.organization_id
  WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id AND p.archived_at IS NULL
    AND m.user_id = NEW.owner_user_id AND m.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'workspace scope is unavailable'); END;

CREATE TRIGGER authorized_workspaces_mapping_immutable
BEFORE UPDATE ON authorized_workspaces
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.storage_path IS NOT OLD.storage_path OR NEW.storage_mapping_hash IS NOT OLD.storage_mapping_hash
  OR NEW.created_at IS NOT OLD.created_at OR NEW.security_epoch < OLD.security_epoch
  OR (OLD.status = 'revoked' AND NEW.status <> 'revoked')
BEGIN SELECT RAISE(ABORT, 'workspace mapping is immutable'); END;

CREATE TRIGGER runtime_instances_scope_insert
BEFORE INSERT ON runtime_instances
WHEN NOT EXISTS (
  SELECT 1 FROM authorized_workspaces w
  WHERE w.id = NEW.workspace_id AND w.organization_id = NEW.organization_id
    AND w.project_id = NEW.project_id AND w.owner_user_id = NEW.owner_user_id
    AND w.status = 'authorized' AND w.security_epoch = NEW.security_epoch
)
BEGIN SELECT RAISE(ABORT, 'runtime workspace scope is unavailable'); END;

CREATE TRIGGER runtime_launch_ticket_scope_insert
BEFORE INSERT ON runtime_launch_tickets
WHEN NOT EXISTS (
  SELECT 1 FROM runtime_instances r JOIN authorized_workspaces w ON w.id = r.workspace_id
  WHERE r.id = NEW.runtime_id AND r.organization_id = NEW.organization_id
    AND r.project_id = NEW.project_id AND r.owner_user_id = NEW.owner_user_id
    AND r.state IN ('READY', 'IDLE') AND w.status = 'authorized'
    AND w.security_epoch = r.security_epoch
)
BEGIN SELECT RAISE(ABORT, 'runtime launch scope is unavailable'); END;

CREATE TRIGGER runtime_browser_ticket_scope_insert
BEFORE INSERT ON runtime_browser_launch_tickets
WHEN NOT EXISTS (
  SELECT 1 FROM runtime_instances r
  JOIN authorized_workspaces w ON w.id = r.workspace_id
  JOIN auth_sessions s ON s.id = NEW.auth_session_id
  JOIN runtime_browser_generations g ON g.runtime_id = r.id
  WHERE r.id = NEW.runtime_id AND r.workspace_id = NEW.workspace_id
    AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id
    AND r.owner_user_id = NEW.owner_user_id AND r.state IN ('READY', 'IDLE')
    AND w.status = 'authorized' AND w.security_epoch = r.security_epoch
    AND s.user_id = r.owner_user_id AND s.revoked_at IS NULL
    AND g.generation = NEW.generation
)
BEGIN SELECT RAISE(ABORT, 'runtime browser launch scope is unavailable'); END;

COMMIT;
PRAGMA foreign_keys = ON;
