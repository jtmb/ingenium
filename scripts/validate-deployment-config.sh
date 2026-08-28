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
control_plane_supervisor_config="${repo_root}/control-plane-supervisord.conf"
runtime_supervisor_config="${repo_root}/runtime-supervisord.conf"
image_provenance_validator="${repo_root}/scripts/validate-image-provenance.mjs"
opencode_global_projector="${repo_root}/scripts/project-opencode-global-config.mjs"
root_opencode_config="${repo_root}/opencode.json"
runtime_entrypoint="${repo_root}/scripts/runtime-entrypoint.sh"
vscode_runner="${repo_root}/scripts/start-vscode.sh"
vscode_theme_manifest="${repo_root}/config/vscode-extensions/ingenium.system-theme-defaults/package.json"
vscode_proxy="${repo_root}/nginx/proxy-vscode.conf"
vault_secret_root_validator="${repo_root}/scripts/validate-vault-job-secret-root.sh"
runtime_gateway="${repo_root}/services/ingenium-api/scripts/runtime-gateway.ts"
protected_token_reader="${repo_root}/scripts/read-protected-api-token.mjs"
root_entrypoint_validator="${repo_root}/scripts/validate-root-entrypoint-chain.mjs"

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

reject_pattern() {
  path="$1"
  pattern="$2"
  if grep -E -q -- "$pattern" "$path"; then
    echo "ERROR: unsafe deployment pattern found in $path: $pattern"
    exit 1
  fi
}

reject_path() {
  path="$1"
  if [ -e "$path" ]; then
    echo "ERROR: obsolete deployment path exists: $path"
    exit 1
  fi
}

for path in "$dockerfile" "$compose_file" "$dockerignore" "$entrypoint" "$windows_helper" "$env_example" "$supervisor_config" "$control_plane_supervisor_config" "$runtime_supervisor_config" "$image_provenance_validator" "$opencode_global_projector" "$vscode_runner" "$vscode_theme_manifest" "$vscode_proxy" "$vault_secret_root_validator" "$runtime_gateway" "$protected_token_reader" "$root_entrypoint_validator"; do
  require_file "$path"
done

