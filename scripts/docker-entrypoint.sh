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

# API management endpoints require an opaque, high-entropy Bearer credential.
# Compose may provide the bootstrap value inline or through a mounted secret
# file. The API process performs the canonical validation again before binding.
if [ -n "${INGENIUM_API_TOKEN_FILE:-}" ]; then
  if [ -L "$INGENIUM_API_TOKEN_FILE" ] || [ ! -f "$INGENIUM_API_TOKEN_FILE" ]; then
    echo "ERROR: INGENIUM_API_TOKEN_FILE must name a regular non-symlink file"
    exit 1
  fi
  api_token="$(cat "$INGENIUM_API_TOKEN_FILE")"
elif [ -n "${INGENIUM_API_TOKEN:-}" ]; then
  api_token="$INGENIUM_API_TOKEN"
else
  echo "ERROR: INGENIUM_API_TOKEN or INGENIUM_API_TOKEN_FILE is required"
  exit 1
fi
api_token_bytes="$(printf '%s' "$api_token" | LC_ALL=C wc -c)"
if [ "$api_token_bytes" -lt 32 ] || [ "$api_token_bytes" -gt 128 ]; then
  echo "ERROR: API token must contain 32 to 128 base64url characters"
  exit 1
fi
if ! printf '%s' "$api_token" | LC_ALL=C grep -qE '^[A-Za-z0-9_-]+$'; then
  echo "ERROR: API token must contain only base64url characters"
  exit 1
fi

# Copy the bootstrap token to an ephemeral, private file before supervisord
# forks service processes. The parent then drops plaintext from its environment;
# API/boundary/dashboard launchers consume only this path. mktemp + rename does
# not follow a final-path symlink, and the containing directory is mode 0700.
RUNTIME_SECRET_DIR="/run/ingenium-secrets"
RUNTIME_API_TOKEN_FILE="${RUNTIME_SECRET_DIR}/api-token"
umask 077
mkdir -p "$RUNTIME_SECRET_DIR"
chown appuser:appuser "$RUNTIME_SECRET_DIR"
chmod 0700 "$RUNTIME_SECRET_DIR"
runtime_token_tmp="$(mktemp "${RUNTIME_SECRET_DIR}/.api-token.XXXXXX")"
trap 'rm -f "$runtime_token_tmp"' EXIT HUP INT TERM
printf '%s\n' "$api_token" > "$runtime_token_tmp"
chown appuser:appuser "$runtime_token_tmp"
chmod 0600 "$runtime_token_tmp"
mv -f "$runtime_token_tmp" "$RUNTIME_API_TOKEN_FILE"
trap - EXIT HUP INT TERM
unset api_token
unset INGENIUM_API_TOKEN
export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"

GATEWAY_RUNTIME_DIR="/run/ingenium-gateway"
GATEWAY_ERROR_LOG="${GATEWAY_RUNTIME_DIR}/nginx-error.log"
# Nginx runs as appuser and must create its pid, lock, and temporary files.
# `/run` is ephemeral, so these paths remain outside persistent application
# volumes and are recreated with owner-only access on every start.
for dir in \
  "$GATEWAY_RUNTIME_DIR" \
  "$GATEWAY_RUNTIME_DIR/client_body" \
  "$GATEWAY_RUNTIME_DIR/proxy" \
  "$GATEWAY_RUNTIME_DIR/fastcgi" \
  "$GATEWAY_RUNTIME_DIR/uwsgi" \
  "$GATEWAY_RUNTIME_DIR/scgi"; do
  install -d -o appuser -g appuser -m 0700 "$dir"
done
# Nginx reopens its error log as appuser; Supervisor reads this same file as
# the gateway stdout log. Replace only this ephemeral runtime artifact before
# either process opens it, preventing a stale owner from blocking either side.
rm -f "$GATEWAY_ERROR_LOG"
install -o appuser -g appuser -m 0600 /dev/null "$GATEWAY_ERROR_LOG"

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
        "INGENIUM_API_TOKEN_FILE": ".opencode/.ingenium-api-token",
        "INGENIUM_PROJECT": "global-default",
        "INGENIUM_WORKTREE": "/workspace"
      }
    }
  },
  "plugin": [
    "/app/packages/ingenium-extension/observer.ts",
    "/app/packages/ingenium-extension/auto-observer.ts",
    "/app/packages/ingenium-extension/resource-sync.ts"
  ]
}
OCEOF
  echo "Seeded OpenCode config with Ingenium MCP"
