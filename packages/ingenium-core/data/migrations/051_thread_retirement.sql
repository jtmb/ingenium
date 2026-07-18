-- Post-gate Thread retirement. Migration 048 remains immutable for installed databases.
-- The runner verifies that both the legacy checkpoint table and source type are empty
-- before this rebuild is allowed to run.
CREATE TABLE rag_sources_retired (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('file','text','url')),
  source_path TEXT,
  source_hash TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO rag_sources_retired (id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at)
SELECT id, project_id, title, source_type, source_path, source_hash, mime_type, byte_size, chunk_count, metadata, created_at, updated_at
FROM rag_sources;
DROP TABLE rag_thread_imports;
DROP TABLE rag_sources;
ALTER TABLE rag_sources_retired RENAME TO rag_sources;
CREATE INDEX idx_rag_sources_project ON rag_sources(project_id, created_at DESC);
CREATE UNIQUE INDEX idx_rag_sources_project_path ON rag_sources(project_id, source_path) WHERE source_path IS NOT NULL;
CREATE INDEX idx_rag_sources_project_updated ON rag_sources(project_id, updated_at DESC, id DESC);
