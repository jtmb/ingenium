#!/bin/sh
# Composite container health: every supervised process, the private dashboard
# and OpenCode/code-server listeners, and ttyd through its only supported health identity.
set -eu

# Docker health commands can inherit the image's original environment even
# after the entrypoint has consumed a bootstrap secret. Re-exec before any
# probe so readiness never receives plaintext credentials by inheritance.
if [ "${INGENIUM_HEALTHCHECK_CLEAN_ENV:-}" != "1" ]; then
  # The entrypoint writes the mode-0600 runtime token for appuser, which is
  # also the user of every token-consuming supervised service. Docker invokes
  # this health command as the container user, so drop to appuser before the
  # authenticated probe validates and reads that file.
  exec runuser -u appuser -- env -i \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    HOME="/home/appuser" \
    INGENIUM_DEPLOYMENT_MODE="${INGENIUM_DEPLOYMENT_MODE:-compatibility}" \
    INGENIUM_API_TOKEN_FILE="${INGENIUM_API_TOKEN_FILE:-/run/ingenium-secrets/api-token}" \
    INGENIUM_HEALTHCHECK_CLEAN_ENV="1" \
    /bin/sh "$0"
fi

require_running() {
  program="$1"
  status="$(supervisorctl status "$program" || true)"
  case "$status" in
    "$program"*RUNNING*) ;;
    *)
      echo "ERROR: supervisor program is not RUNNING: $program ($status)"
      exit 1
      ;;
  esac
}

require_api_ok() {
  if ! node /app/scripts/probe-api.mjs; then
    echo "ERROR: API readiness check failed"
    exit 1
  fi
}

require_vault_job_secret_root() {
  if ! /app/scripts/validate-vault-job-secret-root.sh verify; then
    echo "ERROR: vault job secret root validation failed"
    exit 1
  fi
}

require_restore_maintenance_safe() {
  status="$(supervisorctl status restore-maintenance || true)"
  case "$status" in
    *RUNNING*|*STOPPED*|*EXITED*) ;;
    *)
      echo "ERROR: restore maintenance supervisor state is unsafe: $status"
      exit 1
      ;;
  esac
}

require_http_ok() {
  name="$1"
  url="$2"
  if ! curl --fail --silent --max-time 5 --output /dev/null "$url"; then
    echo "ERROR: HTTP readiness check failed: $name ($url)"
    exit 1
  fi
}

require_gateway_status() {
  name="$1"
  host="$2"
  path="$3"
  expected="$4"
  port="${5:-3000}"
  actual="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' --header "Host: $host" "http://127.0.0.1:${port}${path}" || true)"
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: unexpected gateway status for $name: expected $expected, got ${actual:-000}"
    exit 1
  fi
}

require_ttyd_gateway_health() {
  expected_csp="Content-Security-Policy: frame-ancestors http://localhost:3000 http://127.0.0.1:3000"
  headers="$(curl --fail --silent --show-error --max-time 5 --dump-header - --output /dev/null --header "Host: cli.localhost" --header "X-Ingenium-Authenticated-User: attacker-controlled" http://127.0.0.1:3000/_ingenium/health)"

  if ! printf '%s\n' "$headers" | tr -d '\r' | grep -F -q "$expected_csp"; then
    echo "ERROR: ttyd gateway health check is missing the exact frame policy"
    exit 1
  fi
}

require_vscode_gateway_csp() {
  expected_csp="Content-Security-Policy: frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000"
  headers="$(curl --fail --silent --show-error --max-time 5 --dump-header - --output /dev/null --header "Host: vscode.localhost" "http://127.0.0.1:3000/?folder=/workspace")"

  if ! printf '%s\n' "$headers" | tr -d '\r' | grep -F -q "$expected_csp"; then
    echo "ERROR: VS Code gateway health check is missing the exact worker-safe frame policy"
    exit 1
  fi
}

require_cli_root_ok() {
  actual="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' --header "Host: cli.localhost" --header "X-Ingenium-Authenticated-User: attacker-controlled" http://127.0.0.1:3000/ || true)"
  if [ "$actual" != "200" ]; then
    echo "ERROR: OpenCode CLI local-gateway route is unavailable: got ${actual:-000}"
    exit 1
  fi
}

require_production_aliases_unavailable() {
  expected_body="Direct local runtime aliases are unavailable in production. Open the Ingenium Dashboard and choose an authorized workspace."
  for host in opencode.localhost cli.localhost vscode.localhost; do
    actual="$(curl --silent --show-error --max-time 5 --header "Host: $host" --write-out '|%{http_code}' http://127.0.0.1:3000/)"
    if [ "$actual" != "${expected_body}|404" ]; then
      echo "ERROR: production runtime alias did not return the common 404 guidance: $host"
      exit 1
    fi
  done
  headers="$(curl --silent --show-error --max-time 5 --head --header "Host: opencode.localhost" http://127.0.0.1:3000/)"
  for expected in "Cache-Control: no-store" "X-Content-Type-Options: nosniff" "Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"; do
    if ! printf '%s\n' "$headers" | tr -d '\r' | grep -F -q "$expected"; then
      echo "ERROR: production runtime alias is missing a required static header"
      exit 1
    fi
  done
  upgrade_status="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' --header "Host: opencode.localhost" --header "Connection: Upgrade" --header "Upgrade: websocket" http://127.0.0.1:3000/ || true)"
  if [ "$upgrade_status" != "404" ]; then
    echo "ERROR: production alias forwarded a WebSocket upgrade"
    exit 1
  fi
}

programs="ingenium-api ingenium-api-boundary ingenium-dashboard ingenium-gateway"
if [ "${INGENIUM_DEPLOYMENT_MODE:-compatibility}" = "compatibility" ]; then
  programs="$programs opencode-web ttyd-opencode vscode"
fi
for program in $programs; do
  require_running "$program"
done

require_restore_maintenance_safe
require_vault_job_secret_root
require_api_ok
require_http_ok "dashboard" "http://127.0.0.1:3001/"
require_gateway_status "dashboard gateway" "localhost" "/login" "200"
require_gateway_status "dashboard gateway forwarded host" "host.docker.internal" "/login" "200"
require_gateway_status "dashboard same-origin API" "localhost" "/api/v1/bootstrap/status" "200"
if [ "${INGENIUM_DEPLOYMENT_MODE:-compatibility}" = "compatibility" ]; then
  require_http_ok "OpenCode Web" "http://127.0.0.1:4098/"
  require_http_ok "VS Code" "http://127.0.0.1:4100/healthz"
  require_gateway_status "OpenCode Web gateway" "opencode.localhost" "/" "200"
  require_gateway_status "VS Code gateway root" "vscode.localhost" "/" "302"
  require_gateway_status "VS Code gateway workbench" "vscode.localhost" "/?folder=/workspace" "200"
  require_vscode_gateway_csp
  require_ttyd_gateway_health
  require_cli_root_ok
else
  require_production_aliases_unavailable
fi
