#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-control-plane-env.XXXXXX")"
CAPTURE_FILE="$RUN_ROOT/api-env"
COMPOSE_ENV_FILE="$RUN_ROOT/compose.env"
INSTALLATION_TOKEN_FILE="$RUN_ROOT/installation-api.token"
OPENCODE_PASSWORD_FILE="$RUN_ROOT/opencode-server.password"
EMAIL_ENCRYPTION_KEY_FILE="$RUN_ROOT/email-encryption.key"

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
: > "$INSTALLATION_TOKEN_FILE"
: > "$OPENCODE_PASSWORD_FILE"
: > "$EMAIL_ENCRYPTION_KEY_FILE"
chmod 0600 "$INSTALLATION_TOKEN_FILE" "$OPENCODE_PASSWORD_FILE" "$EMAIL_ENCRYPTION_KEY_FILE"
cat > "$RUN_ROOT/bin/cat" <<'EOF'
#!/bin/sh
case "$1" in
  /usr/local/share/ingenium/api-uid) printf '1101\n' ;;
  /usr/local/share/ingenium/restore-data-gid) printf '1201\n' ;;
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
  INGENIUM_RUNTIME_SCHEME=https
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
INGENIUM_API_TOKEN_FILE=/run/ingenium-secrets/api/installation-api-token \
OPENCODE_SERVER_PASSWORD_FILE=/run/ingenium-secrets/api/opencode-server-password \
INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/run/ingenium-secrets/api/email-encryption-key \
/usr/bin/env "${runtime_environment[@]}" sh "$REPO_ROOT/scripts/run-api.sh"

for expected in "${runtime_environment[@]}"; do
  grep -F -x -q -- "$expected" "$CAPTURE_FILE" || fail "run-api did not forward $expected"
done
grep -F -x -q -- 'node' "$CAPTURE_FILE" || fail 'run-api did not reach the API command'
grep -F -x -q -- 'dist/scripts/api-server.js' "$CAPTURE_FILE" || fail 'run-api did not target the API startup module'

