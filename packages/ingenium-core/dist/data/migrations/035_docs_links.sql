-- 035_docs_links: Backlinks between pages ([[page-slug]] references)
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_page_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    target_page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    link_text TEXT NOT NULL DEFAULT '',
    UNIQUE(source_page_id, target_page_id)
);

CREATE INDEX IF NOT EXISTS idx_docs_links_target ON docs_page_links(target_page_id);
