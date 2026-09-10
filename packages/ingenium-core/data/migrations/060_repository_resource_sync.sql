-- Repository-authoritative resource synchronization state.
--
-- Only resources recorded here are eligible for a later repository deletion.
-- The payload is an exact semantic projection supplied by the extension; it
-- preserves markdown frontmatter, compatibility mirrors, plugin order/options,
-- and skill auxiliary files that the legacy resource tables cannot represent.
CREATE TABLE IF NOT EXISTS repository_sync_resources (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('skill', 'agent', 'plugin')),
  identity TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK(
    length(source_hash) = 64
    AND source_hash NOT GLOB '*[^0-9a-f]*'
  ),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, resource_type, identity),
  UNIQUE (project_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_repository_sync_resources_project_type_name
  ON repository_sync_resources(project_id, resource_type, resource_name);
