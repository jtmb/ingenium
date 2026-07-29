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
opencode_global_projector="${repo_root}/scripts/project-opencode-global-config.mjs"
thread_bridge_launcher="${repo_root}/scripts/run-thread-bridge.mjs"
thread_bridge_guard="${repo_root}/scripts/thread-bridge-guard.mjs"
thread_guard_service="${repo_root}/scripts/thread-guard-service.mjs"
thread_revision="a3d2d4246e2a0222242d1a848abd3f0bd79a690b"

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

require_line_before() {
  path="$1"
  earlier="$2"
  later="$3"
  earlier_line="$(grep -n -F -- "$earlier" "$path" | cut -d: -f1)"
  later_line="$(grep -n -F -- "$later" "$path" | cut -d: -f1)"
  if [ -z "$earlier_line" ] || [ -z "$later_line" ] || [ "$earlier_line" -ge "$later_line" ]; then
    echo "ERROR: required deployment copy order is missing from $path: $earlier must precede $later"
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

service_block() {
  service_name="$1"
  awk -v service_name="$service_name" '
    $0 == "  " service_name ":" { capture = 1 }
    capture && $0 ~ /^  [[:alnum:]_-]+:$/ && $0 != "  " service_name ":" { exit }
    capture { print }
  ' "$compose_file"
}

docker_stage_block() {
  stage_name="$1"
  awk -v stage_name="$stage_name" '
    $0 ~ "^FROM .* AS " stage_name "$" { capture = 1; next }
    capture && $0 ~ /^FROM / { exit }
    capture { print }
  ' "$dockerfile"
}

for path in "$dockerfile" "$compose_file" "$dockerignore" "$entrypoint" "$windows_helper" "$env_example" "$supervisor_config" "$image_provenance_validator" "$opencode_global_projector" "$thread_bridge_launcher" "$thread_bridge_guard" "$thread_guard_service"; do
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
require_literal "$dockerfile" "ARG THREAD_REVISION=${thread_revision}"
require_literal "$dockerfile" "test \"\$THREAD_REVISION\" = \"${thread_revision}\""
require_literal "$dockerfile" 'git fetch --depth=1 origin "$THREAD_REVISION"'
require_literal "$dockerfile" 'git checkout --detach FETCH_HEAD'
require_literal "$dockerfile" 'test "$(git rev-parse HEAD)" = "$THREAD_REVISION"'
require_literal "$dockerfile" "-r thread_server/requirements.txt"
require_literal "$dockerfile" "-r thread_bridge/requirements.txt"
require_literal "$dockerfile" "FROM node:22-slim AS thread-runtime"
require_literal "$dockerfile" "COPY --from=thread-builder --chown=appuser:appuser /opt/thread /opt/thread"
require_literal "$dockerfile" 'ENTRYPOINT ["/usr/bin/tini", "--"]'
require_literal "$dockerfile" 'CMD ["/opt/thread/venv/bin/python", "-m", "thread_server.server"]'
reject_literal "$dockerfile" "git clone"
reject_literal "$dockerfile" "checkout main"
# OpenCode loads the configured TypeScript plugins from source paths. Keep the
# small local dependency closure required by those entrypoints, but do not
# restore a broad extension-workspace copy to the production image.
for extension_source in auto-observer.ts plugins/auto-observer.ts observer.ts plugins/observer.ts resource-sync.ts plugins/resource-sync.ts skill-sync.ts observer-core.ts project-resolver.ts api-auth.ts; do
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
require_literal "$compose_file" "INGENIUM_BACKUPS_DIR=\${INGENIUM_BACKUPS_DIR:-}"
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

# Thread is deliberately isolated from host and provider networks. Only the
# guard spans the backend and frontend networks; Ingenium has no raw Thread
# route even when a user directly registers the upstream bridge executable.
require_literal "$compose_file" "target: thread-runtime"
require_literal "$compose_file" "target: thread-guard-runtime"
require_literal "$compose_file" "- THREAD_AUTH_ENABLED=false"
require_literal "$compose_file" "- THREAD_HOST=0.0.0.0"
require_literal "$compose_file" "- THREAD_PORT=5000"
require_literal "$compose_file" "- THREAD_DB_PATH=/app/data/thread.db"
require_literal "$compose_file" "- THREAD_GIT_BASE=/app/data/git"
require_literal "$compose_file" "- thread_data:/app/data"
require_literal "$compose_file" "thread_data:"
require_literal "$compose_file" "thread-backend:"
require_literal "$compose_file" "thread-frontend:"
require_literal "$compose_file" "internal: true"
require_literal "$compose_file" "condition: service_healthy"

ingenium_service="$(service_block ingenium)"
thread_service="$(service_block thread)"
thread_guard_service_block="$(service_block thread-guard)"
if [ -z "$ingenium_service" ] || [ -z "$thread_service" ] || [ -z "$thread_guard_service_block" ]; then
  echo "ERROR: Ingenium, Thread, and thread-guard services must all be present"
  exit 1
fi
if ! printf '%s\n' "$ingenium_service" | grep -F -q -- "- default" || \
   ! printf '%s\n' "$ingenium_service" | grep -F -q -- "- thread-frontend" || \
   printf '%s\n' "$ingenium_service" | grep -F -q -- "- thread-backend"; then
  echo "ERROR: Ingenium must retain only provider and Thread frontend networks"
  exit 1
fi
if ! printf '%s\n' "$thread_service" | grep -F -q -- "- thread-backend" || \
   printf '%s\n' "$thread_service" | grep -E -q '^[[:space:]]*ports:' || \
   printf '%s\n' "$thread_service" | grep -F -q -- "- default" || \
   printf '%s\n' "$thread_service" | grep -F -q -- "- thread-frontend"; then
  echo "ERROR: Thread must have no host ports and only the Thread backend network"
  exit 1
fi
if ! printf '%s\n' "$thread_guard_service_block" | grep -F -q -- "- thread-backend" || \
   ! printf '%s\n' "$thread_guard_service_block" | grep -F -q -- "- thread-frontend" || \
   ! printf '%s\n' "$thread_guard_service_block" | grep -F -q -- 'user: "1000:1000"' || \
   ! printf '%s\n' "$thread_guard_service_block" | grep -F -q -- "read_only: true" || \
   printf '%s\n' "$thread_guard_service_block" | grep -E -q '^[[:space:]]*ports:' || \
   printf '%s\n' "$thread_guard_service_block" | grep -F -q -- "- default"; then
  echo "ERROR: thread-guard must be non-root, have no host ports, and bridge only Thread networks"
  exit 1
fi

# The local child never includes a raw Thread client or route. The guard service
# owns the pinned bridge and forces every session at the backend boundary.
require_literal "$thread_bridge_launcher" 'guardUrl: "http://thread-guard:8081/v1/call"'
require_literal "$thread_bridge_guard" 'THREAD_BRIDGE_SESSION = "ingenium"'
require_literal "$thread_bridge_guard" 'THREAD_BRIDGE_EXPORT_DIRECTORY = "/workspace/ingenium/.ingenium/thread-exports"'
require_literal "$thread_bridge_guard" 'thread_upload_file'
require_literal "$thread_bridge_guard" 'thread_search'
require_literal "$thread_bridge_guard" 'thread_read_entries'
require_literal "$thread_bridge_guard" 'constants.O_NOFOLLOW'
require_literal "$thread_bridge_guard" 'fstatSync'
require_literal "$thread_bridge_guard" 'readThreadUploadArtifact'
require_literal "$thread_guard_service" 'THREAD_SERVER_URL: "http://thread:5000"'
require_literal "$thread_guard_service" '"-m", "thread_bridge.bridge"'
require_literal "$thread_guard_service" 'THREAD_GUARD_SESSION = "ingenium"'
require_literal "$thread_guard_service" 'thread_read_entries_batch'
require_literal "$thread_guard_service" 'thread_get_tags'
require_literal "$thread_guard_service" 'thread_get_stats'
require_literal "$thread_guard_service" 'constants.O_EXCL'
require_literal "$thread_guard_service" 'detached: process.platform !== "win32"'
reject_literal "$thread_bridge_launcher" "thread:5000"
reject_literal "$thread_bridge_launcher" "thread_bridge.bridge"
reject_literal "$thread_bridge_launcher" "THREAD_DEFAULT_SESSION"
reject_literal "$thread_bridge_launcher" "THREAD_API_TOKEN"
reject_literal "$thread_bridge_launcher" "THREAD_AUTH_PASSWORD"
require_literal "$dockerfile" "scripts/run-thread-bridge.mjs"
require_literal "$dockerfile" "scripts/thread-bridge-guard.mjs"
require_literal "$dockerfile" "scripts/thread-guard-service.mjs"
require_literal "$dockerfile" "--chmod=0555 scripts/run-thread-bridge.mjs"
runtime_stage="$(docker_stage_block runtime)"
thread_guard_stage="$(docker_stage_block thread-guard-runtime)"
if printf '%s\n' "$runtime_stage" | grep -F -q -- "/opt/thread" || \
   printf '%s\n' "$runtime_stage" | grep -F -q -- "thread-guard-service.mjs" || \
   ! printf '%s\n' "$thread_guard_stage" | grep -F -q -- "COPY --from=thread-builder --chown=appuser:appuser /opt/thread /opt/thread"; then
  echo "ERROR: only thread-guard may receive the official Thread bridge runtime"
  exit 1
fi

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

for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh run-init-project.sh start-opencode-web.sh start-ttyd.sh; do
  require_file "${repo_root}/scripts/${script}"
  require_literal "${repo_root}/scripts/${script}" "exec env -i"
done
require_file "${repo_root}/scripts/normalize-agent-profiles.sh"
require_file "${repo_root}/scripts/project-agent-profiles.mjs"
require_literal "${repo_root}/scripts/run-api.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "${repo_root}/scripts/run-api.sh" 'backup_dir="${INGENIUM_BACKUPS_DIR:-}"'
require_literal "${repo_root}/scripts/run-api.sh" '*[![:space:]]*) ;;'
require_literal "${repo_root}/scripts/run-api.sh" '*) backup_dir="/app/.ingenium/backups" ;;'
require_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_BACKUPS_DIR="$backup_dir"'
require_literal "${repo_root}/scripts/run-dashboard.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "$supervisor_config" "command=/app/scripts/run-api.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-api-boundary-proxy.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-dashboard.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-gateway.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-opencode-web.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-ttyd.sh"
reject_literal "$supervisor_config" "environment="
require_literal "$dockerfile" "scripts/project-opencode-global-config.mjs"
require_literal "$dockerfile" "scripts/run-init-project.sh"
require_literal "$dockerfile" "scripts/normalize-agent-profiles.sh"
require_literal "$dockerfile" "COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/"
require_literal "$dockerfile" "COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh"
require_line_before "$dockerfile" "COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/" "COPY --chown=appuser:appuser --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh"
require_line_before "$dockerfile" "COPY --chown=appuser:appuser --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/" "/usr/local/bin/ingenium-init-project --help"
require_literal "$entrypoint" "project-opencode-global-config.mjs"
require_literal "$entrypoint" '"INGENIUM_WORKTREE": "/workspace"'
require_literal "$entrypoint" '"/app/packages/ingenium-extension/plugins/resource-sync.ts"'
require_literal "$entrypoint" '/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_API_TOKEN_FILE="/workspace/.opencode/.ingenium-api-token"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_WORKTREE="/workspace"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_OPENCODE_START_CLEAN_ENV="1"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'attempts=10'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'node /app/scripts/probe-api.mjs'
require_literal "${repo_root}/scripts/run-init-project.sh" 'project="${INGENIUM_PROJECT:-global-default}"'
require_literal "${repo_root}/scripts/run-init-project.sh" 'INGENIUM_API_TOKEN_FILE="$token_file"'
require_literal "${repo_root}/scripts/run-init-project.sh" '/app/scripts/normalize-agent-profiles.sh "$worktree/.opencode/agents"'
require_literal "${repo_root}/scripts/normalize-agent-profiles.sh" 'exec node "$script_dir/project-agent-profiles.mjs" "$@"'
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "constants.O_NOFOLLOW"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "constants.O_EXCL"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "fchmodSync"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "fsyncSync"
reject_literal "${repo_root}/scripts/normalize-agent-profiles.sh" "chmod -R"
reject_literal "${repo_root}/scripts/normalize-agent-profiles.sh" "chown"

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
node --check "$opencode_global_projector"
node --check "$thread_bridge_launcher"
node --check "$thread_bridge_guard"
node --check "$thread_guard_service"
echo "Deployment static validation passed"
