-- COORD-103: sanitized, ordered peer-write handoffs and durable receiver cursors.
BEGIN IMMEDIATE;

CREATE TABLE coordination_handoff_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  source_coordination_session_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision >= 1),
  operation TEXT NOT NULL CHECK(operation IN ('write', 'edit')),
  path TEXT NOT NULL CHECK(
    length(path) BETWEEN 1 AND 1024
    AND path NOT LIKE '/%'
    AND instr(path, char(92)) = 0
    AND path NOT LIKE '%//%'
    AND path NOT LIKE '../%'
    AND path NOT LIKE '%/../%'
    AND path <> '..'
  ),
  baseline_sha256 TEXT CHECK(
    baseline_sha256 IS NULL OR (
      length(baseline_sha256) = 64
      AND baseline_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  current_task_id TEXT,
  current_task_revision INTEGER,
  context_conversation_id TEXT,
  context_revision INTEGER,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  CHECK(
    (current_task_id IS NULL AND current_task_revision IS NULL)
    OR (current_task_id IS NOT NULL AND current_task_revision >= 0)
  ),
  CHECK(
    (context_conversation_id IS NULL AND context_revision IS NULL)
    OR (context_conversation_id IS NOT NULL AND context_revision >= 0)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, source_coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, current_task_id)
    REFERENCES tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, context_conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE coordination_handoff_cursors (
  project_id TEXT NOT NULL,
  coordination_session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, coordination_session_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE INDEX idx_coordination_handoff_events_worktree_sequence
  ON coordination_handoff_events(project_id, worktree_id, sequence);
CREATE INDEX idx_coordination_handoff_cursors_worktree
  ON coordination_handoff_cursors(project_id, worktree_id, last_sequence);

INSERT INTO coordination_handoff_cursors
  (project_id, coordination_session_id, worktree_id, last_sequence, updated_at)
SELECT project_id, id, worktree_id, 0, updated_at
FROM coordination_sessions;

COMMIT;
