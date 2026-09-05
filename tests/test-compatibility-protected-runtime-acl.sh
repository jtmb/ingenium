#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ingenium-ingenium:latest}"
ENTRYPOINT_SOURCE="$(realpath "${2:-scripts/docker-entrypoint.sh}")"
TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_PARENT="${TEMP_PARENT%/}"
RUN_ROOT="$(mktemp -d "$TEMP_PARENT/ingenium-compatibility-acl.XXXXXX")"
PROJECT="${RUN_ROOT##*/}"
PROJECT="${PROJECT,,}"
PROJECT="${PROJECT//[^a-z0-9_-]/-}"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { printf 'ERROR: invalid Compose project name %s\n' "$PROJECT" >&2; exit 1; }
COMPOSE_FILE="$RUN_ROOT/compose.yml"
resources_created=0

export FIXTURE_IMAGE="$IMAGE"
export FIXTURE_ENTRYPOINT_SOURCE="$ENTRYPOINT_SOURCE"
export FIXTURE_ROOT="$RUN_ROOT"

compose=(docker compose --project-name "$PROJECT" --project-directory "$RUN_ROOT" -f "$COMPOSE_FILE")
printf 'FIXTURE: Compose project %s at %s\n' "$PROJECT" "$RUN_ROOT"

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$resources_created" -eq 1 ]] && ! "${compose[@]}" down --volumes --remove-orphans; then
    printf 'RETAINED: Compose project %s and fixture evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
    exit 1
  fi
  if [[ "$RUN_ROOT" != "$TEMP_PARENT/ingenium-compatibility-acl."* ]]; then
    printf 'RETAINED: unexpected fixture path %s\n' "$RUN_ROOT" >&2
    exit 1
  fi
  df -h "$TEMP_PARENT"
  rm -rf -- "$RUN_ROOT"
  [[ ! -e "$RUN_ROOT" ]] || { printf 'RETAINED: fixture cleanup failed at %s\n' "$RUN_ROOT" >&2; exit 1; }
  printf 'CLEANUP: removed Compose project %s and fixture %s\n' "$PROJECT" "$RUN_ROOT"
  exit "$status"
}
trap cleanup EXIT

collaboration_file="$RUN_ROOT/workspace/repo/source.txt"
mkdir -p "$RUN_ROOT/bin"
opencode_root="$RUN_ROOT/workspace/repo/.opencode"
mkdir -p "$opencode_root/protected-runtime-index/coordination-outbox" "$opencode_root/protected-runtime-index/tui-recovery"
: > "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
chmod 0770 "$opencode_root/protected-runtime-index" \
  "$opencode_root/protected-runtime-index/coordination-outbox" \
  "$opencode_root/protected-runtime-index/tui-recovery"
chmod 0670 "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
  printf 'fixture-%s\n' "$credential_name" > "$opencode_root/$credential_name"
  chmod 0670 "$opencode_root/$credential_name"
done
: > "$collaboration_file"
chmod 0600 "$collaboration_file"

cat > "$RUN_ROOT/bin/find" <<'EOF'
#!/bin/sh
if [ "${1:-}" = /workspace ]; then
  echo "ERROR: compatibility entrypoint traversed /workspace twice" >&2
  exit 1
fi
exec /usr/bin/find "$@"
EOF

cat > "$RUN_ROOT/bin/run-entrypoint" <<'EOF'
#!/bin/sh
set -eu
opencode_root=/workspace/.opencode
mkdir -p "$opencode_root/protected-runtime-index/coordination-outbox" "$opencode_root/protected-runtime-index/tui-recovery"
: > "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
chown -R appuser:appuser "$opencode_root/protected-runtime-index"
chmod 0770 "$opencode_root/protected-runtime-index" \
  "$opencode_root/protected-runtime-index/coordination-outbox" \
  "$opencode_root/protected-runtime-index/tui-recovery"
chmod 0670 "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
  printf 'fixture-%s\n' "$credential_name" > "$opencode_root/$credential_name"
  chown appuser:appuser "$opencode_root/$credential_name"
  chmod 0670 "$opencode_root/$credential_name"
done
exec /test-entrypoint.sh
EOF