require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_WEB_URL=\"http://opencode.localhost:3000/\""
require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_CLI_URL=\"http://cli.localhost:3000/\""
require_literal "$dockerfile" "ARG NEXT_PUBLIC_RUNTIME_SCHEME=\"\""
# Keep provenance as build metadata: OCI labels record it without exposing
# these values as runtime environment variables to application processes.
require_literal "$dockerfile" "ARG IMAGE_REVISION"
require_literal "$dockerfile" "ARG IMAGE_SOURCE=\"https://github.com/jtmb/ingenium\""
require_literal "$dockerfile" "grep -Eq '^[0-9a-f]{40}\$'"
require_literal "$dockerfile" 'case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac'
require_literal "$dockerfile" 'case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac'
require_literal "$dockerfile" "org.opencontainers.image.revision=\"\${IMAGE_REVISION}\""
require_literal "$dockerfile" "org.opencontainers.image.source=\"\${IMAGE_SOURCE}\""
reject_literal "$dockerfile" "ENV IMAGE_REVISION"
reject_literal "$dockerfile" "ENV IMAGE_SOURCE"
reject_literal "$dockerfile" "/usr/local/bin/xdg-open"
require_literal "$dockerfile" "FROM node:22-slim AS builder"
require_literal "$dockerfile" "FROM node:22-slim AS runtime-base"
require_literal "$dockerfile" "FROM runtime-base AS user-runtime"
require_literal "$dockerfile" "FROM runtime-base AS runtime-manager"
require_literal "$dockerfile" "FROM runtime-base AS runtime-gateway"
require_literal "$dockerfile" "FROM runtime-base AS control-plane"
require_literal "$dockerfile" "FROM runtime-base AS compatibility"
reject_literal "$dockerfile" "FROM node:22-alpine AS builder"
require_literal "$dockerfile" "RUN node -e 'require(\"better-sqlite3\")'"
require_literal "$dockerfile" "RUN npm run build"
require_literal "$dockerfile" "RUN sh scripts/validate-deployment-config.sh"
require_literal "$dockerfile" "https://github.com/coder/code-server/releases/download/v4.131.0/code-server-4.131.0-linux-amd64.tar.gz"
require_literal "$dockerfile" "f6316f0b14ef5c12ed6e67e0154dd02ccf5e66112064687d7e93c51763105361"
require_literal "$dockerfile" "tar -xzf /tmp/code-server.tar.gz -C /usr/local/lib/code-server --strip-components=1"
require_literal "$dockerfile" "code-server --version | grep -Eq"
require_literal "$dockerfile" "https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix"
require_literal "$dockerfile" "e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4"
require_literal "$dockerfile" "curl --proto '=https' --tlsv1.2 -fsSL"
require_literal "$dockerfile" "/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"
require_literal "$dockerfile" "install -o root -g root -m 0444"
require_literal "$dockerfile" 'code-server --user-data-dir "$extension_temp_dir/user-data" --extensions-dir "$extension_temp_dir/extensions" --install-extension "$extension_file" --force'
require_literal "$dockerfile" 'code-server --user-data-dir "$extension_temp_dir/user-data" --extensions-dir "$extension_temp_dir/extensions" --list-extensions --show-versions'
require_literal "$dockerfile" 'test "$extension_list" = "sst-dev.opencode@0.0.13"'
require_literal "$dockerfile" 'manifest.publisher!=="sst-dev"'
require_literal "$dockerfile" 'manifest.name!=="opencode"'
require_literal "$dockerfile" 'manifest.version!=="0.0.13"'
require_literal "$dockerfile" 'manifest.engines?.vscode'
require_literal "$dockerfile" 'rm -rf "$extension_temp_dir"'
require_literal "$dockerfile" 'test "$(stat -c '\''%U:%G:%a'\'' "$extension_file")" = "root:root:444"'
reject_literal "$dockerfile" "sst-dev/opencode/latest"
require_literal "$dockerfile" "scripts/start-vscode.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0444 config/vscode-extensions/ingenium.system-theme-defaults/package.json /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json"
require_literal "$dockerfile" 'builtin_manifest="/usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json"'
require_literal "$dockerfile" 'builtin_dir="$(dirname "$builtin_manifest")"'
require_literal "$dockerfile" 'test -d "/usr/local/lib/code-server/lib/vscode/extensions"'
require_literal "$dockerfile" 'chmod 0755 "$builtin_dir"'
require_literal "$dockerfile" 'runuser -u appuser -- test -r /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json'
require_literal "$dockerfile" 'manifest.name!=="system-theme-defaults"'
require_literal "$dockerfile" 'manifest.publisher!=="ingenium"'
require_literal "$dockerfile" 'manifest.version!=="1.0.0"'
require_literal "$dockerfile" 'configurationDefaults'
require_literal "$dockerfile" '"window.autoDetectColorScheme":true'
require_literal "$dockerfile" '"workbench.preferredDarkColorTheme":"Dark Modern"'
require_literal "$dockerfile" '"workbench.preferredLightColorTheme":"Light Modern"'
require_literal "$dockerfile" 'forbidden=["main","browser","activationEvents","scripts","dependencies","devDependencies","permissions"]'
require_literal "$dockerfile" 'fs.readdirSync(require("path").dirname(manifestPath)).sort()'
reject_literal "$dockerfile" "ensure-vscode-settings"
require_literal "$dockerfile" "nginx/proxy-vscode.conf"
require_literal "$dockerfile" "scripts/generate-dashboard-safe-read-policy.mjs"
require_literal "$dockerfile" "nginx/dashboard-safe-reads-map.conf"
require_literal "$dockerfile" "services/ingenium-api/config/dashboard-safe-reads.json ./services/ingenium-api/dist/config/dashboard-safe-reads.json"
require_literal "$dockerfile" "EXPOSE 3000 4097 1455"
require_literal "$dockerfile" "validate-vault-job-secret-root.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/validate-vault-job-secret-root.sh scripts/validate-process-isolation.sh ./scripts/"
require_literal "$dockerfile" '`/dev/shm` is a container-runtime tmpfs'
reject_pattern "$dockerfile" 'RUN[[:space:]].*(mkdir|install).*/dev/shm/ingenium-job-secrets'
reject_literal "$dockerfile" "3002"
reject_pattern "$dockerfile" '^EXPOSE .*4100'
# OpenCode loads the configured TypeScript plugins from source paths. Keep the
# small local dependency closure required by those entrypoints, but do not
# restore a broad extension-workspace copy to the production image.
for extension_source in plugin-specs.mjs auto-observer.ts plugins/auto-observer.ts observer.ts plugins/observer.ts resource-sync.ts plugins/resource-sync.ts session-coordinator.ts plugins/session-coordinator.ts skill-sync.ts observer-core.ts project-resolver.ts api-auth.ts; do
  require_literal "$dockerfile" "COPY --from=builder --chown=root:root /app/packages/ingenium-extension/${extension_source} ./packages/ingenium-extension/${extension_source}"
