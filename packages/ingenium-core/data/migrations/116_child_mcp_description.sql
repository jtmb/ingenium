-- db.ts checks column existence after migration 062 before applying this upgrade.
ALTER TABLE mcp_child_server_definitions ADD COLUMN description TEXT NULL;
