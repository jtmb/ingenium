-- 039_docs_templates: Page templates
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    content TEXT NOT NULL DEFAULT '',   -- template Markdown
    category TEXT DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
