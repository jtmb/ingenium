-- Migration 043: Skill lineage — provenance mapping for merge/copy/derive operations.
--
-- Purpose:
--   Track the provenance of skills: which source skill (by project + name) a target
--   skill was derived from, merged into, or otherwise descended from. This enables
--   cycle detection, conflict resolution, and audit trails for skill evolution.
--
-- Design:
--   - `source_project_id` + `source_name` identify the origin skill (no FK required —
--     the source may have been deleted or may exist in a different project).
--   - `target_skill_id` FK references skills(id) with ON DELETE RESTRICT — preserves
--     provenance history even if the target skill is archived. The RESTRICT ensures
--     that skill deletion (if ever implemented) must first resolve lineage references.
--   - `source_hash` is a SHA-256 hash of the source skill's content at lineage creation.
--   - `merged_file_paths` is a JSON array of file paths that were merged.
--   - `tombstone_path` is the path to a tombstone file recording lineage for archived sources.
--   - `reason` is a human-readable description of why this lineage was created.
--   - Cycle prevention is enforced in application code (skill-governance.ts) because
--     it requires recursive graph traversal not expressible in SQL CHECK constraints.
--
-- Guard: checked in db.ts by probing for `skill_lineage` table existence.

CREATE TABLE IF NOT EXISTS skill_lineage (
    -- 043_lineage
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    source_project_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    target_skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
    source_hash TEXT NOT NULL DEFAULT '',
    merged_file_paths TEXT NOT NULL DEFAULT '[]',
    tombstone_path TEXT DEFAULT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, source_project_id, source_name, target_skill_id)
);

-- Index for lineage lookups by target skill (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_skill_lineage_target ON skill_lineage(target_skill_id);

-- Index for finding all lineage records for a project
CREATE INDEX IF NOT EXISTS idx_skill_lineage_project ON skill_lineage(project_id);

-- Index for source-based lookups (cycle detection, resolve by source)
CREATE INDEX IF NOT EXISTS idx_skill_lineage_source ON skill_lineage(source_project_id, source_name);
