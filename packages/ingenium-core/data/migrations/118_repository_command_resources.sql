CREATE TABLE repository_sync_resources_118 (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('skill', 'agent', 'plugin', 'command')),
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

INSERT INTO repository_sync_resources_118
  (project_id, resource_type, identity, resource_id, resource_name, source_path, source_hash, payload, created_at, updated_at)
SELECT project_id, resource_type, identity, resource_id, resource_name, source_path, source_hash, payload, created_at, updated_at
FROM repository_sync_resources;

DROP TABLE repository_sync_resources;
ALTER TABLE repository_sync_resources_118 RENAME TO repository_sync_resources;

CREATE INDEX idx_repository_sync_resources_project_type_name
  ON repository_sync_resources(project_id, resource_type, resource_name);
