#!/bin/sh
# Disposable RESTORE-101 fixture launcher. Never allow persistent container paths.
set -eu

fixture_root="${INGENIUM_RESTORE_FIXTURE_ROOT:?INGENIUM_RESTORE_FIXTURE_ROOT is required}"
case "$fixture_root" in
  /tmp/ingenium-restore-fixture-*) ;;
  *)
    echo "restore fixture must use a disposable /tmp/ingenium-restore-fixture-* root" >&2
    exit 64
    ;;
esac

if [ -n "${INGENIUM_CORE_DB_PATH:-}" ] || [ -n "${OPENCODE_DB_PATH:-}" ] || [ -n "${INGENIUM_RESTORE_MAINTENANCE_DIR:-}" ]; then
  echo "restore fixture refuses caller-controlled target paths" >&2
  exit 64
fi

fixture_mode="${RESTORE_FIXTURE_MODE:-execute}"
case "$fixture_mode" in execute|recover) ;; *) exit 64 ;; esac
proc_fault="${RESTORE_FIXTURE_PROC_FAULT:-}"
case "$proc_fault" in ''|fd-dir|fd) ;; *) exit 64 ;; esac
target_lock_probe="${RESTORE_FIXTURE_TARGET_LOCK_PROBE:-}"
case "$target_lock_probe" in ''|1) ;; *) exit 64 ;; esac
proc_root="${RESTORE_FIXTURE_PROC_ROOT:-$fixture_root/proc}"
case "$proc_root" in "$fixture_root"/*) ;; *) exit 64 ;; esac
mkdir -p "$proc_root"
if [ -n "$proc_fault" ]; then mkdir -p "$proc_root/1/fd"; fi
if [ "$proc_fault" = "fd" ]; then : > "$proc_root/1/fd/0"; fi

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/tmp" \
  NODE_ENV="test" \
  INGENIUM_RESTORE_TEST_ROOT="$fixture_root" \
  INGENIUM_RESTORE_MAINTENANCE_MODE="$fixture_mode" \
  INGENIUM_RESTORE_TEST_PROC_FAULT="$proc_fault" \
  INGENIUM_RESTORE_TEST_PROC_ROOT="$proc_root" \
  INGENIUM_RESTORE_TEST_TARGET_LOCK_PROBE="$target_lock_probe" \
  INGENIUM_TRUSTED_ARTIFACT_UID="${INGENIUM_TRUSTED_ARTIFACT_UID:?INGENIUM_TRUSTED_ARTIFACT_UID is required}" \
  INGENIUM_TRUSTED_ARTIFACT_GID="${INGENIUM_TRUSTED_ARTIFACT_GID:?INGENIUM_TRUSTED_ARTIFACT_GID is required}" \
  INGENIUM_API_PORT="${INGENIUM_API_PORT:?INGENIUM_API_PORT is required}" \
  INGENIUM_API_TOKEN_FILE="$fixture_root/api-token" \
  "${RESTORE_MAINTENANCE_NODE:?RESTORE_MAINTENANCE_NODE is required}" "${RESTORE_MAINTENANCE_SCRIPT:?RESTORE_MAINTENANCE_SCRIPT is required}"
