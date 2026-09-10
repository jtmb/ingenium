-- 045_pipeline_event_types: Add skill_created, skill_updated, and proposal event types
-- to the pipeline_events CHECK constraint. The TypeScript PipelineEventSchema already
-- includes skill_created and skill_updated, but the SQL CHECK constraint was missing
-- them, causing synthesis.ts emissions to be silently swallowed by SQLITE_CONSTRAINT.
--
-- SQLite does not support ALTER CONSTRAINT — we recreate the table.

-- Drop dependent indexes first
DROP INDEX IF EXISTS idx_pipeline_events_project_time;
DROP INDEX IF EXISTS idx_pipeline_events_type;
DROP INDEX IF EXISTS idx_pipeline_events_source;
DROP INDEX IF EXISTS idx_pipeline_events_parent;

-- Rename old table
ALTER TABLE pipeline_events RENAME TO pipeline_events_old_045;

-- Create new table with updated CHECK constraint (-- 045_pipeline_event_types marker)
CREATE TABLE pipeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    event_type TEXT NOT NULL CHECK(event_type IN (
        'session_created',          -- OpenCode session started
        'session_idle',             -- Session went idle
        'observation_created',      -- Agent called ingenium_observe
        'observation_imported',     -- Observer imported from file fallback
        'observation_detected',     -- Auto-observer pattern detection
        'synthesis_triggered',      -- Synthesis pipeline was triggered
        'synthesis_started',        -- Pipeline started processing
        'synthesis_completed',      -- Pipeline finished with results
        'synthesis_failed',         -- Pipeline encountered errors at batch level
        'extraction_completed',     -- LLM extraction engine completed a run
        'extraction_failed',        -- LLM extraction engine failed
        'trait_created',            -- Personality trait was created (new)
        'trait_updated',            -- Personality trait confidence was updated
        'skill_created',            -- Skill was created by synthesis pipeline
        'skill_updated',            -- Skill was updated by synthesis pipeline
        'proposal_created',         -- Skill proposal was created
        'proposal_submitted',       -- Proposal was submitted for review
        'proposal_approved',        -- Proposal was approved
        'proposal_rejected',        -- Proposal was rejected
        'proposal_applied',         -- Proposal was applied to target skill
        'proposal_rolled_back',     -- Applied proposal was rolled back
        'plugin_initialized',       -- Observer plugin initialized
        'plugin_error'              -- Plugin encountered an error
    )),
    event_source TEXT NOT NULL CHECK(event_source IN (
        'agent',                    -- From agent workflow
        'plugin',                   -- From observer plugin
        'synthesis',                -- From synthesis pipeline
        'system'                    -- From system init/hooks
    )),
    title TEXT NOT NULL,            -- Short human-readable title
    description TEXT,               -- Optional longer description
    data TEXT,                      -- JSON blob with event-specific payload
    parent_event_id INTEGER,        -- Link to parent event for grouping
    session_id TEXT,                -- Session where this happened
    importance INTEGER DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
    created_at TEXT NOT NULL
);

-- Copy data from old table (existing events have only pre-045 types, all compatible)
INSERT INTO pipeline_events SELECT * FROM pipeline_events_old_045;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_pipeline_events_project_time ON pipeline_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type ON pipeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_source ON pipeline_events(event_source);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_parent ON pipeline_events(parent_event_id);

-- Drop old table
DROP TABLE pipeline_events_old_045;
