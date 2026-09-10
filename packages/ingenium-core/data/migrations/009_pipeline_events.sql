-- Migration 009: Pipeline events table for observability timeline.
-- Tracks every event in the self-learning pipeline lifecycle:
-- Agent observations, plugin actions, synthesis runs, trait operations.
CREATE TABLE IF NOT EXISTS pipeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    event_type TEXT NOT NULL CHECK(event_type IN (
        'session_created',          -- OpenCode session started
        'session_idle',             -- Session went idle
        'observation_created',      -- Agent called ingenium_observe
        'observation_imported',     -- Observer imported from file fallback
        'synthesis_triggered',      -- Synthesis pipeline was triggered
        'synthesis_started',        -- Pipeline started processing
        'synthesis_completed',      -- Pipeline finished with results
        'synthesis_failed',         -- Pipeline encountered errors at batch level
        'trait_created',            -- Personality trait was created (new)
        'trait_updated',            -- Personality trait confidence was updated
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
    parent_event_id INTEGER,        -- Link to parent event for grouping (e.g., trait child of synthesis run)
    session_id TEXT,                -- Session where this happened
    importance INTEGER DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_project_time ON pipeline_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type ON pipeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_source ON pipeline_events(event_source);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_parent ON pipeline_events(parent_event_id);
