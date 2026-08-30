-- AUTH-104: normalized owned mail accounts and organization-qualified mail state.
BEGIN IMMEDIATE;

CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('user', 'organization')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK(length(email) BETWEEN 1 AND 320),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 256),
  provider TEXT NOT NULL CHECK(provider IN ('gmail', 'outlook', 'yahoo', 'custom')),
  auth_type TEXT NOT NULL CHECK(auth_type IN ('oauth2', 'app_password')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json) = 'object'),
  connected INTEGER NOT NULL DEFAULT 0 CHECK(connected IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0, 1)),
  last_sync TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_by_actor_type TEXT NOT NULL CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system')),
  created_by_actor_id TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK((owner_kind = 'user') = (owner_user_id IS NOT NULL))
);

CREATE TABLE mail_account_credentials (
  organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  credential_kind TEXT NOT NULL CHECK(credential_kind IN ('imap_password', 'smtp_password', 'oauth_access_token', 'oauth_refresh_token')),
  encrypted_value TEXT NOT NULL CHECK(length(encrypted_value) > 0),
  token_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(token_metadata_json) AND json_type(token_metadata_json) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(organization_id, account_id, credential_kind),
  FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE mail_oauth_attempts (
  state_hash TEXT PRIMARY KEY CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('user', 'organization')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  provider TEXT NOT NULL CHECK(provider IN ('gmail', 'outlook')),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system')),
  actor_id TEXT,
  expires_at TEXT NOT NULL CHECK(julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  CHECK((owner_kind = 'user') = (owner_user_id IS NOT NULL))
);
CREATE INDEX idx_mail_oauth_attempts_expiry ON mail_oauth_attempts(expires_at, consumed_at);

INSERT INTO mail_accounts
  (id, organization_id, owner_kind, email, name, provider, auth_type, config_json, connected, hidden, last_sync, created_by_actor_type, created_at, updated_at)
SELECT json_extract(setting.value, '$.id'), project.organization_id, 'organization', json_extract(setting.value, '$.email'),
       COALESCE(json_extract(setting.value, '$.name'), json_extract(setting.value, '$.email')),
       COALESCE(json_extract(setting.value, '$.provider'), 'custom'), COALESCE(json_extract(setting.value, '$.authType'), 'app_password'),
       json_remove(setting.value, '$.imapPass', '$.smtpPass', '$.tokens'),
       CASE json_extract(setting.value, '$.connected') WHEN 1 THEN 1 ELSE 0 END,
       CASE json_extract(setting.value, '$.hidden') WHEN 1 THEN 1 ELSE 0 END,
       json_extract(setting.value, '$.lastSync'), 'compatibility', datetime('now'), datetime('now')
FROM settings setting JOIN projects project ON project.id = setting.project_id
WHERE setting.key LIKE 'email_account_%' AND json_valid(setting.value)
  AND json_extract(setting.value, '$.id') = substr(setting.key, length('email_account_') + 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO mail_accounts
  (id, organization_id, owner_kind, email, name, provider, auth_type, config_json, hidden, created_by_actor_type, created_at, updated_at)
SELECT account_id, '00000000-0000-4000-8000-000000000093', 'organization', account_id,
       account_id, 'custom', 'app_password', '{}', 1, 'compatibility', datetime('now'), datetime('now')
FROM (
  SELECT account_id FROM email_cache
  UNION SELECT account_id FROM email_bodies
  UNION SELECT account_id FROM email_sync_state
  UNION SELECT account_id FROM email_suggestions
  UNION SELECT account_id FROM email_summaries
  UNION SELECT account_id FROM email_suggestion_queue
  UNION SELECT account_id FROM email_watcher_markers
)
WHERE NOT EXISTS (SELECT 1 FROM mail_accounts WHERE id = account_id)
ON CONFLICT(id) DO NOTHING;

INSERT INTO mail_account_credentials
  (organization_id, account_id, credential_kind, encrypted_value, created_at, updated_at)
SELECT account.organization_id, account.id, 'imap_password', json_extract(setting.value, '$.imapPass'), datetime('now'), datetime('now')
FROM settings setting JOIN mail_accounts account ON account.id = substr(setting.key, length('email_account_') + 1)
WHERE setting.key LIKE 'email_account_%' AND json_type(setting.value, '$.imapPass') = 'text'
ON CONFLICT(organization_id, account_id, credential_kind) DO NOTHING;
INSERT INTO mail_account_credentials
  (organization_id, account_id, credential_kind, encrypted_value, created_at, updated_at)
SELECT account.organization_id, account.id, 'smtp_password', json_extract(setting.value, '$.smtpPass'), datetime('now'), datetime('now')
FROM settings setting JOIN mail_accounts account ON account.id = substr(setting.key, length('email_account_') + 1)
WHERE setting.key LIKE 'email_account_%' AND json_type(setting.value, '$.smtpPass') = 'text'
ON CONFLICT(organization_id, account_id, credential_kind) DO NOTHING;
INSERT INTO mail_account_credentials
  (organization_id, account_id, credential_kind, encrypted_value, token_metadata_json, created_at, updated_at)
SELECT account.organization_id, account.id, 'oauth_access_token', json_extract(setting.value, '$.accessToken'),
       json_remove(setting.value, '$.accessToken', '$.refreshToken'), datetime('now'), datetime('now')
FROM settings setting JOIN mail_accounts account ON setting.key = 'email_oauth_' || account.id
WHERE json_valid(setting.value) AND json_type(setting.value, '$.accessToken') = 'text'
ON CONFLICT(organization_id, account_id, credential_kind) DO NOTHING;
INSERT INTO mail_account_credentials
  (organization_id, account_id, credential_kind, encrypted_value, token_metadata_json, created_at, updated_at)
SELECT account.organization_id, account.id, 'oauth_refresh_token', json_extract(setting.value, '$.refreshToken'),
       json_remove(setting.value, '$.accessToken', '$.refreshToken'), datetime('now'), datetime('now')
FROM settings setting JOIN mail_accounts account ON setting.key = 'email_oauth_' || account.id
WHERE json_valid(setting.value) AND json_type(setting.value, '$.refreshToken') = 'text'
ON CONFLICT(organization_id, account_id, credential_kind) DO NOTHING;

ALTER TABLE email_cache ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_bodies ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_sync_state ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_suggestions ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_summaries ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_suggestion_queue ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_watcher_markers ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE email_cache SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_cache.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_bodies SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_bodies.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_sync_state SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_sync_state.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_suggestions SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_suggestions.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_summaries SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_summaries.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_suggestion_queue SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_suggestion_queue.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;
UPDATE email_watcher_markers SET organization_id = COALESCE((SELECT organization_id FROM mail_accounts WHERE id = email_watcher_markers.account_id), '00000000-0000-4000-8000-000000000093') WHERE organization_id IS NULL;

CREATE UNIQUE INDEX idx_email_cache_org_account_folder_uid ON email_cache(organization_id, account_id, folder, uid);
CREATE UNIQUE INDEX idx_email_bodies_org_account_folder_uid ON email_bodies(organization_id, account_id, folder, uid);
CREATE UNIQUE INDEX idx_email_sync_state_org_account_folder ON email_sync_state(organization_id, account_id, folder);
CREATE UNIQUE INDEX idx_email_suggestions_org_account_folder_uid ON email_suggestions(organization_id, account_id, folder, uid);
CREATE UNIQUE INDEX idx_email_summaries_org_account_folder_uid ON email_summaries(organization_id, account_id, folder, uid);
CREATE UNIQUE INDEX idx_email_suggestion_queue_org_account_folder_uid ON email_suggestion_queue(organization_id, account_id, folder, uid);
CREATE UNIQUE INDEX idx_email_watcher_markers_org_account_folder_uid ON email_watcher_markers(organization_id, account_id, folder, uid);

CREATE TRIGGER mail_accounts_owner_immutable BEFORE UPDATE OF organization_id, owner_kind, owner_user_id ON mail_accounts
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'mail account ownership transfer requires the audited transfer operation'); END;
CREATE TRIGGER mail_accounts_owner_valid_insert BEFORE INSERT ON mail_accounts
WHEN (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'
  ))
BEGIN SELECT RAISE(ABORT, 'invalid mail account owner'); END;
CREATE TRIGGER mail_accounts_revision_update BEFORE UPDATE ON mail_accounts
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'mail account revision must advance by one'); END;
CREATE TRIGGER mail_account_credentials_scope_insert BEFORE INSERT ON mail_account_credentials
WHEN NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'mail credential account must belong to organization'); END;
CREATE TRIGGER mail_account_credentials_scope_update BEFORE UPDATE OF organization_id, account_id ON mail_account_credentials
WHEN NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'mail credential account must belong to organization'); END;
CREATE TRIGGER mail_oauth_attempts_consume_once BEFORE UPDATE ON mail_oauth_attempts
WHEN NEW.state_hash IS NOT OLD.state_hash OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.account_id IS NOT OLD.account_id OR NEW.provider IS NOT OLD.provider
  OR NEW.actor_type IS NOT OLD.actor_type OR NEW.actor_id IS NOT OLD.actor_id
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'mail OAuth attempt may only be consumed once'); END;

