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

secure_persistent_path() {
  node - "$@" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [operation, target, uidText, gidText, directoryMode, fileMode = "-", excludedName = ""] = process.argv.slice(2);
const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const fileFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
const uid = uidText === "-" ? undefined : Number.parseInt(uidText, 10);
const gid = gidText === "-" ? undefined : Number.parseInt(gidText, 10);

function fail() {
  process.stderr.write(`ERROR: persistent path containment validation failed: ${target}\n`);
  process.exit(1);
}

function parseMode(value, metadata) {
  if (value === "-") return undefined;
  if (value === "user-only") return metadata.mode & 0o700;
  const mode = Number.parseInt(value, 8);
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) fail();
  return mode;
}

function sameObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function openDirectory(parentDescriptor, name, create) {
  const childPath = `/proc/self/fd/${parentDescriptor}/${name}`;
  let metadata;
  try {
    metadata = fs.lstatSync(childPath);
  } catch (error) {
    if (!create || error.code !== "ENOENT") fail();
    try {
      fs.mkdirSync(childPath, { mode: 0o700 });
      metadata = fs.lstatSync(childPath);
    } catch {
      fail();
    }
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail();
  let descriptor;
  try {
    descriptor = fs.openSync(childPath, directoryFlags);
  } catch {
    fail();
  }
  const opened = fs.fstatSync(descriptor);
  if (!opened.isDirectory() || !sameObject(metadata, opened)) fail();
  return descriptor;
}

function openRegularFile(parentDescriptor, name) {
  const childPath = `/proc/self/fd/${parentDescriptor}/${name}`;
  let metadata;
  let descriptor;
  try {
    metadata = fs.lstatSync(childPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail();
    descriptor = fs.openSync(childPath, fileFlags);
  } catch {
    fail();
  }
  const opened = fs.fstatSync(descriptor);
  if (!opened.isFile() || !sameObject(metadata, opened)) fail();
  return descriptor;
}

function verifyStillLinked(parentDescriptor, name, descriptor) {
  try {
    const linked = fs.lstatSync(`/proc/self/fd/${parentDescriptor}/${name}`);
    if (!sameObject(linked, fs.fstatSync(descriptor))) fail();
  } catch {
    fail();
  }
}

function applyMetadata(descriptor, modeSpec) {
  if (uid !== undefined || gid !== undefined) {
    const metadata = fs.fstatSync(descriptor);
    fs.fchownSync(descriptor, uid ?? metadata.uid, gid ?? metadata.gid);
  }
  const mode = parseMode(modeSpec, fs.fstatSync(descriptor));
  if (mode !== undefined) fs.fchmodSync(descriptor, mode);
  const metadata = fs.fstatSync(descriptor);
  if ((uid !== undefined && metadata.uid !== uid) || (gid !== undefined && metadata.gid !== gid)
    || (mode !== undefined && (metadata.mode & 0o7777) !== mode)) fail();
}

function validatePackageBinLink(parentDescriptor, name, metadata, rootDevice, relative) {
  const childRelative = relative ? `${relative}/${name}` : name;
  if (path.basename(target) !== ".config" || !/^opencode\/node_modules\/\.bin\/[^/]+$/.test(childRelative)) fail();
  const childPath = `/proc/self/fd/${parentDescriptor}/${name}`;
  try {
    const linkTarget = fs.readlinkSync(childPath);
    const modulesRoot = fs.realpathSync(path.join(target, "opencode/node_modules"));
    const resolvedTarget = fs.realpathSync(childPath);
    const resolvedMetadata = fs.statSync(childPath);
    if (path.isAbsolute(linkTarget) || !resolvedTarget.startsWith(`${modulesRoot}${path.sep}`)
      || !resolvedMetadata.isFile() || resolvedMetadata.dev !== rootDevice) fail();
    if (uid !== undefined || gid !== undefined) {
      fs.lchownSync(childPath, uid ?? metadata.uid, gid ?? metadata.gid);
    }
    const linked = fs.lstatSync(childPath);
    if (!sameObject(metadata, linked) || (uid !== undefined && linked.uid !== uid)
      || (gid !== undefined && linked.gid !== gid)) fail();
  } catch {
    fail();
  }
}

function walkTree(descriptor, rootDevice, relative = "") {
  const directoryPath = `/proc/self/fd/${descriptor}`;
  for (const name of fs.readdirSync(directoryPath)) {
    if (!relative && name === excludedName) continue;
    const childPath = `${directoryPath}/${name}`;
    const metadata = fs.lstatSync(childPath);
    if (metadata.dev !== rootDevice) fail();
    if (metadata.isSymbolicLink()) {
      validatePackageBinLink(descriptor, name, metadata, rootDevice, relative);
    } else if (metadata.isDirectory()) {
      const child = openDirectory(descriptor, name, false);
      walkTree(child, rootDevice, relative ? `${relative}/${name}` : name);
      applyMetadata(child, directoryMode);
      verifyStillLinked(descriptor, name, child);
      fs.closeSync(child);
    } else if (metadata.isFile()) {
      const child = openRegularFile(descriptor, name);
      applyMetadata(child, fileMode);
      verifyStillLinked(descriptor, name, child);
      fs.closeSync(child);
    } else {
      fail();
    }
  }
}

if (process.platform !== "linux" || !fs.constants.O_NOFOLLOW || !fs.constants.O_DIRECTORY
  || !path.isAbsolute(target) || path.resolve(target) !== target || target === "/"
  || !["directory", "file", "tree"].includes(operation)
  || (uid !== undefined && !Number.isInteger(uid)) || (gid !== undefined && !Number.isInteger(gid))) fail();

const components = target.split("/").filter(Boolean);
const finalName = components.pop();
let parent = fs.openSync("/", directoryFlags);
for (const component of components) {
  const child = openDirectory(parent, component, false);
  fs.closeSync(parent);
  parent = child;
}

const targetDescriptor = operation === "file"
  ? openRegularFile(parent, finalName)
  : openDirectory(parent, finalName, operation === "directory");
if (operation === "tree") walkTree(targetDescriptor, fs.fstatSync(targetDescriptor).dev);
applyMetadata(targetDescriptor, directoryMode);
verifyStillLinked(parent, finalName, targetDescriptor);
fs.closeSync(targetDescriptor);
fs.closeSync(parent);
NODE
}

DEPLOYMENT_MODE="${INGENIUM_DEPLOYMENT_MODE:-compatibility}"
case "$DEPLOYMENT_MODE" in
  compatibility|control-plane) ;;
  *) echo "ERROR: INGENIUM_DEPLOYMENT_MODE must be compatibility or control-plane"; exit 1 ;;
