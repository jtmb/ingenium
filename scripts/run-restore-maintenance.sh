#!/bin/sh
# Static root-only RESTORE-101 maintenance launcher. Supervisor supplies no argv.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "restore-maintenance requires root" >&2
  exit 64
fi

trusted_artifact_uid="$(cat /usr/local/share/ingenium/appuser-uid)"
trusted_artifact_gid="$(cat /usr/local/share/ingenium/appuser-gid)"
case "$trusted_artifact_uid:$trusted_artifact_gid" in
  *[!0-9:]*|:*|*:) exit 64 ;;
esac

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/root" \
  NODE_ENV="production" \
  INGENIUM_BACKUPS_DIR="/app/.ingenium/backups" \
  INGENIUM_BACKUP_SIGNING_KEY_FILE="/app/.ingenium/backup-signing-key" \
  INGENIUM_RESTORE_STAGING_DIR="/app/.ingenium/restore-staging" \
  INGENIUM_TRUSTED_ARTIFACT_UID="$trusted_artifact_uid" \
  INGENIUM_TRUSTED_ARTIFACT_GID="$trusted_artifact_gid" \
  INGENIUM_RESTORE_JOURNAL_KEY_FILE="/app/.ingenium/restore-journal-key" \
  INGENIUM_API_PORT="4096" \
  INGENIUM_API_TOKEN_FILE="/run/ingenium-secrets/api-token" \
  INGENIUM_RESTORE_MAINTENANCE_MODE="execute" \
  node /app/services/ingenium-api/dist/scripts/restore-maintenance.js
