-- AUTH-101 exact upgrade from the AUTH-100 authorization-token foundation.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

DROP TRIGGER scoped_api_tokens_identity_immutable;
DROP INDEX idx_scoped_api_tokens_user;
DROP INDEX idx_scoped_api_tokens_service;
ALTER TABLE scoped_api_tokens RENAME TO scoped_api_tokens_auth100;
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
INSERT INTO scoped_api_tokens
  (id, user_id, service_principal_id, name, token_prefix, token_hash, scopes_json, expires_at, revoked_at, created_at)
SELECT id, user_id, service_principal_id, 'Migrated API token', 'legacy_' || substr(replace(id, '-', ''), 1, 12),
       token_hash, scopes_json, expires_at, revoked_at, created_at
FROM scoped_api_tokens_auth100;
DROP TABLE scoped_api_tokens_auth100;
CREATE INDEX idx_scoped_api_tokens_user ON scoped_api_tokens(user_id, revoked_at, expires_at);
CREATE INDEX idx_scoped_api_tokens_service ON scoped_api_tokens(service_principal_id, revoked_at, expires_at);
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
  OR NEW.created_at IS NOT OLD.created_at OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL OR NEW.revoked_at IS NOT OLD.revoked_at
BEGIN SELECT RAISE(ABORT, 'organization invitation may only be accepted once'); END;

COMMIT;
PRAGMA foreign_keys = ON;