esac
export INGENIUM_DEPLOYMENT_MODE="$DEPLOYMENT_MODE"

# VAULT-101: this must run as root before any supervised API process exists.
# The validator creates only its exact tmpfs child and never enumerates secrets.
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: vault job secret root provisioning requires root"
  exit 1
fi

node /app/scripts/validate-root-entrypoint-chain.mjs

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
/app/scripts/validate-vault-job-secret-root.sh provision /dev/shm/ingenium-job-secrets "$(id -u ingenium-api)" "$(id -g ingenium-api)"

API_UID="$(cat /usr/local/share/ingenium/api-uid)"
API_GID="$(cat /usr/local/share/ingenium/api-gid)"
DASHBOARD_UID="$(cat /usr/local/share/ingenium/dashboard-uid)"
DASHBOARD_GID="$(cat /usr/local/share/ingenium/dashboard-gid)"
OPENCODE_UID="$(cat /usr/local/share/ingenium/opencode-uid)"
OPENCODE_GID="$(cat /usr/local/share/ingenium/opencode-gid)"
RESTORE_UID="$(cat /usr/local/share/ingenium/restore-uid)"
RESTORE_GID="$(cat /usr/local/share/ingenium/restore-gid)"
RESTORE_DATA_GID="$(cat /usr/local/share/ingenium/restore-data-gid)"
OPENCODE_CONFIG_GID="$(getent group ingenium-opencode-config | cut -d: -f3)"
VSCODE_UID="$(id -u ingenium-vscode)"
VSCODE_GID="$(id -g ingenium-vscode)"
for identity in "$API_UID:$API_GID" "$DASHBOARD_UID:$DASHBOARD_GID" "$OPENCODE_UID:$OPENCODE_GID" "$RESTORE_UID:$RESTORE_GID" "$RESTORE_DATA_GID:$OPENCODE_CONFIG_GID" "$VSCODE_UID:$VSCODE_GID"; do
  case "$identity" in *[!0-9:]*|:*|*:) echo "ERROR: immutable service identity is invalid"; exit 1 ;; esac
