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

for program in ingenium-api ingenium-api-boundary ingenium-dashboard ingenium-gateway opencode-web ttyd-opencode vscode; do
  require_running "$program"
done

require_api_ok
require_http_ok "dashboard" "http://127.0.0.1:3001/"
require_http_ok "OpenCode Web" "http://127.0.0.1:4098/"
require_http_ok "VS Code" "http://127.0.0.1:4100/healthz"
require_gateway_status "dashboard gateway" "localhost" "/tasks" "200"
require_gateway_status "dashboard gateway forwarded host" "host.docker.internal" "/" "200"
require_gateway_status "dashboard same-origin API" "localhost" "/api/v1/projects" "200"
require_gateway_status "OpenCode Web gateway" "opencode.localhost" "/" "200"
# code-server redirects its root to the mounted workspace selector. Verify both
# the root gateway behavior and the final workbench document.
require_gateway_status "VS Code gateway root" "vscode.localhost" "/" "302"
require_gateway_status "VS Code gateway workbench" "vscode.localhost" "/?folder=/workspace" "200"
require_vscode_gateway_csp
require_ttyd_gateway_health
require_cli_root_ok
