#!/bin/sh
set -eu

# Require auth for OpenCode server
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# Ensure writable directories exist with correct ownership
for dir in /app/.ingenium /app/.opencode/skills /home/appuser/.config/opencode /home/appuser/.local/share/opencode/log; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
  fi
done
chown -R appuser:appuser /app/.ingenium /app/.opencode /home/appuser 2>/dev/null || true

# Seed OpenCode config with Ingenium MCP on first start
OC_CONFIG="/home/appuser/.config/opencode/opencode.jsonc"
if [ ! -f "$OC_CONFIG" ]; then
  mkdir -p "$(dirname "$OC_CONFIG")"
  cat > "$OC_CONFIG" << 'OCEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ingenium": {
      "type": "local",
      "command": ["node", "/app/services/ingenium-server/dist/scripts/mcp-server.js"],
      "enabled": true,
      "environment": {
        "INGENIUM_API_URL": "http://localhost:4097/api/v1"
      }
    }
  }
}
OCEOF
  echo "Seeded OpenCode config with Ingenium MCP"
fi

# Auto-create global-default project
exec supervisord -c /app/supervisord.conf &
sleep 5
curl -s -X POST 'http://localhost:4097/api/v1/projects?project=global-default' \
  -H 'Content-Type: application/json' -d '{"name":"global-default"}' > /dev/null 2>&1 || true

# Register Ingenium MCP server in Ingenium DB so dashboard shows it
curl -s -X POST 'http://localhost:4097/api/v1/servers?project=global-default' \
  -H 'Content-Type: application/json' \
  -d '{"name":"ingenium","command":"node /app/services/ingenium-server/dist/scripts/mcp-server.js","args":"[]","env":"{\"INGENIUM_API_URL\":\"http://localhost:4097/api/v1\"}"}' > /dev/null 2>&1 || true
# Mark it as running
curl -s -X PATCH 'http://localhost:4097/api/v1/servers/ingenium?project=global-default' \
  -H 'Content-Type: application/json' \
  -d '{"running":1}' > /dev/null 2>&1 || true

# Set OpenCode workspace to /workspace
# Must stop OpenCode first or it overwrites from in-memory cache
OC_DB="/home/appuser/.local/share/opencode/opencode.db"
sleep 3
if [ -f "$OC_DB" ]; then
  WORKTREE=$(node -e "
const D = require('/app/node_modules/better-sqlite3');
const db = new D('$OC_DB');
try {
  const p = db.prepare('SELECT worktree FROM project WHERE id = ?').get('global');
  console.log(p ? p.worktree : '');
} finally { db.close(); }
")
  if [ "$WORKTREE" != "/workspace" ]; then
    supervisorctl stop opencode-server opencode-iframe 2>/dev/null || true
    node -e "
const D = require('/app/node_modules/better-sqlite3');
const db = new D('$OC_DB');
db.prepare('UPDATE project SET worktree = ? WHERE id = ?').run('/workspace', 'global');
console.log('Updated OpenCode workspace to /workspace');
db.close();
"
    supervisorctl start opencode-server opencode-iframe 2>/dev/null || true
  fi
fi
wait
