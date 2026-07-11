-- migrate:down (not easily reversible for constraint changes — just note it)
-- Rebuild the plugins table to have UNIQUE(project_id, name) instead of UNIQUE(name)

-- SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we rebuild:
CREATE TABLE IF NOT EXISTS plugins_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    source_content TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);

INSERT INTO plugins_new SELECT * FROM plugins;
DROP TABLE plugins;
ALTER TABLE plugins_new RENAME TO plugins;
