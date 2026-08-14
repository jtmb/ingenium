#!/bin/sh
# docker-entrypoint.sh — Ingenium container bootstrap
#
# Key design decisions:
# - Uses POSIX `sh` to keep bootstrap dependencies limited to the slim runtime image
# - Deliberately omits `-o pipefail` since `sh` doesn't support it;
#   commands use explicit `|| true` for error tolerance instead
# - One-shot setup completes before supervisord starts
# - Supervisord is exec'd so it receives container lifecycle signals as PID 1
set -eu

# VAULT-101: this must run as root before any supervised API process exists.
# The validator creates only its exact tmpfs child and never enumerates secrets.
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: vault job secret root provisioning requires root"
  exit 1
fi

TRUSTED_ARTIFACT_UID_FILE="/usr/local/share/ingenium/appuser-uid"
TRUSTED_ARTIFACT_GID_FILE="/usr/local/share/ingenium/appuser-gid"
if [ -L "$TRUSTED_ARTIFACT_UID_FILE" ] || [ ! -f "$TRUSTED_ARTIFACT_UID_FILE" ] || [ -L "$TRUSTED_ARTIFACT_GID_FILE" ] || [ ! -f "$TRUSTED_ARTIFACT_GID_FILE" ] \
  || [ "$(stat -c '%a:%U:%G' "$TRUSTED_ARTIFACT_UID_FILE")" != "444:root:root" ] || [ "$(stat -c '%a:%U:%G' "$TRUSTED_ARTIFACT_GID_FILE")" != "444:root:root" ]; then
  echo "ERROR: immutable appuser UID source is invalid"
  exit 1
fi
TRUSTED_ARTIFACT_UID="$(cat "$TRUSTED_ARTIFACT_UID_FILE")"
TRUSTED_ARTIFACT_GID="$(cat "$TRUSTED_ARTIFACT_GID_FILE")"
case "$TRUSTED_ARTIFACT_UID:$TRUSTED_ARTIFACT_GID" in
  *[!0-9:]*|:*|*:) echo "ERROR: immutable appuser UID source is invalid"; exit 1 ;;
esac
if [ "$TRUSTED_ARTIFACT_UID" != "$(id -u appuser)" ] || [ "$TRUSTED_ARTIFACT_GID" != "$(id -g appuser)" ]; then
  echo "ERROR: immutable appuser UID source does not match appuser"
  exit 1
fi
export INGENIUM_TRUSTED_ARTIFACT_UID="$TRUSTED_ARTIFACT_UID"
export INGENIUM_TRUSTED_ARTIFACT_GID="$TRUSTED_ARTIFACT_GID"
/app/scripts/validate-vault-job-secret-root.sh provision

