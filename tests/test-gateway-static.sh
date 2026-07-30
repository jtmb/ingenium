#!/usr/bin/env bash
# Deterministic Phase 2E gateway contract checks.
#
# These checks intentionally inspect configuration and image inputs only. They
# do not start Docker, nginx, OpenCode, a provider, or any network service.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$REPO_ROOT/$path" ]] || fail "missing gateway file: $path"
}

require_text() {
  local path="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$REPO_ROOT/$path" || fail "missing '$expected' in $path"
}

reject_text() {
  local path="$1"
  local forbidden="$2"
  if grep -Fq -- "$forbidden" "$REPO_ROOT/$path"; then
    fail "unsafe '$forbidden' found in $path"
  fi
}

line_number() {
  local path="$1"
  local expected="$2"
  grep -n -F -- "$expected" "$REPO_ROOT/$path" | cut -d: -f1
}

for path in \
  docker-compose.yml \
  Dockerfile \
  supervisord.conf \
  nginx/gateway.conf \
  nginx/proxy-common.conf \
  nginx/proxy-dashboard.conf \
  nginx/proxy-opencode.conf \
  nginx/proxy-oauth-callback.conf \
  scripts/docker-entrypoint.sh \
  scripts/api-boundary-proxy.mjs \
  scripts/probe-api.mjs \
  scripts/run-api.sh \
  scripts/run-api-boundary-proxy.sh \
  scripts/run-dashboard.sh \
  scripts/run-dashboard.mjs \
  scripts/validate-gateway-config.sh \
  scripts/normalize-agent-profiles.sh \
  scripts/project-agent-profiles.mjs \
  scripts/healthcheck.sh \
  scripts/start-opencode-web.sh \
  scripts/start-ttyd.sh \
  scripts/wait-for-opencode.sh; do
  require_file "$path"
done
require_file 'scripts/windows-loopback-transport.ps1'

# The browser gateway binds the WSL transport so Windows localhost forwarding
# can reach it. OpenCode listeners remain container-internal; the API boundary
# remains host-loopback-only and bearer-authenticated for MCP clients.
require_text docker-compose.yml '- "3000:3000"'
reject_text docker-compose.yml '127.0.0.1:3000:3000'
require_text docker-compose.yml '- "127.0.0.1:4097:4097"'
require_text docker-compose.yml '- "127.0.0.1:1455:1455"'
require_text docker-compose.yml 'INGENIUM_API_TOKEN=${INGENIUM_API_TOKEN:-}'
require_text docker-compose.yml 'INGENIUM_API_TOKEN_FILE=${INGENIUM_API_TOKEN_FILE:-}'
require_text docker-compose.yml 'DASHBOARD_ALLOWED_ORIGINS=${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}'
require_text docker-compose.yml 'INGENIUM_API_PORT=4096'
reject_text docker-compose.yml '1455:4097'
reject_text docker-compose.yml '4096:4096'
reject_text docker-compose.yml 'INGENIUM_GATEWAY_PASSWORD'
reject_text docker-compose.yml 'INGENIUM_GATEWAY_BCRYPT_COST'
require_text docker-compose.yml 'OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD:?'
require_text docker-compose.yml 'NEXT_PUBLIC_OPENCODE_WEB_URL:-http://opencode.localhost:3000/'
require_text docker-compose.yml 'NEXT_PUBLIC_OPENCODE_CLI_URL:-http://cli.localhost:3000/'
require_text docker-compose.yml '${HOME:?HOME must be set for the /workspace bind mount}/repos:/workspace'
reject_text docker-compose.yml 'opencodeweb_workspace'
reject_text docker-compose.yml '${HOME:-~}/repos'
require_text docker-compose.yml 'ingenium-data:/app/.ingenium'
require_text docker-compose.yml 'opencode-config:/home/appuser/.config'
require_text docker-compose.yml 'opencode-data:/home/appuser/.local'
if grep -Eq '(^|[[:space:]-])([0-9]+:)?409[89](:|$)' "$REPO_ROOT/docker-compose.yml"; then
  fail "docker-compose publishes a private OpenCode port"
fi
reject_text docker-compose.yml 'security_opt:'
reject_text docker-compose.yml 'seccomp=unconfined'
reject_text docker-compose.yml 'sudo'