done
require_literal "$dockerfile" "COPY --from=builder --chown=root:root /app/packages/ingenium-extension/ponytail ./packages/ingenium-extension/ponytail"
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
require_literal "$compose_file" "NEXT_PUBLIC_RUNTIME_SCHEME: \"\${INGENIUM_RUNTIME_SCHEME:-http}\""
require_literal "$compose_file" '"${INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS:-127.0.0.1}:${INGENIUM_RUNTIME_GATEWAY_HOST_PORT:-80}:${INGENIUM_RUNTIME_GATEWAY_PORT:-8080}"'
require_literal "$compose_file" "INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS=\${INGENIUM_RUNTIME_GATEWAY_BIND_ADDRESS:-127.0.0.1}"
require_literal "$compose_file" "INGENIUM_RUNTIME_GATEWAY_HOST_PORT=\${INGENIUM_RUNTIME_GATEWAY_HOST_PORT:-80}"
reject_literal "$compose_file" '"443:8443"'
require_literal "$compose_file" "IMAGE_REVISION: \"\${IMAGE_REVISION:?IMAGE_REVISION must be set to the current Git commit SHA}\""
require_literal "$compose_file" "IMAGE_SOURCE: \"\${IMAGE_SOURCE:-https://github.com/jtmb/ingenium}\""
require_literal "$compose_file" '"3000:3000"'
reject_literal "$compose_file" "127.0.0.1:3000:3000"
reject_literal "$compose_file" "3002"
require_literal "$compose_file" "127.0.0.1:4097:4097"
require_literal "$compose_file" "127.0.0.1:1455:1455"
require_literal "$compose_file" "vscode-data:/home/ingenium-vscode/vscode-data"
reject_pattern "$compose_file" '(^|[^0-9])4100:4100([^0-9]|$)'
reject_literal "$compose_file" "INGENIUM_API_TOKEN=\${INGENIUM_API_TOKEN:-}"
require_literal "$compose_file" "INGENIUM_API_TOKEN_FILE=/run/ingenium-bootstrap/api-token"
require_literal "$compose_file" '${INGENIUM_API_TOKEN_FILE:?INGENIUM_API_TOKEN_FILE must point to the protected host installation token}:/run/ingenium-bootstrap/api-token:ro'
require_literal "$compose_file" "INGENIUM_BACKUPS_DIR=\${INGENIUM_BACKUPS_DIR:-}"
require_literal "$compose_file" "DASHBOARD_ALLOWED_ORIGINS=\${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
reject_literal "$compose_file" "1455:4097"
require_literal "$runtime_gateway" "export function runtimeGatewayTransportConfig"
require_literal "$runtime_gateway" 'Local runtime HTTP must use 127.0.0.1:80 and container port 8080'
require_literal "$runtime_gateway" 'Remote runtime HTTPS must use 0.0.0.0:443 and container port 8443'
require_literal "$compose_file" "driver: local"
require_literal "$compose_file" "max-size: \"10m\""
reject_literal "$compose_file" "4098:4098"
reject_literal "$compose_file" "4099:4099"
require_literal "$compose_file" "security_opt:"
require_literal "$compose_file" "cap_drop:"
reject_literal "$compose_file" "seccomp=unconfined"
reject_literal "$dockerfile" "seccomp=unconfined"
reject_literal "$supervisor_config" "seccomp=unconfined"
reject_literal "$dockerfile" "NOPASSWD:ALL"
reject_literal "$dockerfile" "sudo"
require_literal "$compose_file" 'profiles: ["compatibility"]'
require_literal "$compose_file" 'profiles: ["production"]'
require_literal "$compose_file" 'profiles: ["runtime-build"]'
require_literal "$compose_file" '/var/run/docker.sock:/var/run/docker.sock'
socket_mounts="$(grep -F -c -- '/var/run/docker.sock:/var/run/docker.sock' "$compose_file")"
if [ "$socket_mounts" -ne 1 ]; then
  echo "ERROR: exactly one Docker socket mount is required"
  exit 1
fi
require_literal "$compose_file" 'INGENIUM_RUNTIME_MANAGER_TOKEN_FILE=/run/ingenium-runtime-manager/token'
require_literal "$compose_file" 'INGENIUM_RUNTIME_MANAGER_BOOTSTRAP_TOKEN_FILE=/run/ingenium-bootstrap/runtime-manager-token'
require_literal "$compose_file" 'INGENIUM_RUNTIME_GATEWAY_BOOTSTRAP_TOKEN_FILE=/run/ingenium-bootstrap/runtime-gateway-token'
require_literal "$compose_file" 'test: ["CMD", "setpriv", "--reuid=1110", "--regid=1110", "--clear-groups", "node", "/app/scripts/runtime-gateway-healthcheck.mjs"]'
require_literal "$compose_file" 'INGENIUM_RUNTIME_WORKSPACE_MAP_FILE=/run/ingenium-secrets/runtime-manager/workspaces.json'
require_literal "$compose_file" 'INGENIUM_RUNTIME_WORKSPACE_BOOTSTRAP_MAP_FILE=/run/ingenium-bootstrap/runtime-workspaces.json'
require_literal "$compose_file" 'ingenium-data:/app/.ingenium'
require_literal "$compose_file" 'opencode-config:/home/ingenium-opencode/.config'
require_literal "$compose_file" 'opencode-data:/home/ingenium-opencode/.local'
require_literal "$compose_file" 'INGENIUM_RUNTIME_WORKSPACE_VALIDATION_SOURCE:-./config'
require_literal "$compose_file" 'INGENIUM_RUNTIME_WORKSPACE_VALIDATION_TARGET:-/workspace-validation'
reject_literal "$compose_file" 'control-plane-data:'
reject_literal "$compose_file" 'control-plane-opencode-config:'
reject_literal "$compose_file" 'control-plane-opencode-data:'
require_literal "$compose_file" 'INGENIUM_RUNTIME_NETWORK_PREFIX=ingenium-runtime-'
require_literal "$compose_file" 'INGENIUM_RUNTIME_API_URL=http://ingenium-control-plane:4097/api/v1/'
require_literal "$runtime_gateway" '"X-Ingenium-Audience": "runtime-gateway"'
reject_literal "$runtime_gateway" '"X-Ingenium-Runtime-Gateway": "1"'
opencode_password_wires="$(grep -F -c -- 'OPENCODE_SERVER_PASSWORD_FILE=/run/ingenium-bootstrap/opencode-server-password' "$compose_file")"
if [ "$opencode_password_wires" -ne 2 ]; then
  echo "ERROR: compatibility and production control plane must both use the protected OpenCode server credential file"
  exit 1