# RESTORE-100: keep the backup signing key beside persistent application data,
# never inside the backup tree. The path is deliberately one direct child so
# root can validate every parent component without following a symlink.
BACKUP_SIGNING_KEY_FILE="${INGENIUM_BACKUP_SIGNING_KEY_FILE:-/app/.ingenium/backup-signing-key}"
BACKUP_SIGNING_KEY_PARENT="$(dirname "$BACKUP_SIGNING_KEY_FILE")"
case "$BACKUP_SIGNING_KEY_FILE" in
  /app/.ingenium/*) ;;
  *)
    echo "ERROR: INGENIUM_BACKUP_SIGNING_KEY_FILE must be a direct file below /app/.ingenium"
    exit 1
    ;;
esac
if [ "$BACKUP_SIGNING_KEY_PARENT" != "/app/.ingenium" ] || [ "$BACKUP_SIGNING_KEY_FILE" = "/app/.ingenium/backups" ]; then
  echo "ERROR: backup signing key must be outside backups and directly below /app/.ingenium"
  exit 1
fi
if [ -L /app/.ingenium ]; then
  echo "ERROR: backup signing-key parent must not be a symbolic link"
  exit 1
fi
mkdir -p /app/.ingenium
if [ ! -d /app/.ingenium ] || [ -L /app/.ingenium ]; then
  echo "ERROR: backup signing-key parent must be a real directory"
  exit 1
fi
# A fresh named volume contains no SQLite file, while the API starts as appuser
# after this parent becomes root-owned and non-writable. Publish the fixed file
# before dropping that write access; never follow or replace a final-path link.
CORE_DB_PATH="/app/.ingenium/data"
if [ -L "$CORE_DB_PATH" ] || { [ -e "$CORE_DB_PATH" ] && [ ! -f "$CORE_DB_PATH" ]; }; then
  echo "ERROR: core database path must be a regular non-symlink file"
  exit 1
fi
if [ ! -e "$CORE_DB_PATH" ]; then
  core_db_tmp="$(mktemp /app/.ingenium/.data.XXXXXX)"
  trap 'rm -f "$core_db_tmp"' EXIT HUP INT TERM
  chown appuser:appuser "$core_db_tmp"
  chmod 0600 "$core_db_tmp"
  if ! ln "$core_db_tmp" "$CORE_DB_PATH"; then
    rm -f "$core_db_tmp"
    trap - EXIT HUP INT TERM
    if [ -L "$CORE_DB_PATH" ] || [ ! -f "$CORE_DB_PATH" ]; then
      echo "ERROR: core database publication failed"
      exit 1
    fi
  else
    rm -f "$core_db_tmp"
    trap - EXIT HUP INT TERM
  fi
fi
# A WAL database needs its sibling files before the parent becomes root-owned.
# Initializing as the future runtime user also applies the complete migration
# inventory to a fresh named volume instead of leaving an empty SQLite file.
if ! runuser -u appuser -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  INGENIUM_CORE_DB_PATH="$CORE_DB_PATH" \
  node --input-type=module -e 'import { getDb } from "ingenium-core"; getDb();'; then
  echo "ERROR: core database initialization failed"
  exit 1
fi
# SQLite needs the WAL/SHM siblings to survive after this parent stops being
# appuser-writable. Publish empty regular files now; SQLite owns their contents.
for sidecar in "$CORE_DB_PATH-wal" "$CORE_DB_PATH-shm"; do
  if [ -L "$sidecar" ] || { [ -e "$sidecar" ] && [ ! -f "$sidecar" ]; }; then
    echo "ERROR: core database sidecar must be a regular non-symlink file"
    exit 1
  fi
  if [ ! -e "$sidecar" ]; then
    sidecar_tmp="$(mktemp /app/.ingenium/.data-sidecar.XXXXXX)"
    trap 'rm -f "$sidecar_tmp"' EXIT HUP INT TERM
    chown appuser:appuser "$sidecar_tmp"
    chmod 0600 "$sidecar_tmp"
    if ! ln "$sidecar_tmp" "$sidecar"; then
      rm -f "$sidecar_tmp"
      trap - EXIT HUP INT TERM
      if [ -L "$sidecar" ] || [ ! -f "$sidecar" ]; then
        echo "ERROR: core database sidecar publication failed"
        exit 1
      fi
    else
      rm -f "$sidecar_tmp"
      trap - EXIT HUP INT TERM
    fi
  fi
done
# Project resources are created by the API after startup; reserve a writable
# child before the maintenance parent is locked down.
PROJECTS_DIR="/app/.ingenium/projects"
if [ -L "$PROJECTS_DIR" ] || { [ -e "$PROJECTS_DIR" ] && [ ! -d "$PROJECTS_DIR" ]; }; then
  echo "ERROR: projects root must be a real non-symlink directory"
  exit 1
fi
mkdir -p "$PROJECTS_DIR"
chown appuser:appuser "$PROJECTS_DIR"
chmod 0700 "$PROJECTS_DIR"
# Backups are published by the API and cannot create their root after the
# maintenance parent becomes root-owned.
BACKUPS_DIR="/app/.ingenium/backups"
if [ -L "$BACKUPS_DIR" ] || { [ -e "$BACKUPS_DIR" ] && [ ! -d "$BACKUPS_DIR" ]; }; then
  echo "ERROR: backups root must be a real non-symlink directory"
  exit 1
fi
mkdir -p "$BACKUPS_DIR"
chown appuser:appuser "$BACKUPS_DIR"
chmod 0700 "$BACKUPS_DIR"
# SQLite may create or replace journal siblings after a restore. The sticky bit
# lets appuser do that without allowing it to unlink root-owned maintenance state.
chown root:appuser /app/.ingenium
chmod 1770 /app/.ingenium
if [ -L "$BACKUP_SIGNING_KEY_FILE" ] || { [ -e "$BACKUP_SIGNING_KEY_FILE" ] && [ ! -f "$BACKUP_SIGNING_KEY_FILE" ]; }; then
  echo "ERROR: backup signing key must be a regular non-symlink file"
  exit 1
fi
if [ ! -e "$BACKUP_SIGNING_KEY_FILE" ]; then
  backup_key_tmp="$(mktemp /app/.ingenium/.backup-signing-key.XXXXXX)"
  trap 'rm -f "$backup_key_tmp"' EXIT HUP INT TERM
  umask 077
  dd if=/dev/urandom of="$backup_key_tmp" bs=32 count=1
  chown appuser:appuser "$backup_key_tmp"
  chmod 0600 "$backup_key_tmp"
  # link(2) fails rather than replacing an unexpected final path, so it does
  # not follow a late symlink or clobber a concurrently provisioned key.
  if ! ln "$backup_key_tmp" "$BACKUP_SIGNING_KEY_FILE"; then
    rm -f "$backup_key_tmp"
    trap - EXIT HUP INT TERM
    if [ -L "$BACKUP_SIGNING_KEY_FILE" ] || [ ! -f "$BACKUP_SIGNING_KEY_FILE" ]; then
      echo "ERROR: backup signing key publication failed"
      exit 1
    fi
  else
    rm -f "$backup_key_tmp"
    trap - EXIT HUP INT TERM
  fi
fi
backup_key_metadata="$(stat -c '%a:%U:%G' "$BACKUP_SIGNING_KEY_FILE")"
backup_key_bytes="$(wc -c < "$BACKUP_SIGNING_KEY_FILE")"
if [ "$backup_key_metadata" != "600:appuser:appuser" ] || [ "$backup_key_bytes" -lt 32 ]; then
  echo "ERROR: backup signing key must be appuser-owned mode 0600 with at least 32 bytes"
  exit 1
fi
export INGENIUM_BACKUP_SIGNING_KEY_FILE="$BACKUP_SIGNING_KEY_FILE"

# RESTORE-100 stages verified copies outside the mutable backup-source tree.
RESTORE_STAGING_DIR="${INGENIUM_RESTORE_STAGING_DIR:-/app/.ingenium/restore-staging}"
RESTORE_STAGING_PARENT="$(dirname "$RESTORE_STAGING_DIR")"
case "$RESTORE_STAGING_DIR" in
  /app/.ingenium/*) ;;
  *)
    echo "ERROR: INGENIUM_RESTORE_STAGING_DIR must be a direct directory below /app/.ingenium"
    exit 1
    ;;
esac
if [ "$RESTORE_STAGING_PARENT" != "/app/.ingenium" ] || [ "$RESTORE_STAGING_DIR" = "/app/.ingenium/backups" ] || [ "$RESTORE_STAGING_DIR" = "$BACKUP_SIGNING_KEY_FILE" ]; then
  echo "ERROR: restore staging must be a separate direct directory outside backups and the signing key"
  exit 1
fi
if [ -L "$RESTORE_STAGING_DIR" ] || { [ -e "$RESTORE_STAGING_DIR" ] && [ ! -d "$RESTORE_STAGING_DIR" ]; }; then
  echo "ERROR: restore staging must be a real non-symlink directory"
  exit 1
fi
mkdir -p "$RESTORE_STAGING_DIR"
chmod 0700 "$RESTORE_STAGING_DIR"
export INGENIUM_RESTORE_STAGING_DIR="$RESTORE_STAGING_DIR"

# RESTORE-101 journal state is intentionally separate from the backup HMAC
# key. Only the root static maintenance program can read it or write journals.
if [ -n "${INGENIUM_RESTORE_MAINTENANCE_DIR:-}" ] || { [ -n "${INGENIUM_RESTORE_JOURNAL_KEY_FILE:-}" ] && [ "${INGENIUM_RESTORE_JOURNAL_KEY_FILE}" != "/app/.ingenium/restore-journal-key" ]; }; then
  echo "ERROR: restore maintenance paths are fixed image paths"
  exit 1
fi
RESTORE_MAINTENANCE_DIR="/app/.ingenium/restore-maintenance"
RESTORE_JOURNAL_KEY_FILE="/app/.ingenium/restore-journal-key"
if [ -L "$RESTORE_MAINTENANCE_DIR" ] || { [ -e "$RESTORE_MAINTENANCE_DIR" ] && [ ! -d "$RESTORE_MAINTENANCE_DIR" ]; }; then
  echo "ERROR: restore maintenance root must be a real non-symlink directory"
  exit 1
fi
mkdir -p "$RESTORE_MAINTENANCE_DIR"
chown root:root "$RESTORE_MAINTENANCE_DIR"
chmod 0700 "$RESTORE_MAINTENANCE_DIR"
if [ -L "$RESTORE_JOURNAL_KEY_FILE" ] || { [ -e "$RESTORE_JOURNAL_KEY_FILE" ] && [ ! -f "$RESTORE_JOURNAL_KEY_FILE" ]; }; then
  echo "ERROR: restore journal key must be a regular non-symlink file"
  exit 1
fi
if [ ! -e "$RESTORE_JOURNAL_KEY_FILE" ]; then
  journal_key_tmp="$(mktemp /app/.ingenium/.restore-journal-key.XXXXXX)"
  trap 'rm -f "$journal_key_tmp"' EXIT HUP INT TERM
  umask 077
  dd if=/dev/urandom of="$journal_key_tmp" bs=32 count=1
  chown root:root "$journal_key_tmp"
  chmod 0600 "$journal_key_tmp"
  if ! ln "$journal_key_tmp" "$RESTORE_JOURNAL_KEY_FILE"; then
    rm -f "$journal_key_tmp"
    trap - EXIT HUP INT TERM
    if [ -L "$RESTORE_JOURNAL_KEY_FILE" ] || [ ! -f "$RESTORE_JOURNAL_KEY_FILE" ]; then
      echo "ERROR: restore journal key publication failed"
      exit 1
    fi
  else
    rm -f "$journal_key_tmp"
    trap - EXIT HUP INT TERM
  fi
fi
journal_key_metadata="$(stat -c '%a:%U:%G' "$RESTORE_JOURNAL_KEY_FILE")"
journal_key_bytes="$(wc -c < "$RESTORE_JOURNAL_KEY_FILE")"
if [ "$journal_key_metadata" != "600:root:root" ] || [ "$journal_key_bytes" -lt 32 ]; then
  echo "ERROR: restore journal key must be root-owned mode 0600 with at least 32 bytes"
  exit 1
fi
export INGENIUM_RESTORE_JOURNAL_KEY_FILE="$RESTORE_JOURNAL_KEY_FILE"

# Resolve any signed interrupted maintenance journal before Supervisor can start
# DB users. A malformed journal fails closed: no API/OpenCode/ttyd/VS Code user
# process starts, and the helper emits only a bounded diagnostic code.
if ! /app/scripts/recover-restore-maintenance.sh; then
  echo "ERROR: restore maintenance recovery refused startup"
  exit 1
fi

# SECURITY: Require the server-side credential used by API OpenCode proxy routes.
# Browser-facing OpenCode children clear this variable and remain behind the
# private gateway upstreams.
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

# HACK: chown errors are suppressed (2>/dev/null || true) because the
# container may run as non-root in some environments (e.g. OpenShift);
# the directories themselves are the critical requirement, ownership
# is best-effort
for dir in /app/.ingenium /app/.ingenium/logs /app/.opencode/skills /home/appuser/.config/opencode /home/appuser/.config/opencode/agents /home/appuser/.local/share/opencode/log; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
  fi
done
chown -R appuser:appuser /app/.opencode /home/appuser 2>/dev/null || true
for dir in /app/.ingenium/data /app/.ingenium/backups /app/.ingenium/restore-staging /app/.ingenium/logs; do
  if [ -e "$dir" ]; then
    chown -R appuser:appuser "$dir"
  fi
done
chown root:appuser /app/.ingenium
chmod 1770 /app/.ingenium
chown root:root "$RESTORE_MAINTENANCE_DIR" "$RESTORE_JOURNAL_KEY_FILE"
chmod 0700 "$RESTORE_MAINTENANCE_DIR"
chmod 0600 "$RESTORE_JOURNAL_KEY_FILE"

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
        "INGENIUM_MCP_CREDENTIAL": "{file:.opencode/.ingenium-mcp-credential}",
        "INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential",
        "INGENIUM_MCP_AUDIENCE": "mcp",
        "INGENIUM_PROJECT": "global-default",
        "INGENIUM_WORKSPACE_ID": "global-default-workspace",
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
OCEOF
  echo "Seeded OpenCode config with Ingenium MCP"
fi
# Vault-backed child runs copy this provider-bearing config into tmpfs only when
# it is owner-private. The persistent OpenCode server still reads the same file.
chown appuser:appuser "$OC_CONFIG"
chmod 0600 "$OC_CONFIG"

OC_AUTH="/home/appuser/.local/share/opencode/auth.json"
if [ -L "$OC_AUTH" ] || { [ -e "$OC_AUTH" ] && [ ! -f "$OC_AUTH" ]; }; then
  echo "ERROR: OpenCode auth path must be a regular non-symlink file"
  exit 1
fi
if [ -f "$OC_AUTH" ]; then
  chown appuser:appuser "$OC_AUTH"
  chmod 0600 "$OC_AUTH"
fi

# The global config lives on a persistent volume and may predate protected token
# files or the unified resource-sync plugin. Project the container-owned entries
# on every start while preserving unrelated operator configuration.
runuser -u appuser -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  node /app/scripts/project-opencode-global-config.mjs "$OC_CONFIG"

# OpenCode receives only separately issued scoped credentials. Remove the
# historical installation-token copy after proving it is the known runtime
# credential; never overwrite an operator-issued scoped credential.
WORKSPACE_OPENCODE_DIR="/workspace/.opencode"
LEGACY_WORKSPACE_TOKEN_FILE="${WORKSPACE_OPENCODE_DIR}/.ingenium-api-token"
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
if [ -e "$LEGACY_WORKSPACE_TOKEN_FILE" ] || [ -L "$LEGACY_WORKSPACE_TOKEN_FILE" ]; then
  if [ -L "$LEGACY_WORKSPACE_TOKEN_FILE" ] || [ ! -f "$LEGACY_WORKSPACE_TOKEN_FILE" ] \
    || ! cmp -s "$RUNTIME_API_TOKEN_FILE" "$LEGACY_WORKSPACE_TOKEN_FILE"; then
    echo "ERROR: legacy OpenCode API token path is unsafe or unrecognized"
    exit 1
  fi
  rm -f "$LEGACY_WORKSPACE_TOKEN_FILE"
fi

# Project the two server-owned profiles into OpenCode's persistent global
# discovery directory. OpenCode runs from /workspace but loads its persisted
# global config from /home/appuser/.config/opencode; keeping these copies global
# makes the chat and broker profiles discoverable without overwriting operator
# profiles. The containing directory is created before the recursive ownership
# repair above so a persisted opencode-config volume remains writable by appuser.
GLOBAL_AGENTS_DIR="/home/appuser/.config/opencode/agents"
if [ -L "$GLOBAL_AGENTS_DIR" ] || { [ -e "$GLOBAL_AGENTS_DIR" ] && [ ! -d "$GLOBAL_AGENTS_DIR" ]; }; then
  echo "ERROR: OpenCode global agents directory must be a real directory"
  exit 1
fi
mkdir -p "$GLOBAL_AGENTS_DIR"
chmod 0700 "$GLOBAL_AGENTS_DIR"
/app/scripts/normalize-agent-profiles.sh --project-server-owned /app/.opencode/agents "$GLOBAL_AGENTS_DIR"

# Copy all agent profiles to the workspace before OpenCode starts. OpenCode scans its
# worktree's .opencode/agents/ directory, while the source agents live in /app.
# The orchestrator-based topology includes primary, execution, research, security,
# and chat agent profiles — all copied flat into the workspace for discovery.
WORKSPACE_AGENTS_DIR="${WORKSPACE_OPENCODE_DIR}/agents"
if [ -L "$WORKSPACE_AGENTS_DIR" ] || { [ -e "$WORKSPACE_AGENTS_DIR" ] && [ ! -d "$WORKSPACE_AGENTS_DIR" ]; }; then
  echo "ERROR: OpenCode workspace agents directory must be a real directory"
  exit 1
fi
mkdir -p "$WORKSPACE_AGENTS_DIR"
copy_agent_profile() {
  source_profile="$1"
  target_profile="${WORKSPACE_AGENTS_DIR}/$(basename "$source_profile")"
  if [ -L "$target_profile" ] || { [ -e "$target_profile" ] && [ ! -f "$target_profile" ]; }; then
    echo "ERROR: OpenCode workspace agent profile must be a regular non-symlink file"
    exit 1
  fi
  cp "$source_profile" "$target_profile"
}
copy_agent_profile /app/.opencode/agents/chat/ingenium-chat.md
for dir in primary execution research security; do
  for source_profile in /app/.opencode/agents/$dir/*.md; do
    [ -f "$source_profile" ] || continue
    copy_agent_profile "$source_profile"
  done
done
# Mounted repositories can retain historical root-owned mode-0600 profiles.
# Repair only regular non-symlink Markdown profiles before appuser runs
# repository initialization; secrets and configuration stay untouched.
/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"

# Refuse to start if a templating or package change made the gateway unsafe.
# Validate as the supervised Nginx user so validation cannot leave root-owned
# PID, lock, temp, or log artifacts in the shared runtime directory.
runuser -u appuser -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  /app/scripts/validate-gateway-config.sh

# Start supervisord as PID 1 after all startup setup has completed.
exec supervisord -c /app/supervisord.conf
