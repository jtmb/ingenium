-- AUTH-107 scoped credentials for MCP, repository sync, and private child runtimes.
BEGIN IMMEDIATE;

ALTER TABLE service_principals ADD COLUMN security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0);

CREATE TABLE mcp_credentials (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('service', 'runtime', 'repository-sync')),
  audience TEXT NOT NULL CHECK(audience IN ('mcp', 'runtime', 'repository-sync')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  token_prefix TEXT NOT NULL UNIQUE CHECK(length(token_prefix) BETWEEN 12 AND 24 AND token_prefix NOT GLOB '*[^A-Za-z0-9_-]*'),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json) AND json_type(scopes_json) = 'array' AND length(CAST(scopes_json AS BLOB)) <= 4096),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  project_grants_json TEXT NOT NULL CHECK(json_valid(project_grants_json) AND json_type(project_grants_json) = 'array' AND length(CAST(project_grants_json AS BLOB)) <= 4096),
  workspace_id TEXT NOT NULL CHECK(length(workspace_id) BETWEEN 1 AND 256 AND workspace_id = trim(workspace_id)),
  launcher_worktree TEXT NOT NULL CHECK(length(launcher_worktree) BETWEEN 1 AND 1024 AND launcher_worktree = trim(launcher_worktree)),
  security_epoch INTEGER NOT NULL CHECK(security_epoch >= 0),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  revoked_at TEXT,
  rotated_to_id TEXT REFERENCES mcp_credentials(id) ON DELETE RESTRICT,
  last_used_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  CHECK((kind = 'service' AND audience = 'mcp') OR (kind = 'runtime' AND audience = 'runtime') OR (kind = 'repository-sync' AND audience = 'repository-sync'))
);

CREATE INDEX idx_mcp_credentials_principal ON mcp_credentials(service_principal_id, revoked_at, expires_at);
CREATE INDEX idx_mcp_credentials_project ON mcp_credentials(project_id, audience, revoked_at, expires_at);

CREATE TRIGGER mcp_credentials_scope_insert
BEFORE INSERT ON mcp_credentials
WHEN NOT EXISTS (
  SELECT 1 FROM projects
  WHERE id = NEW.project_id AND organization_id = NEW.organization_id AND archived_at IS NULL
) OR NOT EXISTS (
  SELECT 1 FROM service_principals
  WHERE id = NEW.service_principal_id AND organization_id = NEW.organization_id AND status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'MCP credential scope is unavailable'); END;

CREATE TRIGGER mcp_credentials_immutable
BEFORE UPDATE ON mcp_credentials
WHEN NEW.id IS NOT OLD.id OR NEW.service_principal_id IS NOT OLD.service_principal_id
  OR NEW.kind IS NOT OLD.kind OR NEW.audience IS NOT OLD.audience OR NEW.name IS NOT OLD.name
  OR NEW.token_prefix IS NOT OLD.token_prefix OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.project_grants_json IS NOT OLD.project_grants_json
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.launcher_worktree IS NOT OLD.launcher_worktree OR NEW.security_epoch IS NOT OLD.security_epoch
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.revoked_at IS NOT OLD.revoked_at AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL))
  OR (NEW.rotated_to_id IS NOT OLD.rotated_to_id AND (OLD.rotated_to_id IS NOT NULL OR NEW.rotated_to_id IS NULL))
  OR (NEW.last_used_at IS NOT OLD.last_used_at AND OLD.last_used_at IS NOT NULL AND NEW.last_used_at < OLD.last_used_at)
BEGIN SELECT RAISE(ABORT, 'MCP credential metadata is immutable'); END;

COMMIT;
