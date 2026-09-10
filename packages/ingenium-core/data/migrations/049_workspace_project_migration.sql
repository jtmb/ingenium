-- Durable audit record for the DB-only /workspace → global-default migration.
CREATE TABLE IF NOT EXISTS project_migration_manifests (
    id TEXT PRIMARY KEY,
    source_project_id TEXT NOT NULL,
    destination_project_id TEXT NOT NULL REFERENCES projects(id),
    source_skill_count INTEGER NOT NULL,
    source_hashes TEXT NOT NULL,
    child_counts TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('prepared', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
