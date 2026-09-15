-- CTX-003: bounded, project-owned context document ingestion. Raw chunk upload
-- state is private to the owning project and is not exposed to RAG readers until
-- the final source/chunk/index write commits.

CREATE TABLE IF NOT EXISTS context_rag_uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  rag_source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  provenance TEXT NOT NULL CHECK(provenance IN (
    'direct_upload', 'chunked_upload', 'opencode_session', 'learning_snapshot'
  )),
  source_reference TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  UNIQUE(project_id, rag_source_id),
  UNIQUE(project_id, content_hash),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, rag_source_id)
    REFERENCES rag_sources(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_rag_uploads_project_created
  ON context_rag_uploads(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS context_rag_upload_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 256),
  expected_hash TEXT NOT NULL CHECK(
    length(expected_hash) = 64
    AND expected_hash NOT GLOB '*[^0-9a-f]*'
  ),
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes BETWEEN 1 AND 2097152),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 32),
  mime_type TEXT NOT NULL CHECK(mime_type IN (
    'text/plain', 'text/markdown', 'application/json', 'application/x-ndjson'
  )),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 0 AND 10),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(tags) AND json_type(tags) = 'array'
    AND length(CAST(tags AS BLOB)) <= 4096
  ),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(metadata) AND json_type(metadata) = 'object'
    AND length(CAST(metadata AS BLOB)) <= 16384
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'deduplicated')),
  rag_source_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, rag_source_id)
    REFERENCES rag_sources(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_rag_upload_sessions_project_status
  ON context_rag_upload_sessions(project_id, status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS context_rag_upload_chunks (
  project_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 31),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 65536),
  content_hash TEXT NOT NULL CHECK(
    length(content_hash) = 64
    AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 65536),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, upload_id, ordinal),
  FOREIGN KEY(project_id, upload_id)
    REFERENCES context_rag_upload_sessions(project_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS context_rag_uploads_immutable_update
BEFORE UPDATE ON context_rag_uploads
BEGIN
  SELECT RAISE(ABORT, 'context_rag_uploads rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_rag_uploads_immutable_delete
BEFORE DELETE ON context_rag_uploads
BEGIN
  SELECT RAISE(ABORT, 'context_rag_uploads rows are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_rag_upload_chunks_immutable_update
BEFORE UPDATE ON context_rag_upload_chunks
BEGIN
  SELECT RAISE(ABORT, 'context_rag_upload_chunks rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_rag_upload_chunks_immutable_delete
BEFORE DELETE ON context_rag_upload_chunks
WHEN EXISTS (
  SELECT 1 FROM context_rag_upload_sessions session
  WHERE session.project_id = old.project_id
    AND session.id = old.upload_id
    AND session.status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'pending context_rag_upload_chunks rows are immutable — DELETE rejected');
END;

-- The source and chunks become immutable once their identifier is recorded in
-- a checkpoint. This protects the exact corpus cited by historical context.
CREATE TRIGGER IF NOT EXISTS rag_sources_context_checkpoint_immutable_update
BEFORE UPDATE ON rag_sources
WHEN EXISTS (
  SELECT 1 FROM context_checkpoint_rag_sources link
  WHERE link.project_id = old.project_id AND link.rag_source_id = old.id
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint RAG sources are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_sources_context_checkpoint_immutable_delete
BEFORE DELETE ON rag_sources
WHEN EXISTS (
  SELECT 1 FROM context_checkpoint_rag_sources link
  WHERE link.project_id = old.project_id AND link.rag_source_id = old.id
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint RAG sources are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_checkpoint_immutable_insert
BEFORE INSERT ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_checkpoint_rag_sources link
  JOIN rag_sources source ON source.id = link.rag_source_id
  WHERE source.id = new.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — INSERT rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_checkpoint_immutable_update
BEFORE UPDATE ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_checkpoint_rag_sources link
  JOIN rag_sources source ON source.id = link.rag_source_id
  WHERE source.id = old.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_checkpoint_immutable_delete
BEFORE DELETE ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_checkpoint_rag_sources link
  JOIN rag_sources source ON source.id = link.rag_source_id
  WHERE source.id = old.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'checkpoint RAG chunks are immutable — DELETE rejected');
END;

CREATE TABLE IF NOT EXISTS context_checkpoint_rag_source_snapshots (
  project_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  rag_source_id TEXT NOT NULL,
  source_hash TEXT,
  title TEXT NOT NULL,
  source_path TEXT,
  source_type TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  provenance TEXT NOT NULL,
  source_reference TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, checkpoint_id, rag_source_id),
  FOREIGN KEY(project_id, checkpoint_id, rag_source_id)
    REFERENCES context_checkpoint_rag_sources(project_id, checkpoint_id, rag_source_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_context_checkpoint_rag_snapshots_source
  ON context_checkpoint_rag_source_snapshots(project_id, rag_source_id);

-- Checkpoints created before CTX-003 already own immutable source links. Seed
-- their provenance at migration time before the new source/chunk guards take
-- effect, so historical retrieval has the same citation contract as new links.
INSERT OR IGNORE INTO context_checkpoint_rag_source_snapshots
  (project_id, checkpoint_id, rag_source_id, source_hash, title, source_path,
   source_type, mime_type, byte_size, provenance, source_reference, created_at)
SELECT link.project_id, link.checkpoint_id, link.rag_source_id,
       source.source_hash, source.title, source.source_path, source.source_type,
       source.mime_type, source.byte_size, COALESCE(upload.provenance, 'rag_source'),
       upload.source_reference, link.created_at
FROM context_checkpoint_rag_sources link
JOIN rag_sources source
  ON source.project_id = link.project_id AND source.id = link.rag_source_id
LEFT JOIN context_rag_uploads upload
  ON upload.project_id = source.project_id AND upload.rag_source_id = source.id;

CREATE TRIGGER IF NOT EXISTS context_checkpoint_rag_source_snapshots_immutable_update
BEFORE UPDATE ON context_checkpoint_rag_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_rag_source_snapshots rows are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS context_checkpoint_rag_source_snapshots_immutable_delete
BEFORE DELETE ON context_checkpoint_rag_source_snapshots
BEGIN
  SELECT RAISE(ABORT, 'context_checkpoint_rag_source_snapshots rows are immutable — DELETE rejected');
END;