cat > "$RUN_ROOT/bin/supervisord" <<'EOF'
#!/bin/sh
set -eu
collaboration_file=/workspace/repo/source.txt
fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}
for opencode_root in /workspace/.opencode /workspace/repo/.opencode; do
  protected_index="$opencode_root/protected-runtime-index"
  for protected_directory in "$protected_index" "$protected_index/coordination-outbox" "$protected_index/tui-recovery"; do
    test "$(stat -c '%a:%u:%g' "$protected_directory")" = 700:1000:1000 \
      || fail "private directory metadata changed: $protected_directory"
  done
  protected_record="$protected_index/coordination-outbox/record.json"
  test "$(stat -c '%a:%u:%g' "$protected_record")" = 600:1000:1000 \
    || fail "protected record metadata changed: $protected_record"
  for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
    credential_path="$opencode_root/$credential_name"
    test "$(stat -c '%a:%u:%g' "$credential_path")" = 600:1000:1000 \
      || fail "credential metadata changed: $credential_path"
    test "$(cat "$credential_path")" = "fixture-$credential_name" \
      || fail "credential content changed: $credential_path"
  done
  for identity in ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore ingenium-runtime-manager ingenium-runtime-gateway; do
    if runuser -u "$identity" -- test -x "$protected_index"; then
      fail "$identity can traverse $protected_index"
    fi
    if runuser -u "$identity" -- test -r "$protected_record"; then
      fail "$identity can read $protected_record"
    fi
    for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
      if runuser -u "$identity" -- test -r "$opencode_root/$credential_name"; then
        fail "$identity can read $opencode_root/$credential_name"
      fi
    done
  done
done
for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
  if ! runuser -u "$identity" -- test -r "$collaboration_file"; then
    fail "$identity cannot read the collaboration file"
  fi
  runuser -u "$identity" -- test -w "$collaboration_file" \
    || fail "$identity cannot write the collaboration file"
done
printf 'COMPATIBILITY_ENTRYPOINT_ACL_OK\n'
EOF
chmod 0555 "$RUN_ROOT/bin/find" "$RUN_ROOT/bin/run-entrypoint" "$RUN_ROOT/bin/supervisord"

cat > "$COMPOSE_FILE" <<'EOF'
services:
  bootstrap:
    image: ${FIXTURE_IMAGE:?FIXTURE_IMAGE is required}
    network_mode: none
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        printf "%064d\n" 0 > /fixture/api-token
        printf "%064d\n" 1 > /fixture/opencode-server-password
        printf "%064d\n" 2 > /fixture/email-encryption-key
        chown appuser:appuser /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key
        chmod 0600 /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key
    volumes:
      - bootstrap:/fixture

  entrypoint:
    image: ${FIXTURE_IMAGE:?FIXTURE_IMAGE is required}
    network_mode: none
    environment:
      PATH: /test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      INGENIUM_DEPLOYMENT_MODE: compatibility
      INGENIUM_API_TOKEN_FILE: /run/ingenium-bootstrap/api-token
      OPENCODE_SERVER_PASSWORD_FILE: /run/ingenium-bootstrap/opencode-server-password
      INGENIUM_EMAIL_ENCRYPTION_KEY_FILE: /run/ingenium-bootstrap/email-encryption-key
    entrypoint: ["/test-bin/run-entrypoint"]
    volumes:
      - type: bind
        source: ${FIXTURE_ENTRYPOINT_SOURCE:?FIXTURE_ENTRYPOINT_SOURCE is required}
        target: /test-entrypoint.sh
        read_only: true
      - type: bind
        source: ${FIXTURE_ROOT:?FIXTURE_ROOT is required}/bin
        target: /test-bin
        read_only: true
      - type: bind
        source: ${FIXTURE_ROOT:?FIXTURE_ROOT is required}/workspace
        target: /workspace
      - bootstrap:/run/ingenium-bootstrap
    tmpfs:
      - /workspace/.opencode:rw,nosuid,nodev,size=16777216,mode=0700
volumes:
  bootstrap:
EOF

resources_created=1
"${compose[@]}" run --rm --no-deps bootstrap
timeout --foreground 180s "${compose[@]}" run --rm --no-deps entrypoint

printf 'PASS: actual compatibility entrypoint preserves protected files and workspace collaboration\n'
