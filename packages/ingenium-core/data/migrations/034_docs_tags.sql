-- 034_docs_tags: Tags and page-tag associations
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS docs_page_tags (
    page_id INTEGER NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES docs_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, tag_id)
);