CREATE TRIGGER email_cache_account_scope_insert BEFORE INSERT ON email_cache
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email cache account must belong to organization'); END;
CREATE TRIGGER email_cache_account_scope_update BEFORE UPDATE OF organization_id, account_id ON email_cache
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email cache account must belong to organization'); END;
CREATE TRIGGER email_sync_state_scope_insert BEFORE INSERT ON email_sync_state
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email sync state account must belong to organization'); END;
CREATE TRIGGER email_sync_state_scope_update BEFORE UPDATE OF organization_id, account_id ON email_sync_state
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email sync state account must belong to organization'); END;
CREATE TRIGGER email_bodies_scope_insert BEFORE INSERT ON email_bodies
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email body must match organization cache row'); END;
CREATE TRIGGER email_bodies_scope_update BEFORE UPDATE OF organization_id, account_id, folder, uid ON email_bodies
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email body must match organization cache row'); END;
CREATE TRIGGER email_suggestions_scope_insert BEFORE INSERT ON email_suggestions
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email suggestion must match organization cache row'); END;
CREATE TRIGGER email_suggestions_scope_update BEFORE UPDATE OF organization_id, account_id, folder, uid ON email_suggestions
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email suggestion must match organization cache row'); END;
CREATE TRIGGER email_summaries_scope_insert BEFORE INSERT ON email_summaries
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email summary must match organization cache row'); END;
CREATE TRIGGER email_summaries_scope_update BEFORE UPDATE OF organization_id, account_id, folder, uid ON email_summaries
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email summary must match organization cache row'); END;
CREATE TRIGGER email_suggestion_queue_scope_insert BEFORE INSERT ON email_suggestion_queue
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email queue item must match organization cache row'); END;
CREATE TRIGGER email_suggestion_queue_scope_update BEFORE UPDATE OF organization_id, account_id, folder, uid ON email_suggestion_queue
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM email_cache WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id AND folder = NEW.folder AND uid = NEW.uid)
BEGIN SELECT RAISE(ABORT, 'email queue item must match organization cache row'); END;
CREATE TRIGGER email_watcher_markers_scope_insert BEFORE INSERT ON email_watcher_markers
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email watcher marker account must belong to organization'); END;
CREATE TRIGGER email_watcher_markers_scope_update BEFORE UPDATE OF organization_id, account_id ON email_watcher_markers
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM mail_accounts WHERE organization_id = NEW.organization_id AND id = NEW.account_id)
BEGIN SELECT RAISE(ABORT, 'email watcher marker account must belong to organization'); END;

