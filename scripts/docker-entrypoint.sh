#!/bin/sh
# docker-entrypoint.sh — Ingenium container bootstrap
#
# Key design decisions:
# - Uses `sh` (not bash) for Alpine-based distroless compatibility
# - Deliberately omits `-o pipefail` since `sh` doesn't support it;
#   commands use explicit `|| true` for error tolerance instead
# - Supervisord is backgrounded (not exec'd) so one-shot setup can run
#   before yielding control to the process supervisor
# - `wait` at the end keeps the container alive as PID 1 without
#   requiring a separate supervisor/parent process dependency
set -eu

# SECURITY: Require auth for OpenCode server — prevents unauthenticated
# access to the MCP tool execution endpoint exposed via ttyd and the
# embedded web interface
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# SECURITY: Validate email encryption key format before supervisor starts.
# Must be exactly 64 hex characters — no fallback, no generated secret.
if [ -z "${INGENIUM_EMAIL_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: INGENIUM_EMAIL_ENCRYPTION_KEY is required (64 hex characters)"
  exit 1
fi
if ! echo "${INGENIUM_EMAIL_ENCRYPTION_KEY}" | grep -qE '^[0-9a-fA-F]{64}$'; then
  echo "ERROR: INGENIUM_EMAIL_ENCRYPTION_KEY must be exactly 64 hex characters"
  exit 1
fi

# Ensure writable directories exist with correct ownership
# HACK: chown errors are suppressed (2>/dev/null || true) because the
# container may run as non-root in some environments (e.g. OpenShift);
# the directories themselves are the critical requirement, ownership
# is best-effort
for dir in /app/.ingenium /app/.ingenium/logs /app/.opencode/skills /home/appuser/.config/opencode /home/appuser/.local/share/opencode/log; do
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
      "command": ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
      "enabled": true,
      "environment": {
        "INGENIUM_API_URL": "http://localhost:4097/api/v1",
        "INGENIUM_PROJECT": "global-default"
      }
    }
  },
  "plugin": [
    "/app/packages/ingenium-extension/observer.ts",
    "/app/packages/ingenium-extension/auto-observer.ts",
    "/app/packages/ingenium-extension/skill-sync.ts"
  ]
}
OCEOF
  echo "Seeded OpenCode config with Ingenium MCP"
fi

# Auto-create global-default project if it doesn't exist
# NOTE: `|| true` makes this idempotent across restarts — curl fails
# silently when the project already exists (HTTP 409). The 5s sleep
# gives supervisord time to start the API process on first launch.
exec supervisord -c /app/supervisord.conf &
sleep 5
curl -s -X POST 'http://localhost:4097/api/v1/projects?project=global-default' \
  -H 'Content-Type: application/json' -d '{"name":"global-default","is_global":true}' > /dev/null 2>&1 || true

# Register Ingenium MCP server in Ingenium DB so dashboard shows it
# NOTE: This is a POST (not PUT) so `|| true` handles the "already exists"
# case gracefully across container restarts.
curl -s -X POST 'http://localhost:4097/api/v1/servers?project=global-default' \
  -H 'Content-Type: application/json' \
  -d '{"name":"ingenium","command":"node /app/services/ingenium-server/dist/scripts/mcp-server.js","args":"[]","env":"{\"INGENIUM_API_URL\":\"http://localhost:4097/api/v1\"}"}' > /dev/null 2>&1 || true
curl -s -X PATCH 'http://localhost:4097/api/v1/servers/ingenium?project=global-default' \
  -H 'Content-Type: application/json' \
  -d '{"running":1}' > /dev/null 2>&1 || true

# Set OpenCode workspace to /workspace
# NOTE: Must stop OpenCode before updating the DB because the process
# retains the worktree in memory and overwrites the DB on graceful
# shutdown. The 3s sleep after stopping gives the process time to
# release the SQLite WAL lock before we write.
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
    supervisorctl stop opencode-web 2>/dev/null || true
    node -e "
const D = require('/app/node_modules/better-sqlite3');
const db = new D('$OC_DB');
db.prepare('UPDATE project SET worktree = ? WHERE id = ?').run('/workspace', 'global');
console.log('Updated OpenCode workspace to /workspace');
db.close();
"
    supervisorctl start opencode-web 2>/dev/null || true
  fi
fi
# Keep container alive as PID 1. Normally `exec supervisord` would serve
# this role, but we backgrounded it above to run setup steps. `wait` is
# the POSIX-compliant way to block indefinitely on the background process
# without busy-looping.
wait
