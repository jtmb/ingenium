-- migrate:down (not easily reversible for constraint changes — just note it)
-- Rebuild the servers table to have UNIQUE(project_id, name) instead of UNIQUE(name)

-- SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we rebuild:
CREATE TABLE IF NOT EXISTS servers_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT,
    env TEXT,
    source TEXT NOT NULL DEFAULT 'opencode',
    enabled INTEGER DEFAULT 1,
    running INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);

INSERT INTO servers_new SELECT * FROM servers;
DROP TABLE servers;
ALTER TABLE servers_new RENAME TO servers;
