#!/bin/sh
# Static deployment checks that do not need Docker or a running container.
set -eu

repo_root="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
dockerfile="${repo_root}/Dockerfile"
compose_file="${repo_root}/docker-compose.yml"
dockerignore="${repo_root}/.dockerignore"
entrypoint="${repo_root}/scripts/docker-entrypoint.sh"
windows_helper="${repo_root}/scripts/windows-loopback-transport.ps1"
env_example="${repo_root}/.env.example"
supervisor_config="${repo_root}/supervisord.conf"
image_provenance_validator="${repo_root}/scripts/validate-image-provenance.mjs"

require_file() {
  path="$1"
  if [ ! -f "$path" ]; then
    echo "ERROR: required file is missing: $path"
    exit 1
  fi
}

require_literal() {
  path="$1"
  literal="$2"
  if ! grep -F -q -- "$literal" "$path"; then
    echo "ERROR: required deployment setting is missing from $path: $literal"
    exit 1
  fi
}

reject_literal() {
  path="$1"
  literal="$2"
  if grep -F -q -- "$literal" "$path"; then
    echo "ERROR: unsafe deployment setting found in $path: $literal"
    exit 1
  fi
}

for path in "$dockerfile" "$compose_file" "$dockerignore" "$entrypoint" "$windows_helper" "$env_example" "$supervisor_config" "$image_provenance_validator"; do
  require_file "$path"
done

require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_WEB_URL=\"http://opencode.localhost:3000/\""
require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_CLI_URL=\"http://cli.localhost:3000/\""
require_literal "$dockerfile" "ARG IMAGE_REVISION"
require_literal "$dockerfile" "ARG IMAGE_SOURCE=\"https://github.com/jtmb/ingenium\""
require_literal "$dockerfile" "grep -Eq '^[0-9a-f]{40}\$'"
require_literal "$dockerfile" 'case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac'
require_literal "$dockerfile" 'case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac'
require_literal "$dockerfile" "org.opencontainers.image.revision=\"\${IMAGE_REVISION}\""
require_literal "$dockerfile" "org.opencontainers.image.source=\"\${IMAGE_SOURCE}\""
reject_literal "$dockerfile" "ENV IMAGE_REVISION"
reject_literal "$dockerfile" "ENV IMAGE_SOURCE"
require_literal "$dockerfile" "FROM node:22-slim AS builder"
require_literal "$dockerfile" "FROM node:22-slim AS runtime"
reject_literal "$dockerfile" "FROM node:22-alpine AS builder"
require_literal "$dockerfile" "RUN node -e 'require(\"better-sqlite3\")'"
require_literal "$dockerfile" "RUN npm run build"
require_literal "$dockerfile" "RUN sh scripts/validate-deployment-config.sh"
# OpenCode loads the configured TypeScript plugins from source paths. Keep the
# small local dependency closure required by those entrypoints, but do not
# restore a broad extension-workspace copy to the production image.
for extension_source in auto-observer.ts observer.ts resource-sync.ts skill-sync.ts observer-core.ts project-resolver.ts api-auth.ts; do
  require_literal "$dockerfile" "COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/${extension_source} ./packages/ingenium-extension/${extension_source}"
done
reject_literal "$dockerfile" "COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/ ./packages/ingenium-extension/"
web_arg_line="$(grep -n -F 'ARG NEXT_PUBLIC_OPENCODE_WEB_URL=' "$dockerfile" | cut -d: -f1)"
cli_arg_line="$(grep -n -F 'ARG NEXT_PUBLIC_OPENCODE_CLI_URL=' "$dockerfile" | cut -d: -f1)"
build_line="$(grep -n -F 'RUN npm run build' "$dockerfile" | cut -d: -f1)"
if [ "$web_arg_line" -ge "$build_line" ] || [ "$cli_arg_line" -ge "$build_line" ]; then
  echo "ERROR: public OpenCode gateway build arguments must precede the Next.js build"
  exit 1
fi
require_literal "$compose_file" "NEXT_PUBLIC_OPENCODE_WEB_URL: \"\${NEXT_PUBLIC_OPENCODE_WEB_URL:-http://opencode.localhost:3000/}\""
require_literal "$compose_file" "NEXT_PUBLIC_OPENCODE_CLI_URL: \"\${NEXT_PUBLIC_OPENCODE_CLI_URL:-http://cli.localhost:3000/}\""
require_literal "$compose_file" "IMAGE_REVISION: \"\${IMAGE_REVISION:?IMAGE_REVISION must be set to the current Git commit SHA}\""
require_literal "$compose_file" "IMAGE_SOURCE: \"\${IMAGE_SOURCE:-https://github.com/jtmb/ingenium}\""
require_literal "$compose_file" '"3000:3000"'
reject_literal "$compose_file" "127.0.0.1:3000:3000"
require_literal "$compose_file" "127.0.0.1:4097:4097"
require_literal "$compose_file" "127.0.0.1:1455:1455"
require_literal "$compose_file" "INGENIUM_API_TOKEN=\${INGENIUM_API_TOKEN:-}"
require_literal "$compose_file" "INGENIUM_API_TOKEN_FILE=\${INGENIUM_API_TOKEN_FILE:-}"
require_literal "$compose_file" "DASHBOARD_ALLOWED_ORIGINS=\${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
reject_literal "$compose_file" "1455:4097"
require_literal "$compose_file" "driver: local"
require_literal "$compose_file" "max-size: \"10m\""
reject_literal "$compose_file" "4098:4098"
reject_literal "$compose_file" "4099:4099"
reject_literal "$compose_file" "security_opt:"
reject_literal "$compose_file" "seccomp=unconfined"
reject_literal "$dockerfile" "seccomp=unconfined"
reject_literal "$supervisor_config" "seccomp=unconfined"
reject_literal "$dockerfile" "NOPASSWD:ALL"
reject_literal "$dockerfile" "sudo"

