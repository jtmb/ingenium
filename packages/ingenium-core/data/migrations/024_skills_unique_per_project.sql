-- Migration 024: Rebuild skills table with UNIQUE(project_id, name) instead of UNIQUE(name).
-- The 001_init.sql schema uses global UNIQUE(name), which prevents the same skill name
-- from existing in multiple projects. This rebuild establishes per-project uniqueness.
-- Follows the safe rebuild pattern from migrations 015 and 017.

-- Guard: checked in db.ts before execution — looks for UNIQUE(project_id, name) in skills CREATE SQL.
-- The -- 024_rebuilt comment marker in the CREATE TABLE below provides a secondary guard.

PRAGMA foreign_keys = OFF;

-- Step 1: Drop FTS triggers if they exist (may not exist — skills FTS is managed in app code)
DROP TRIGGER IF EXISTS skills_fts_insert;
DROP TRIGGER IF EXISTS skills_fts_delete;
DROP TRIGGER IF EXISTS skills_fts_update;

-- Step 2: Drop FTS virtual table (it references the old skills table by name)
DROP TABLE IF EXISTS skills_fts;

-- Step 3: Rename existing skills table
ALTER TABLE skills RENAME TO skills_old;

-- Step 4: Create new skills table with per-project uniqueness
CREATE TABLE IF NOT EXISTS skills (
    -- 024_rebuilt
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    tags TEXT,
    enabled INTEGER DEFAULT 1,
    always_apply INTEGER DEFAULT 0,
    file_tree TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
);

-- Step 5: Restore data from old table
INSERT INTO skills SELECT * FROM skills_old;

-- Step 6: Recreate FTS5 virtual table with content-sync
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(name, description, content, content='skills', content_rowid='rowid');

-- Step 7: Recreate FTS triggers pointing to the new skills table
CREATE TRIGGER IF NOT EXISTS skills_fts_insert AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(rowid, name, description, content) VALUES (new.rowid, new.name, new.description, new.content);
END;
CREATE TRIGGER IF NOT EXISTS skills_fts_delete AFTER DELETE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, name, description, content) VALUES('delete', old.rowid, old.name, old.description, old.content);
END;
CREATE TRIGGER IF NOT EXISTS skills_fts_update AFTER UPDATE ON skills BEGIN
    INSERT INTO skills_fts(skills_fts, rowid, name, description, content) VALUES('delete', old.rowid, old.name, old.description, old.content);
    INSERT INTO skills_fts(rowid, name, description, content) VALUES (new.rowid, new.name, new.description, new.content);
END;

-- Step 8: Rebuild FTS index from restored data
INSERT INTO skills_fts(skills_fts) VALUES('rebuild');

-- Step 9: Cleanup old table
DROP TABLE IF EXISTS skills_old;

-- Step 10: Recreate index from 001_init.sql
CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(project_id);

PRAGMA foreign_keys = ON;
