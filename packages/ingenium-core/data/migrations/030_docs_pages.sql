-- 030_docs_pages: Create documentation pages table
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES docs_spaces(id) ON DELETE CASCADE,
    parent_page_id INTEGER REFERENCES docs_pages(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,                 -- URL-safe, unique within space
    content TEXT NOT NULL DEFAULT '',   -- published Markdown content
    revision INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency control
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
    sort_order INTEGER DEFAULT 0,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(space_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_docs_pages_space ON docs_pages(space_id);
CREATE INDEX IF NOT EXISTS idx_docs_pages_parent ON docs_pages(parent_page_id);
CREATE INDEX IF NOT EXISTS idx_docs_pages_status ON docs_pages(status);
