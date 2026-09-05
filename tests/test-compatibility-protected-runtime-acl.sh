#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ingenium-ingenium:latest}"
ENTRYPOINT_SOURCE="$(realpath "${2:-scripts/docker-entrypoint.sh}")"
TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_PARENT="${TEMP_PARENT%/}"
RUN_ROOT="$(mktemp -d "$TEMP_PARENT/ingenium-compatibility-acl.XXXXXX")"
PROJECT="ingenium-compatibility-acl-$RANDOM-$RANDOM"
COMPOSE_FILE="$RUN_ROOT/compose.yml"
resources_created=0

export FIXTURE_IMAGE="$IMAGE"
export FIXTURE_ENTRYPOINT_SOURCE="$ENTRYPOINT_SOURCE"
export FIXTURE_ROOT="$RUN_ROOT"

compose=(docker compose --project-name "$PROJECT" --project-directory "$RUN_ROOT" -f "$COMPOSE_FILE")

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
  exit "$status"
}
trap cleanup EXIT

protected_index="$RUN_ROOT/workspace/repo/.opencode/protected-runtime-index"
protected_directory="$protected_index/coordination-outbox"
protected_record="$protected_directory/record.json"
collaboration_file="$RUN_ROOT/workspace/repo/source.txt"
mkdir -p "$RUN_ROOT/bin" "$RUN_ROOT/workspace/.opencode" "$protected_directory"
chmod 0700 "$protected_index" "$protected_directory"
: > "$protected_record"
: > "$collaboration_file"
chmod 0670 "$protected_record"
chmod 0600 "$collaboration_file"

cat > "$RUN_ROOT/bin/find" <<'EOF'
#!/bin/sh
if [ "${1:-}" = /workspace ]; then
  echo "ERROR: compatibility entrypoint traversed /workspace twice" >&2
  exit 1
fi
exec /usr/bin/find "$@"
EOF

cat > "$RUN_ROOT/bin/supervisord" <<'EOF'
#!/bin/sh
set -eu
protected_directory=/workspace/repo/.opencode/protected-runtime-index/coordination-outbox
protected_record="$protected_directory/record.json"
collaboration_file=/workspace/repo/source.txt
test "$(stat -c '%a:%u:%g' "$protected_record")" = 600:1000:1000
for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
  runuser -u "$identity" -- test -x "$protected_directory"
  if runuser -u "$identity" -- test -r "$protected_record"; then
    exit 1
  fi
  runuser -u "$identity" -- test -r "$collaboration_file"
  runuser -u "$identity" -- test -w "$collaboration_file"
done
if runuser -u ingenium-api -- test -x "$protected_directory"; then
  exit 1
fi
printf 'COMPATIBILITY_ENTRYPOINT_ACL_OK\n'
EOF
chmod 0555 "$RUN_ROOT/bin/find" "$RUN_ROOT/bin/supervisord"

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
    entrypoint: ["/test-entrypoint.sh"]
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
