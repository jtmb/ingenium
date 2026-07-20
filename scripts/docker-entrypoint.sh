#!/bin/sh
# docker-entrypoint.sh — Ingenium container bootstrap
#
# Key design decisions:
# - Uses `sh` (not bash) for Alpine-based distroless compatibility
# - Deliberately omits `-o pipefail` since `sh` doesn't support it;
#   commands use explicit `|| true` for error tolerance instead
# - One-shot setup completes before supervisord starts
# - Supervisord is exec'd so it receives container lifecycle signals as PID 1
set -eu

# SECURITY: Require auth for OpenCode server — prevents unauthenticated
# access to the MCP tool execution endpoint exposed via ttyd and the
# embedded web interface
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# SECURITY: Validate email encryption key format before supervisor starts.
# Accept a 32-byte hex key or a 64-character base64url secret. The latter is
# deterministically reduced to an AES-256 key by the email package.
if [ -z "${INGENIUM_EMAIL_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: INGENIUM_EMAIL_ENCRYPTION_KEY is required (64 hex characters or 64-character base64url secret)"
  exit 1
fi
if ! printf '%s\n' "${INGENIUM_EMAIL_ENCRYPTION_KEY}" | grep -qE '^[A-Za-z0-9_-]{64}$'; then
  echo "ERROR: INGENIUM_EMAIL_ENCRYPTION_KEY must be 64 hex or base64url characters"
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

# Copy agents to workspace before OpenCode starts. OpenCode scans its
# worktree's .opencode/agents/ directory, while the source agents live in /app.
mkdir -p /workspace/.opencode/agents
cp /app/.opencode/agents/chat/ingenium-chat.md /workspace/.opencode/agents/ingenium-chat.md 2>/dev/null || true
if [ -f /app/.opencode/agents/execution/ingenium-llm-broker.md ]; then
  cp /app/.opencode/agents/execution/ingenium-llm-broker.md /workspace/.opencode/agents/ingenium-llm-broker.md 2>/dev/null || true
fi

# Start supervisord as PID 1 after all startup setup has completed.
exec supervisord -c /app/supervisord.conf
