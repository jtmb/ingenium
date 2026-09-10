-- AUTH-108 per-owner workspace authorization and isolated runtime lifecycle.
BEGIN IMMEDIATE;

CREATE TABLE authorized_workspaces (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256 AND id = trim(id)),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL UNIQUE CHECK(length(storage_path) BETWEEN 1 AND 1024 AND storage_path = trim(storage_path) AND substr(storage_path, 1, 1) = '/'),
  storage_mapping_hash TEXT NOT NULL CHECK(length(storage_mapping_hash) = 64 AND storage_mapping_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL DEFAULT 'authorized' CHECK(status IN ('authorized', 'revoked')),
  security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(id, organization_id, project_id, owner_user_id)
);

CREATE TABLE runtime_instances (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  workspace_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ABSENT' CHECK(state IN ('ABSENT','PROVISIONING','STARTING','READY','IDLE','STOPPING','STOPPED','FAILED','REVOKED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  lease_owner_hash TEXT CHECK(lease_owner_hash IS NULL OR (length(lease_owner_hash) = 64 AND lease_owner_hash NOT GLOB '*[^0-9a-f]*')),
  lease_expires_at TEXT,
  idle_expires_at TEXT,
  absolute_expires_at TEXT,
  cpu_millis INTEGER NOT NULL CHECK(cpu_millis BETWEEN 100 AND 64000),
  memory_bytes INTEGER NOT NULL CHECK(memory_bytes BETWEEN 134217728 AND 274877906944),
  pids_limit INTEGER NOT NULL CHECK(pids_limit BETWEEN 16 AND 65536),
  disk_bytes INTEGER NOT NULL CHECK(disk_bytes BETWEEN 67108864 AND 1099511627776),
  process_limit INTEGER NOT NULL CHECK(process_limit BETWEEN 16 AND 65536 AND process_limit <= pids_limit),
  backend_name TEXT NOT NULL UNIQUE CHECK(length(backend_name) BETWEEN 1 AND 128 AND backend_name NOT GLOB '*[^a-z0-9_.-]*'),
  backend_container_id TEXT CHECK(backend_container_id IS NULL OR (length(backend_container_id) = 64 AND backend_container_id NOT GLOB '*[^0-9a-f]*')),
  security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0),
  active_connections INTEGER NOT NULL DEFAULT 0 CHECK(active_connections >= 0),
  active_generations INTEGER NOT NULL DEFAULT 0 CHECK(active_generations >= 0),
  last_authenticated_activity_at TEXT,
  last_backend_health_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  stopped_at TEXT,
  FOREIGN KEY(workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES authorized_workspaces(id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT,
  CHECK((lease_owner_hash IS NULL AND lease_expires_at IS NULL) OR (lease_owner_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK(state <> 'REVOKED' OR (active_connections = 0 AND active_generations = 0))
);

CREATE TABLE runtime_capability_bindings (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  runtime_id TEXT NOT NULL REFERENCES runtime_instances(id) ON DELETE RESTRICT,
  mcp_credential_id TEXT NOT NULL UNIQUE REFERENCES mcp_credentials(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL,
  security_epoch INTEGER NOT NULL CHECK(security_epoch >= 0),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  FOREIGN KEY(runtime_id, workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES runtime_instances(id, workspace_id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT
);

CREATE TABLE runtime_launch_tickets (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  runtime_id TEXT NOT NULL REFERENCES runtime_instances(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  audience TEXT NOT NULL CHECK(audience IN ('web', 'cli', 'vscode')),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  nonce_hash TEXT NOT NULL UNIQUE CHECK(length(nonce_hash) = 64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  FOREIGN KEY(runtime_id, organization_id, project_id, owner_user_id)
    REFERENCES runtime_instances(id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT
);

CREATE TABLE runtime_activity_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  runtime_id TEXT NOT NULL REFERENCES runtime_instances(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK(event_type IN ('connection_opened','connection_closed','generation_started','generation_finished','lease_claimed','state_changed','revoked','orphaned')),
  from_state TEXT,
  to_state TEXT,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','manager','system')),
  actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

CREATE TABLE runtime_isolation_manifests (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  migration INTEGER NOT NULL CHECK(migration = 101),
  workspace_count INTEGER NOT NULL CHECK(workspace_count >= 0),
  runtime_count INTEGER NOT NULL CHECK(runtime_count >= 0),
  phase TEXT NOT NULL CHECK(phase = 'verified'),
  foreign_key_violations INTEGER NOT NULL CHECK(foreign_key_violations = 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX idx_runtime_instances_scope
  ON runtime_instances(id, workspace_id, organization_id, project_id, owner_user_id);
CREATE INDEX idx_runtime_instances_owner_state ON runtime_instances(owner_user_id, state, updated_at);
CREATE INDEX idx_runtime_instances_lease ON runtime_instances(state, lease_expires_at);
CREATE INDEX idx_runtime_activity_runtime_created ON runtime_activity_events(runtime_id, created_at);
CREATE UNIQUE INDEX idx_runtime_capability_active ON runtime_capability_bindings(runtime_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_runtime_instances_launch_scope
  ON runtime_instances(id, organization_id, project_id, owner_user_id);
CREATE INDEX idx_runtime_launch_tickets_runtime_expiry ON runtime_launch_tickets(runtime_id, expires_at);

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

CREATE TRIGGER runtime_instances_identity_immutable
BEFORE UPDATE ON runtime_instances
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.backend_name IS NOT OLD.backend_name
  OR NEW.cpu_millis IS NOT OLD.cpu_millis OR NEW.memory_bytes IS NOT OLD.memory_bytes
  OR NEW.pids_limit IS NOT OLD.pids_limit OR NEW.disk_bytes IS NOT OLD.disk_bytes
  OR NEW.process_limit IS NOT OLD.process_limit OR NEW.created_at IS NOT OLD.created_at
  OR NEW.security_epoch < OLD.security_epoch OR NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'runtime identity or revision is invalid'); END;

CREATE TRIGGER runtime_capability_scope_insert
BEFORE INSERT ON runtime_capability_bindings
WHEN NOT EXISTS (
  SELECT 1 FROM runtime_instances r JOIN mcp_credentials c
    ON c.id = NEW.mcp_credential_id
  WHERE r.id = NEW.runtime_id AND r.workspace_id = NEW.workspace_id
    AND r.organization_id = NEW.organization_id AND r.project_id = NEW.project_id
    AND r.owner_user_id = NEW.owner_user_id AND r.security_epoch = NEW.security_epoch
    AND c.kind = 'runtime' AND c.audience = 'runtime'
    AND c.organization_id = NEW.organization_id AND c.project_id = NEW.project_id
    AND c.workspace_id = NEW.workspace_id AND c.created_by_user_id = NEW.owner_user_id
    AND c.security_epoch = NEW.security_epoch AND c.expires_at = NEW.expires_at
    AND c.revoked_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'runtime capability scope is unavailable'); END;

CREATE TRIGGER runtime_capability_immutable_update BEFORE UPDATE ON runtime_capability_bindings
WHEN NEW.id IS NOT OLD.id OR NEW.runtime_id IS NOT OLD.runtime_id OR NEW.mcp_credential_id IS NOT OLD.mcp_credential_id
  OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.security_epoch IS NOT OLD.security_epoch OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT, 'runtime capability binding is immutable'); END;
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
CREATE TRIGGER runtime_launch_ticket_consume_once BEFORE UPDATE ON runtime_launch_tickets
WHEN NEW.id IS NOT OLD.id OR NEW.runtime_id IS NOT OLD.runtime_id
  OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.audience IS NOT OLD.audience
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.nonce_hash IS NOT OLD.nonce_hash
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'runtime launch ticket is immutable'); END;
CREATE TRIGGER runtime_launch_ticket_immutable_delete BEFORE DELETE ON runtime_launch_tickets
BEGIN SELECT RAISE(ABORT, 'runtime launch ticket is immutable'); END;
CREATE TRIGGER runtime_activity_immutable_update BEFORE UPDATE ON runtime_activity_events
BEGIN SELECT RAISE(ABORT, 'runtime activity is immutable'); END;
CREATE TRIGGER runtime_activity_immutable_delete BEFORE DELETE ON runtime_activity_events
BEGIN SELECT RAISE(ABORT, 'runtime activity is immutable'); END;
CREATE TRIGGER runtime_manifest_immutable_update BEFORE UPDATE ON runtime_isolation_manifests
BEGIN SELECT RAISE(ABORT, 'runtime migration manifest is immutable'); END;
CREATE TRIGGER runtime_manifest_immutable_delete BEFORE DELETE ON runtime_isolation_manifests
BEGIN SELECT RAISE(ABORT, 'runtime migration manifest is immutable'); END;

INSERT INTO authorized_workspaces
  (id, organization_id, project_id, owner_user_id, storage_path, storage_mapping_hash, security_epoch, created_at, updated_at)
SELECT workspace_id, organization_id, project_id, created_by_user_id, launcher_worktree,
       sha256(workspace_id || char(0) || launcher_worktree), MAX(security_epoch), MIN(created_at), MAX(created_at)
FROM mcp_credentials
GROUP BY workspace_id
HAVING COUNT(DISTINCT organization_id || char(0) || project_id || char(0) || created_by_user_id || char(0) || launcher_worktree) = 1;

INSERT INTO runtime_instances
  (id, workspace_id, organization_id, project_id, owner_user_id, state, cpu_millis, memory_bytes,
   pids_limit, disk_bytes, process_limit, backend_name, security_epoch, created_at, updated_at)
SELECT MIN(id), workspace_id, MIN(organization_id), MIN(project_id), MIN(created_by_user_id), 'STOPPED',
       1000, 1073741824, 256, 2147483648, 128,
       'ingenium-runtime-' || replace(MIN(id), '-', ''), MAX(security_epoch), MIN(created_at), MAX(created_at)
FROM mcp_credentials WHERE kind = 'runtime' GROUP BY workspace_id;

INSERT INTO runtime_capability_bindings
  (id, runtime_id, mcp_credential_id, organization_id, project_id, owner_user_id, workspace_id, security_epoch, expires_at, created_at)
SELECT c.id, r.id, c.id, r.organization_id, r.project_id, r.owner_user_id, r.workspace_id,
       r.security_epoch, c.expires_at, c.created_at
FROM runtime_instances r JOIN mcp_credentials c ON c.workspace_id = r.workspace_id AND c.kind = 'runtime'
WHERE c.id = (
  SELECT c2.id FROM mcp_credentials c2
  WHERE c2.workspace_id = r.workspace_id AND c2.kind = 'runtime'
    AND c2.security_epoch = r.security_epoch AND c2.revoked_at IS NULL
  ORDER BY c2.expires_at DESC, c2.id DESC LIMIT 1
);

INSERT INTO runtime_isolation_manifests
  (id, migration, workspace_count, runtime_count, phase, foreign_key_violations, created_at)
SELECT '00000000-0000-4000-8000-000000000101', 101,
       (SELECT count(DISTINCT workspace_id) FROM mcp_credentials),
       (SELECT count(DISTINCT workspace_id) FROM mcp_credentials WHERE kind = 'runtime'),
       'verified', 0, datetime('now');

COMMIT;