require_text Dockerfile 'COPY --chown=appuser:appuser nginx/gateway.conf nginx/proxy-common.conf nginx/proxy-dashboard.conf nginx/proxy-opencode.conf'
require_text Dockerfile 'COPY --chown=appuser:appuser scripts/api-boundary-proxy.mjs scripts/probe-api.mjs scripts/project-opencode-global-config.mjs scripts/run-api.sh scripts/run-api-boundary-proxy.sh scripts/run-dashboard.mjs scripts/run-dashboard.sh scripts/run-gateway.sh scripts/start-opencode-web.sh scripts/wait-for-opencode.sh scripts/start-ttyd.sh scripts/healthcheck.sh scripts/validate-gateway-config.sh scripts/validate-api-boundary.sh ./scripts/'
require_text Dockerfile 'COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/'
require_text Dockerfile 'COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh'
normalizer_copy_line="$(line_number Dockerfile 'COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/')"
init_wrapper_copy_line="$(line_number Dockerfile 'COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh')"
init_smoke_line="$(line_number Dockerfile '/usr/local/bin/ingenium-init-project --help')"
if [[ -z "$normalizer_copy_line" || -z "$init_wrapper_copy_line" || -z "$init_smoke_line" || "$normalizer_copy_line" -ge "$init_wrapper_copy_line" || "$normalizer_copy_line" -ge "$init_smoke_line" ]]; then
  fail 'normalize-agent-profiles must be safely copied before init-project wrapper smoke'
fi
require_text Dockerfile 'ARG NEXT_PUBLIC_OPENCODE_WEB_URL="http://opencode.localhost:3000/"'
require_text Dockerfile 'ARG NEXT_PUBLIC_OPENCODE_CLI_URL="http://cli.localhost:3000/"'
require_text Dockerfile 'FROM node:22-slim AS builder'
require_text Dockerfile 'FROM node:22-slim AS runtime'
reject_text Dockerfile 'FROM node:22-alpine AS builder'
require_text Dockerfile 'ARG OPENCODE_VERSION=1.18.9'
require_text Dockerfile 'ARG OPENCODE_SHA256=a0fa4b7b8bdacbd013e79a5f69d4220d36b545cd3ea296ba765f3016fa501b5b'
require_text Dockerfile 'test "$(opencode --version)" = "${OPENCODE_VERSION}"'
require_text Dockerfile 'RUN node -e '\''require("better-sqlite3")'\'''
require_text Dockerfile 'runuser -u appuser -- sh /app/scripts/validate-gateway-config.sh'
require_text Dockerfile 'EXPOSE 3000 4097 1455'
if grep -Eq 'EXPOSE.*(4098|4099)' "$REPO_ROOT/Dockerfile"; then
  fail "Dockerfile exposes a private OpenCode port"
fi
reject_text Dockerfile 'sudo'
reject_text Dockerfile 'NOPASSWD:ALL'

