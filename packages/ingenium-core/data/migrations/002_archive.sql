-- 002_archive: Add soft-delete support to projects + settings table

ALTER TABLE projects ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS settings (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (project_id, key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
