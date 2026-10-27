#!/bin/sh
set -eu
image="${1:?runtime image required}"
source_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mode="${2:-source}"
case "$mode" in source|packaged) ;; *) exit 64 ;; esac
fixture="$(mktemp -d "${TMPDIR:?TMPDIR must be task-owned}/ingenium-api-backup-limits.XXXXXX")"
chmod 0755 "$fixture"
trap 'rm -rf -- "$fixture"' EXIT HUP INT TERM

run_case() {
  expected="$1"
  if [ -e "$fixture/node" ]; then chmod 0755 "$fixture/node"; fi
  cat > "$fixture/node" <<EOF
#!/bin/sh
set -eu
test "\$#" = 1
test "\$1" = dist/scripts/api-server.js
test "\${INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES-}" = "$expected"
test "\${INGENIUM_RESTORE_HANDOFF_MAX_BYTES-}" = "$expected"
test "\${INGENIUM_UNAPPROVED_ENV+x}" != x
printf 'API_BACKUP_LIMIT_ALLOWLIST_OK\\n'
EOF
  chmod 0555 "$fixture/node"
  launcher=/app/scripts/run-api.sh
  set --
  if [ "$mode" = source ]; then
    set -- --mount "type=bind,source=$source_root/scripts/run-api.sh,target=/fixture/run-api.sh,readonly"
    launcher=/fixture/run-api.sh
  fi
  docker run --rm --network none --read-only --user 1101:1101 \
    --entrypoint /bin/sh --workdir /app/services/ingenium-api \
    "$@" \
    --mount "type=bind,source=$fixture/node,target=/usr/local/bin/node,readonly" \
    --env INGENIUM_DEPLOYMENT_MODE=compatibility \
    --env INGENIUM_AUTH_ENCRYPTION_KEY_FILE=/fixture/test-only-auth \
    --env OPENCODE_SERVER_PASSWORD_FILE=/fixture/test-only-opencode \
    --env INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/fixture/test-only-email \
    --env INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES="$expected" \
    --env INGENIUM_RESTORE_HANDOFF_MAX_BYTES="$expected" \
    --env INGENIUM_UNAPPROVED_ENV=must-not-leak \
    "$image" "$launcher"
}
run_case 1073741824
run_case ''
printf 'PASS: API launcher preserves explicit backup bounds and drops unrelated environment\n'
