-- Child tool categories are server-specific. Rebuild the discovery table so
-- installations that already applied migration 062 do not retain its former
-- `category = 'Child MCP'` CHECK constraint.
BEGIN;

ALTER TABLE mcp_child_discovered_tools RENAME TO mcp_child_discovered_tools_legacy;
DROP INDEX IF EXISTS idx_mcp_child_discovered_tools_server;

CREATE TABLE mcp_child_discovered_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_child_server_definitions(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL CHECK(
    length(source_name) BETWEEN 1 AND 64
    AND source_name GLOB '[a-z]*'
    AND source_name NOT GLOB '*[^a-z0-9_]*'
    AND source_name NOT GLOB 'ingenium_*'
  ),
  canonical_name TEXT NOT NULL CHECK(
    canonical_name GLOB 'ingenium_[a-z]*'
    AND canonical_name NOT GLOB '*[^a-z0-9_]*'
  ),
  category TEXT NOT NULL CHECK(
    category GLOB 'Child MCP / [a-z]*'
    AND category NOT GLOB '*[^A-Za-z0-9 /]*'
  ),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 1024),
  input_schema TEXT NOT NULL CHECK(json_valid(input_schema) AND length(input_schema) <= 16384),
  discovered_at TEXT NOT NULL,
  UNIQUE(server_id, source_name),
  UNIQUE(server_id, canonical_name)
);

INSERT INTO mcp_child_discovered_tools
  (id, server_id, source_name, canonical_name, category, description, input_schema, discovered_at)
SELECT
  tool.id,
  tool.server_id,
  tool.source_name,
  tool.canonical_name,
  'Child MCP / ' || server.name,
  tool.description,
  tool.input_schema,
  tool.discovered_at
FROM mcp_child_discovered_tools_legacy AS tool
INNER JOIN mcp_child_server_definitions AS server ON server.id = tool.server_id;

DROP TABLE mcp_child_discovered_tools_legacy;
CREATE INDEX idx_mcp_child_discovered_tools_server
  ON mcp_child_discovered_tools(server_id, canonical_name);

COMMIT;
