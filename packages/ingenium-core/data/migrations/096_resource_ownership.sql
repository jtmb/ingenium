-- AUTH-104: normalized ownership for vault and provider resources.
BEGIN IMMEDIATE;

CREATE TABLE resource_grants (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('vault_folder', 'vault_item', 'provider_connection', 'mail_account')),
  resource_id TEXT NOT NULL CHECK(length(resource_id) BETWEEN 1 AND 256),
  grantee_kind TEXT NOT NULL CHECK(grantee_kind IN ('user', 'service', 'installation')),
  grantee_id TEXT CHECK(grantee_id IS NULL OR length(grantee_id) BETWEEN 1 AND 128),
  permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json) AND json_type(permissions_json) = 'array'),
  granted_by_actor_type TEXT NOT NULL CHECK(granted_by_actor_type IN ('compatibility', 'user', 'service', 'system')),
  granted_by_actor_id TEXT CHECK(granted_by_actor_id IS NULL OR length(granted_by_actor_id) BETWEEN 1 AND 128),
  expires_at TEXT,
  revoked_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK((grantee_kind = 'installation' AND grantee_id IS NULL) OR (grantee_kind <> 'installation' AND grantee_id IS NOT NULL)),
  UNIQUE(organization_id, resource_type, resource_id, grantee_kind, grantee_id)
);

CREATE TABLE resource_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('vault', 'vault_folder', 'vault_item', 'provider_connection', 'mail_account')),
  resource_id TEXT CHECK(resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 256),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 128),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system')),
  actor_id TEXT CHECK(actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 128),
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'failure')),
  request_id TEXT CHECK(request_id IS NULL OR length(request_id) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

ALTER TABLE vault_folders ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE vault_folders ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'organization' CHECK(owner_kind IN ('user', 'organization'));
ALTER TABLE vault_folders ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE vault_folders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE vault_folders ADD COLUMN created_by_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE vault_folders ADD COLUMN created_by_actor_id TEXT;
UPDATE vault_folders
SET organization_id = (SELECT organization_id FROM projects WHERE projects.id = vault_folders.project_id)
WHERE organization_id IS NULL;

ALTER TABLE vault_items ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE vault_items ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'organization' CHECK(owner_kind IN ('user', 'organization'));
ALTER TABLE vault_items ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE vault_items ADD COLUMN ownership_revision INTEGER NOT NULL DEFAULT 0 CHECK(ownership_revision >= 0);
ALTER TABLE vault_items ADD COLUMN created_by_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE vault_items ADD COLUMN created_by_actor_id TEXT;
UPDATE vault_items
SET organization_id = (SELECT organization_id FROM projects WHERE projects.id = vault_items.project_id)
WHERE organization_id IS NULL;

ALTER TABLE vault_audit_log ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE vault_audit_log ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE vault_audit_log ADD COLUMN actor_id TEXT;
ALTER TABLE vault_audit_log ADD COLUMN request_id TEXT;
ALTER TABLE vault_audit_log ADD COLUMN source_audit_event_id TEXT REFERENCES resource_audit_events(id) ON DELETE RESTRICT;
UPDATE vault_audit_log
SET organization_id = (SELECT organization_id FROM projects WHERE projects.id = vault_audit_log.project_id)
WHERE organization_id IS NULL;

CREATE UNIQUE INDEX idx_vault_folders_owner_id ON vault_folders(organization_id, owner_kind, owner_user_id, id);
CREATE UNIQUE INDEX idx_vault_items_owner_id ON vault_items(organization_id, owner_kind, owner_user_id, id);
CREATE INDEX idx_resource_grants_resource ON resource_grants(organization_id, resource_type, resource_id, revoked_at, expires_at);
CREATE INDEX idx_resource_audit_scope ON resource_audit_events(organization_id, resource_type, resource_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_resource_audit_exactly_once ON resource_audit_events(request_id, action, resource_type, COALESCE(resource_id, '')) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vault_audit_exactly_once ON vault_audit_log(request_id, event_type, item_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vault_audit_source ON vault_audit_log(source_audit_event_id) WHERE source_audit_event_id IS NOT NULL;

CREATE TRIGGER vault_folders_owner_valid_insert BEFORE INSERT ON vault_folders
WHEN NEW.organization_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'
  ))
BEGIN SELECT RAISE(ABORT, 'invalid vault folder owner'); END;
CREATE TRIGGER vault_folders_owner_valid_update BEFORE UPDATE ON vault_folders
WHEN NEW.organization_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid vault folder owner'); END;
CREATE TRIGGER vault_folders_owner_immutable BEFORE UPDATE OF organization_id, owner_kind, owner_user_id ON vault_folders
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'vault folder ownership transfer requires the audited transfer operation'); END;
CREATE TRIGGER vault_folders_parent_owner_insert BEFORE INSERT ON vault_folders
WHEN NEW.parent_folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_folders parent WHERE parent.id = NEW.parent_folder_id AND parent.project_id = NEW.project_id
    AND parent.organization_id = NEW.organization_id AND parent.owner_kind = NEW.owner_kind
    AND parent.owner_user_id IS NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT, 'vault folder parent must have the same owner'); END;
