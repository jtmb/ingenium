-- Canonical child-MCP definitions. Commands and arguments are separate so a
-- future bridge can use spawn(command, args) without a shell. Environment
-- values are never persisted here: the normalized reference table points only
-- to encrypted vault items owned by the same project.
CREATE TABLE IF NOT EXISTS mcp_child_server_definitions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(
    length(name) BETWEEN 1 AND 48
    AND name GLOB '[a-z]*'
    AND name NOT GLOB '*[^a-z0-9]*'
  ),
  executable TEXT NOT NULL CHECK(
    length(executable) BETWEEN 1 AND 1024
    AND executable NOT GLOB '*[^A-Za-z0-9_+@./:-]*'
    AND executable <> '.'
    AND executable <> '..'
    AND executable NOT LIKE '../%'
    AND executable NOT LIKE '%/../%'
    AND executable NOT LIKE '%/..'
  ),
  args TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(args) AND json_type(args) = 'array'),
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('project', 'global')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  discovery_status TEXT NOT NULL DEFAULT 'pending' CHECK(discovery_status IN ('pending', 'ready', 'failed')),
  discovery_diagnostic TEXT CHECK(discovery_diagnostic IN ('unavailable', 'unauthorized', 'invalid_response', 'timeout')),
  last_discovered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_child_server_definitions_project_scope
  ON mcp_child_server_definitions(project_id, scope, name);

CREATE TABLE IF NOT EXISTS mcp_child_server_vault_refs (
  server_id TEXT NOT NULL REFERENCES mcp_child_server_definitions(id) ON DELETE CASCADE,
  env_key TEXT NOT NULL CHECK(
    length(env_key) BETWEEN 1 AND 64
    AND env_key GLOB '[A-Z_]*'
    AND env_key NOT GLOB '*[^A-Z0-9_]*'
  ),
  vault_item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE RESTRICT,
  PRIMARY KEY(server_id, env_key)
);

CREATE TRIGGER IF NOT EXISTS mcp_child_server_vault_ref_project_match
BEFORE INSERT ON mcp_child_server_vault_refs
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM mcp_child_server_definitions AS server
  INNER JOIN vault_items AS vault_item ON vault_item.id = NEW.vault_item_id
  WHERE server.id = NEW.server_id
    AND server.project_id = vault_item.project_id
    AND vault_item.access_policy <> '{"mode":"deleted"}'
)
BEGIN
  SELECT RAISE(ABORT, 'child MCP vault reference must belong to the owning project');
END;

CREATE TABLE IF NOT EXISTS mcp_child_discovered_tools (
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

CREATE INDEX IF NOT EXISTS idx_mcp_child_discovered_tools_server
  ON mcp_child_discovered_tools(server_id, canonical_name);