# Host routing: the default dashboard gateway must accept Windows-to-WSL
# forwarded host headers without browser Basic auth. OpenCode stays on separate
# root hosts while its upstream ports remain private.
require_text nginx/gateway.conf 'listen 3000 default_server;'
require_text nginx/gateway.conf 'listen [::]:3000 default_server;'
require_text nginx/gateway.conf 'server_name _;'
reject_text nginx/gateway.conf 'return 444;'
require_text nginx/gateway.conf 'proxy_pass http://ingenium_dashboard;'
require_text nginx/gateway.conf 'server_name opencode.localhost;'
require_text nginx/gateway.conf 'server_name cli.localhost;'
reject_text nginx/gateway.conf 'auth_basic'
reject_text nginx/gateway.conf 'auth_delay'
reject_text nginx/gateway.conf 'htpasswd'
require_text nginx/gateway.conf 'pid /run/ingenium-gateway/nginx.pid;'
require_text nginx/gateway.conf 'lock_file /run/ingenium-gateway/nginx.lock;'
require_text nginx/gateway.conf 'error_log /run/ingenium-gateway/nginx-error.log warn;'
reject_text nginx/gateway.conf 'error_log stderr warn;'
reject_text nginx/gateway.conf 'error_log /dev/stderr'
require_text nginx/gateway.conf 'limit_req_zone $binary_remote_addr zone=dashboard_request:10m rate=30r/s;'
require_text nginx/gateway.conf 'limit_req_zone $opencode_request_limit_key zone=opencode_request:10m rate=30r/s;'
require_text nginx/gateway.conf 'map $http_upgrade $opencode_upgrade_rate_limit_key {'
require_text nginx/gateway.conf 'map $uri $opencode_request_limit_key {'
require_text nginx/gateway.conf '~^/(?:assets/|_next/|@vite/|node_modules/\.vite/) "";'
require_text nginx/gateway.conf 'map $host $dashboard_ipv6_loopback {'
require_text nginx/gateway.conf '"::1" 1;'
require_text nginx/gateway.conf 'return 308 http://localhost:3000$request_uri;'
require_text nginx/gateway.conf 'map $http_origin $ttyd_websocket_upstream_host {'
require_text nginx/gateway.conf '"http://localhost:3000" "localhost:3000";'
require_text nginx/gateway.conf '"http://127.0.0.1:3000" "127.0.0.1:3000";'
require_text nginx/gateway.conf '"http://cli.localhost:3000" "cli.localhost:3000";'
require_text nginx/gateway.conf 'limit_req zone=dashboard_request burst=60 nodelay;'
require_text nginx/gateway.conf 'limit_req zone=opencode_request burst=60 nodelay;'
reject_text nginx/gateway.conf 'zone=gateway_request'
require_text supervisord.conf 'stdout_logfile=/run/ingenium-gateway/nginx-error.log'
require_text nginx/gateway.conf 'proxy_pass http://opencode_web;'
require_text nginx/gateway.conf 'proxy_pass http://opencode_cli;'
require_text nginx/gateway.conf 'include /app/nginx/proxy-opencode.conf;'
require_text nginx/gateway.conf 'proxy_set_header X-Ingenium-Authenticated-User local-gateway;'
require_text nginx/gateway.conf 'location = /ws {'
require_text nginx/gateway.conf 'if ($ttyd_websocket_upstream_host = "") {'
require_text nginx/gateway.conf 'return 403;'
require_text nginx/gateway.conf 'proxy_set_header Host $ttyd_websocket_upstream_host;'
require_text nginx/gateway.conf 'proxy_set_header Origin $http_origin;'
require_text nginx/gateway.conf 'allow 127.0.0.1;'
require_text nginx/gateway.conf 'deny all;'
require_text nginx/gateway.conf 'location / {'
require_text nginx/proxy-common.conf 'proxy_set_header Upgrade $http_upgrade;'
require_text nginx/proxy-common.conf 'proxy_set_header Connection $connection_upgrade;'
require_text nginx/proxy-common.conf 'proxy_buffering off;'
require_text nginx/proxy-opencode.conf 'proxy_set_header Authorization "";'
require_text nginx/proxy-opencode.conf 'proxy_set_header Proxy-Authorization "";'
reject_text nginx/proxy-opencode.conf 'proxy_set_header Host'
require_text nginx/proxy-opencode.conf 'proxy_set_header X-Ingenium-Authenticated-User "";'
require_text nginx/proxy-opencode.conf 'proxy_set_header X-Forwarded-For "";'
require_text nginx/proxy-opencode.conf 'proxy_set_header X-Real-IP "";'
require_text nginx/proxy-opencode.conf 'proxy_hide_header Content-Security-Policy;'
require_text nginx/proxy-opencode.conf 'proxy_hide_header X-Frame-Options;'
require_text nginx/proxy-opencode.conf 'add_header Content-Security-Policy "frame-ancestors http://localhost:3000 http://127.0.0.1:3000" always;'
reject_text nginx/proxy-opencode.conf 'frame-ancestors http://localhost:3000 http://127.0.0.1:3000 http://[::1]:3000'
reject_text nginx/proxy-opencode.conf 'frame-ancestors *'
require_text nginx/proxy-dashboard.conf 'proxy_set_header Authorization "";'
require_text nginx/proxy-dashboard.conf 'proxy_set_header X-Ingenium-Authenticated-User "";'
require_text nginx/proxy-dashboard.conf 'proxy_set_header X-Forwarded-For $remote_addr;'
require_text nginx/proxy-dashboard.conf 'proxy_set_header X-Forwarded-Host $host;'
require_text nginx/proxy-dashboard.conf 'proxy_set_header X-Forwarded-Proto $scheme;'
require_text nginx/proxy-dashboard.conf 'proxy_set_header X-Forwarded-Port $server_port;'
require_text nginx/proxy-dashboard.conf 'proxy_set_header Forwarded "";'

