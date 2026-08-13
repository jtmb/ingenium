-- AUTH-101 scoped user API tokens, invitations, installation principals, and auth audit.
BEGIN IMMEDIATE;

CREATE TABLE installation_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

CREATE TABLE service_principals (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(organization_id, name)
);

CREATE TABLE scoped_api_tokens (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  token_prefix TEXT NOT NULL UNIQUE CHECK(length(token_prefix) BETWEEN 12 AND 24 AND token_prefix NOT GLOB '*[^A-Za-z0-9_-]*'),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json) AND json_type(scopes_json) = 'array' AND length(CAST(scopes_json AS BLOB)) <= 4096),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  CHECK((user_id IS NOT NULL) <> (service_principal_id IS NOT NULL)),
  CHECK(project_id IS NULL OR organization_id IS NOT NULL)
);

CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email_normalized TEXT NOT NULL CHECK(length(email_normalized) BETWEEN 3 AND 320 AND email_normalized = lower(trim(email_normalized))),
  role TEXT NOT NULL CHECK(role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

CREATE TABLE security_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system')),
  actor_id TEXT CHECK(actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'failure')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(metadata_json = '{}'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

CREATE INDEX idx_scoped_api_tokens_user ON scoped_api_tokens(user_id, revoked_at, expires_at);
CREATE INDEX idx_scoped_api_tokens_service ON scoped_api_tokens(service_principal_id, revoked_at, expires_at);
CREATE INDEX idx_organization_invitations_scope ON organization_invitations(organization_id, email_normalized, expires_at);
CREATE INDEX idx_security_audit_scope ON security_audit_events(organization_id, project_id, created_at DESC, id DESC);

CREATE TRIGGER security_audit_events_immutable_update BEFORE UPDATE ON security_audit_events
BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END;
CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events
BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END;
CREATE TRIGGER security_audit_events_project_organization_insert
BEFORE INSERT ON security_audit_events
WHEN NEW.organization_id IS NOT NULL AND NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'security audit project must belong to organization'); END;
CREATE TRIGGER scoped_api_tokens_identity_immutable
BEFORE UPDATE ON scoped_api_tokens
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.service_principal_id IS NOT OLD.service_principal_id
  OR NEW.name IS NOT OLD.name OR NEW.token_prefix IS NOT OLD.token_prefix OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.revoked_at IS NOT OLD.revoked_at AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL))
  OR (NEW.last_used_at IS NOT OLD.last_used_at AND NEW.last_used_at < OLD.last_used_at)
BEGIN SELECT RAISE(ABORT, 'scoped API token may only be revoked once'); END;

CREATE TRIGGER scoped_api_tokens_project_organization_insert
BEFORE INSERT ON scoped_api_tokens
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'scoped API token project must belong to organization'); END;
CREATE TRIGGER scoped_api_tokens_project_organization_update
BEFORE UPDATE OF organization_id, project_id ON scoped_api_tokens
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'scoped API token project must belong to organization'); END;

CREATE TRIGGER organization_invitations_consume_once
BEFORE UPDATE ON organization_invitations
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.email_normalized IS NOT OLD.email_normalized
  OR NEW.role IS NOT OLD.role OR NEW.token_hash IS NOT OLD.token_hash OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at OR OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
  OR (NEW.accepted_at IS NULL) = (NEW.revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'organization invitation may only be consumed once'); END;

COMMIT;
