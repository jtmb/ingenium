#!/bin/sh
# Stable container launcher for repository initialization. The OpenCode runtime
# clears inherited credentials, so this wrapper supplies only non-secret paths
# and an explicit container project identity to the packaged extension CLI.
set -eu

worktree="${INGENIUM_WORKTREE:-/workspace}"
project="${INGENIUM_PROJECT:-global-default}"
api_url="${INGENIUM_API_URL:-http://localhost:4097/api/v1}"
credential_file="${INGENIUM_MCP_CREDENTIAL_FILE:-.opencode/.ingenium-repository-sync-credential}"
workspace_id="${INGENIUM_WORKSPACE_ID:-global-default-workspace}"

if [ "$(id -u)" -eq 0 ]; then
  # Repair only public, regular agent profiles while still privileged. This
  # handles mode-0600 mounted files before the command drops to appuser.
  /app/scripts/normalize-agent-profiles.sh "$worktree/.opencode/agents"
  exec runuser -u appuser -- env -i \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    HOME="/home/appuser" \
    XDG_CONFIG_HOME="/home/appuser/.config" \
    XDG_DATA_HOME="/home/appuser/.local/share" \
    INGENIUM_WORKTREE="$worktree" \
    INGENIUM_PROJECT="$project" \
    INGENIUM_API_URL="$api_url" \
    INGENIUM_MCP_CREDENTIAL_FILE="$credential_file" \
    INGENIUM_MCP_AUDIENCE="repository-sync" \
    INGENIUM_WORKSPACE_ID="$workspace_id" \
    node /app/packages/ingenium-extension/dist/scripts/init-project.js "$@"
fi

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  XDG_DATA_HOME="/home/appuser/.local/share" \
  INGENIUM_WORKTREE="$worktree" \
  INGENIUM_PROJECT="$project" \
  INGENIUM_API_URL="$api_url" \
  INGENIUM_MCP_CREDENTIAL_FILE="$credential_file" \
  INGENIUM_MCP_AUDIENCE="repository-sync" \
  INGENIUM_WORKSPACE_ID="$workspace_id" \
  node /app/packages/ingenium-extension/dist/scripts/init-project.js "$@"
