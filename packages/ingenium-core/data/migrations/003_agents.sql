CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'execution',
    mode TEXT NOT NULL DEFAULT 'subagent',
    model TEXT,
    reasoning_effort TEXT,
    permissions TEXT DEFAULT '{}',
    skills TEXT DEFAULT '[]',
    content TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);
