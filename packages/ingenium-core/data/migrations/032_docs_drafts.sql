-- 032_docs_drafts: Autosave drafts for documentation pages
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_page_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',   -- draft Markdown content
    saved_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(page_id)
);
