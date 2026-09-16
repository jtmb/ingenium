-- RECOVERY-102: principal-bound linked sessions with append-only transcript replay.
-- db.ts probes the complete boundary before applying this migration.
BEGIN IMMEDIATE;

ALTER TABLE coordination_sessions ADD COLUMN principal_id TEXT CHECK(
  principal_id IS NULL OR (
    length(principal_id) BETWEEN 1 AND 128
    AND principal_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  )
);

CREATE TABLE IF NOT EXISTS coordination_session_links (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  source_coordination_session_id TEXT NOT NULL,
  target_coordination_session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('linked', 'fork')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  CHECK(source_coordination_session_id <> target_coordination_session_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, source_coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, target_coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coordination_transcript_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  source_coordination_session_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL CHECK(
    length(source_message_id) BETWEEN 1 AND 512
    AND source_message_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  payload_json TEXT NOT NULL CHECK(
    json_valid(payload_json)
    AND json_type(payload_json) = 'object'
    AND length(CAST(payload_json AS BLOB)) <= 1572864
  ),
  payload_sha256 TEXT NOT NULL CHECK(
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, source_coordination_session_id, source_message_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, source_coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coordination_transcript_cursors (
  project_id TEXT NOT NULL,
  coordination_session_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  source_coordination_session_id TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, coordination_session_id, link_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, link_id)
    REFERENCES coordination_session_links(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, source_coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coordination_sessions_principal
  ON coordination_sessions(project_id, worktree_id, principal_id, session_id, incarnation);
CREATE INDEX IF NOT EXISTS idx_coordination_session_links_worktree
  ON coordination_session_links(project_id, worktree_id, sequence);
CREATE INDEX IF NOT EXISTS idx_coordination_session_links_source
  ON coordination_session_links(project_id, source_coordination_session_id);
CREATE INDEX IF NOT EXISTS idx_coordination_session_links_target
  ON coordination_session_links(project_id, target_coordination_session_id);
CREATE INDEX IF NOT EXISTS idx_coordination_transcript_messages_source
  ON coordination_transcript_messages(project_id, source_coordination_session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_coordination_transcript_cursors_reader
  ON coordination_transcript_cursors(project_id, coordination_session_id, last_sequence);

CREATE TRIGGER IF NOT EXISTS coordination_session_links_immutable_update
BEFORE UPDATE ON coordination_session_links
BEGIN
  SELECT RAISE(ABORT, 'coordination session links are immutable');
END;

CREATE TRIGGER IF NOT EXISTS coordination_session_links_immutable_delete
BEFORE DELETE ON coordination_session_links
BEGIN
  SELECT RAISE(ABORT, 'coordination session links are retained');
END;

CREATE TRIGGER IF NOT EXISTS coordination_transcript_messages_immutable_update
BEFORE UPDATE ON coordination_transcript_messages
BEGIN
  SELECT RAISE(ABORT, 'coordination transcript messages are immutable');
END;

CREATE TRIGGER IF NOT EXISTS coordination_transcript_messages_immutable_delete
BEFORE DELETE ON coordination_transcript_messages
BEGIN
  SELECT RAISE(ABORT, 'coordination transcript messages are retained');
END;

COMMIT;
