-- Migration 042: Add revision tracking + archived_at to skills; create immutable skill_versions table.
--
-- Purpose:
--   1. Add `revision INTEGER NOT NULL DEFAULT 0` and `archived_at TEXT` to the skills table.
--   2. Create an immutable `skill_versions` table keyed by (skill_id, revision).
--   3. AFTER INSERT/UPDATE snapshot triggers automatically version every mutation.
--   4. BEFORE UPDATE/DELETE triggers enforce strict immutability — version rows cannot be modified.
--   5. Seed revision 0 for all existing skills (pre-042 rows).
--
-- Legacy safety: No non-empty CHECKs on name/description/content (empty legacy rows tolerated).
-- ON DELETE RESTRICT on version FK prevents destroying version history.
--
-- Guard: db.ts probes for revision + archived_at columns, skill_versions table, all 4 triggers,
--        and the idx_skill_versions_skill_rev index. Any partial state fails loudly.

-- Step 1: Add revision and archived_at columns
ALTER TABLE skills ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE skills ADD COLUMN archived_at TEXT;

-- Step 2: Create immutable skill_versions table
CREATE TABLE IF NOT EXISTS skill_versions (
    -- 042_versions
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK(revision >= 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    tags TEXT,
    always_apply INTEGER NOT NULL DEFAULT 0,
    file_tree TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    archived_at TEXT,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL,
    UNIQUE(skill_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_rev ON skill_versions(skill_id, revision DESC);

-- Step 3: AFTER INSERT trigger — snapshot revision 0
CREATE TRIGGER IF NOT EXISTS skill_versions_after_insert
AFTER INSERT ON skills
BEGIN
    INSERT INTO skill_versions (skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at,created_by,created_at)
    VALUES (NEW.id,NEW.revision,NEW.name,NEW.description,NEW.content,NEW.category,NEW.tags,COALESCE(NEW.always_apply,0),NEW.file_tree,COALESCE(NEW.enabled,1),NEW.archived_at,'system',datetime('now'));
END;

-- Step 4: AFTER UPDATE trigger — snapshot only when revision changes
CREATE TRIGGER IF NOT EXISTS skill_versions_after_update
AFTER UPDATE ON skills
WHEN NEW.revision != OLD.revision
BEGIN
    INSERT INTO skill_versions (skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at,created_by,created_at)
    VALUES (NEW.id,NEW.revision,NEW.name,NEW.description,NEW.content,NEW.category,NEW.tags,COALESCE(NEW.always_apply,0),NEW.file_tree,COALESCE(NEW.enabled,1),NEW.archived_at,'system',datetime('now'));
END;

-- Step 5: BEFORE UPDATE trigger — REJECT any modification to version rows
CREATE TRIGGER IF NOT EXISTS skill_versions_before_update
BEFORE UPDATE ON skill_versions
BEGIN
    SELECT RAISE(ABORT, 'skill_versions rows are immutable — UPDATE rejected');
END;

-- Step 6: BEFORE DELETE trigger — REJECT any deletion of version rows
CREATE TRIGGER IF NOT EXISTS skill_versions_before_delete
BEFORE DELETE ON skill_versions
BEGIN
    SELECT RAISE(ABORT, 'skill_versions rows are immutable — DELETE rejected');
END;

-- Step 7: Seed revision 0 for existing skills
INSERT INTO skill_versions (skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at,created_by,created_at)
SELECT s.id,0,s.name,s.description,s.content,s.category,s.tags,COALESCE(s.always_apply,0),s.file_tree,COALESCE(s.enabled,1),s.archived_at,'migration-042',datetime('now')
FROM skills s WHERE s.revision = 0
ON CONFLICT(skill_id,revision) DO NOTHING;
