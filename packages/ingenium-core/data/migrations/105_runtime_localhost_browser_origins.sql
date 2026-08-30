-- Allow exact HTTP audience origins only for special-use .localhost runtime hosts.
-- Guard: db.ts applies this migration only while the browser tables lack the localhost origin constraint.
BEGIN IMMEDIATE;

CREATE TABLE runtime_browser_launch_tickets_105 (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  runtime_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  auth_session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  launcher_origin TEXT NOT NULL CHECK(length(launcher_origin) BETWEEN 8 AND 512),
  audience TEXT NOT NULL CHECK(audience IN ('web', 'cli', 'vscode')),
  origin TEXT NOT NULL CHECK(length(origin) BETWEEN 9 AND 512 AND (
    origin = 'https://' || host OR (host GLOB '*.localhost' AND origin = 'http://' || host)
  )),
  host TEXT NOT NULL CHECK(length(host) BETWEEN 1 AND 253 AND host = lower(host)),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  nonce_hash TEXT NOT NULL UNIQUE CHECK(length(nonce_hash) = 64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  FOREIGN KEY(runtime_id, workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES runtime_instances(id, workspace_id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT
);

INSERT INTO runtime_browser_launch_tickets_105
  (id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, launcher_origin,
   audience, origin, host, token_hash, nonce_hash, generation, expires_at, consumed_at, created_at)
SELECT id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, launcher_origin,
  audience, origin, host, token_hash, nonce_hash, generation, expires_at, consumed_at, created_at
FROM runtime_browser_launch_tickets;

CREATE TABLE runtime_browser_sessions_105 (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  runtime_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  auth_session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  audience TEXT NOT NULL CHECK(audience IN ('web', 'cli', 'vscode')),
  origin TEXT NOT NULL CHECK(length(origin) BETWEEN 9 AND 512 AND (
    origin = 'https://' || host OR (host GLOB '*.localhost' AND origin = 'http://' || host)
  )),
  host TEXT NOT NULL CHECK(length(host) BETWEEN 1 AND 253 AND host = lower(host)),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK(length(last_seen_at) BETWEEN 1 AND 64),
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  launcher_origin TEXT CHECK(launcher_origin IS NULL OR length(launcher_origin) BETWEEN 8 AND 512),
  FOREIGN KEY(runtime_id, workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES runtime_instances(id, workspace_id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT
);

INSERT INTO runtime_browser_sessions_105
  (id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, audience,
   origin, host, token_hash, generation, expires_at, last_seen_at, revoked_at, created_at, launcher_origin)
SELECT id, runtime_id, workspace_id, organization_id, project_id, owner_user_id, auth_session_id, audience,
  origin, host, token_hash, generation, expires_at, last_seen_at, revoked_at, created_at, launcher_origin
FROM runtime_browser_sessions;

DROP TABLE runtime_browser_launch_tickets;
DROP TABLE runtime_browser_sessions;
ALTER TABLE runtime_browser_launch_tickets_105 RENAME TO runtime_browser_launch_tickets;
ALTER TABLE runtime_browser_sessions_105 RENAME TO runtime_browser_sessions;

CREATE INDEX idx_runtime_browser_tickets_expiry
  ON runtime_browser_launch_tickets(runtime_id, audience, expires_at);
CREATE INDEX idx_runtime_browser_sessions_runtime
  ON runtime_browser_sessions(runtime_id, audience, revoked_at, expires_at);
CREATE INDEX idx_runtime_browser_sessions_auth
  ON runtime_browser_sessions(auth_session_id, revoked_at);

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

CREATE TRIGGER runtime_browser_ticket_consume_once
BEFORE UPDATE ON runtime_browser_launch_tickets
WHEN NEW.id IS NOT OLD.id OR NEW.runtime_id IS NOT OLD.runtime_id
  OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.auth_session_id IS NOT OLD.auth_session_id OR NEW.audience IS NOT OLD.audience
  OR NEW.launcher_origin IS NOT OLD.launcher_origin
  OR NEW.origin IS NOT OLD.origin OR NEW.host IS NOT OLD.host OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.nonce_hash IS NOT OLD.nonce_hash OR NEW.generation IS NOT OLD.generation
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'runtime browser launch ticket is immutable'); END;

CREATE TRIGGER runtime_browser_ticket_immutable_delete BEFORE DELETE ON runtime_browser_launch_tickets
BEGIN SELECT RAISE(ABORT, 'runtime browser launch ticket is immutable'); END;

CREATE TRIGGER runtime_browser_session_scope_insert
BEFORE INSERT ON runtime_browser_sessions
WHEN NOT EXISTS (
  SELECT 1 FROM runtime_instances r
  JOIN auth_sessions s ON s.id = NEW.auth_session_id
  JOIN runtime_browser_generations g ON g.runtime_id = r.id
  WHERE r.id = NEW.runtime_id AND r.workspace_id = NEW.workspace_id
    AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id
    AND r.owner_user_id = NEW.owner_user_id AND r.state IN ('READY', 'IDLE')
    AND s.user_id = r.owner_user_id AND s.revoked_at IS NULL
    AND g.generation = NEW.generation
)
BEGIN SELECT RAISE(ABORT, 'runtime browser session scope is unavailable'); END;

CREATE TRIGGER runtime_browser_session_update
BEFORE UPDATE ON runtime_browser_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.runtime_id IS NOT OLD.runtime_id
  OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.auth_session_id IS NOT OLD.auth_session_id OR NEW.audience IS NOT OLD.audience
  OR NEW.origin IS NOT OLD.origin OR NEW.host IS NOT OLD.host OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.generation IS NOT OLD.generation OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at OR NEW.last_seen_at < OLD.last_seen_at
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN SELECT RAISE(ABORT, 'runtime browser session update is invalid'); END;

CREATE TRIGGER runtime_browser_session_immutable_delete BEFORE DELETE ON runtime_browser_sessions
BEGIN SELECT RAISE(ABORT, 'runtime browser session is immutable'); END;

CREATE TRIGGER runtime_browser_session_launcher_origin_insert
BEFORE INSERT ON runtime_browser_sessions
WHEN NEW.launcher_origin IS NULL
  OR (substr(NEW.launcher_origin, 1, 8) <> 'https://'
    AND NEW.launcher_origin NOT GLOB 'http://localhost:*'
    AND NEW.launcher_origin NOT GLOB 'http://127.0.0.1:*')
BEGIN SELECT RAISE(ABORT, 'runtime browser launcher origin is invalid'); END;

CREATE TRIGGER runtime_browser_session_launcher_origin_update
BEFORE UPDATE OF launcher_origin ON runtime_browser_sessions
WHEN NEW.launcher_origin IS NOT OLD.launcher_origin
BEGIN SELECT RAISE(ABORT, 'runtime browser launcher origin is immutable'); END;

COMMIT;
