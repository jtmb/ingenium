-- 033_docs_versions: Page version history
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_page_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_versions_page ON docs_page_versions(page_id);
