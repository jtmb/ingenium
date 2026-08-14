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
vscode_runner="${repo_root}/scripts/start-vscode.sh"
vscode_theme_manifest="${repo_root}/config/vscode-extensions/ingenium.system-theme-defaults/package.json"
vscode_proxy="${repo_root}/nginx/proxy-vscode.conf"
vault_secret_root_validator="${repo_root}/scripts/validate-vault-job-secret-root.sh"

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

for path in "$dockerfile" "$compose_file" "$dockerignore" "$entrypoint" "$windows_helper" "$env_example" "$supervisor_config" "$image_provenance_validator" "$opencode_global_projector" "$vscode_runner" "$vscode_theme_manifest" "$vscode_proxy" "$vault_secret_root_validator"; do
  require_file "$path"
done

require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_WEB_URL=\"http://opencode.localhost:3000/\""
require_literal "$dockerfile" "ARG NEXT_PUBLIC_OPENCODE_CLI_URL=\"http://cli.localhost:3000/\""
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
require_literal "$dockerfile" "FROM node:22-slim AS runtime"
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
require_literal "$dockerfile" "EXPOSE 3000 4097 1455"
require_literal "$dockerfile" "validate-vault-job-secret-root.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/validate-vault-job-secret-root.sh ./scripts/validate-vault-job-secret-root.sh"
require_literal "$dockerfile" '`/dev/shm` is a container-runtime tmpfs'
reject_pattern "$dockerfile" 'RUN[[:space:]].*(mkdir|install).*/dev/shm/ingenium-job-secrets'
reject_literal "$dockerfile" "3002"
reject_pattern "$dockerfile" '^EXPOSE .*4100'
# OpenCode loads the configured TypeScript plugins from source paths. Keep the
# small local dependency closure required by those entrypoints, but do not
# restore a broad extension-workspace copy to the production image.
for extension_source in auto-observer.ts plugins/auto-observer.ts observer.ts plugins/observer.ts resource-sync.ts plugins/resource-sync.ts skill-sync.ts observer-core.ts project-resolver.ts api-auth.ts; do
  require_literal "$dockerfile" "COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/${extension_source} ./packages/ingenium-extension/${extension_source}"
done
require_literal "$dockerfile" "COPY --from=builder --chown=appuser:appuser /app/packages/ingenium-extension/ponytail ./packages/ingenium-extension/ponytail"
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
reject_literal "$compose_file" "3002"
require_literal "$compose_file" "127.0.0.1:4097:4097"
require_literal "$compose_file" "127.0.0.1:1455:1455"
require_literal "$compose_file" "vscode-data:/home/appuser/vscode-data"
reject_pattern "$compose_file" '(^|[^0-9])4100:4100([^0-9]|$)'
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

reject_literal "$compose_file" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$compose_file" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$entrypoint" "INGENIUM_GATEWAY_BCRYPT_COST"
reject_literal "$entrypoint" "htpasswd"
require_literal "$entrypoint" "API token must contain 32 to 128 base64url characters"
require_literal "$entrypoint" "unset INGENIUM_API_TOKEN"
require_literal "$entrypoint" "RUNTIME_API_TOKEN_FILE=\"\${RUNTIME_SECRET_DIR}/api-token\""
require_literal "$entrypoint" 'validate-vault-job-secret-root.sh provision'
require_literal "$entrypoint" 'vault job secret root provisioning requires root'
require_line_before "$entrypoint" 'validate-vault-job-secret-root.sh provision' 'OPENCODE_SERVER_PASSWORD environment variable is required'
reject_literal "$entrypoint" 'rm -rf /dev/shm/ingenium-job-secrets'
require_literal "$entrypoint" 'OC_AUTH="/home/appuser/.local/share/opencode/auth.json"'
require_literal "$entrypoint" 'chmod 0600 "$OC_CONFIG"'
require_literal "$entrypoint" 'chmod 0600 "$OC_AUTH"'
require_literal "$env_example" "INGENIUM_API_TOKEN="
require_literal "$env_example" "INGENIUM_API_TOKEN_FILE=/run/secrets/ingenium-api-token"
reject_literal "$env_example" "INGENIUM_GATEWAY_PASSWORD"
reject_literal "$env_example" "INGENIUM_GATEWAY_BCRYPT_COST"

