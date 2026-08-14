#!/bin/sh
# OpenCode is served only through the local gateway. Before loading plugins,
# require a bounded authenticated API probe so a normal cold container start
# does not race extension project provisioning.
set -eu

# Every probe is individually time-bounded by probe-api.mjs. This loop is
# intentionally fixed rather than environment-configurable, avoiding an
# accidental infinite or excessively long startup wait.
attempts=10
attempt=1
while [ "$attempt" -le "$attempts" ]; do
  if node /app/scripts/probe-api.mjs; then
    echo "Authenticated API readiness passed before OpenCode start after ${attempt} attempt(s)"
    exec env -i \
      PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      HOME="/home/appuser" \
      XDG_CONFIG_HOME="/home/appuser/.config" \
      XDG_DATA_HOME="/home/appuser/.local/share" \
      OPENCODE_SERVER_PASSWORD="" \
      INGENIUM_API_URL="http://localhost:4097/api/v1" \
      INGENIUM_MCP_CREDENTIAL_FILE=".opencode/.ingenium-repository-sync-credential" \
      INGENIUM_MCP_AUDIENCE="repository-sync" \
      INGENIUM_WORKTREE="/workspace" \
      INGENIUM_PROJECT="global-default" \
      INGENIUM_WORKSPACE_ID="global-default-workspace" \
      opencode serve --port 4098 --hostname 127.0.0.1
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep 1
  fi
  attempt=$((attempt + 1))
done

echo "ERROR: authenticated API readiness did not pass before OpenCode start"
exit 1
