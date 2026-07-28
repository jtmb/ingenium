#!/bin/sh
# Start the sole upstream-token-bearing service with an explicit allowlist.
# Supervisor inherits the container environment, so each child must clear it itself.
set -eu

token_file="${INGENIUM_API_TOKEN_FILE:-/run/ingenium-secrets/api-token}"
backup_dir="${INGENIUM_BACKUPS_DIR:-}"

# An empty Compose interpolation or whitespace-only operator override is unset.
case "$backup_dir" in
  *[![:space:]]*) ;;
  *) backup_dir="/app/.ingenium/backups" ;;
esac

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  NODE_ENV="production" \
  TZ="${TZ:-UTC}" \
  INGENIUM_HOME="/app/.ingenium" \
  INGENIUM_CORE_DB_PATH="/app/.ingenium/data" \
  INGENIUM_GLOBAL_CONFIG_PATH="/home/appuser/.config/opencode" \
  INGENIUM_DOCS_ROOT="${INGENIUM_DOCS_ROOT:-}" \
  INGENIUM_BACKUPS_DIR="$backup_dir" \
  INGENIUM_API_PORT="${INGENIUM_API_PORT:-4097}" \
  INGENIUM_API_RATE_LIMIT="${INGENIUM_API_RATE_LIMIT:-100}" \
  DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}" \
  OPENCODE_SERVER_URL="${OPENCODE_SERVER_URL:-http://127.0.0.1:4098}" \
  OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}" \
  OPENCODE_OAUTH_CALLBACK_FORWARD_URL="${OPENCODE_OAUTH_CALLBACK_FORWARD_URL:-http://127.0.0.1:4098/auth/callback}" \
  OPENCODE_DB_PATH="${OPENCODE_DB_PATH:-/home/appuser/.local/share/opencode/opencode.db}" \
  INGENIUM_OPENCODE_DB_PATH="${INGENIUM_OPENCODE_DB_PATH:-/var/opencode/opencode.db}" \
  INGENIUM_EMAIL_ENCRYPTION_KEY="${INGENIUM_EMAIL_ENCRYPTION_KEY:?INGENIUM_EMAIL_ENCRYPTION_KEY is required}" \
  GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}" \
  GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
  MS_OAUTH_CLIENT_ID="${MS_OAUTH_CLIENT_ID:-}" \
  MS_OAUTH_CLIENT_SECRET="${MS_OAUTH_CLIENT_SECRET:-}" \
  OAUTH_REDIRECT_URI="${OAUTH_REDIRECT_URI:-http://localhost:3000/mail/oauth/callback}" \
  INGENIUM_API_TOKEN_FILE="$token_file" \
  INGENIUM_API_URL="${INGENIUM_API_URL:-http://127.0.0.1:4097/api/v1}" \
  SYNTHESIS_INTERVAL_MS="${SYNTHESIS_INTERVAL_MS:-900000}" \
  node dist/scripts/api-server.js
