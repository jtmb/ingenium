-- 036_docs_comments: Inline comments on documentation pages
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    parent_comment_id INTEGER REFERENCES docs_comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    selection_text TEXT DEFAULT '',     -- highlighted text the comment is on
    selection_offset INTEGER DEFAULT 0,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_comments_page ON docs_comments(page_id);
