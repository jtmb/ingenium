#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-control-plane-env.XXXXXX")"
CAPTURE_FILE="$RUN_ROOT/api-env"
COMPOSE_ENV_FILE="$RUN_ROOT/compose.env"

cleanup() {
  if [[ "$RUN_ROOT" == "${TMPDIR:-/tmp}/ingenium-control-plane-env."* ]]; then
    rm -rf -- "$RUN_ROOT"
  fi
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

mkdir -p "$RUN_ROOT/bin"
: > "$COMPOSE_ENV_FILE"
cat > "$RUN_ROOT/bin/cat" <<'EOF'
#!/bin/sh
case "$1" in
  /usr/local/share/ingenium/appuser-uid|/usr/local/share/ingenium/appuser-gid) printf '1000\n' ;;
  *) exec /bin/cat "$@" ;;
esac
EOF
cat > "$RUN_ROOT/bin/env" <<'EOF'
#!/bin/sh
: "${CAPTURE_FILE:?}"
printf '%s\n' "$@" > "$CAPTURE_FILE"
EOF
chmod 0700 "$RUN_ROOT/bin/cat" "$RUN_ROOT/bin/env"

runtime_environment=(
  INGENIUM_DEPLOYMENT_MODE=control-plane
  INGENIUM_RUNTIME_MANAGER_URL=http://runtime-manager:4110/
  INGENIUM_RUNTIME_MANAGER_TOKEN_FILE=/run/ingenium-runtime-manager/token
  INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE=/run/ingenium-runtime-gateway/token
  INGENIUM_RUNTIME_ROOT_DOMAIN=runtime.example.test
  DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.test
  INGENIUM_AUTH_ENCRYPTION_KEY_FILE=/app/.ingenium/auth-encryption-key
  INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS=17001
  INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER=3
  INGENIUM_RUNTIME_CPU_MILLIS=1100
  INGENIUM_RUNTIME_MEMORY_BYTES=1200000000
  INGENIUM_RUNTIME_PIDS_LIMIT=300
  INGENIUM_RUNTIME_DISK_BYTES=2200000000
  INGENIUM_RUNTIME_PROCESS_LIMIT=140
  INGENIUM_RUNTIME_IDLE_LEASE_MS=1900000
  INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS=29000000
)

PATH="$RUN_ROOT/bin:/usr/bin:/bin" \
CAPTURE_FILE="$CAPTURE_FILE" \
OPENCODE_SERVER_PASSWORD=protected-test-secret \
INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
/usr/bin/env "${runtime_environment[@]}" sh "$REPO_ROOT/scripts/run-api.sh"

for expected in "${runtime_environment[@]}"; do
  grep -F -x -q -- "$expected" "$CAPTURE_FILE" || fail "run-api did not forward $expected"
done
grep -F -x -q -- 'node' "$CAPTURE_FILE" || fail 'run-api did not reach the API command'
grep -F -x -q -- 'dist/scripts/api-server.js' "$CAPTURE_FILE" || fail 'run-api did not target the API startup module'

rendered="$({
  OPENCODE_SERVER_PASSWORD=protected-test-secret \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  IMAGE_REVISION="$REVISION" \
  /usr/bin/env "${runtime_environment[@]:1}" docker compose --env-file "$COMPOSE_ENV_FILE" --profile production --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json
})"
printf '%s' "$rendered" | node -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const env = config.services?.["control-plane"]?.environment ?? {};
  const expected = {
    INGENIUM_DEPLOYMENT_MODE: "control-plane",
    OPENCODE_SERVER_PASSWORD: "protected-test-secret",
    INGENIUM_RUNTIME_MANAGER_URL: "http://runtime-manager:4110/",
    INGENIUM_RUNTIME_MANAGER_TOKEN_FILE: "/run/ingenium-runtime-manager/token",
    INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE: "/run/ingenium-runtime-gateway/token",
    INGENIUM_RUNTIME_ROOT_DOMAIN: "runtime.example.test",
    DASHBOARD_ALLOWED_ORIGINS: "https://dashboard.example.test",
    INGENIUM_AUTH_ENCRYPTION_KEY_FILE: "/app/.ingenium/auth-encryption-key",
    INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS: "17001",
    INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER: "3",
    INGENIUM_RUNTIME_CPU_MILLIS: "1100",
    INGENIUM_RUNTIME_MEMORY_BYTES: "1200000000",
    INGENIUM_RUNTIME_PIDS_LIMIT: "300",
    INGENIUM_RUNTIME_DISK_BYTES: "2200000000",
    INGENIUM_RUNTIME_PROCESS_LIMIT: "140",
    INGENIUM_RUNTIME_IDLE_LEASE_MS: "1900000",
    INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS: "29000000",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) throw new Error(`control-plane environment mismatch for ${name}`);
  }
'

if missing_rendered="$(env -u OPENCODE_SERVER_PASSWORD \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  IMAGE_REVISION="$REVISION" \
  docker compose --env-file "$COMPOSE_ENV_FILE" --profile production --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json)"; then
  fail 'production Compose rendered without OPENCODE_SERVER_PASSWORD'
fi

if env -u OPENCODE_SERVER_PASSWORD \
  PATH="$RUN_ROOT/bin:/usr/bin:/bin" \
  CAPTURE_FILE="$CAPTURE_FILE" \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  /usr/bin/env "${runtime_environment[@]}" sh "$REPO_ROOT/scripts/run-api.sh"; then
  fail 'run-api reached startup without OPENCODE_SERVER_PASSWORD'
fi

grep -F -x -q -- 'require_gateway_status "dashboard gateway" "localhost" "/login" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the public login route'
grep -F -x -q -- 'require_gateway_status "dashboard gateway forwarded host" "host.docker.internal" "/login" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the forwarded public login route'
grep -F -x -q -- 'require_gateway_status "dashboard same-origin API" "localhost" "/api/v1/bootstrap/status" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the bootstrap-safe API route'

printf 'PASS: production control-plane mode, runtime configuration, and OpenCode secret fail-closed startup contract\n'
