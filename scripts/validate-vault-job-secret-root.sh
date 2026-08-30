#!/bin/sh
# Validate the ephemeral, runner-owned vault secret root without enumerating it.
set -eu

mode="${1:-}"
root="/dev/shm/ingenium-job-secrets"

fail() {
  echo "ERROR: vault job secret root is unsafe"
  exit 1
}

case "$mode" in
  provision|verify) ;;
  *) fail ;;
esac

if [ "$#" -eq 4 ]; then
  root="$2"
  owner_uid="$3"
  owner_gid="$4"
  case "$root" in
    /dev/shm/*) ;;
    *) fail ;;
  esac
  if [ "$(dirname "$root")" != "/dev/shm" ] || [ -z "$(basename "$root")" ]; then
    fail
  fi
elif [ "$#" -eq 1 ]; then
  owner_uid="$(id -u appuser 2>/dev/null || true)"
  owner_gid="$(id -g appuser 2>/dev/null || true)"
  [ "$root" = "/dev/shm/ingenium-job-secrets" ] || fail
else
  fail
fi

case "$owner_uid" in ''|*[!0-9]*) fail ;; esac
case "$owner_gid" in ''|*[!0-9]*) fail ;; esac

# The container runtime owns /dev/shm. Never create, mount, or clean it during
# image build; only a real tmpfs is an acceptable parent at container start.
if [ -L /dev/shm ] || [ ! -d /dev/shm ] || [ "$(stat -fc '%T' /dev/shm)" != "tmpfs" ]; then
  fail
fi

if [ -L "$root" ]; then
  fail
fi
if [ -e "$root" ] && [ ! -d "$root" ]; then
  fail
fi

if [ "$mode" = "provision" ]; then
  if [ "$(id -u)" -ne 0 ] && [ "$#" -eq 1 ]; then
    fail
  fi
  if [ ! -e "$root" ]; then
    umask 077
    mkdir "$root" || fail
  fi
  if [ -L "$root" ] || [ ! -d "$root" ]; then
    fail
  fi
  chown "${owner_uid}:${owner_gid}" "$root" || fail
  chmod 0700 "$root" || fail
fi

if [ -L "$root" ] || [ ! -d "$root" ] || [ "$(stat -fc '%T' "$root")" != "tmpfs" ]; then
  fail
fi
if [ "$(stat -c '%u:%g:%a' "$root")" != "${owner_uid}:${owner_gid}:700" ]; then
  fail
fi
