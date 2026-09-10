#!/bin/sh
# OpenCode is served only through the local gateway. Before loading plugins,
# require a bounded authenticated API probe so a normal cold container start
# does not race extension project provisioning.
set -eu
unset INGENIUM_RUNTIME_ID

attempt=0
while [ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    echo "MCP_BOOTSTRAP_WAIT_FAILED"
    exit 1
  fi
  sleep 1
done
attempt=0
while [ ! -s /run/ingenium-runtime/environment ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 12 ]; then
    echo "MCP_BOOTSTRAP_DEGRADED stage=local-runtime code=WAIT_EXPIRED"
    break
  fi
  sleep 1
done
if [ -s /run/ingenium-runtime/environment ] && [ -s /run/ingenium-runtime/capability ]; then
  . /run/ingenium-runtime/environment
fi

# A provisioned compatibility runtime must not inherit the persistent global
# MCP entry's legacy project or general-purpose credential.
set --
if [ -n "${INGENIUM_RUNTIME_ID:-}" ]; then
  for name in INGENIUM_PROJECT INGENIUM_PROJECT_ID INGENIUM_ORGANIZATION_ID INGENIUM_RUNTIME_OWNER_ID INGENIUM_WORKSPACE_ID INGENIUM_STORAGE_MAPPING_HASH; do
    eval "value=\${$name:-}"
    if [ -z "$value" ]; then
      echo "ERROR: compatibility runtime identity is incomplete"
      exit 1
    fi
  done
  if [ "${INGENIUM_WORKTREE:-}" != /workspace ]; then
    echo "ERROR: compatibility runtime worktree is invalid"
    exit 1
  fi
  runtime_config='{"mcp":{"ingenium":{"type":"local","command":["node","/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],"enabled":true,"environment":{"INGENIUM_API_URL":"http://localhost:4097/api/v1","INGENIUM_MCP_AUDIENCE":"runtime","INGENIUM_MCP_CREDENTIAL_PURPOSE":"runtime","INGENIUM_RUNTIME_CREDENTIAL_FILE":"/run/ingenium-runtime/capability","INGENIUM_PROJECT":"{env:INGENIUM_PROJECT}","INGENIUM_PROJECT_ID":"{env:INGENIUM_PROJECT_ID}","INGENIUM_ORGANIZATION_ID":"{env:INGENIUM_ORGANIZATION_ID}","INGENIUM_RUNTIME_OWNER_ID":"{env:INGENIUM_RUNTIME_OWNER_ID}","INGENIUM_RUNTIME_ID":"{env:INGENIUM_RUNTIME_ID}","INGENIUM_WORKSPACE_ID":"{env:INGENIUM_WORKSPACE_ID}","INGENIUM_STORAGE_MAPPING_HASH":"{env:INGENIUM_STORAGE_MAPPING_HASH}","INGENIUM_WORKTREE":"/workspace"}}}}'
  set -- \
    OPENCODE_CONFIG_CONTENT="$runtime_config" \
    INGENIUM_MCP_AUDIENCE="runtime" \
    INGENIUM_MCP_CREDENTIAL_PURPOSE="runtime" \
    INGENIUM_RUNTIME_CREDENTIAL_FILE="/run/ingenium-runtime/capability" \
    INGENIUM_PROJECT_ID="$INGENIUM_PROJECT_ID" \
    INGENIUM_ORGANIZATION_ID="$INGENIUM_ORGANIZATION_ID" \
    INGENIUM_RUNTIME_ID="$INGENIUM_RUNTIME_ID" \
    INGENIUM_RUNTIME_OWNER_ID="$INGENIUM_RUNTIME_OWNER_ID" \
    INGENIUM_WORKTREE="$INGENIUM_WORKTREE" \
    INGENIUM_STORAGE_MAPPING_HASH="$INGENIUM_STORAGE_MAPPING_HASH"
else
  INGENIUM_PROJECT=ingenium
  INGENIUM_WORKSPACE_ID=shared-memory-ingenium
fi

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
      PWD="/app" \
      HOME="/home/ingenium-opencode" \
      XDG_CONFIG_HOME="/home/ingenium-opencode/.config" \
      XDG_DATA_HOME="/home/ingenium-opencode/.local/share" \
      OPENCODE_CONFIG_DIR="/home/ingenium-opencode/.config/opencode/runtime" \
      OPENCODE_SERVER_PASSWORD="" \
      INGENIUM_API_URL="http://localhost:4097/api/v1" \
      INGENIUM_MCP_CREDENTIAL_FILE="/run/ingenium-opencode/.ingenium-mcp-credential" \
      INGENIUM_MCP_AUDIENCE="mcp" \
      INGENIUM_MCP_CREDENTIAL_PURPOSE="general" \
      INGENIUM_WORKTREE="/home/brajam/repos/ingenium" \
      INGENIUM_PROJECT="${INGENIUM_PROJECT:-ingenium}" \
      INGENIUM_WORKSPACE_ID="${INGENIUM_WORKSPACE_ID:-shared-memory-ingenium}" \
      "$@" \
      opencode serve --port 4098 --hostname 127.0.0.1
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep 1
  fi
  attempt=$((attempt + 1))
done

echo "ERROR: authenticated API readiness did not pass before OpenCode start"
exit 1
