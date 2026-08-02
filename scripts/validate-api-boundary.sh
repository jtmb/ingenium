#!/bin/sh
# Static API/Docker boundary checks. This intentionally never reads .env values.
set -eu

repo_root="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
compose_file="${repo_root}/docker-compose.yml"
dockerfile="${repo_root}/Dockerfile"
gitignore="${repo_root}/.gitignore"
dockerignore="${repo_root}/.dockerignore"
entrypoint="${repo_root}/scripts/docker-entrypoint.sh"
run_api="${repo_root}/scripts/run-api.sh"
healthcheck="${repo_root}/scripts/healthcheck.sh"
api_probe="${repo_root}/scripts/probe-api.mjs"
dashboard_runner="${repo_root}/scripts/run-dashboard.sh"
dashboard_proxy="${repo_root}/services/ingenium-dashboard/src/proxy.ts"
dashboard_token="${repo_root}/services/ingenium-dashboard/src/lib/dashboard-token.ts"
auth_middleware="${repo_root}/services/ingenium-api/lib/middleware/auth.ts"
api_token_middleware="${repo_root}/services/ingenium-api/lib/middleware/api-token.ts"
csrf_middleware="${repo_root}/services/ingenium-api/lib/middleware/csrf.ts"
api_server="${repo_root}/services/ingenium-api/scripts/api-server.ts"
scheduler="${repo_root}/services/ingenium-api/lib/scheduler.ts"
gateway="${repo_root}/nginx/gateway.conf"
callback_proxy="${repo_root}/nginx/proxy-oauth-callback.conf"
bootstrap="${repo_root}/scripts/bootstrap-local-secrets.sh"
boundary_proxy="${repo_root}/scripts/api-boundary-proxy.mjs"
boundary_proxy_runner="${repo_root}/scripts/run-api-boundary-proxy.sh"
supervisor_config="${repo_root}/supervisord.conf"

require_file() {
  path="$1"
  [ -f "$path" ] || { echo "ERROR: required file is missing: $path"; exit 1; }
}

require_literal() {
  path="$1"
  literal="$2"
  if ! grep -F -q -- "$literal" "$path"; then
    echo "ERROR: required API boundary setting is missing from $path: $literal"
    exit 1
  fi
}

reject_literal() {
  path="$1"
  literal="$2"
  if grep -F -q -- "$literal" "$path"; then
    echo "ERROR: unsafe API boundary setting found in $path: $literal"
    exit 1
  fi
}

reject_pattern() {
  path="$1"
  pattern="$2"
  if grep -E -q -- "$pattern" "$path"; then
    echo "ERROR: unsafe API boundary pattern found in $path: $pattern"
    exit 1
  fi
}

for path in "$compose_file" "$dockerfile" "$gitignore" "$dockerignore" "$entrypoint" "$run_api" "$healthcheck" "$api_probe" "$dashboard_runner" "$dashboard_proxy" "$dashboard_token" "$auth_middleware" "$api_token_middleware" "$csrf_middleware" "$api_server" "$scheduler" "$gateway" "$callback_proxy" "$bootstrap" "$boundary_proxy" "$boundary_proxy_runner" "$supervisor_config"; do
  require_file "$path"
done

require_literal "$compose_file" '127.0.0.1:4097:4097'
require_literal "$compose_file" '127.0.0.1:1455:1455'
require_literal "$compose_file" 'INGENIUM_API_TOKEN=${INGENIUM_API_TOKEN:-}'
require_literal "$compose_file" 'INGENIUM_API_TOKEN_FILE=${INGENIUM_API_TOKEN_FILE:-}'
require_literal "$compose_file" 'DASHBOARD_ALLOWED_ORIGINS=${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}'
require_literal "$compose_file" 'INGENIUM_API_PORT=4096'
reject_literal "$compose_file" '1455:4097'
reject_literal "$compose_file" '4096:4096'
require_literal "$dockerfile" 'scripts/validate-api-boundary.sh'
require_literal "$dockerfile" 'scripts/api-boundary-proxy.mjs'
require_literal "$dockerfile" 'scripts/probe-api.mjs'
require_literal "$dockerfile" 'scripts/run-api-boundary-proxy.sh'
require_literal "$dockerfile" 'nginx/proxy-oauth-callback.conf'
require_literal "$gitignore" '.opencode/.ingenium-api-token'
require_literal "$dockerignore" '.opencode/.ingenium-api-token'