fi
email_key_wires="$(grep -F -c -- 'INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/run/ingenium-bootstrap/email-encryption-key' "$compose_file")"
if [ "$email_key_wires" -ne 2 ]; then
  echo "ERROR: compatibility and production control plane must both use the protected email encryption key file"
  exit 1
fi
reject_literal "$compose_file" 'OPENCODE_SERVER_PASSWORD=${'
reject_literal "$compose_file" 'INGENIUM_EMAIL_ENCRYPTION_KEY=${'

reject_literal "$compose_file" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$compose_file" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "htpasswd"
require_literal "$entrypoint" 'INGENIUM_API_TOKEN_FILE is required'
require_literal "$entrypoint" "unset INGENIUM_API_TOKEN"
require_literal "$entrypoint" 'RUNTIME_API_TOKEN_FILE="${RUNTIME_API_SECRET_DIR}/installation-api-token"'
require_literal "$entrypoint" 'node /app/scripts/read-protected-api-token.mjs'
require_literal "$entrypoint" 'node /app/scripts/validate-root-entrypoint-chain.mjs'
require_literal "$protected_token_reader" 'constants.O_RDONLY | constants.O_NOFOLLOW'
require_literal "$protected_token_reader" '(metadata.mode & 0o777) !== 0o600'
require_literal "$dockerfile" 'COPY --chown=root:root --chmod=0555 scripts/docker-entrypoint.sh ./entrypoint.sh'
require_literal "$dockerfile" 'chmod 0755 /app /app/packages /app/services /app/services/ingenium-api'
require_literal "$dockerfile" 'chmod 0555 /app/scripts /app/entrypoint.sh /app/scripts/*.sh'
require_literal "$dockerfile" 'chmod 0444 /app/control-plane-supervisord.conf /app/runtime-supervisord.conf /app/supervisord.conf /app/scripts/*.mjs'
require_literal "$dockerfile" 'node /app/scripts/validate-root-entrypoint-chain.mjs'
require_literal "$dockerfile" 'install -d -o root -g root -m 0555 /usr/local/share/ingenium/opencode-managed /usr/local/share/ingenium/opencode-managed/agents /usr/local/share/ingenium/opencode-managed/plugins /etc/opencode'
require_literal "$dockerfile" 'install -o root -g root -m 0444 /app/config/opencode-managed/opencode.json /usr/local/share/ingenium/opencode-managed/opencode.json'
require_literal "$dockerfile" 'install -o root -g root -m 0444 /app/config/opencode-managed/enforce-reserved-broker.mjs /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker.mjs'
require_literal "$dockerfile" 'install -o root -g root -m 0444 /app/.opencode/agents/execution/ingenium-llm-broker.md /usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md'
require_literal "$dockerfile" 'ln -s /usr/local/share/ingenium/opencode-managed/opencode.json /etc/opencode/opencode.json'
require_literal "$dockerfile" 'import("file:///app/packages/ingenium-core/dist/lib/index.js")'
require_literal "$dockerfile" 'trustedAgents.validateProtectedOpenCodeDeployment()'
require_literal "$dockerfile" 'useradd --system --uid 1109 --gid 1109 --home-dir /home/ingenium-runtime-manager'
require_literal "$dockerfile" 'useradd --system --uid 1110 --gid 1110 --home-dir /home/ingenium-runtime-gateway'
require_literal "$dockerfile" 'ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "manager"]'
require_literal "$dockerfile" 'ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "gateway"]'
require_literal "$dockerfile" 'runtime-gateway-healthcheck.mjs'
require_literal "$root_entrypoint_validator" '"/app/node_modules"'
require_literal "$root_entrypoint_validator" '"/app/packages"'
require_literal "$root_entrypoint_validator" '"/app/services"'
require_literal "$root_entrypoint_validator" '"/usr/local/share/ingenium/opencode-managed"'
require_literal "$entrypoint" 'validate-vault-job-secret-root.sh provision'
require_literal "$entrypoint" 'vault job secret root provisioning requires root'
require_line_before "$entrypoint" 'validate-vault-job-secret-root.sh provision' 'RUNTIME_API_OPENCODE_PASSWORD_FILE='
reject_literal "$entrypoint" 'rm -rf /dev/shm/ingenium-job-secrets'
require_literal "$entrypoint" 'OC_AUTH="/home/ingenium-opencode/.local/share/opencode/auth.json"'
require_literal "$entrypoint" 'secure_persistent_path file "$OC_CONFIG" "$OPENCODE_UID" "$OPENCODE_CONFIG_GID" 0660'
require_literal "$entrypoint" 'secure_persistent_path file "$OC_AUTH" "$OPENCODE_UID" "$OPENCODE_GID" 0600'
reject_literal "$env_example" "INGENIUM_API_TOKEN="
require_literal "$env_example" "INGENIUM_API_TOKEN_FILE=/home/you/.config/ingenium/live-production/installation-api.token"
require_literal "$env_example" "OPENCODE_SERVER_PASSWORD="
require_literal "$env_example" "OPENCODE_SERVER_PASSWORD_FILE=/absolute/path/to/opencode-server.password"
require_literal "$env_example" "INGENIUM_EMAIL_ENCRYPTION_KEY="
require_literal "$env_example" "INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/absolute/path/to/email-encryption.key"
reject_literal "$env_example" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$env_example" "INGENIUM_GATEWAY_BCRYPT_COST"

