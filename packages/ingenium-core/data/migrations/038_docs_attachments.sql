-- 038_docs_attachments: File attachments for documentation pages
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,         -- relative path under INGENIUM_HOME/attachments/
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(page_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_docs_attachments_page ON docs_attachments(page_id);