CREATE TRIGGER vault_folders_parent_owner_update BEFORE UPDATE OF parent_folder_id ON vault_folders
WHEN NEW.parent_folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_folders parent WHERE parent.id = NEW.parent_folder_id AND parent.project_id = NEW.project_id
    AND parent.organization_id = NEW.organization_id AND parent.owner_kind = NEW.owner_kind
    AND parent.owner_user_id IS NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT, 'vault folder parent must have the same owner'); END;

CREATE TRIGGER vault_items_owner_valid_insert BEFORE INSERT ON vault_items
WHEN NEW.organization_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'
  ))
BEGIN SELECT RAISE(ABORT, 'invalid vault item owner'); END;
CREATE TRIGGER vault_items_owner_valid_update BEFORE UPDATE ON vault_items
WHEN NEW.organization_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid vault item owner'); END;
CREATE TRIGGER vault_items_owner_immutable BEFORE UPDATE OF organization_id, owner_kind, owner_user_id ON vault_items
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'vault item ownership transfer requires the audited transfer operation'); END;
CREATE TRIGGER vault_items_folder_owner_insert BEFORE INSERT ON vault_items
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_folders folder WHERE folder.id = NEW.folder_id AND folder.project_id = NEW.project_id
    AND folder.organization_id = NEW.organization_id AND folder.owner_kind = NEW.owner_kind
    AND folder.owner_user_id IS NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT, 'vault item folder must have the same owner'); END;
CREATE TRIGGER vault_items_folder_owner_update BEFORE UPDATE OF folder_id ON vault_items
WHEN NEW.folder_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_folders folder WHERE folder.id = NEW.folder_id AND folder.project_id = NEW.project_id
    AND folder.organization_id = NEW.organization_id AND folder.owner_kind = NEW.owner_kind
    AND folder.owner_user_id IS NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT, 'vault item folder must have the same owner'); END;

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
  provider_key TEXT NOT NULL CHECK(length(provider_key) BETWEEN 1 AND 128),
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('installation', 'user', 'organization')),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  credential_item_id TEXT,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 256),
  provider_type TEXT NOT NULL CHECK(provider_type IN ('managed', 'native')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json) = 'object'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_by_actor_type TEXT NOT NULL CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system')),
  created_by_actor_id TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK(
    (owner_kind = 'installation' AND organization_id IS NULL AND owner_user_id IS NULL)
    OR (owner_kind = 'organization' AND organization_id IS NOT NULL AND owner_user_id IS NULL)
    OR (owner_kind = 'user' AND organization_id IS NOT NULL AND owner_user_id IS NOT NULL)
  ),
  UNIQUE(owner_kind, organization_id, owner_user_id, provider_key)
);

