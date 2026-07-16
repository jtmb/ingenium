-- 029_docs_spaces: Create documentation spaces table
-- Guard: checks if table exists
CREATE TABLE IF NOT EXISTS docs_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,          -- e.g., "Engineering", "Personal"
    slug TEXT NOT NULL UNIQUE,          -- URL-safe: "engineering", "personal"
    description TEXT DEFAULT '',
    icon TEXT DEFAULT 'folder',         -- icon name for UI
    sort_order INTEGER DEFAULT 0,
    is_global INTEGER NOT NULL DEFAULT 1, -- global-first: all spaces are global
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
