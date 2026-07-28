-- Immutable, project-scoped context conversations. These tables are separate
-- from the legacy mutable context_entries compatibility surface.
--
-- Checkpoints retain a content-addressed snapshot of an append-only message
-- stream. RAG sources are linked through a junction table so a checkpoint can
-- cite multiple existing sources without changing rag_sources semantics.

-- SQLite requires the exact parent column tuple to be unique before a child
-- table can use a composite foreign key. The primary key on rag_sources.id is
-- not sufficient for the project-scoped reference below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_sources_project_id
  ON rag_sources(project_id, id);

CREATE TABLE IF NOT EXISTS context_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT CHECK(
    idempotency_key IS NULL OR (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    )
  ),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(tags)
    AND json_type(tags) = 'array'
    AND length(CAST(tags AS BLOB)) <= 4096
  ),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 0 AND 10),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(metadata)
    AND json_type(metadata) = 'object'
    AND length(CAST(metadata AS BLOB)) <= 16384
  ),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_conversations_project_created
  ON context_conversations(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS context_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 262144),
  content_hash TEXT NOT NULL CHECK(
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT CHECK(
    idempotency_key IS NULL OR (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    )
  ),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(tags)
    AND json_type(tags) = 'array'
    AND length(CAST(tags AS BLOB)) <= 4096
  ),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 0 AND 10),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(metadata)
    AND json_type(metadata) = 'object'
    AND length(CAST(metadata AS BLOB)) <= 16384
  ),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, conversation_id, id),
  UNIQUE(project_id, conversation_id, sequence),
  UNIQUE(project_id, conversation_id, idempotency_key),
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_messages_conversation_sequence
  ON context_messages(project_id, conversation_id, sequence ASC);

-- This index enables bounded, relevance-ranked message lookup. Public list and
-- search responses return metadata and hashes only; message content requires a
-- deliberate retrieve call.
CREATE VIRTUAL TABLE IF NOT EXISTS context_messages_fts USING fts5(
  content,
  content='context_messages',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS context_checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  through_message_id TEXT NOT NULL,
  message_count INTEGER NOT NULL CHECK(message_count >= 1),
  state_hash TEXT NOT NULL CHECK(
    length(state_hash) = 64
    AND state_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT CHECK(
    idempotency_key IS NULL OR (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    )
  ),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(metadata)
    AND json_type(metadata) = 'object'
    AND length(CAST(metadata AS BLOB)) <= 16384
  ),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, conversation_id, sequence),
  UNIQUE(project_id, conversation_id, idempotency_key),
  FOREIGN KEY(project_id, conversation_id)
    REFERENCES context_conversations(project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY(project_id, conversation_id, through_message_id)
    REFERENCES context_messages(project_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_checkpoints_conversation_sequence
  ON context_checkpoints(project_id, conversation_id, sequence DESC);

CREATE TABLE IF NOT EXISTS context_checkpoint_rag_sources (
  project_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  rag_source_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(metadata)
    AND json_type(metadata) = 'object'
    AND length(CAST(metadata AS BLOB)) <= 16384
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, checkpoint_id, rag_source_id),
  UNIQUE(project_id, checkpoint_id, ordinal),
  FOREIGN KEY(project_id, checkpoint_id)
    REFERENCES context_checkpoints(project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY(project_id, rag_source_id)
    REFERENCES rag_sources(project_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_checkpoint_rag_sources_source
  ON context_checkpoint_rag_sources(project_id, rag_source_id);

CREATE TRIGGER IF NOT EXISTS context_conversations_immutable_update
BEFORE UPDATE ON context_conversations
BEGIN
  SELECT RAISE(ABORT, 'context_conversations rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_conversations_immutable_delete
BEFORE DELETE ON context_conversations
BEGIN
  SELECT RAISE(ABORT, 'context_conversations rows are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_messages_immutable_update
BEFORE UPDATE ON context_messages
BEGIN
  SELECT RAISE(ABORT, 'context_messages rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_messages_immutable_delete
BEFORE DELETE ON context_messages
BEGIN
  SELECT RAISE(ABORT, 'context_messages rows are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_messages_fts_insert
AFTER INSERT ON context_messages
BEGIN
  INSERT INTO context_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoints_immutable_update
BEFORE UPDATE ON context_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoints rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoints_immutable_delete
BEFORE DELETE ON context_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoints rows are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoint_rag_sources_immutable_update
BEFORE UPDATE ON context_checkpoint_rag_sources
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_rag_sources rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoint_rag_sources_immutable_delete
BEFORE DELETE ON context_checkpoint_rag_sources
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_rag_sources rows are immutable — DELETE rejected');
END;