# Entrypoint validation: the local gateway has no Basic-auth secret or htpasswd
# artifact, while the server-side OpenCode and API credentials remain required.
require_text scripts/docker-entrypoint.sh 'OPENCODE_SERVER_PASSWORD environment variable is required'
reject_text scripts/docker-entrypoint.sh 'INGENIUM_GATEWAY_PASSWORD'
reject_text scripts/docker-entrypoint.sh 'htpasswd'
require_text scripts/docker-entrypoint.sh '/app/scripts/validate-gateway-config.sh'
require_text scripts/docker-entrypoint.sh 'install -d -o appuser -g appuser -m 0700 "$dir"'
require_text scripts/docker-entrypoint.sh 'GATEWAY_ERROR_LOG="${GATEWAY_RUNTIME_DIR}/nginx-error.log"'
require_text scripts/docker-entrypoint.sh 'install -o appuser -g appuser -m 0600 /dev/null "$GATEWAY_ERROR_LOG"'
require_text scripts/docker-entrypoint.sh 'runuser -u appuser -- env -i'
require_text scripts/docker-entrypoint.sh 'RUNTIME_API_TOKEN_FILE="${RUNTIME_SECRET_DIR}/api-token"'
require_text scripts/docker-entrypoint.sh 'chmod 0600 "$runtime_token_tmp"'
require_text scripts/docker-entrypoint.sh 'mv -f "$runtime_token_tmp" "$RUNTIME_API_TOKEN_FILE"'
require_text scripts/docker-entrypoint.sh 'unset INGENIUM_API_TOKEN'
require_text scripts/docker-entrypoint.sh 'export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"'
require_text scripts/docker-entrypoint.sh 'project-opencode-global-config.mjs "$OC_CONFIG"'
require_text scripts/docker-entrypoint.sh '"/app/packages/ingenium-extension/plugins/resource-sync.ts"'
require_text scripts/docker-entrypoint.sh '"/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"'
require_text scripts/docker-entrypoint.sh 'GLOBAL_AGENTS_DIR="/home/appuser/.config/opencode/agents"'
require_text scripts/docker-entrypoint.sh '/app/scripts/normalize-agent-profiles.sh --project-server-owned /app/.opencode/agents "$GLOBAL_AGENTS_DIR"'
require_text scripts/docker-entrypoint.sh '/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"'
require_text scripts/run-init-project.sh '/app/scripts/normalize-agent-profiles.sh "$worktree/.opencode/agents"'
require_text scripts/normalize-agent-profiles.sh 'exec node "$script_dir/project-agent-profiles.mjs" "$@"'
require_text scripts/project-agent-profiles.mjs 'constants.O_NOFOLLOW'
require_text scripts/project-agent-profiles.mjs 'constants.O_EXCL'
require_text scripts/project-agent-profiles.mjs 'fchmodSync'
require_text scripts/project-agent-profiles.mjs 'fsyncSync'
reject_text scripts/normalize-agent-profiles.sh 'chmod -R'
reject_text scripts/normalize-agent-profiles.sh 'chown'
require_text scripts/start-opencode-web.sh 'INGENIUM_API_TOKEN_FILE="/workspace/.opencode/.ingenium-api-token"'
require_text scripts/start-opencode-web.sh 'INGENIUM_WORKTREE="/workspace"'
require_text scripts/start-opencode-web.sh 'INGENIUM_OPENCODE_START_CLEAN_ENV="1"'
require_text scripts/start-opencode-web.sh 'attempts=10'
require_text scripts/start-opencode-web.sh 'node /app/scripts/probe-api.mjs'
require_text scripts/run-init-project.sh 'project="${INGENIUM_PROJECT:-global-default}"'

bash "$REPO_ROOT/tests/test-opencode-global-agent-profiles.sh"

# Express and token-bearing services remain container-only; the separate API
# boundary is loopback-only and bearer-authenticated for host MCP clients.
require_text supervisord.conf '[program:ingenium-api-boundary]'
require_text supervisord.conf 'command=/app/scripts/run-api-boundary-proxy.sh'
require_text scripts/run-api-boundary-proxy.sh 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_text scripts/run-api-boundary-proxy.sh 'INGENIUM_API_PROXY_PORT="4097"'
require_text scripts/run-api-boundary-proxy.sh 'INGENIUM_API_UPSTREAM_PORT="4096"'
require_text scripts/api-boundary-proxy.mjs 'const providedToken = incomingBearerToken(request.headers);'
require_text scripts/api-boundary-proxy.mjs 'if (!apiTokensEqual(providedToken, token)) {'
require_text scripts/api-boundary-proxy.mjs 'forwarded.authorization = `Bearer ${token}`;'
require_text scripts/run-api.sh 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_text scripts/run-dashboard.sh 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_text scripts/run-api.sh 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_text scripts/run-dashboard.sh 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
reject_text scripts/run-dashboard.mjs 'process.env.INGENIUM_API_TOKEN ='
require_text scripts/run-dashboard.mjs 'await import("/app/services/ingenium-dashboard/server.js");'

