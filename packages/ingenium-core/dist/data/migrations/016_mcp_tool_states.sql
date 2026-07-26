-- migrate:down DROP TABLE mcp_tool_states;
CREATE TABLE IF NOT EXISTS mcp_tool_states (
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, tool_name)
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_states_project ON mcp_tool_states(project_id);