for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh run-restore-handoff.sh run-restore-maintenance.sh recover-restore-maintenance.sh run-init-project.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  require_file "${repo_root}/scripts/${script}"
  require_literal "${repo_root}/scripts/${script}" "exec env -i"
done
require_file "${repo_root}/scripts/normalize-agent-profiles.sh"
require_file "${repo_root}/scripts/project-agent-profiles.mjs"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" 'if (entry.name === RESERVED_BROKER_PROFILE) continue;'
reject_literal "${repo_root}/scripts/project-agent-profiles.mjs" '["execution", "ingenium-llm-broker.md"]'
require_literal "${repo_root}/scripts/run-api.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "${repo_root}/scripts/run-api.sh" 'backup_dir="${INGENIUM_BACKUPS_DIR:-}"'
require_literal "${repo_root}/scripts/run-api.sh" '*[![:space:]]*) ;;'
require_literal "${repo_root}/scripts/run-api.sh" '*) backup_dir="/app/.ingenium/backups" ;;'
require_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_BACKUPS_DIR="$backup_dir"'
require_literal "${repo_root}/scripts/run-api.sh" 'deployment_mode="${INGENIUM_DEPLOYMENT_MODE:?INGENIUM_DEPLOYMENT_MODE is required}"'
require_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_DEPLOYMENT_MODE="$deployment_mode"'
require_literal "${repo_root}/scripts/run-api.sh" 'OPENCODE_SERVER_PASSWORD_FILE="$opencode_password_file"'
require_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_EMAIL_ENCRYPTION_KEY_FILE="$email_encryption_key_file"'
reject_literal "${repo_root}/scripts/run-api.sh" 'OPENCODE_SERVER_PASSWORD="'
reject_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_EMAIL_ENCRYPTION_KEY="'
for runtime_setting in \
  INGENIUM_RUNTIME_MANAGER_URL \
  INGENIUM_RUNTIME_MANAGER_TOKEN_FILE \
  INGENIUM_RUNTIME_RECONCILE_INTERVAL_MS \
  INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER \
  INGENIUM_RUNTIME_CPU_MILLIS \
  INGENIUM_RUNTIME_MEMORY_BYTES \
  INGENIUM_RUNTIME_PIDS_LIMIT \
  INGENIUM_RUNTIME_DISK_BYTES \
  INGENIUM_RUNTIME_PROCESS_LIMIT \
  INGENIUM_RUNTIME_IDLE_LEASE_MS \
  INGENIUM_RUNTIME_ABSOLUTE_LEASE_MS; do
  require_literal "${repo_root}/scripts/run-api.sh" ": \"\${${runtime_setting}:?${runtime_setting} is required in control-plane mode}\""
  require_literal "${repo_root}/scripts/run-api.sh" "${runtime_setting}=\"\${${runtime_setting}"
