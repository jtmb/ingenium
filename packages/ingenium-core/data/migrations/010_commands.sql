-- migrate:down DROP TABLE commands;
-- Migration 010: Commands table for OpenCode slash-command management.
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_commands_project ON commands(project_id);