CREATE TABLE provider_model_policies (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK(purpose IN ('available', 'chat', 'synthesis_primary', 'synthesis_backup', 'mail')),
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 256),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(connection_id, purpose)
);

INSERT INTO provider_connections
  (id, provider_key, owner_kind, display_name, provider_type, config_json, enabled, created_by_actor_type, created_at, updated_at)
SELECT 'installation:installation:shared:' || json_extract(provider.value, '$.id'), json_extract(provider.value, '$.id'), 'installation',
       COALESCE(json_extract(provider.value, '$.name'), json_extract(provider.value, '$.id')), 'managed',
       json_object(
         'id', json_extract(provider.value, '$.id'),
         'name', COALESCE(json_extract(provider.value, '$.name'), json_extract(provider.value, '$.id')),
         'npm', COALESCE(json_extract(provider.value, '$.npm'), ''),
         'baseURL', COALESCE(json_extract(provider.value, '$.baseURL'), ''),
         'models', json(COALESCE(json_extract(provider.value, '$.models'), '[]')),
         'defaultModel', COALESCE(json_extract(provider.value, '$.defaultModel'), ''),
         'roles', json(CASE
           WHEN json_type(provider.value, '$.roles') = 'array' THEN json_extract(provider.value, '$.roles')
           WHEN json_extract(provider.value, '$.role') = 'primary' THEN '["available","primary"]'
           WHEN json_extract(provider.value, '$.role') = 'backup' THEN '["available","backup"]'
           ELSE '["available"]'
         END),
         'enabled', CASE json_extract(provider.value, '$.enabled') WHEN 1 THEN json('true') ELSE json('false') END,
         'allowPrivateNetwork', CASE json_extract(provider.value, '$.allowPrivateNetwork') WHEN 1 THEN json('true') ELSE json('false') END,
         'ownerKind', 'installation'
       ),
       CASE
         WHEN json_type(provider.value, '$.apiKey') IS NOT NULL
           OR json_type(provider.value, '$.api_key') IS NOT NULL
           OR json_type(provider.value, '$.token') IS NOT NULL
           OR json_type(provider.value, '$.clientSecret') IS NOT NULL
           OR json_type(provider.value, '$.client_secret') IS NOT NULL
           OR json_type(provider.value, '$.password') IS NOT NULL THEN 0
         WHEN json_extract(provider.value, '$.enabled') = 1 THEN 1 ELSE 0
       END,
       'compatibility', datetime('now'), datetime('now')
FROM settings setting, json_each(setting.value) provider
JOIN projects project ON project.id = setting.project_id
WHERE setting.key = 'llm_provider_configs' AND json_valid(setting.value) AND json_type(setting.value) = 'array'
  AND project.is_global = 1 AND project.archived_at IS NULL
ON CONFLICT(id) DO NOTHING;