done
require_literal "${repo_root}/scripts/run-dashboard.sh" 'DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"'
require_literal "$supervisor_config" "command=/app/scripts/run-api.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-api-boundary-proxy.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-dashboard.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-gateway.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-opencode-web.sh"
require_literal "$supervisor_config" "command=/app/scripts/start-ttyd.sh"
require_literal "$supervisor_config" "[program:vscode]"
require_literal "$supervisor_config" "command=/app/scripts/start-vscode.sh"
require_literal "$supervisor_config" "[program:restore-maintenance]"
require_literal "$supervisor_config" "command=/app/scripts/run-restore-maintenance.sh"
require_literal "$supervisor_config" "command=/app/scripts/run-restore-handoff.sh"
require_literal "$supervisor_config" "user=ingenium-restore"
require_literal "$supervisor_config" "autostart=false"
require_literal "$supervisor_config" "stopasgroup=true"
require_literal "$dockerfile" "scripts/run-restore-handoff.sh scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/run-restore-handoff.sh scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh ./scripts/"
reject_literal "$supervisor_config" "environment="
require_literal "$dockerfile" "scripts/project-opencode-global-config.mjs"
require_literal "$dockerfile" "scripts/run-init-project.sh"
require_literal "$dockerfile" "scripts/normalize-agent-profiles.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh"
require_line_before "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/" "COPY --chown=root:root --chmod=0555 scripts/run-init-project.sh ./scripts/run-init-project.sh"
require_line_before "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/normalize-agent-profiles.sh scripts/project-agent-profiles.mjs ./scripts/" "/usr/local/bin/ingenium-init-project --help"
require_literal "$entrypoint" "project-opencode-global-config.mjs"
require_literal "$root_opencode_config" '"INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential"'
reject_literal "$root_opencode_config" '"INGENIUM_MCP_CREDENTIAL"'
reject_literal "$entrypoint" '"INGENIUM_MCP_CREDENTIAL":'
require_literal "$runtime_entrypoint" '"INGENIUM_MCP_CREDENTIAL_FILE": "/run/ingenium-runtime/capability"'
reject_literal "$runtime_entrypoint" '"INGENIUM_MCP_CREDENTIAL":'
require_literal "$runtime_entrypoint" 'import("file:///app/packages/ingenium-core/dist/lib/index.js")'
require_literal "$runtime_entrypoint" 'trustedAgents.validateProtectedOpenCodeDeployment()'
reject_literal "$runtime_entrypoint" 'from "ingenium-core"'
require_literal "$entrypoint" '"INGENIUM_WORKTREE": "/workspace"'
require_literal "$entrypoint" '"file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts"'
require_literal "$entrypoint" '"file://{env:PWD}/packages/ingenium-extension/plugins/session-coordinator.ts"'
require_literal "$entrypoint" '"file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"'
require_literal "$entrypoint" 'secure_persistent_path tree /app/.ingenium "$API_UID" "$RESTORE_DATA_GID" 2770 0660 backups'
require_literal "$entrypoint" 'fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW'
require_literal "$entrypoint" 'setfacl -m u:ingenium-api:--x,u:ingenium-restore:--x /home/ingenium-opencode /home/ingenium-opencode/.local /home/ingenium-opencode/.local/share'
require_literal "$entrypoint" '/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"'
require_literal "$entrypoint" '[ "$(basename "$source_profile")" = "ingenium-llm-broker.md" ] && continue'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_MCP_CREDENTIAL_FILE=".opencode/.ingenium-repository-sync-credential"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_MCP_AUDIENCE="repository-sync"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_WORKTREE="/workspace"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_WORKSPACE_ID="global-default-workspace"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'OPENCODE_CONFIG_DIR="/home/ingenium-opencode/.config/opencode/runtime"'
require_literal "${repo_root}/scripts/start-runtime-opencode-web.sh" 'OPENCODE_CONFIG_DIR="/home/appuser/.config/opencode/runtime"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'attempts=10'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'node /app/scripts/probe-api.mjs'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'opencode serve --port 4098 --hostname 127.0.0.1'
reject_literal "${repo_root}/scripts/start-opencode-web.sh" 'opencode web'
require_literal "$vscode_runner" 'compatibility:ingenium-vscode) VSCODE_DATA_DIR="/home/ingenium-vscode/vscode-data"'
require_literal "$vscode_runner" 'user-runtime:appuser) VSCODE_DATA_DIR="/home/appuser/vscode-data"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_FILE="/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_ID="sst-dev.opencode@0.0.13"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_SHA256="e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4"'
require_literal "$vscode_runner" '"${1:-}" != "--clean-env"'
require_literal "$vscode_runner" '/bin/sh "$0" --clean-env'
require_literal "$vscode_runner" 'case "$INGENIUM_DEPLOYMENT_MODE:$(id -un)" in'
require_literal "$vscode_runner" '[ ! -f "$VSCODE_EXTENSION_FILE" ] || [ -L "$VSCODE_EXTENSION_FILE" ]'
require_literal "$vscode_runner" 'sha256sum "$VSCODE_EXTENSION_FILE"'
require_literal "$vscode_runner" 'code_server --list-extensions --show-versions'
require_literal "$vscode_runner" 'code_server --install-extension "$VSCODE_EXTENSION_FILE" --force'
require_literal "$vscode_runner" 'normalized_extension="$(printf '\''%s'\'' "$extension" | tr '\''[:upper:]'\'' '\''[:lower:]'\'' | tr -d '\''[:space:]'\'')"'
require_literal "$vscode_runner" 'case "$normalized_extension" in'
require_literal "$vscode_runner" 'sst-dev.opencode@*)'
require_literal "$vscode_runner" 'if [ "$extension" != "$VSCODE_EXTENSION_ID" ]; then'
require_literal "$vscode_runner" '[ "$found" -eq 1 ]'
reject_literal "$vscode_runner" "open-vsx.org"
reject_literal "$vscode_runner" "https://"
reject_literal "$vscode_runner" "http://"
reject_literal "$vscode_runner" '--install-extension sst-dev.opencode'
reject_pattern "$vscode_runner" 'rm[[:space:]].*extensions'
require_literal "$vscode_runner" '--bind-addr "${INGENIUM_RUNTIME_BIND_HOST:-127.0.0.1}:4100"'
require_literal "$vscode_runner" '--auth none'
require_literal "$vscode_runner" '--disable-telemetry'
require_literal "$vscode_runner" '--disable-update-check'
require_literal "$vscode_runner" '--user-data-dir "${VSCODE_DATA_DIR}/user-data"'
require_literal "$vscode_runner" '--extensions-dir "${VSCODE_DATA_DIR}/extensions"'
require_literal "$vscode_runner" 'administrator-grade'
require_literal "$vscode_runner" 'unsupported for LAN, remote, shared, or untrusted users'
require_literal "$vscode_runner" 'full-terminal'
reject_literal "$vscode_runner" 'INGENIUM_API_TOKEN'
reject_literal "$vscode_runner" 'disable-terminal'
reject_literal "$vscode_runner" "ensure-vscode-settings"
reject_pattern "$vscode_runner" 'settings\.json|VSCODE_SETTINGS'
reject_path "${repo_root}/scripts/ensure-vscode-settings.mjs"
reject_path "${repo_root}/scripts/ensure-vscode-settings.test.mjs"
require_literal "$vscode_theme_manifest" '"name": "system-theme-defaults"'
require_literal "$vscode_theme_manifest" '"publisher": "ingenium"'
require_literal "$vscode_theme_manifest" '"version": "1.0.0"'
  require_literal "$vscode_theme_manifest" '"vscode": "^1.131.0"'
