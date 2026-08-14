#!/bin/sh
# Start the sole upstream-token-bearing service with an explicit allowlist.
# Supervisor inherits the container environment, so each child must clear it itself.
set -eu

token_file="${INGENIUM_API_TOKEN_FILE:-/run/ingenium-secrets/api-token}"
backup_dir="${INGENIUM_BACKUPS_DIR:-}"
backup_signing_key_file="${INGENIUM_BACKUP_SIGNING_KEY_FILE:-/app/.ingenium/backup-signing-key}"
restore_staging_dir="${INGENIUM_RESTORE_STAGING_DIR:-}"
trusted_artifact_uid="$(cat /usr/local/share/ingenium/appuser-uid)"
trusted_artifact_gid="$(cat /usr/local/share/ingenium/appuser-gid)"
deployment_mode="${INGENIUM_DEPLOYMENT_MODE:?INGENIUM_DEPLOYMENT_MODE is required}"

case "$trusted_artifact_uid:$trusted_artifact_gid" in
  *[!0-9:]*|:*|*:) exit 64 ;;
esac
case "$deployment_mode" in
  compatibility|control-plane) ;;
  *) echo "ERROR: INGENIUM_DEPLOYMENT_MODE is invalid"; exit 64 ;;
esac

if [ "$deployment_mode" = "control-plane" ]; then
  : "${INGENIUM_RUNTIME_MANAGER_URL:?INGENIUM_RUNTIME_MANAGER_URL is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_MANAGER_TOKEN_FILE:?INGENIUM_RUNTIME_MANAGER_TOKEN_FILE is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE:?INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_ROOT_DOMAIN:?INGENIUM_RUNTIME_ROOT_DOMAIN is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS:?INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER:?INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_CPU_MILLIS:?INGENIUM_RUNTIME_CPU_MILLIS is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_MEMORY_BYTES:?INGENIUM_RUNTIME_MEMORY_BYTES is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_PIDS_LIMIT:?INGENIUM_RUNTIME_PIDS_LIMIT is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_DISK_BYTES:?INGENIUM_RUNTIME_DISK_BYTES is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_PROCESS_LIMIT:?INGENIUM_RUNTIME_PROCESS_LIMIT is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_IDLE_LEASE_MS:?INGENIUM_RUNTIME_IDLE_LEASE_MS is required in control-plane mode}"
  : "${INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS:?INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS is required in control-plane mode}"
fi

# An empty Compose interpolation or whitespace-only operator override is unset.
case "$backup_dir" in
  *[![:space:]]*) ;;
  *) backup_dir="/app/.ingenium/backups" ;;
esac
case "$restore_staging_dir" in
  *[![:space:]]*) ;;
  *) restore_staging_dir="/app/.ingenium/restore-staging" ;;
esac

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  NODE_ENV="production" \
  TZ="${TZ:-UTC}" \
  INGENIUM_DEPLOYMENT_MODE="$deployment_mode" \
  INGENIUM_HOME="/app/.ingenium" \
  INGENIUM_CORE_DB_PATH="/app/.ingenium/data" \
  INGENIUM_GLOBAL_CONFIG_PATH="/home/appuser/.config/opencode" \
  INGENIUM_DOCS_ROOT="${INGENIUM_DOCS_ROOT:-}" \
  INGENIUM_BACKUPS_DIR="$backup_dir" \
  INGENIUM_BACKUP_SIGNING_KEY_FILE="$backup_signing_key_file" \
  INGENIUM_RESTORE_STAGING_DIR="$restore_staging_dir" \
  INGENIUM_TRUSTED_ARTIFACT_UID="$trusted_artifact_uid" \
  INGENIUM_TRUSTED_ARTIFACT_GID="$trusted_artifact_gid" \
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
  INGENIUM_RUNTIME_MANAGER_URL="${INGENIUM_RUNTIME_MANAGER_URL:-}" \
  INGENIUM_RUNTIME_MANAGER_TOKEN_FILE="${INGENIUM_RUNTIME_MANAGER_TOKEN_FILE:-}" \
  INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE="${INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE:-}" \
  INGENIUM_RUNTIME_ROOT_DOMAIN="${INGENIUM_RUNTIME_ROOT_DOMAIN:-}" \
  INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS="${INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS:-15000}" \
  INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER="${INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER:-2}" \
  INGENIUM_RUNTIME_CPU_MILLIS="${INGENIUM_RUNTIME_CPU_MILLIS:-1000}" \
  INGENIUM_RUNTIME_MEMORY_BYTES="${INGENIUM_RUNTIME_MEMORY_BYTES:-1073741824}" \
  INGENIUM_RUNTIME_PIDS_LIMIT="${INGENIUM_RUNTIME_PIDS_LIMIT:-256}" \
  INGENIUM_RUNTIME_DISK_BYTES="${INGENIUM_RUNTIME_DISK_BYTES:-2147483648}" \
  INGENIUM_RUNTIME_PROCESS_LIMIT="${INGENIUM_RUNTIME_PROCESS_LIMIT:-128}" \
  INGENIUM_RUNTIME_IDLE_LEASE_MS="${INGENIUM_RUNTIME_IDLE_LEASE_MS:-1800000}" \
  INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS="${INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS:-28800000}" \
  SYNTHESIS_INTERVAL_MS="${SYNTHESIS_INTERVAL_MS:-900000}" \
  node dist/scripts/api-server.js
