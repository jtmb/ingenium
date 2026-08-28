#!/bin/sh
# Static dedicated-identity RESTORE-101 maintenance launcher. Supervisor supplies no argv.
set -eu

if [ "$(id -un)" != "ingenium-restore" ]; then
  echo "restore-maintenance requires ingenium-restore" >&2
  exit 64
fi

trusted_artifact_uid="$(cat /usr/local/share/ingenium/api-uid)"
trusted_artifact_gid="$(cat /usr/local/share/ingenium/restore-data-gid)"
case "$trusted_artifact_uid:$trusted_artifact_gid" in
  *[!0-9:]*|:*|*:) exit 64 ;;
esac

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-restore" \
  NODE_ENV="production" \
  INGENIUM_BACKUPS_DIR="/app/.ingenium/backups" \
  INGENIUM_BACKUP_SIGNING_KEY_FILE="/run/ingenium-secrets/restore/backup-signing-key" \
  INGENIUM_RESTORE_STAGING_DIR="/app/.ingenium/restore-staging" \
  INGENIUM_TRUSTED_ARTIFACT_UID="$trusted_artifact_uid" \
  INGENIUM_TRUSTED_ARTIFACT_GID="$trusted_artifact_gid" \
  INGENIUM_RESTORE_JOURNAL_KEY_FILE="/run/ingenium-secrets/restore/restore-journal-key" \
  INGENIUM_API_PORT="4096" \
  INGENIUM_RESTORE_MAINTENANCE_MODE="execute" \
  /usr/local/libexec/ingenium-restore-node /app/services/ingenium-api/dist/scripts/restore-maintenance.js
