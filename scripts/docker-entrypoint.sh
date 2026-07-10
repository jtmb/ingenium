#!/bin/sh
set -eu

# Require auth for OpenCode server
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# Ensure writable directories exist
for dir in /app/.ingenium /app/.opencode/skills; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
  fi
done

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

# Auto-create global-default project on first start
exec supervisord -c /app/supervisord.conf &
sleep 5
curl -s -X POST 'http://localhost:4097/api/v1/projects?project=global-default' \
  -H 'Content-Type: application/json' -d '{"name":"global-default"}' > /dev/null 2>&1 || true
wait
