CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    agent_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    token_usage INTEGER DEFAULT 0,
    parent_session_id TEXT REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(content, description);

-- FTS5 sync is handled in application code (lib/tools/skills.ts)
-- to avoid rowid type mismatch between TEXT PK and INTEGER FTS5 rowid.

CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    entry_type TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    priority INTEGER DEFAULT 5,
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(content, tags, content=learnings, content_rowid=id);
CREATE TRIGGER IF NOT EXISTS learnings_fts_insert AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS learnings_fts_delete AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS learnings_fts_update AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
    INSERT INTO learnings_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    column_id TEXT NOT NULL DEFAULT 'todo',
    assigned_to TEXT,
    depends_on TEXT,
    files TEXT,
    labels TEXT,
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS context_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL,
    priority INTEGER DEFAULT 5,
    tags TEXT,
    session_id TEXT REFERENCES sessions(id),
    created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(content, tags, content=context_entries, content_rowid=id);
CREATE TRIGGER IF NOT EXISTS context_fts_insert AFTER INSERT ON context_entries BEGIN
    INSERT INTO context_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS context_fts_delete AFTER DELETE ON context_entries BEGIN
    INSERT INTO context_fts(context_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS context_fts_update AFTER UPDATE ON context_entries BEGIN
    INSERT INTO context_fts(context_fts, rowid, content, tags) VALUES('delete', old.id, old.content, old.tags);
    INSERT INTO context_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL,
    args TEXT,
    env TEXT,
    enabled INTEGER DEFAULT 1,
    running INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
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

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_id);
CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(entry_type);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id);
CREATE INDEX IF NOT EXISTS idx_context_project ON context_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(project_id);