INSERT INTO resource_ownership_manifests (migration, organization_id, counts_json, ids_json, phase, created_at)
SELECT 97, '00000000-0000-4000-8000-000000000093',
       json_object('mail_accounts', (SELECT count(*) FROM mail_accounts), 'mail_credentials', (SELECT count(*) FROM mail_account_credentials), 'cache', (SELECT count(*) FROM email_cache), 'bodies', (SELECT count(*) FROM email_bodies), 'sync_state', (SELECT count(*) FROM email_sync_state), 'suggestions', (SELECT count(*) FROM email_suggestions), 'summaries', (SELECT count(*) FROM email_summaries), 'queue', (SELECT count(*) FROM email_suggestion_queue), 'watchers', (SELECT count(*) FROM email_watcher_markers)),
       COALESCE((SELECT json_group_array(identity) FROM (
         SELECT 'mail_account:' || json_array(id) AS identity FROM mail_accounts
         UNION ALL SELECT 'mail_credential:' || json_array(organization_id, account_id, credential_kind) FROM mail_account_credentials
         UNION ALL SELECT 'email_cache:' || json_array(organization_id, account_id, folder, uid) FROM email_cache
         UNION ALL SELECT 'email_body:' || json_array(organization_id, account_id, folder, uid) FROM email_bodies
         UNION ALL SELECT 'email_sync_state:' || json_array(organization_id, account_id, folder) FROM email_sync_state
         UNION ALL SELECT 'email_suggestion:' || json_array(organization_id, account_id, folder, uid) FROM email_suggestions
         UNION ALL SELECT 'email_summary:' || json_array(organization_id, account_id, folder, uid) FROM email_summaries
         UNION ALL SELECT 'email_suggestion_queue:' || json_array(organization_id, account_id, folder, uid) FROM email_suggestion_queue
         UNION ALL SELECT 'email_watcher_marker:' || json_array(organization_id, account_id, folder, uid) FROM email_watcher_markers
         ORDER BY identity
       )), '[]'),
       'verified', datetime('now');

COMMIT;
