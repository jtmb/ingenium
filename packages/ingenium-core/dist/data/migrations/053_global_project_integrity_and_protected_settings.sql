CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_one_active_global
  ON projects(is_global)
  WHERE is_global = 1 AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS protected_settings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK(key IN ('oauth_gmail_client_secret', 'oauth_outlook_client_secret')),
  vault_item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, key),
  UNIQUE (vault_item_id)
);

CREATE INDEX IF NOT EXISTS idx_protected_settings_project ON protected_settings(project_id);