rendered="$({
  OPENCODE_SERVER_PASSWORD_FILE="$OPENCODE_PASSWORD_FILE" \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE="$EMAIL_ENCRYPTION_KEY_FILE" \
  INGENIUM_API_TOKEN_FILE="$INSTALLATION_TOKEN_FILE" \
  IMAGE_REVISION="$REVISION" \
  INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS=0.0.0.0 \
  INGENIUM_RUNTIME_GATEWAY_HOST_PORT=443 \
  INGENIUM_RUNTIME_GATEWAY_PORT=8443 \
  INGENIUM_RUNTIME_WORKSPACE_VALIDATION_SOURCE="$REPO_ROOT" \
  INGENIUM_RUNTIME_WORKSPACE_VALIDATION_TARGET=/workspace-validation/acceptance-ingenium \
  /usr/bin/env "${runtime_environment[@]:1}" docker compose --env-file "$COMPOSE_ENV_FILE" --profile production --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json
})"
printf '%s' "$rendered" | node -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const control = config.services?.["control-plane"];
  const env = control?.environment ?? {};
  const expected = {
    INGENIUM_DEPLOYMENT_MODE: "control-plane",
    OPENCODE_SERVER_PASSWORD_FILE: "/run/ingenium-bootstrap/opencode-server-password",
    INGENIUM_EMAIL_ENCRYPTION_KEY_FILE: "/run/ingenium-bootstrap/email-encryption-key",
    INGENIUM_RUNTIME_MANAGER_URL: "http://runtime-manager:4110/",
    INGENIUM_RUNTIME_MANAGER_TOKEN_FILE: "/run/ingenium-runtime-manager/token",
    INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE: "/run/ingenium-runtime-gateway/token",
    INGENIUM_RUNTIME_ROOT_DOMAIN: "runtime.example.test",
    INGENIUM_RUNTIME_SCHEME: "https",
    DASHBOARD_ALLOWED_ORIGINS: "https://dashboard.example.test",
    INGENIUM_API_TOKEN_FILE: "/run/ingenium-bootstrap/api-token",
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
  const gateway = config.services?.["runtime-gateway"];
  const manager = config.services?.["runtime-manager"];
  const port = gateway?.ports?.[0];
  if (gateway?.environment?.INGENIUM_RUNTIME_SCHEME !== "https"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS !== "0.0.0.0"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_HOST_PORT !== "443"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_PORT !== "8443"
    || port?.host_ip !== "0.0.0.0" || port?.published !== "443" || port?.target !== 8443) {
    throw new Error("remote runtime gateway transport is incoherent");
  }
  if (!manager?.volumes?.some((mount) => mount.type === "bind"
    && mount.source.endsWith("/ingenium")
    && mount.target === "/workspace-validation/acceptance-ingenium"
    && mount.read_only === true)) {
    throw new Error("runtime workspace validation mount is not canonical and read-only");
  }
  const controlVolumes = control?.volumes?.filter((mount) => mount.type === "volume") ?? [];
  for (const target of ["/app/.ingenium", "/home/ingenium-opencode/.config", "/home/ingenium-opencode/.local"]) {
    if (!controlVolumes.some((mount) => mount.target === target)) throw new Error(`control-plane persistent volume is missing for ${target}`);
  }
  if (!control?.volumes?.some((mount) => mount.type === "bind"
    && mount.target === "/run/ingenium-bootstrap/api-token"
    && mount.read_only === true)) {
    throw new Error("control-plane protected installation-token mount is missing");
  }
  for (const target of [
    "/run/ingenium-bootstrap/opencode-server-password",
    "/run/ingenium-bootstrap/email-encryption-key",
  ]) {
    if (!control?.volumes?.some((mount) => mount.type === "bind"
      && mount.target === target && mount.read_only === true)) {
      throw new Error(`control-plane protected deployment-secret mount is missing: ${target}`);
    }
  }
'

local_rendered="$(OPENCODE_SERVER_PASSWORD_FILE="$OPENCODE_PASSWORD_FILE" \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE="$EMAIL_ENCRYPTION_KEY_FILE" \
  INGENIUM_API_TOKEN_FILE="$INSTALLATION_TOKEN_FILE" \
  IMAGE_REVISION="$REVISION" \
  DASHBOARD_ALLOWED_ORIGINS=http://localhost:3000 \
  docker compose --env-file "$COMPOSE_ENV_FILE" --profile production --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json)"
printf '%s' "$local_rendered" | node -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const control = config.services?.["control-plane"];
  const gateway = config.services?.["runtime-gateway"];
  const port = gateway?.ports?.[0];
  if (control?.environment?.INGENIUM_RUNTIME_SCHEME !== "http"
    || control.environment.INGENIUM_RUNTIME_ROOT_DOMAIN !== "runtime.localhost"
    || control.build?.args?.NEXT_PUBLIC_RUNTIME_SCHEME !== "http"
    || control.build?.args?.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN !== "runtime.localhost"
    || gateway?.environment?.INGENIUM_RUNTIME_SCHEME !== "http"
    || gateway.environment.INGENIUM_RUNTIME_ROOT_DOMAIN !== "runtime.localhost"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS !== "127.0.0.1"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_HOST_PORT !== "80"
    || gateway.environment.INGENIUM_RUNTIME_GATEWAY_PORT !== "8080"
    || gateway.ports?.length !== 1 || port?.host_ip !== "127.0.0.1"
    || port?.published !== "80" || port?.target !== 8080) {
    throw new Error("local runtime gateway transport is not loopback-only and coherent");
  }
'

if missing_rendered="$(env -u OPENCODE_SERVER_PASSWORD_FILE \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE="$EMAIL_ENCRYPTION_KEY_FILE" \
  INGENIUM_API_TOKEN_FILE="$INSTALLATION_TOKEN_FILE" \
  IMAGE_REVISION="$REVISION" \
  DASHBOARD_ALLOWED_ORIGINS=http://localhost:3000 \
  docker compose --env-file "$COMPOSE_ENV_FILE" --profile production --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json)"; then
  fail 'production Compose rendered without OPENCODE_SERVER_PASSWORD_FILE'
fi

if env -u OPENCODE_SERVER_PASSWORD_FILE \
  PATH="$RUN_ROOT/bin:/usr/bin:/bin" \
  CAPTURE_FILE="$CAPTURE_FILE" \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/run/ingenium-secrets/api/email-encryption-key \
  /usr/bin/env "${runtime_environment[@]}" sh "$REPO_ROOT/scripts/run-api.sh"; then
  fail 'run-api reached startup without OPENCODE_SERVER_PASSWORD_FILE'
fi

grep -F -x -q -- 'require_gateway_status "dashboard gateway" "localhost" "/login" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the public login route'
grep -F -x -q -- 'require_gateway_status "dashboard gateway forwarded host" "host.docker.internal" "/login" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the forwarded public login route'
grep -F -x -q -- 'require_gateway_status "dashboard same-origin API" "localhost" "/api/v1/bootstrap/status" "200"' \
  "$REPO_ROOT/scripts/healthcheck.sh" || fail 'healthcheck does not probe the bootstrap-safe API route'

printf 'PASS: production control-plane mode, runtime configuration, and OpenCode secret fail-closed startup contract\n'