require_literal "$vscode_theme_manifest" '"window.autoDetectColorScheme": true'
require_literal "$vscode_theme_manifest" '"workbench.preferredDarkColorTheme": "Dark Modern"'
require_literal "$vscode_theme_manifest" '"workbench.preferredLightColorTheme": "Light Modern"'
reject_pattern "$vscode_theme_manifest" '"(main|browser|activationEvents|scripts|dependencies|devDependencies|permissions|workbench\.colorTheme|security\.workspace\.trust|update\.)"'
require_literal "${repo_root}/scripts/run-init-project.sh" 'project="${INGENIUM_PROJECT:-global-default}"'
require_literal "${repo_root}/scripts/run-init-project.sh" 'INGENIUM_MCP_CREDENTIAL_FILE="$credential_file"'
require_literal "${repo_root}/scripts/run-init-project.sh" 'INGENIUM_MCP_AUDIENCE="repository-sync"'
require_literal "${repo_root}/scripts/run-init-project.sh" '/app/scripts/normalize-agent-profiles.sh "$worktree/.opencode/agents"'
require_literal "${repo_root}/scripts/normalize-agent-profiles.sh" 'exec node "$script_dir/project-agent-profiles.mjs" "$@"'
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "constants.O_NOFOLLOW"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "constants.O_EXCL"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "fchmodSync"
require_literal "${repo_root}/scripts/project-agent-profiles.mjs" "fsyncSync"
reject_literal "${repo_root}/scripts/normalize-agent-profiles.sh" "chmod -R"
reject_literal "${repo_root}/scripts/normalize-agent-profiles.sh" "chown"

# Nginx is supervised as its dedicated identity. It must not reopen /dev/stderr or write to
# root-owned defaults when creating its pid, lock, and request buffers.
gateway_config="${repo_root}/nginx/gateway.conf"
require_literal "$gateway_config" "pid /run/ingenium-gateway/nginx.pid;"
require_literal "$gateway_config" "lock_file /run/ingenium-gateway/nginx.lock;"
require_literal "$gateway_config" "error_log /run/ingenium-gateway/nginx-error.log warn;"
reject_literal "$gateway_config" "error_log stderr warn;"
reject_literal "$gateway_config" "error_log /dev/stderr"
require_literal "$gateway_config" "server_name _;"
reject_literal "$gateway_config" "return 444;"
require_literal "$entrypoint" "install -d -o ingenium-gateway -g ingenium-gateway -m 0700 \"\$dir\""
require_literal "$entrypoint" "GATEWAY_ERROR_LOG=\"\${GATEWAY_RUNTIME_DIR}/nginx-error.log\""
require_literal "$entrypoint" "install -o ingenium-gateway -g ingenium-gateway -m 0600 /dev/null \"\$GATEWAY_ERROR_LOG\""
require_literal "$entrypoint" "runuser -u ingenium-gateway -- env -i"
require_literal "$dockerfile" "runuser -u ingenium-gateway -- sh /app/scripts/validate-gateway-config.sh"
require_literal "$supervisor_config" "stdout_logfile=/run/ingenium-gateway/nginx-error.log"

