-- Repository-authoritative Markdown onboarding state. The page survives an
-- archive so an unchanged file can later restore its Docs Workspace identity.
CREATE TABLE IF NOT EXISTS docs_repository_pages (
  page_id INTEGER PRIMARY KEY REFERENCES docs_pages(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK(
    length(source_hash) = 64
    AND source_hash NOT GLOB '*[^0-9a-f]*'
  ),
  rag_source_id TEXT UNIQUE REFERENCES rag_sources(id) ON DELETE SET NULL,
  managed_tags TEXT NOT NULL DEFAULT '["repository-managed","repository-doc"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, source_path)
);

CREATE INDEX IF NOT EXISTS idx_docs_repository_pages_project_hash
  ON docs_repository_pages(project_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_docs_repository_pages_project_path
  ON docs_repository_pages(project_id, source_path);