CREATE TRIGGER provider_connections_owner_immutable BEFORE UPDATE OF owner_kind, organization_id, owner_user_id ON provider_connections
WHEN NEW.owner_kind IS NOT OLD.owner_kind OR NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'provider ownership transfer requires the audited transfer operation'); END;
CREATE TRIGGER provider_connections_owner_valid_insert BEFORE INSERT ON provider_connections
WHEN (NEW.owner_kind = 'user' AND NOT EXISTS (
  SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'
)) OR (NEW.credential_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_items item
  JOIN projects project ON project.id = item.project_id
  WHERE item.id = NEW.credential_item_id AND item.access_policy <> '{"mode":"deleted"}'
    AND ((NEW.owner_kind = 'installation' AND project.is_global = 1 AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'organization' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'user' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'user' AND item.owner_user_id = NEW.owner_user_id))
))
BEGIN SELECT RAISE(ABORT, 'invalid provider owner or credential'); END;
CREATE TRIGGER provider_connections_credential_valid_update BEFORE UPDATE OF credential_item_id ON provider_connections
WHEN NEW.credential_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_items item
  JOIN projects project ON project.id = item.project_id
  WHERE item.id = NEW.credential_item_id AND item.access_policy <> '{"mode":"deleted"}'
    AND ((NEW.owner_kind = 'installation' AND project.is_global = 1 AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'organization' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'user' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'user' AND item.owner_user_id = NEW.owner_user_id))
)
BEGIN SELECT RAISE(ABORT, 'invalid provider credential'); END;
CREATE TRIGGER provider_connections_config_secret_free_insert BEFORE INSERT ON provider_connections
WHEN EXISTS (
  SELECT 1 FROM json_tree(NEW.config_json)
  WHERE key IS NOT NULL AND lower(replace(replace(replace(key, '_', ''), '-', ''), '.', '')) GLOB '*token'
     OR key IS NOT NULL AND lower(replace(replace(replace(key, '_', ''), '-', ''), '.', '')) IN ('apikey', 'clientsecret', 'password')
)
BEGIN SELECT RAISE(ABORT, 'provider config must not contain credentials'); END;
CREATE TRIGGER provider_connections_config_secret_free_update BEFORE UPDATE OF config_json ON provider_connections
WHEN EXISTS (
  SELECT 1 FROM json_tree(NEW.config_json)
  WHERE key IS NOT NULL AND lower(replace(replace(replace(key, '_', ''), '-', ''), '.', '')) GLOB '*token'
     OR key IS NOT NULL AND lower(replace(replace(replace(key, '_', ''), '-', ''), '.', '')) IN ('apikey', 'clientsecret', 'password')
)
BEGIN SELECT RAISE(ABORT, 'provider config must not contain credentials'); END;
CREATE TRIGGER resource_grants_revision_update BEFORE UPDATE ON resource_grants
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'resource grant revision must advance by one'); END;
CREATE TRIGGER resource_audit_events_immutable_update BEFORE UPDATE ON resource_audit_events
BEGIN SELECT RAISE(ABORT, 'resource audit events are immutable'); END;
CREATE TRIGGER resource_audit_events_immutable_delete BEFORE DELETE ON resource_audit_events
BEGIN SELECT RAISE(ABORT, 'resource audit events are immutable'); END;
CREATE TRIGGER resource_audit_events_project_organization_insert BEFORE INSERT ON resource_audit_events
WHEN NEW.organization_id IS NOT NULL AND NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'resource audit project must belong to organization'); END;

CREATE TABLE resource_ownership_manifests (
  migration INTEGER PRIMARY KEY CHECK(migration IN (96, 97)),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  counts_json TEXT NOT NULL CHECK(json_valid(counts_json) AND json_type(counts_json) = 'object'),
  ids_json TEXT NOT NULL CHECK(json_valid(ids_json) AND json_type(ids_json) = 'array'),
  phase TEXT NOT NULL CHECK(phase = 'verified'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
INSERT INTO resource_ownership_manifests (migration, organization_id, counts_json, ids_json, phase, created_at)
SELECT 96, '00000000-0000-4000-8000-000000000093',
       json_object('vault_folders', (SELECT count(*) FROM vault_folders), 'vault_items', (SELECT count(*) FROM vault_items), 'provider_connections', (SELECT count(*) FROM provider_connections)),
       COALESCE((SELECT json_group_array(kind || ':' || id) FROM (
         SELECT 'vault_folder' AS kind, id FROM vault_folders
         UNION ALL SELECT 'vault_item', id FROM vault_items
         UNION ALL SELECT 'provider_connection', id FROM provider_connections
         ORDER BY kind, id
       )), '[]'),
       'verified', datetime('now');
CREATE TRIGGER resource_ownership_manifests_immutable_update BEFORE UPDATE ON resource_ownership_manifests
BEGIN SELECT RAISE(ABORT, 'resource ownership manifests are immutable'); END;
CREATE TRIGGER resource_ownership_manifests_immutable_delete BEFORE DELETE ON resource_ownership_manifests
BEGIN SELECT RAISE(ABORT, 'resource ownership manifests are immutable'); END;

COMMIT;
