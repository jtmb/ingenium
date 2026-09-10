-- Migration 086: durable, content-free proof of server-global lifecycle transitions.
-- Recovery may use only a ceased_global event; the seed records the one active
-- global known at migration time without inferring status for archived projects.
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS server_global_project_provenance (
  id INTEGER PRIMARY KEY,
  source_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('became_global', 'ceased_global')),
  occurred_at TEXT NOT NULL CHECK(length(occurred_at) BETWEEN 1 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_server_global_project_provenance_recovery
  ON server_global_project_provenance(source_project_id, occurred_at)
  WHERE source_project_id IS NOT NULL AND event_type = 'ceased_global';

INSERT INTO server_global_project_provenance (source_project_id, event_type, occurred_at)
SELECT project.id, 'became_global', project.updated_at
FROM projects AS project
WHERE project.is_global = 1
  AND project.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM server_global_project_provenance AS provenance
    WHERE provenance.source_project_id = project.id
      AND provenance.event_type = 'became_global'
  );

COMMIT;
