#!/bin/sh
set -eu

if [ "$(id -u)" -ne 1000 ] || [ "$(id -g)" -ne 1000 ]; then
  echo "ERROR: user runtime must run as appuser"
  exit 1
fi

for name in HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME INGENIUM_API_URL INGENIUM_PROJECT INGENIUM_PROJECT_ID INGENIUM_ORGANIZATION_ID INGENIUM_RUNTIME_ID INGENIUM_RUNTIME_OWNER_ID INGENIUM_WORKSPACE_ID; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "ERROR: runtime identity is incomplete"
    exit 1
  fi
done

if [ "$HOME" != "/home/appuser" ] || [ "$XDG_CONFIG_HOME" != "/home/appuser/.config" ] \
  || [ "$XDG_DATA_HOME" != "/home/appuser/.local/share" ] || [ "$XDG_STATE_HOME" != "/home/appuser/.local/state" ]; then
  echo "ERROR: runtime state roots are invalid"
  exit 1
fi

capability="/run/ingenium-runtime/capability"
capability_tmp="/run/ingenium-runtime/.capability.tmp"
capability_value=""
if ! IFS= read -r capability_value || ! printf '%s\n' "$capability_value" | grep -qxE 'ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}'; then
  echo "ERROR: runtime capability handoff is unavailable"
  exit 1
fi
umask 077
printf '%s\n' "$capability_value" > "$capability_tmp"
unset capability_value
chmod 0600 "$capability_tmp"
mv "$capability_tmp" "$capability"
if [ -L "$capability" ] || [ ! -f "$capability" ] || [ "$(stat -c '%a:%u:%g' "$capability")" != "600:1000:1000" ]; then
  echo "ERROR: runtime capability handoff is unavailable"
  exit 1
fi
if [ "$(wc -c < "$capability")" -ne 61 ] || ! grep -qxE 'ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}' "$capability"; then
  echo "ERROR: runtime capability is invalid"
  exit 1
fi

mkdir -p \
  "/home/appuser/.config/opencode/agents" \
  "/home/appuser/.local/share/opencode/log" \
  "/home/appuser/.local/state" \
  "/home/appuser/vscode-data/user-data" \
  "/home/appuser/vscode-data/extensions"
chmod 0700 "/home/appuser/.config" "/home/appuser/.local" "/home/appuser/.local/share" "/home/appuser/.local/state" "/home/appuser/vscode-data"

/app/scripts/normalize-agent-profiles.sh --project-server-owned /app/.opencode/agents /home/appuser/.config/opencode/agents

config_file="/home/appuser/.config/opencode/opencode.jsonc"
cat > "$config_file" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ingenium": {
      "type": "local",
      "command": ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
      "enabled": true,
      "environment": {
        "INGENIUM_API_URL": "$INGENIUM_API_URL",
        "INGENIUM_MCP_CREDENTIAL_FILE": "/run/ingenium-runtime/capability",
        "INGENIUM_RUNTIME_CREDENTIAL_FILE": "/run/ingenium-runtime/capability",
        "INGENIUM_MCP_AUDIENCE": "runtime",
        "INGENIUM_PROJECT": "$INGENIUM_PROJECT",
        "INGENIUM_WORKSPACE_ID": "$INGENIUM_WORKSPACE_ID",
        "INGENIUM_WORKTREE": "/workspace"
      }
    }
  },
  "plugin": [
    "/app/packages/ingenium-extension/plugins/observer.ts",
    "/app/packages/ingenium-extension/plugins/auto-observer.ts",
    "/app/packages/ingenium-extension/plugins/resource-sync.ts",
    "/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"
  ]
}
EOF
chmod 0600 "$config_file"

export INGENIUM_RUNTIME_BIND_HOST="0.0.0.0"
exec supervisord -c /app/runtime-supervisord.conf
