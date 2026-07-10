-- Migration 007: Observations table for background self-learning pipeline.
-- Replaces the old self-reporting learnings system with passive observations.
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    observation_type TEXT NOT NULL CHECK(observation_type IN (
        'correction',       -- User corrected the agent's behavior/output
        'preference',       -- User expressed a preference (style, format, tone)
        'pattern',          -- Recurring behavior or workflow pattern observed
        'insight',          -- Novel insight or discovery from agent's analysis
        'feedback',         -- Implicit feedback (user accepted/rejected/dismissed)
        'behavior',         -- User behavior signal (navigation, timing, priority)
        'terminology',      -- User's preferred terminology/language
        'workflow',         -- User's workflow sequence
        'error',            -- User encountered an error
        'goal'              -- User's stated or implied goal
    )),
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
    source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN (
        'agent',            -- Agent observed during interaction
        'email',            -- Email interaction analysis
        'chat',             -- Chat/conversation analysis
        'document',         -- Document analysis
        'calendar',         -- Calendar/task pattern
        'synthesis',        -- Synthesized from multiple observations
        'import',           -- Imported from legacy learnings
        'manual'            -- Manually entered by user
    )),
    embedding BLOB,           -- Placeholder for future vector embedding
    context TEXT,             -- JSON: surrounding context (e.g. session info, file paths)
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'skipped', 'failed')),
    session_id TEXT,          -- Session where this was observed
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_project_status ON observations(project_id, status);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance DESC);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(content, context, content=observations, content_rowid=id);

CREATE TRIGGER IF NOT EXISTS observations_fts_insert AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, content, context) VALUES (new.id, new.content, new.context);
END;
CREATE TRIGGER IF NOT EXISTS observations_fts_delete AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content, context) VALUES('delete', old.id, old.content, old.context);
END;
CREATE TRIGGER IF NOT EXISTS observations_fts_update AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, content, context) VALUES('delete', old.id, old.content, old.context);
    INSERT INTO observations_fts(rowid, content, context) VALUES (new.id, new.content, new.context);
END;