# Gateway plaintext is consumed once by the entrypoint. Every supervised child
# clears it; API, boundary, and dashboard consume the protected token-file path.
for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_GATEWAY_PASSWORD"
done
for script in run-gateway.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_API_TOKEN="
done
for script in run-init-project.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_API_TOKEN_FILE"
done
for script in run-dashboard.sh run-gateway.sh run-restore-handoff.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_EMAIL_ENCRYPTION_KEY"
  reject_literal "${repo_root}/scripts/${script}" "GOOGLE_OAUTH_CLIENT_SECRET"
  reject_literal "${repo_root}/scripts/${script}" "MS_OAUTH_CLIENT_SECRET"
done
require_literal "${repo_root}/scripts/run-restore-handoff.sh" "exec env -i"

require_literal "${repo_root}/scripts/healthcheck.sh" "exec env -i"
require_literal "${repo_root}/scripts/healthcheck.sh" "node /app/scripts/probe-api.mjs"
require_literal "${repo_root}/scripts/healthcheck.sh" "validate-vault-job-secret-root.sh verify"
require_literal "${repo_root}/scripts/healthcheck.sh" 'programs="$programs opencode-web opencode-internal-proxy ttyd-opencode vscode"'
require_literal "${repo_root}/scripts/healthcheck.sh" "require_restore_maintenance_safe"
require_literal "$entrypoint" "recover-restore-maintenance.sh"
require_literal "$dockerfile" "appuser-gid"
require_literal "$entrypoint" "TRUSTED_ARTIFACT_GID_FILE"
require_literal "${repo_root}/scripts/run-api.sh" "INGENIUM_TRUSTED_ARTIFACT_GID"
require_literal "${repo_root}/scripts/run-restore-maintenance.sh" "INGENIUM_TRUSTED_ARTIFACT_GID"
require_literal "$entrypoint" "RESTORE_JOURNAL_KEY_FILE=\"/app/.ingenium/restore-journal-key\""
require_literal "$entrypoint" "restore journal key must be restore-owned mode 0600"
require_literal "$entrypoint" 'provision-auth-encryption-key.sh "$AUTH_ENCRYPTION_KEY_FILE" root root'
require_literal "${repo_root}/scripts/run-api.sh" 'INGENIUM_AUTH_ENCRYPTION_KEY_FILE="$auth_encryption_key_file"'
require_literal "$dockerfile" 'scripts/provision-auth-encryption-key.sh ./scripts/provision-auth-encryption-key.sh'
require_literal "$entrypoint" 'secure_persistent_path directory "$RESTORE_MAINTENANCE_DIR" "$RESTORE_UID" "$RESTORE_GID" 0700'
require_literal "${repo_root}/scripts/healthcheck.sh" "http://127.0.0.1:4100/healthz"
require_literal "${repo_root}/scripts/healthcheck.sh" '"VS Code gateway root" "vscode.localhost" "/" "302"'
require_literal "${repo_root}/scripts/healthcheck.sh" '"VS Code gateway workbench" "vscode.localhost" "/?folder=/workspace" "200"'
require_literal "${repo_root}/scripts/healthcheck.sh" "Content-Security-Policy: frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000"
reject_literal "${repo_root}/scripts/healthcheck.sh" '"3002"'
reject_literal "${repo_root}/scripts/healthcheck.sh" "Authorization: Bearer \${INGENIUM_API_TOKEN"
require_literal "$vault_secret_root_validator" '/dev/shm/ingenium-job-secrets'
require_literal "$vault_secret_root_validator" "stat -fc '%T' /dev/shm"
require_literal "$vault_secret_root_validator" 'chown "${owner_uid}:${owner_gid}" "$root"'
require_literal "$vault_secret_root_validator" 'chmod 0700 "$root"'
reject_literal "$vault_secret_root_validator" 'rm -rf'
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
node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const defaults={"window.autoDetectColorScheme":true,"workbench.preferredDarkColorTheme":"Dark Modern","workbench.preferredLightColorTheme":"Light Modern"}; const forbidden=["main","browser","activationEvents","scripts","dependencies","devDependencies","permissions"]; if (manifest.name!=="system-theme-defaults" || manifest.publisher!=="ingenium" || manifest.version!=="1.0.0" || manifest.engines?.vscode!=="^1.131.0" || JSON.stringify(manifest.contributes?.configurationDefaults)!==JSON.stringify(defaults) || forbidden.some((key)=>Object.hasOwn(manifest,key))) process.exit(1);' "$vscode_theme_manifest"
echo "Deployment static validation passed"
