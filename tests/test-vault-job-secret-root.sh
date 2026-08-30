#!/usr/bin/env bash
# Shell-level VAULT-101 fixture: no Docker, API, secret, or provider required.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
VALIDATOR="$REPO_ROOT/scripts/validate-vault-job-secret-root.sh"
ROOT="$(mktemp -d /dev/shm/ingenium-vault-job-root.XXXXXX)"
OWNER_UID="$(id -u)"
OWNER_GID="$(id -g)"
RUN_ID="11111111-1111-4111-8111-111111111111"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -f "$ROOT/retained-file" ]; then
    rm "$ROOT/retained-file"
  fi
  if [ -L "$ROOT" ] || [ -f "$ROOT" ]; then
    rm "$ROOT"
  elif [ -d "$ROOT" ]; then
    rmdir "$ROOT" || true
  fi
}
trap cleanup EXIT

rmdir "$ROOT"
sh "$VALIDATOR" provision "$ROOT" "$OWNER_UID" "$OWNER_GID"
[[ "$(stat -c '%u:%g:%a' "$ROOT")" == "$OWNER_UID:$OWNER_GID:700" ]] || fail 'provisioned root metadata is incorrect'

# The unprivileged owner used by the API can create an isolated run directory.
mkdir "$ROOT/$RUN_ID"
rmdir "$ROOT/$RUN_ID"

chmod 0755 "$ROOT"
if sh "$VALIDATOR" verify "$ROOT" "$OWNER_UID" "$OWNER_GID"; then
  fail 'verify accepted an unsafe mode'
fi
sh "$VALIDATOR" provision "$ROOT" "$OWNER_UID" "$OWNER_GID"
[[ "$(stat -c '%u:%g:%a' "$ROOT")" == "$OWNER_UID:$OWNER_GID:700" ]] || fail 'provision did not remediate mode'

rmdir "$ROOT"
ln -s /tmp "$ROOT"
if sh "$VALIDATOR" provision "$ROOT" "$OWNER_UID" "$OWNER_GID"; then
  fail 'provision followed a symlink'
fi
rm "$ROOT"

: > "$ROOT"
if sh "$VALIDATOR" provision "$ROOT" "$OWNER_UID" "$OWNER_GID"; then
  fail 'provision accepted a non-directory'
fi
rm "$ROOT"

sh "$VALIDATOR" provision "$ROOT" "$OWNER_UID" "$OWNER_GID"
printf 'fixture-content' > "$ROOT/retained-file"
sh "$VALIDATOR" verify "$ROOT" "$OWNER_UID" "$OWNER_GID"
[[ "$(<"$ROOT/retained-file")" == 'fixture-content' ]] || fail 'validator touched root contents'
rm "$ROOT/retained-file"

printf 'PASS: VAULT-101 tmpfs root provisioning and validation\n'