reject_literal "$compose_file" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$compose_file" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "htpasswd"
require_literal "$entrypoint" "API token must contain 32 to 128 base64url characters"
require_literal "$entrypoint" "unset INGENIUM_API_TOKEN"
require_literal "$entrypoint" "RUNTIME_API_TOKEN_FILE=\"\${RUNTIME_SECRET_DIR}/api-token\""
require_literal "$env_example" "INGENIUM_API_TOKEN="
require_literal "$env_example" "INGENIUM_API_TOKEN_FILE=/run/secrets/ingenium-api-token"
reject_literal "$env_example" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$env_example" "INGENIUM_GATEWAY_BCRYPT_COST"

for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh; do
  require_file "${repo_root}/scripts/${script}"
  require_literal "${repo_root}/scripts/${script}" "exec env -i"
done
require_literal "${repo_root}/scripts/run-api.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "${repo_root}/scripts/run-dashboard.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "$supervisor_config" "command=/app/scripts/run-api.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-api-boundary-proxy.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-dashboard.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-gateway.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-opencode-web.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-ttyd.sh"
reject_literal "$supervisor_config" "environment="

# Nginx is supervised as appuser. It must not reopen /dev/stderr or write to
# root-owned defaults when creating its pid, lock, and request buffers.
gateway_config="${repo_root}/nginx/gateway.conf"
require_literal "$gateway_config" "pid /run/ingenium-gateway/nginx.pid;"
require_literal "$gateway_config" "lock_file /run/ingenium-gateway/nginx.lock;"
require_literal "$gateway_config" "error_log /run/ingenium-gateway/nginx-error.log warn;"
reject_literal "$gateway_config" "error_log stderr warn;"
reject_literal "$gateway_config" "error_log /dev/stderr"
require_literal "$gateway_config" "server_name _;"
reject_literal "$gateway_config" "return 444;"
require_literal "$entrypoint" "install -d -o appuser -g appuser -m 0700 \"\$dir\""
require_literal "$entrypoint" "GATEWAY_ERROR_LOG=\"\${GATEWAY_RUNTIME_DIR}/nginx-error.log\""
require_literal "$entrypoint" "install -o appuser -g appuser -m 0600 /dev/null \"\$GATEWAY_ERROR_LOG\""
require_literal "$entrypoint" "runuser -u appuser -- env -i"
require_literal "$dockerfile" "runuser -u appuser -- sh /app/scripts/validate-gateway-config.sh"
require_literal "$supervisor_config" "stdout_logfile=/run/ingenium-gateway/nginx-error.log"

# Gateway plaintext is consumed once by the entrypoint. Every supervised child
# clears it; API, boundary, and dashboard consume the protected token-file path.
for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_GATEWAY_PASSWORD"
done
for script in run-gateway.sh start-opencode-web.sh start-ttyd.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_API_TOKEN="
done
for script in run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_EMAIL_ENCRYPTION_KEY"
  reject_literal "${repo_root}/scripts/${script}" "GOOGLE_OAUTH_CLIENT_SECRET"
  reject_literal "${repo_root}/scripts/${script}" "MS_OAUTH_CLIENT_SECRET"
done

require_literal "${repo_root}/scripts/healthcheck.sh" "exec runuser -u appuser -- env -i"
require_literal "${repo_root}/scripts/healthcheck.sh" "node /app/scripts/probe-api.mjs"
reject_literal "${repo_root}/scripts/healthcheck.sh" "Authorization: Bearer \${INGENIUM_API_TOKEN"
require_literal "${repo_root}/scripts/wait-for-opencode.sh" "exec env -i"

for pattern in .git/ '**/.git/' .env '*.key' '*.pem' credentials.json .ssh/ .aws/ .ingenium/ '*.db' '*.sqlite' '**/node_modules/' '**/dist/' '**/.next/' '**/coverage/' '**/.cache/'; do
  require_literal "$dockerignore" "$pattern"
done

# Docker patterns must not be silently joined by whitespace. All repository
# patterns are intentionally simple, so a non-comment line with two tokens is
# a regression.
if grep -n -E '^[^#[:space:]][^[:space:]]*[[:space:]]+[^[:space:]#]' "$dockerignore"; then
  echo "ERROR: .dockerignore must contain one pattern per line"
  exit 1
fi

# The Windows helper is a verifier only. Persistent host-network mutation is
# intentionally outside this repository's deployment workflow.
if grep -E -q 'netsh|New-NetFirewallRule|Set-NetFirewallProfile|Add-Net' "$windows_helper"; then
  echo "ERROR: Windows loopback helper must not alter host networking"
  exit 1
fi

GATEWAY_VALIDATE_STATIC_ONLY=1 sh "${repo_root}/scripts/validate-gateway-config.sh" "${repo_root}/nginx/gateway.conf"
sh "${repo_root}/scripts/validate-api-boundary.sh" "$repo_root"
node --check "$image_provenance_validator"
echo "Deployment static validation passed"
