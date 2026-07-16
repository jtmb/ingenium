-- 031_docs_pages_fts: Full-text search on documentation pages
-- Guard: checks if FTS table exists
CREATE VIRTUAL TABLE IF NOT EXISTS docs_pages_fts USING fts5(
    title,
    content,
    content='docs_pages',
    content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS docs_pages_ai AFTER INSERT ON docs_pages BEGIN
    INSERT INTO docs_pages_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_pages_ad AFTER DELETE ON docs_pages BEGIN
    INSERT INTO docs_pages_fts(docs_pages_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS docs_pages_au AFTER UPDATE ON docs_pages BEGIN
    INSERT INTO docs_pages_fts(docs_pages_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    INSERT INTO docs_pages_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
