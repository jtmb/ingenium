-- Migration 020: Kanban board data layer.
-- Expands the tasks table with hierarchy, time tracking, custom fields,
-- and adds comments, activity, links, notifications, and board_config.

-- ============================================================
-- 1. Add new columns to tasks (ALTER TABLE is fine for additions)
-- ============================================================

ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'task' CHECK(issue_type IN ('epic', 'story', 'task', 'subtask'));
ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN due_date TEXT;
ALTER TABLE tasks ADD COLUMN start_date TEXT;
ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN spent_minutes INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN remaining_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN custom_fields TEXT;

-- ============================================================
-- 2. New tables
-- ============================================================

-- Threaded comments on tasks
CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES task_comments(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    reactions TEXT DEFAULT '{}',
    edited_at TEXT,
    created_at TEXT NOT NULL
);

-- Activity / audit log for tasks
CREATE TABLE IF NOT EXISTS task_activity (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
);

-- Task links (blocks, blocked_by, relates_to)
CREATE TABLE IF NOT EXISTS task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    linked_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL CHECK(link_type IN ('blocks', 'blocked_by', 'relates_to')),
    UNIQUE(task_id, linked_task_id, link_type)
);

-- Notifications for task events
CREATE TABLE IF NOT EXISTS task_notifications (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    recipient TEXT NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('mentioned', 'assigned', 'watched_status')),
    read_at TEXT,
    created_at TEXT NOT NULL
);

-- Board configuration per project
CREATE TABLE IF NOT EXISTS board_config (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    columns TEXT NOT NULL DEFAULT '[]',
    custom_field_defs TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================
-- 3. Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_linked ON task_links(linked_task_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_project ON task_notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_task_notifications_recipient_read ON task_notifications(recipient, read_at);

-- ============================================================
-- 4. FTS5 for task search (mirrors observations_fts pattern)
-- ============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description, content=tasks, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

-- ============================================================
-- 5. Default board_config for existing projects
-- ============================================================

INSERT OR IGNORE INTO board_config (id, project_id, columns, created_at, updated_at)
SELECT
    hex(randomblob(16)),
    p.id,
    '[{"id":"todo","name":"Todo","wip_limit":null},{"id":"in_progress","name":"In Progress","wip_limit":5},{"id":"review","name":"Review","wip_limit":3},{"id":"done","name":"Done","wip_limit":null}]',
    datetime('now'),
    datetime('now')
FROM projects p
WHERE NOT EXISTS (
    SELECT 1 FROM board_config bc WHERE bc.project_id = p.id
);
