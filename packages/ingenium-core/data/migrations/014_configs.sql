-- migrate:down DROP TABLE configs;
CREATE TABLE IF NOT EXISTS configs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    type TEXT NOT NULL CHECK(type IN ('project', 'global')),
    content TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, type)
);
CREATE INDEX IF NOT EXISTS idx_configs_project ON configs(project_id);
