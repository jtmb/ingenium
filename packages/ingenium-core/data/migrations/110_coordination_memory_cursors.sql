-- Durable per-session acknowledgement for bounded operational-memory replay.
BEGIN IMMEDIATE;

CREATE TABLE coordination_memory_cursors (
  project_id TEXT NOT NULL,
  coordination_session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_revision INTEGER NOT NULL DEFAULT 0 CHECK(last_revision >= 0),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, coordination_session_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_coordination_memory_cursors_worktree
  ON coordination_memory_cursors(project_id, worktree_id, last_revision);

INSERT INTO coordination_memory_cursors
  (project_id, coordination_session_id, worktree_id, conversation_id, last_revision, updated_at)
SELECT session.project_id, session.id, session.worktree_id, session.context_conversation_id,
       MAX(0, COALESCE((
         SELECT COUNT(*) FROM context_messages message
         WHERE message.project_id = session.project_id
           AND message.conversation_id = session.context_conversation_id
       ), 0) - 8),
       session.updated_at
FROM coordination_sessions session
WHERE session.context_conversation_id IS NOT NULL;

COMMIT;