require_literal "$entrypoint" 'INGENIUM_API_TOKEN or INGENIUM_API_TOKEN_FILE is required'
require_literal "$entrypoint" 'API token must contain 32 to 128 base64url characters'
require_literal "$entrypoint" 'RUNTIME_API_TOKEN_FILE="${RUNTIME_SECRET_DIR}/api-token"'
require_literal "$entrypoint" 'unset INGENIUM_API_TOKEN'
require_literal "$run_api" 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_literal "${repo_root}/scripts/run-dashboard.sh" 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_literal "$run_api" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "${repo_root}/scripts/run-dashboard.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
reject_pattern "$dashboard_runner" 'INGENIUM_API_TOKEN='
require_literal "$dashboard_runner" 'node /app/services/ingenium-dashboard/server.js'
require_literal "$dashboard_proxy" 'import { loadDashboardApiToken } from "./lib/dashboard-token";'
require_literal "$dashboard_proxy" 'return loadDashboardApiToken(environment);'
require_literal "$dashboard_proxy" 'headers.set("authorization", `Bearer ${token}`);'
require_literal "$dashboard_token" 'const configuredFile = environment.INGENIUM_API_TOKEN_FILE;'
require_literal "$dashboard_token" 'return readDashboardApiTokenFile(configuredFile.trim());'
reject_pattern "$dashboard_token" '(^|[^_[:alnum:]])INGENIUM_API_TOKEN([^_[:alnum:]]|$)'
require_literal "$boundary_proxy_runner" 'exec env -i'
require_literal "$boundary_proxy_runner" 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_literal "$boundary_proxy_runner" 'INGENIUM_API_UPSTREAM_PORT="4096"'
require_literal "$boundary_proxy" 'forwarded.authorization = `Bearer ${token}`;'
require_literal "$boundary_proxy" 'const providedToken = incomingBearerToken(request.headers);'
require_literal "$boundary_proxy" 'if (!apiTokensEqual(providedToken, token)) {'
require_literal "$boundary_proxy" 'server.listen(proxyPort, "0.0.0.0"'
require_literal "$supervisor_config" '[program:ingenium-api-boundary]'
require_literal "$supervisor_config" 'command=/app/scripts/run-api-boundary-proxy.sh'
require_literal "$bootstrap" 'chmod 0600 "$env_file"'
require_literal "$bootstrap" 'chmod 0600 "$token_file"'
require_literal "$bootstrap" '.env must not be a symbolic link'
require_literal "$bootstrap" '.opencode/.ingenium-api-token must not be a symbolic link'
reject_literal "$bootstrap" 'INGENIUM_EMAIL_ENCRYPTION_KEY='

require_literal "$auth_middleware" 'isPublicOAuthCallbackRequest'
require_literal "$auth_middleware" 'API_AUTH_NOT_CONFIGURED'
require_literal "$auth_middleware" 'loadApiToken()'
require_literal "$api_token_middleware" 'API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/'
require_literal "$api_token_middleware" 'constants.O_NOFOLLOW'
require_literal "$api_token_middleware" 'API token file must not be group- or world-readable'
require_literal "$api_server" 'app.use(authMiddleware);'
require_literal "$api_server" 'app.use(csrfMiddleware);'
require_literal "$api_server" 'app.listen(config.port, "127.0.0.1"'
require_literal "$csrf_middleware" 'Unsafe browser API requests require the trusted dashboard origin and request marker'
require_literal "$csrf_middleware" 'config.dashboardOrigins.includes(origin)'
require_literal "$api_server" 'app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);'
auth_line="$(grep -n -F 'app.use(authMiddleware);' "$api_server" | cut -d: -f1)"
callback_line="$(grep -n -F 'app.get("/auth/callback", createOAuthCallbackRateLimiter(), handleOAuthCallback);' "$api_server" | cut -d: -f1)"
if [ "$auth_line" -ge "$callback_line" ]; then
  echo "ERROR: OAuth callback must be routed through the explicit auth allowlist"
  exit 1
fi
require_literal "$scheduler" 'headers: { Authorization: `Bearer ${token}` }'
require_literal "$healthcheck" 'exec runuser -u appuser -- env -i'
require_literal "$healthcheck" 'node /app/scripts/probe-api.mjs'
require_literal "$api_probe" 'loadApiToken(process.env)'
require_literal "$api_probe" 'Authorization: `Bearer ${token}`'
reject_literal "$healthcheck" 'Authorization: Bearer ${INGENIUM_API_TOKEN'
require_literal "${repo_root}/scripts/wait-for-opencode.sh" 'exec env -i'

require_literal "$gateway" 'listen 1455 default_server;'
require_literal "$gateway" 'location = /auth/callback'
require_literal "$gateway" 'if ($request_method != GET) {'
require_literal "$gateway" 'return 405;'
require_literal "$gateway" 'limit_except GET {'
require_literal "$gateway" 'proxy_pass http://ingenium_api;'
require_literal "$gateway" 'server 127.0.0.1:4096;'
require_literal "$gateway" 'include /app/nginx/proxy-oauth-callback.conf;'
require_literal "$gateway" 'return 404;'
callback_locations="$(grep -F -c 'location = /auth/callback' "$gateway")"
if [ "$callback_locations" -ne 1 ]; then
  echo "ERROR: callback listener must contain exactly one exact callback location"
  exit 1
fi
require_literal "$callback_proxy" 'proxy_set_header Authorization "";'
require_literal "$callback_proxy" 'proxy_set_header Proxy-Authorization "";'
require_literal "$callback_proxy" 'proxy_set_header X-Forwarded-For "";'
require_literal "$callback_proxy" 'proxy_set_header Upgrade "";'
require_literal "$callback_proxy" 'proxy_set_header Connection "";'
require_literal "$callback_proxy" 'proxy_pass_request_body off;'

echo "API boundary static validation passed"
