PRAGMA foreign_keys = OFF;

CREATE TABLE agents_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'execution' CHECK(category IN ('primary', 'execution', 'research', 'security', 'chat')),
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

INSERT INTO agents_new (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, skills, content, enabled, created_at, updated_at)
SELECT id, project_id, name, description,
  CASE WHEN category IN ('primary', 'execution', 'research', 'security', 'chat') THEN category ELSE 'execution' END,
  mode, model, reasoning_effort, permissions, skills, content, enabled, created_at, updated_at
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

PRAGMA foreign_keys = ON;