for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh run-restore-maintenance.sh recover-restore-maintenance.sh run-init-project.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
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
require_literal "$supervisor_config" "[program:vscode]"
require_literal "$supervisor_config" "command=/app/scripts/start-vscode.sh"
require_literal "$supervisor_config" "[program:restore-maintenance]"
require_literal "$supervisor_config" "command=/app/scripts/run-restore-maintenance.sh"
require_literal "$supervisor_config" "user=root"
require_literal "$supervisor_config" "autostart=false"
require_literal "$supervisor_config" "stopasgroup=true"
require_literal "$dockerfile" "scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh"
require_literal "$dockerfile" "COPY --chown=root:root --chmod=0555 scripts/run-restore-maintenance.sh scripts/recover-restore-maintenance.sh ./scripts/"
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
require_literal "$entrypoint" '"/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"'
require_literal "$entrypoint" '/app/scripts/normalize-agent-profiles.sh "$WORKSPACE_AGENTS_DIR"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_MCP_CREDENTIAL_FILE=".opencode/.ingenium-repository-sync-credential"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_MCP_AUDIENCE="repository-sync"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_WORKTREE="/workspace"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'INGENIUM_WORKSPACE_ID="global-default-workspace"'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'attempts=10'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'node /app/scripts/probe-api.mjs'
require_literal "${repo_root}/scripts/start-opencode-web.sh" 'opencode serve --port 4098 --hostname 127.0.0.1'
reject_literal "${repo_root}/scripts/start-opencode-web.sh" 'opencode web'
require_literal "$vscode_runner" 'VSCODE_DATA_DIR="/home/appuser/vscode-data"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_FILE="/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_ID="sst-dev.opencode@0.0.13"'
require_literal "$vscode_runner" 'VSCODE_EXTENSION_SHA256="e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4"'
require_literal "$vscode_runner" '"${1:-}" != "--clean-env"'
require_literal "$vscode_runner" '/bin/sh "$0" --clean-env'
require_literal "$vscode_runner" '"$(id -un)" != "appuser"'
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
require_literal "$vscode_runner" '--bind-addr 127.0.0.1:4100'
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
for script in run-api.sh run-api-boundary-proxy.sh run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_GATEWAY_PASSWORD"
done
for script in run-gateway.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_API_TOKEN="
done
for script in run-init-project.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_API_TOKEN_FILE"
done
for script in run-dashboard.sh run-gateway.sh start-opencode-web.sh start-ttyd.sh start-vscode.sh; do
  reject_literal "${repo_root}/scripts/${script}" "INGENIUM_EMAIL_ENCRYPTION_KEY"
  reject_literal "${repo_root}/scripts/${script}" "GOOGLE_OAUTH_CLIENT_SECRET"
  reject_literal "${repo_root}/scripts/${script}" "MS_OAUTH_CLIENT_SECRET"
done

require_literal "${repo_root}/scripts/healthcheck.sh" "exec runuser -u appuser -- env -i"
require_literal "${repo_root}/scripts/healthcheck.sh" "node /app/scripts/probe-api.mjs"
require_literal "${repo_root}/scripts/healthcheck.sh" "validate-vault-job-secret-root.sh verify"
require_literal "${repo_root}/scripts/healthcheck.sh" "ttyd-opencode vscode; do"
require_literal "${repo_root}/scripts/healthcheck.sh" "require_restore_maintenance_safe"
require_literal "$entrypoint" "recover-restore-maintenance.sh"
require_literal "$dockerfile" "appuser-gid"
require_literal "$entrypoint" "TRUSTED_ARTIFACT_GID_FILE"
require_literal "${repo_root}/scripts/run-api.sh" "INGENIUM_TRUSTED_ARTIFACT_GID"
require_literal "${repo_root}/scripts/run-restore-maintenance.sh" "INGENIUM_TRUSTED_ARTIFACT_GID"
require_literal "$entrypoint" "RESTORE_JOURNAL_KEY_FILE=\"/app/.ingenium/restore-journal-key\""
require_literal "$entrypoint" "restore journal key must be root-owned mode 0600"
require_literal "$entrypoint" "chown root:root \"\$RESTORE_MAINTENANCE_DIR\""
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
