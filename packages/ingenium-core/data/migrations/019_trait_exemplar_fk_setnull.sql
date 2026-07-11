-- Migration 019: Change exemplar_observation_id FK to ON DELETE SET NULL.
-- When an observation is deleted, traits that referenced it should have their
-- exemplar_observation_id set to NULL instead of blocking the delete with a
-- FOREIGN KEY constraint error.
--
-- Rebuilds personality_traits using the same safe pattern as migration 017:
-- PRAGMA foreign_keys=OFF (applied by db.ts) → rename → create → copy → drop → recreate indexes/view.

ALTER TABLE personality_traits RENAME TO personality_traits_old_019;

CREATE TABLE IF NOT EXISTS personality_traits (
    -- 019_fk_setnull
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    trait_type TEXT NOT NULL CHECK(trait_type IN (
        'communication_style',   -- Formal/casual, detail level, tone
        'code_preference',       -- Naming conventions, style, patterns
        'workflow_pattern',      -- How user approaches tasks
        'terminology',           -- Preferred terms
        'priority_signal',       -- What user considers important
        'feedback_style',        -- How user gives feedback
        'interaction_pattern',   -- When/how user interacts
        'domain_knowledge',      -- User's expertise areas
        'learned_skill',         -- Skill the system has learned
        'personality_trait'      -- General personality observation
    )),
    trait_value TEXT NOT NULL,    -- e.g. "snake_case", "brief_responses", "morning_person"
    display_label TEXT,           -- Human-readable label: "Prefers snake_case naming"
    confidence REAL DEFAULT 0.5 CHECK(confidence >= 0.0 AND confidence <= 1.0),
    exemplar_observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
    exemplar_text TEXT,           -- The observation that established this trait
    source TEXT NOT NULL DEFAULT 'synthesis',
    is_active INTEGER DEFAULT 1,
    metadata TEXT,                -- JSON for flexibility
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO personality_traits SELECT * FROM personality_traits_old_019;
DROP TABLE personality_traits_old_019;

CREATE INDEX IF NOT EXISTS idx_personality_active ON personality_traits(project_id, is_active);
CREATE INDEX IF NOT EXISTS idx_personality_type ON personality_traits(trait_type);
CREATE INDEX IF NOT EXISTS idx_personality_confidence ON personality_traits(confidence DESC);

-- Recreate the personality profile view to reference the new table
DROP VIEW IF EXISTS personality_profile;
CREATE VIEW IF NOT EXISTS personality_profile AS
SELECT 
    project_id,
    trait_type,
    json_group_array(json_object(
        'trait_value', trait_value,
        'display_label', display_label,
        'confidence', confidence,
        'source', source
    )) as traits
FROM personality_traits 
WHERE is_active = 1
GROUP BY project_id, trait_type
ORDER BY trait_type, confidence DESC;
