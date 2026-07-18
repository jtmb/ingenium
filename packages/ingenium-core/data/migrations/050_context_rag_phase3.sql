-- Canonical agent memory and RAG lifecycle metadata.
ALTER TABLE context_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','agent','import','system'));
ALTER TABLE context_entries ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE context_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE context_entries SET updated_at = created_at WHERE updated_at = '';
CREATE INDEX IF NOT EXISTS idx_context_project_priority_created ON context_entries(project_id, priority DESC, created_at DESC, id DESC);

-- A source path is canonical within one project. This makes file and published-page
-- updates idempotent while retaining editable pasted text sources without a path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_sources_project_path ON rag_sources(project_id, source_path) WHERE source_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rag_sources_project_updated ON rag_sources(project_id, updated_at DESC, id DESC);
