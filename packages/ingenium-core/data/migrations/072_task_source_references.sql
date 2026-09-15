-- TASK-100: metadata-only references to trusted task sources.
-- Source ownership remains application-validated because the five source types
-- have incompatible key shapes and lifecycle rules.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_id_id
  ON tasks(project_id, id);

CREATE TABLE IF NOT EXISTS task_source_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('email', 'context', 'docs', 'chat', 'job')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 512),
  display_title TEXT NOT NULL CHECK(length(display_title) BETWEEN 1 AND 256),
  display_detail TEXT CHECK(display_detail IS NULL OR length(display_detail) BETWEEN 1 AND 512),
  source_timestamp TEXT CHECK(source_timestamp IS NULL OR length(source_timestamp) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, task_id, source_type, source_id),
  FOREIGN KEY(project_id, task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_source_references_task
  ON task_source_references(project_id, task_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS task_source_references_immutable_update
BEFORE UPDATE ON task_source_references
BEGIN
  SELECT RAISE(ABORT, 'task source references are immutable — UPDATE rejected');
END;