done

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
secure_persistent_path directory /app/.ingenium "$API_UID" "$RESTORE_DATA_GID" 2770
secure_persistent_path tree /app/.ingenium "$API_UID" "$RESTORE_DATA_GID" - -
# Signed bundles enforce stricter per-artifact modes and must survive restarts unchanged.
secure_persistent_path tree /app/.ingenium "$API_UID" "$RESTORE_DATA_GID" 2770 0660 backups
secure_persistent_path directory /app/.ingenium "$RESTORE_UID" "$RESTORE_DATA_GID" 3770
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
  secure_persistent_path file "$core_db_tmp" "$API_UID" "$RESTORE_DATA_GID" 0660
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
if ! runuser -u ingenium-api -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-api" \
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
    secure_persistent_path file "$sidecar_tmp" "$API_UID" "$RESTORE_DATA_GID" 0660
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
secure_persistent_path file "$CORE_DB_PATH" "$API_UID" "$RESTORE_DATA_GID" 0660
secure_persistent_path file "$CORE_DB_PATH-wal" "$API_UID" "$RESTORE_DATA_GID" 0660
secure_persistent_path file "$CORE_DB_PATH-shm" "$API_UID" "$RESTORE_DATA_GID" 0660
# Project resources are created by the API after startup; reserve a writable
# child before the maintenance parent is locked down.
PROJECTS_DIR="/app/.ingenium/projects"
secure_persistent_path directory "$PROJECTS_DIR" "$API_UID" "$API_GID" 0700
# Backups are published by the API and cannot create their root after the
# maintenance parent becomes root-owned.
BACKUPS_DIR="/app/.ingenium/backups"
secure_persistent_path directory "$BACKUPS_DIR" "$API_UID" "$RESTORE_DATA_GID" 2770
# SQLite may create or replace journal siblings after a restore. The sticky bit
# lets appuser do that without allowing it to unlink root-owned maintenance state.
secure_persistent_path directory /app/.ingenium "$RESTORE_UID" "$RESTORE_DATA_GID" 3770
if [ -L "$BACKUP_SIGNING_KEY_FILE" ] || { [ -e "$BACKUP_SIGNING_KEY_FILE" ] && [ ! -f "$BACKUP_SIGNING_KEY_FILE" ]; }; then
  echo "ERROR: backup signing key must be a regular non-symlink file"
  exit 1
fi
if [ ! -e "$BACKUP_SIGNING_KEY_FILE" ]; then
  backup_key_tmp="$(mktemp /app/.ingenium/.backup-signing-key.XXXXXX)"
  trap 'rm -f "$backup_key_tmp"' EXIT HUP INT TERM
  umask 077
  dd if=/dev/urandom of="$backup_key_tmp" bs=32 count=1
  secure_persistent_path file "$backup_key_tmp" 0 0 0600
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
secure_persistent_path file "$BACKUP_SIGNING_KEY_FILE" 0 0 0600
backup_key_metadata="$(stat -c '%a:%U:%G' "$BACKUP_SIGNING_KEY_FILE")"
if [ "$backup_key_metadata" != "600:root:root" ] || [ "$backup_key_bytes" -lt 32 ]; then
  echo "ERROR: backup signing key must be root-owned mode 0600 with at least 32 bytes"
  exit 1
fi
export INGENIUM_BACKUP_SIGNING_KEY_FILE="$BACKUP_SIGNING_KEY_FILE"