fi

# The global config lives on a persistent volume and may predate protected token
# files or the unified resource-sync plugin. Project the container-owned entries
# on every start while preserving unrelated operator configuration.
runuser -u appuser -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  node /app/scripts/project-opencode-global-config.mjs "$OC_CONFIG"

# OpenCode is launched with env -i, so its local MCP child cannot inherit the
# runtime token-file path. Seed the only protected fallback path accepted by
# the MCP server below its worktree; the non-secret MCP config passes that
# relative file path to the child, which reads it from its /workspace CWD.
WORKSPACE_OPENCODE_DIR="/workspace/.opencode"
WORKSPACE_MCP_TOKEN_FILE="${WORKSPACE_OPENCODE_DIR}/.ingenium-api-token"
if [ -L "$WORKSPACE_OPENCODE_DIR" ]; then
  echo "ERROR: OpenCode workspace directory must not be a symbolic link"
  exit 1
fi
if [ -e "$WORKSPACE_OPENCODE_DIR" ] && [ ! -d "$WORKSPACE_OPENCODE_DIR" ]; then
  echo "ERROR: OpenCode workspace path must be a directory"
  exit 1
fi
mkdir -p "$WORKSPACE_OPENCODE_DIR"
chown appuser:appuser "$WORKSPACE_OPENCODE_DIR"
chmod 0700 "$WORKSPACE_OPENCODE_DIR"
if [ -L "$WORKSPACE_MCP_TOKEN_FILE" ]; then
  echo "ERROR: OpenCode MCP token file must not be a symbolic link"
  exit 1
fi
if [ -e "$WORKSPACE_MCP_TOKEN_FILE" ] && [ ! -f "$WORKSPACE_MCP_TOKEN_FILE" ]; then
  echo "ERROR: OpenCode MCP token path must be a regular file"
  exit 1
fi
workspace_token_tmp="$(mktemp "${WORKSPACE_OPENCODE_DIR}/.ingenium-api-token.XXXXXX")"
trap 'rm -f "$workspace_token_tmp"' EXIT HUP INT TERM
chown appuser:appuser "$workspace_token_tmp"
chmod 0600 "$workspace_token_tmp"
cat "$RUNTIME_API_TOKEN_FILE" > "$workspace_token_tmp"
mv -f "$workspace_token_tmp" "$WORKSPACE_MCP_TOKEN_FILE"
trap - EXIT HUP INT TERM

# Validate metadata and content equivalence without printing credential bytes.
workspace_token_metadata="$(stat -c '%a:%U:%G' "$WORKSPACE_MCP_TOKEN_FILE")"
if [ "$workspace_token_metadata" != "600:appuser:appuser" ]; then
  echo "ERROR: OpenCode MCP token file must be mode 0600 and owned by appuser"
  exit 1
fi
if ! cmp -s "$RUNTIME_API_TOKEN_FILE" "$WORKSPACE_MCP_TOKEN_FILE"; then
  echo "ERROR: OpenCode MCP token file does not match the runtime token file"
  exit 1
fi

# Copy all agent profiles to the workspace before OpenCode starts. OpenCode scans its
# worktree's .opencode/agents/ directory, while the source agents live in /app.
# The orchestrator-based topology includes primary, execution, research, security,
# and chat agent profiles — all copied flat into the workspace for discovery.
mkdir -p /workspace/.opencode/agents
cp /app/.opencode/agents/chat/ingenium-chat.md /workspace/.opencode/agents/ingenium-chat.md 2>/dev/null || true
for dir in primary execution research security; do
  cp /app/.opencode/agents/$dir/*.md /workspace/.opencode/agents/ 2>/dev/null || true
done

# Refuse to start if a templating or package change made the gateway unsafe.
# Validate as the supervised Nginx user so validation cannot leave root-owned
# PID, lock, temp, or log artifacts in the shared runtime directory.
runuser -u appuser -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  /app/scripts/validate-gateway-config.sh

# Start supervisord as PID 1 after all startup setup has completed.
exec supervisord -c /app/supervisord.conf