# Readiness must cover every supervised process, both private OpenCode
# listeners, the local dashboard/OpenCode roots, and the bearer API boundary.
for program in ingenium-api ingenium-api-boundary ingenium-dashboard ingenium-gateway opencode-web ttyd-opencode; do
  require_text scripts/healthcheck.sh "$program"
done
require_text scripts/healthcheck.sh 'node /app/scripts/probe-api.mjs'
require_text scripts/probe-api.mjs 'http://127.0.0.1:4097/api/v1/health'
require_text scripts/probe-api.mjs 'Authorization: `Bearer ${token}`'
# The API rejects token files owned by a different user. The entrypoint makes
# the private runtime token appuser-owned, as are all supervised token readers,
# so the Docker health command must re-exec as appuser before probing the API.
require_text scripts/docker-entrypoint.sh 'chown appuser:appuser "$runtime_token_tmp"'
require_text supervisord.conf 'user=appuser'
require_text scripts/healthcheck.sh 'exec runuser -u appuser -- env -i'
require_text scripts/healthcheck.sh 'http://127.0.0.1:3001/'
require_text scripts/healthcheck.sh 'http://127.0.0.1:4098/'
require_text scripts/healthcheck.sh 'http://127.0.0.1:3000/_ingenium/health'
require_text scripts/healthcheck.sh '"host.docker.internal" "/" "200"'
require_text scripts/healthcheck.sh '"opencode.localhost" "/" "200"'
require_text scripts/healthcheck.sh '"localhost" "/api/v1/projects" "200"'
require_text scripts/healthcheck.sh 'require_ttyd_gateway_health'
require_text scripts/healthcheck.sh 'Content-Security-Policy: frame-ancestors http://localhost:3000 http://127.0.0.1:3000'
require_text scripts/windows-loopback-transport.ps1 'Name = "dashboard-forwarded-host"'
require_text scripts/windows-loopback-transport.ps1 '/api/v1/projects'
require_text scripts/windows-loopback-transport.ps1 'Name = "opencode-web-root"'
require_text scripts/windows-loopback-transport.ps1 'Name = "opencode-cli-root"'
require_text scripts/windows-loopback-transport.ps1 '$_.Status -ne 200 -or $_.Authentication'
require_text scripts/windows-loopback-transport.ps1 'Name "api-boundary-without-bearer"'
require_text scripts/windows-loopback-transport.ps1 'Get-WslLoopbackApiStatus'
require_text scripts/windows-loopback-transport.ps1 '$apiBoundaryStatus -ne 401'
require_text scripts/windows-loopback-transport.ps1 'foreach ($port in 4098, 4099)'
require_text scripts/windows-loopback-transport.ps1 '$null -ne $_.Status'
reject_text scripts/windows-loopback-transport.ps1 'INGENIUM_GATEWAY_PASSWORD'
reject_text scripts/healthcheck.sh 'http://127.0.0.1:4099/'
require_text scripts/validate-gateway-config.sh 'nginx -t -c "$config_path"'

# Private listeners remain loopback-only inside the container. The browser
# contract is the local gateway, not a host publication of 4098/4099.
require_text scripts/start-ttyd.sh '--interface 127.0.0.1'
require_text scripts/start-ttyd.sh '--port 4099'
require_text scripts/start-ttyd.sh '--check-origin'
require_text scripts/start-opencode-web.sh 'opencode web --port 4098 --hostname 127.0.0.1'
require_text supervisord.conf 'command=/app/scripts/start-opencode-web.sh'
require_text supervisord.conf 'program:ttyd-opencode'

# OAuth uses the dedicated callback listener. It is exact-path, GET-only, and
# strips caller credentials before reaching the private API upstream.
require_text nginx/gateway.conf 'listen 1455 default_server;'
require_text nginx/gateway.conf 'location = /auth/callback'
require_text nginx/gateway.conf 'if ($request_method != GET) {'
require_text nginx/gateway.conf 'proxy_pass http://ingenium_api;'
require_text nginx/gateway.conf 'include /app/nginx/proxy-oauth-callback.conf;'
require_text nginx/gateway.conf 'return 404;'
require_text nginx/proxy-oauth-callback.conf 'proxy_set_header Authorization "";'
require_text nginx/proxy-oauth-callback.conf 'proxy_set_header Upgrade "";'
require_text nginx/proxy-oauth-callback.conf 'proxy_set_header Connection "";'
require_text nginx/proxy-oauth-callback.conf 'proxy_pass_request_body off;'

printf 'PASS: Phase 2E gateway static contracts\n'
