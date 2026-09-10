-- RAG documents (ingestion sources — files, Thread imports, text pastes)
CREATE TABLE IF NOT EXISTS rag_sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('file','thread_import','text','url')), source_path TEXT, source_hash TEXT, mime_type TEXT, byte_size INTEGER, chunk_count INTEGER NOT NULL DEFAULT 0, metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_rag_sources_project ON rag_sources(project_id, created_at DESC);

-- RAG chunks (token-aware splits with overlap)
CREATE TABLE IF NOT EXISTS rag_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES rag_sources(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0, heading_path TEXT, priority INTEGER NOT NULL DEFAULT 5 CHECK(priority >= 0 AND priority <= 10), tags TEXT DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source_id, chunk_index);

-- FTS5 external content table for chunks
CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(content, tags, source_id UNINDEXED, priority UNINDEXED, content='rag_chunks', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2', prefix='2 3 4');
CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rowid, content, tags, source_id, priority) VALUES (new.rowid, new.content, new.tags, new.source_id, new.priority); END;
CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, tags, source_id, priority) VALUES ('delete', old.rowid, old.content, old.tags, old.source_id, old.priority); END;
CREATE TRIGGER IF NOT EXISTS rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, tags, source_id, priority) VALUES ('delete', old.rowid, old.content, old.tags, old.source_id, old.priority); INSERT INTO rag_chunks_fts(rowid, content, tags, source_id, priority) VALUES (new.rowid, new.content, new.tags, new.source_id, new.priority); END;

-- Embeddings (Float32Array BLOBs)
CREATE TABLE IF NOT EXISTS rag_embeddings (chunk_id TEXT PRIMARY KEY REFERENCES rag_chunks(id) ON DELETE CASCADE, embedding BLOB NOT NULL, model_id TEXT NOT NULL, dimensions INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- Ingestion state (resumable imports)
CREATE TABLE IF NOT EXISTS rag_ingestion_state (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT UNIQUE REFERENCES rag_sources(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed')), progress_pct REAL NOT NULL DEFAULT 0, error_message TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- Thread import checkpoints
CREATE TABLE IF NOT EXISTS rag_thread_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT REFERENCES rag_sources(id) ON DELETE CASCADE, thread_session_name TEXT NOT NULL, entries_total INTEGER NOT NULL DEFAULT 0, entries_imported INTEGER NOT NULL DEFAULT 0, last_entry_id INTEGER, checksum TEXT, completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
