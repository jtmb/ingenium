#!/bin/sh
set -eu

for name in INGENIUM_API_URL INGENIUM_PROJECT INGENIUM_PROJECT_ID INGENIUM_ORGANIZATION_ID INGENIUM_RUNTIME_ID INGENIUM_RUNTIME_OWNER_ID INGENIUM_WORKSPACE_ID INGENIUM_STORAGE_MAPPING_HASH; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "ERROR: runtime identity is incomplete"
    exit 1
  fi
done

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  PWD="/app" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  XDG_DATA_HOME="/home/appuser/.local/share" \
  XDG_STATE_HOME="/home/appuser/.local/state" \
  OPENCODE_CONFIG_DIR="/home/appuser/.config/opencode/runtime" \
  OPENCODE_SERVER_PASSWORD="" \
  INGENIUM_API_URL="$INGENIUM_API_URL" \
  INGENIUM_PROJECT="$INGENIUM_PROJECT" \
  INGENIUM_PROJECT_ID="$INGENIUM_PROJECT_ID" \
  INGENIUM_ORGANIZATION_ID="$INGENIUM_ORGANIZATION_ID" \
  INGENIUM_RUNTIME_ID="$INGENIUM_RUNTIME_ID" \
  INGENIUM_RUNTIME_OWNER_ID="$INGENIUM_RUNTIME_OWNER_ID" \
  INGENIUM_WORKSPACE_ID="$INGENIUM_WORKSPACE_ID" \
  INGENIUM_STORAGE_MAPPING_HASH="$INGENIUM_STORAGE_MAPPING_HASH" \
  INGENIUM_WORKTREE="/workspace" \
  INGENIUM_MCP_AUDIENCE="runtime" \
  INGENIUM_MCP_CREDENTIAL_FILE="/run/ingenium-runtime/capability" \
  INGENIUM_RUNTIME_CREDENTIAL_FILE="/run/ingenium-runtime/capability" \
  opencode serve --port 4098 --hostname 0.0.0.0
