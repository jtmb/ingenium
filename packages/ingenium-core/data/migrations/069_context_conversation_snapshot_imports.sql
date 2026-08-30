-- CTX-005: replay-safe, append-only file snapshot ingestion for Context-native
-- conversations. Source mappings retain only logical source identifiers and
-- hashes; transcript bodies remain solely in immutable context_messages.

CREATE TABLE IF NOT EXISTS context_conversation_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_key TEXT NOT NULL CHECK(
    length(source_key) BETWEEN 1 AND 256
    AND instr(source_key, '/') = 0
    AND instr(source_key, char(92)) = 0
  ),
  source_session_id TEXT CHECK(
    source_session_id IS NULL OR (
      length(source_session_id) BETWEEN 1 AND 512
      AND instr(source_session_id, '/') = 0
      AND instr(source_session_id, char(92)) = 0
    )
  ),
  conversation_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK(
    length(snapshot_hash) = 64
    AND snapshot_hash NOT GLOB '*[^0-9a-f]*'
  ),
  entry_count INTEGER NOT NULL CHECK(entry_count >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, source_key),
  UNIQUE(project_id, conversation_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_conversation_sources_project_updated
  ON context_conversation_sources(project_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS context_conversation_source_messages (
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content_hash TEXT NOT NULL CHECK(
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  source_fingerprint TEXT NOT NULL CHECK(
    length(source_fingerprint) = 64
    AND source_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, source_id, sequence),
  UNIQUE(project_id, source_id, message_id),
  UNIQUE(project_id, source_id, source_fingerprint),
  FOREIGN KEY(project_id, source_id)
    REFERENCES context_conversation_sources(project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id, message_id)
    REFERENCES context_messages(project_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_conversation_source_messages_message
  ON context_conversation_source_messages(project_id, conversation_id, message_id);

CREATE TRIGGER IF NOT EXISTS context_conversation_source_messages_immutable_update
BEFORE UPDATE ON context_conversation_source_messages
BEGIN
  SELECT RAISE(ABORT, 'context_conversation_source_messages rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_conversation_source_messages_immutable_delete
BEFORE DELETE ON context_conversation_source_messages
BEGIN
  SELECT RAISE(ABORT, 'context_conversation_source_messages rows are immutable — DELETE rejected');
END;