AUTH_ENCRYPTION_KEY_FILE="${INGENIUM_AUTH_ENCRYPTION_KEY_FILE:-/app/.ingenium/auth-encryption-key}"
AUTH_ENCRYPTION_KEY_PARENT="$(dirname "$AUTH_ENCRYPTION_KEY_FILE")"
case "$AUTH_ENCRYPTION_KEY_FILE" in
  /app/.ingenium/*) ;;
  *) echo "ERROR: auth encryption key path must be directly below /app/.ingenium"; exit 1 ;;
esac
if [ "$AUTH_ENCRYPTION_KEY_PARENT" != "/app/.ingenium" ] || [ "$AUTH_ENCRYPTION_KEY_FILE" = "$BACKUP_SIGNING_KEY_FILE" ]; then
  echo "ERROR: auth encryption key path is invalid"
  exit 1
fi
if [ -e "$AUTH_ENCRYPTION_KEY_FILE" ]; then
  secure_persistent_path file "$AUTH_ENCRYPTION_KEY_FILE" 0 0 0600
fi
/app/scripts/provision-auth-encryption-key.sh "$AUTH_ENCRYPTION_KEY_FILE" root root
export INGENIUM_AUTH_ENCRYPTION_KEY_FILE="$AUTH_ENCRYPTION_KEY_FILE"

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
secure_persistent_path directory "$RESTORE_STAGING_DIR" "$API_UID" "$RESTORE_DATA_GID" 2770
export INGENIUM_RESTORE_STAGING_DIR="$RESTORE_STAGING_DIR"

# RESTORE-101 journal state is intentionally separate from the backup HMAC
# key. Only the root static maintenance program can read it or write journals.
if [ -n "${INGENIUM_RESTORE_MAINTENANCE_DIR:-}" ] || { [ -n "${INGENIUM_RESTORE_JOURNAL_KEY_FILE:-}" ] && [ "${INGENIUM_RESTORE_JOURNAL_KEY_FILE}" != "/app/.ingenium/restore-journal-key" ]; }; then
  echo "ERROR: restore maintenance paths are fixed image paths"
  exit 1
fi
RESTORE_MAINTENANCE_DIR="/app/.ingenium/restore-maintenance"
RESTORE_JOURNAL_KEY_FILE="/app/.ingenium/restore-journal-key"
secure_persistent_path directory "$RESTORE_MAINTENANCE_DIR" "$RESTORE_UID" "$RESTORE_GID" 0700
if [ -L "$RESTORE_JOURNAL_KEY_FILE" ] || { [ -e "$RESTORE_JOURNAL_KEY_FILE" ] && [ ! -f "$RESTORE_JOURNAL_KEY_FILE" ]; }; then
  echo "ERROR: restore journal key must be a regular non-symlink file"
  exit 1
fi
if [ ! -e "$RESTORE_JOURNAL_KEY_FILE" ]; then
  journal_key_tmp="$(mktemp /app/.ingenium/.restore-journal-key.XXXXXX)"
  trap 'rm -f "$journal_key_tmp"' EXIT HUP INT TERM
  umask 077
  dd if=/dev/urandom of="$journal_key_tmp" bs=32 count=1
  secure_persistent_path file "$journal_key_tmp" "$RESTORE_UID" "$RESTORE_GID" 0600
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
secure_persistent_path file "$RESTORE_JOURNAL_KEY_FILE" "$RESTORE_UID" "$RESTORE_GID" 0600
journal_key_metadata="$(stat -c '%a:%U:%G' "$RESTORE_JOURNAL_KEY_FILE")"
if [ "$journal_key_metadata" != "600:ingenium-restore:ingenium-restore" ] || [ "$journal_key_bytes" -lt 32 ]; then
  echo "ERROR: restore journal key must be restore-owned mode 0600 with at least 32 bytes"
  exit 1
fi
export INGENIUM_RESTORE_JOURNAL_KEY_FILE="$RESTORE_JOURNAL_KEY_FILE"

# Install each secret into only the identities that consume it.
RUNTIME_SECRET_DIR="/run/ingenium-secrets"
RUNTIME_API_SECRET_DIR="${RUNTIME_SECRET_DIR}/api"
RUNTIME_DASHBOARD_SECRET_DIR="${RUNTIME_SECRET_DIR}/dashboard"
RUNTIME_OPENCODE_SECRET_DIR="${RUNTIME_SECRET_DIR}/opencode"
RUNTIME_RESTORE_SECRET_DIR="${RUNTIME_SECRET_DIR}/restore"
RUNTIME_API_TOKEN_FILE="${RUNTIME_API_SECRET_DIR}/installation-api-token"
RUNTIME_API_OPENCODE_PASSWORD_FILE="${RUNTIME_API_SECRET_DIR}/opencode-server-password"
RUNTIME_OPENCODE_PASSWORD_FILE="${RUNTIME_OPENCODE_SECRET_DIR}/opencode-server-password"
RUNTIME_EMAIL_ENCRYPTION_KEY_FILE="${RUNTIME_API_SECRET_DIR}/email-encryption-key"
RUNTIME_API_BACKUP_SIGNING_KEY_FILE="${RUNTIME_API_SECRET_DIR}/backup-signing-key"
RUNTIME_RESTORE_BACKUP_SIGNING_KEY_FILE="${RUNTIME_RESTORE_SECRET_DIR}/backup-signing-key"
RUNTIME_API_AUTH_ENCRYPTION_KEY_FILE="${RUNTIME_API_SECRET_DIR}/auth-encryption-key"
RUNTIME_RESTORE_JOURNAL_KEY_FILE="${RUNTIME_RESTORE_SECRET_DIR}/restore-journal-key"
RUNTIME_API_DASHBOARD_TOKEN_FILE="${RUNTIME_API_SECRET_DIR}/dashboard-bootstrap-token"
RUNTIME_DASHBOARD_TOKEN_FILE="${RUNTIME_DASHBOARD_SECRET_DIR}/bootstrap-token"
umask 077
install -d -o root -g root -m 0711 "$RUNTIME_SECRET_DIR"
install -d -o ingenium-api -g ingenium-api -m 0700 "$RUNTIME_API_SECRET_DIR"
install -d -o ingenium-dashboard -g ingenium-dashboard -m 0700 "$RUNTIME_DASHBOARD_SECRET_DIR"
install -d -o ingenium-opencode -g ingenium-opencode -m 0700 "$RUNTIME_OPENCODE_SECRET_DIR"
install -d -o ingenium-restore -g ingenium-restore -m 0700 "$RUNTIME_RESTORE_SECRET_DIR"
install -d -o root -g root -m 0700 /run/ingenium-bootstrap
node /app/scripts/read-protected-api-token.mjs \
  "${INGENIUM_API_TOKEN_FILE:?INGENIUM_API_TOKEN_FILE is required}" \
  "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_API_TOKEN_FILE" installation-api 0 0 "$API_UID" "$API_GID"
unset INGENIUM_API_TOKEN
export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"
node /app/scripts/read-protected-api-token.mjs \
  "${OPENCODE_SERVER_PASSWORD_FILE:?OPENCODE_SERVER_PASSWORD_FILE is required}" \
  "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_API_OPENCODE_PASSWORD_FILE" opencode-server 0 0 "$API_UID" "$API_GID"
node /app/scripts/read-protected-api-token.mjs \
  "$OPENCODE_SERVER_PASSWORD_FILE" \
  "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_OPENCODE_PASSWORD_FILE" opencode-server 0 0 "$OPENCODE_UID" "$OPENCODE_GID"
node /app/scripts/read-protected-api-token.mjs \
  "${INGENIUM_EMAIL_ENCRYPTION_KEY_FILE:?INGENIUM_EMAIL_ENCRYPTION_KEY_FILE is required}" \
  "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_EMAIL_ENCRYPTION_KEY_FILE" email-encryption 0 0 "$API_UID" "$API_GID"
node /app/scripts/read-protected-api-token.mjs \
  "$BACKUP_SIGNING_KEY_FILE" 0 0 "$RUNTIME_API_BACKUP_SIGNING_KEY_FILE" opaque "$RESTORE_UID" "$RESTORE_DATA_GID" "$API_UID" "$API_GID" 770
node /app/scripts/read-protected-api-token.mjs \
  "$BACKUP_SIGNING_KEY_FILE" 0 0 "$RUNTIME_RESTORE_BACKUP_SIGNING_KEY_FILE" opaque "$RESTORE_UID" "$RESTORE_DATA_GID" "$RESTORE_UID" "$RESTORE_GID" 770
node /app/scripts/read-protected-api-token.mjs \
  "$AUTH_ENCRYPTION_KEY_FILE" 0 0 "$RUNTIME_API_AUTH_ENCRYPTION_KEY_FILE" opaque "$RESTORE_UID" "$RESTORE_DATA_GID" "$API_UID" "$API_GID" 770
node /app/scripts/read-protected-api-token.mjs \
  "$RESTORE_JOURNAL_KEY_FILE" "$RESTORE_UID" "$RESTORE_GID" "$RUNTIME_RESTORE_JOURNAL_KEY_FILE" opaque "$RESTORE_UID" "$RESTORE_DATA_GID" "$RESTORE_UID" "$RESTORE_GID" 770
node /app/scripts/provision-dashboard-bootstrap-token.mjs \
  "$RUNTIME_API_DASHBOARD_TOKEN_FILE" "$API_UID" "$API_GID" \
  "$RUNTIME_DASHBOARD_TOKEN_FILE" "$DASHBOARD_UID" "$DASHBOARD_GID"
unset OPENCODE_SERVER_PASSWORD INGENIUM_EMAIL_ENCRYPTION_KEY
export OPENCODE_SERVER_PASSWORD_FILE="$RUNTIME_API_OPENCODE_PASSWORD_FILE"
export INGENIUM_EMAIL_ENCRYPTION_KEY_FILE="$RUNTIME_EMAIL_ENCRYPTION_KEY_FILE"
export INGENIUM_BACKUP_SIGNING_KEY_FILE="$RUNTIME_API_BACKUP_SIGNING_KEY_FILE"
export INGENIUM_AUTH_ENCRYPTION_KEY_FILE="$RUNTIME_API_AUTH_ENCRYPTION_KEY_FILE"
export INGENIUM_RESTORE_JOURNAL_KEY_FILE="$RUNTIME_RESTORE_JOURNAL_KEY_FILE"
export INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE="$RUNTIME_API_DASHBOARD_TOKEN_FILE"

if [ "$DEPLOYMENT_MODE" = "control-plane" ]; then
  install -d -o root -g root -m 0700 /run/ingenium-runtime-manager /run/ingenium-runtime-gateway
  RUNTIME_API_MANAGER_TOKEN_FILE="${RUNTIME_API_SECRET_DIR}/runtime-manager-token"
  RUNTIME_API_GATEWAY_TOKEN_FILE="${RUNTIME_API_SECRET_DIR}/runtime-gateway-token"
  node /app/scripts/read-protected-api-token.mjs \
    "${INGENIUM_RUNTIME_MANAGER_TOKEN_FILE:?INGENIUM_RUNTIME_MANAGER_TOKEN_FILE is required}" \
    "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_API_MANAGER_TOKEN_FILE" installation-api 0 0 "$API_UID" "$API_GID"
  node /app/scripts/read-protected-api-token.mjs \
    "${INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE:?INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE is required}" \
    "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_API_GATEWAY_TOKEN_FILE" installation-api 0 0 "$API_UID" "$API_GID"
  export INGENIUM_RUNTIME_MANAGER_TOKEN_FILE="$RUNTIME_API_MANAGER_TOKEN_FILE"
  export INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE="$RUNTIME_API_GATEWAY_TOKEN_FILE"
fi

# Resolve any signed interrupted maintenance journal before Supervisor can start
# DB users. A malformed journal fails closed.
if ! runuser -u ingenium-restore -- /app/scripts/recover-restore-maintenance.sh; then
  echo "ERROR: restore maintenance recovery refused startup"
  exit 1
fi

install -d -o root -g ingenium-api -m 0770 /run/ingenium-supervisor
install -d -o ingenium-restore -g ingenium-api -m 0710 /run/ingenium-restore-handoff

GATEWAY_RUNTIME_DIR="/run/ingenium-gateway"
GATEWAY_ERROR_LOG="${GATEWAY_RUNTIME_DIR}/nginx-error.log"
# Nginx runs as its dedicated user and must create its pid, lock, and temporary files.
# `/run` is ephemeral, so these paths remain outside persistent application
# volumes and are recreated with owner-only access on every start.
for dir in \
  "$GATEWAY_RUNTIME_DIR" \
  "$GATEWAY_RUNTIME_DIR/client_body" \
  "$GATEWAY_RUNTIME_DIR/proxy" \
  "$GATEWAY_RUNTIME_DIR/fastcgi" \
  "$GATEWAY_RUNTIME_DIR/uwsgi" \
  "$GATEWAY_RUNTIME_DIR/scgi"; do
  install -d -o ingenium-gateway -g ingenium-gateway -m 0700 "$dir"
done
# Nginx reopens its error log as appuser; Supervisor reads this same file as
# the gateway stdout log. Replace only this ephemeral runtime artifact before
# either process opens it, preventing a stale owner from blocking either side.
rm -f "$GATEWAY_ERROR_LOG"
install -o ingenium-gateway -g ingenium-gateway -m 0600 /dev/null "$GATEWAY_ERROR_LOG"
install -d -o ingenium-api -g ingenium-api -m 0700 /home/ingenium-api /home/ingenium-api/.config /home/ingenium-api/.local /home/ingenium-api/.local/share
install -d -o ingenium-dashboard -g ingenium-dashboard -m 0700 /home/ingenium-dashboard
install -d -o ingenium-boundary -g ingenium-boundary -m 0700 /home/ingenium-boundary
install -d -o ingenium-ttyd -g ingenium-ttyd -m 0700 /home/ingenium-ttyd /home/ingenium-ttyd/.tmp /home/ingenium-ttyd/.config /home/ingenium-ttyd/.local /home/ingenium-ttyd/.local/share

GLOBAL_AGENTS_DIR="/home/ingenium-opencode/.config/opencode/agents"
secure_persistent_path directory /home/ingenium-opencode/.config "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 2770
secure_persistent_path directory /home/ingenium-opencode/.config/opencode "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 2770
secure_persistent_path tree /home/ingenium-opencode/.config "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 2770 0660
secure_persistent_path directory /home/ingenium-opencode/.config/opencode/runtime "$OPENCODE_UID" "$OPENCODE_GID" 0700
secure_persistent_path directory /home/ingenium-opencode/.local "$OPENCODE_UID" "$OPENCODE_GID" 0700
secure_persistent_path directory /home/ingenium-opencode/.local/share "$OPENCODE_UID" "$OPENCODE_GID" 0700
secure_persistent_path directory /home/ingenium-opencode/.local/share/opencode "$OPENCODE_UID" "$OPENCODE_GID" 0700
secure_persistent_path directory /home/ingenium-opencode/.local/share/opencode/log "$OPENCODE_UID" "$OPENCODE_GID" 0700
secure_persistent_path tree /home/ingenium-opencode/.local "$OPENCODE_UID" "$OPENCODE_GID" 0700 0600
# Backup and restore need traversal without exposing unrelated home contents.
setfacl -m u:ingenium-api:--x,u:ingenium-restore:--x /home/ingenium-opencode /home/ingenium-opencode/.local /home/ingenium-opencode/.local/share
setfacl -R -m u:ingenium-api:r-X,u:ingenium-restore:rwX /home/ingenium-opencode/.local/share/opencode
setfacl -m d:u:ingenium-api:r-X,d:u:ingenium-restore:rwX /home/ingenium-opencode/.local/share/opencode
secure_persistent_path directory /home/ingenium-vscode/vscode-data "$VSCODE_UID" "$VSCODE_GID" 0700
secure_persistent_path directory /home/ingenium-vscode/vscode-data/user-data "$VSCODE_UID" "$VSCODE_GID" 0700
secure_persistent_path directory /home/ingenium-vscode/vscode-data/extensions "$VSCODE_UID" "$VSCODE_GID" 0700
secure_persistent_path tree /home/ingenium-vscode/vscode-data "$VSCODE_UID" "$VSCODE_GID" 0700 user-only

/app/scripts/validate-process-isolation.sh

# Compatibility mode retains the historical single-user OpenCode/VS Code state.
if [ "$DEPLOYMENT_MODE" = "compatibility" ]; then
# Preserve host ownership while granting only the three interactive workspace
# identities access to the mounted workspace.
setfacl -R -m u:ingenium-opencode:rwX,u:ingenium-ttyd:rwX,u:ingenium-vscode:rwX /workspace
setfacl -R -m d:u:ingenium-opencode:rwX,d:u:ingenium-ttyd:rwX,d:u:ingenium-vscode:rwX /workspace
# Seed OpenCode config with Ingenium MCP on first start
OC_CONFIG="/home/ingenium-opencode/.config/opencode/opencode.jsonc"
if [ ! -f "$OC_CONFIG" ]; then
  secure_persistent_path directory "$(dirname "$OC_CONFIG")" "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 2770
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
        "INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential",
        "INGENIUM_MCP_AUDIENCE": "mcp",
        "INGENIUM_PROJECT": "global-default",
        "INGENIUM_WORKSPACE_ID": "global-default-workspace",
        "INGENIUM_WORKTREE": "/workspace"
      }
    }
  },
  "plugin": [
    "file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/session-coordinator.ts",
    "file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"
  ]
}
OCEOF
  echo "Seeded OpenCode config with Ingenium MCP"
fi
# Vault-backed child runs copy this provider-bearing config into tmpfs only when
# it is owner-private. The persistent OpenCode server still reads the same file.
secure_persistent_path file "$OC_CONFIG" "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 0660

OC_AUTH="/home/ingenium-opencode/.local/share/opencode/auth.json"
if [ -L "$OC_AUTH" ] || { [ -e "$OC_AUTH" ] && [ ! -f "$OC_AUTH" ]; }; then
  echo "ERROR: OpenCode auth path must be a regular non-symlink file"
  exit 1
fi
if [ -f "$OC_AUTH" ]; then
  secure_persistent_path file "$OC_AUTH" "$OPENCODE_UID" "$OPENCODE_GID" 0600
fi

# The global config lives on a persistent volume and may predate protected token
# files or the unified resource-sync plugin. Project the container-owned entries
# on every start while preserving unrelated operator configuration.
runuser -u ingenium-opencode -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-opencode" \
  XDG_CONFIG_HOME="/home/ingenium-opencode/.config" \
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
secure_persistent_path directory "$WORKSPACE_OPENCODE_DIR" - - -
if [ -e "$LEGACY_WORKSPACE_TOKEN_FILE" ] || [ -L "$LEGACY_WORKSPACE_TOKEN_FILE" ]; then
  if [ -L "$LEGACY_WORKSPACE_TOKEN_FILE" ] || [ ! -f "$LEGACY_WORKSPACE_TOKEN_FILE" ] \
    || ! cmp -s "$RUNTIME_API_TOKEN_FILE" "$LEGACY_WORKSPACE_TOKEN_FILE"; then
    echo "ERROR: legacy OpenCode API token path is unsafe or unrecognized"
    exit 1
  fi
  rm -f "$LEGACY_WORKSPACE_TOKEN_FILE"
fi

# Project the ordinary chat profile into OpenCode's persistent global directory.
# The broker is discovered only from the protected image path.
if [ -L "$GLOBAL_AGENTS_DIR" ] || { [ -e "$GLOBAL_AGENTS_DIR" ] && [ ! -d "$GLOBAL_AGENTS_DIR" ]; }; then
  echo "ERROR: OpenCode global agents directory must be a real directory"
  exit 1
fi
secure_persistent_path directory "$GLOBAL_AGENTS_DIR" "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 0700
LEGACY_GLOBAL_BROKER="${GLOBAL_AGENTS_DIR}/ingenium-llm-broker.md"
if [ -L "$LEGACY_GLOBAL_BROKER" ] || [ -f "$LEGACY_GLOBAL_BROKER" ]; then
  rm -f "$LEGACY_GLOBAL_BROKER"
elif [ -e "$LEGACY_GLOBAL_BROKER" ]; then
  echo "ERROR: legacy global broker path is not a regular file"
  exit 1
fi
/app/scripts/normalize-agent-profiles.sh --project-server-owned /app/.opencode/agents "$GLOBAL_AGENTS_DIR"

# Copy ordinary agent profiles into the workspace for project discovery. The
# protected broker is deliberately excluded.
WORKSPACE_AGENTS_DIR="${WORKSPACE_OPENCODE_DIR}/agents"
if [ -L "$WORKSPACE_AGENTS_DIR" ] || { [ -e "$WORKSPACE_AGENTS_DIR" ] && [ ! -d "$WORKSPACE_AGENTS_DIR" ]; }; then
  echo "ERROR: OpenCode workspace agents directory must be a real directory"
  exit 1
fi
secure_persistent_path directory "$WORKSPACE_AGENTS_DIR" - - -
LEGACY_WORKSPACE_BROKER="${WORKSPACE_AGENTS_DIR}/ingenium-llm-broker.md"
if [ -L "$LEGACY_WORKSPACE_BROKER" ] || [ -f "$LEGACY_WORKSPACE_BROKER" ]; then
  rm -f "$LEGACY_WORKSPACE_BROKER"
elif [ -e "$LEGACY_WORKSPACE_BROKER" ]; then
  echo "ERROR: legacy workspace broker path is not a regular file"
  exit 1
fi
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
    [ "$(basename "$source_profile")" = "ingenium-llm-broker.md" ] && continue
    copy_agent_profile "$source_profile"
  done
done
# Mounted repositories can retain historical root-owned mode-0600 profiles.
# Repair only regular non-symlink Markdown profiles before appuser runs
# repository initialization; the reserved broker remains deployment-read-only.
/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"
fi

# Persistent setup must not weaken or replace any executable root-owned startup artifact.
node /app/scripts/validate-root-entrypoint-chain.mjs

# Refuse to start if a templating or package change made the gateway unsafe.
# Validate as the supervised Nginx user so validation cannot leave root-owned
# PID, lock, temp, or log artifacts in the shared runtime directory.
runuser -u ingenium-gateway -- env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  /app/scripts/validate-gateway-config.sh

# Start supervisord as PID 1 after all startup setup has completed.
if [ "$DEPLOYMENT_MODE" = "control-plane" ]; then
  exec supervisord -c /app/control-plane-supervisord.conf
fi
exec supervisord -c /app/supervisord.conf
