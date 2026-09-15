#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_pair() {
  local config="$1" program="$2" user="$3"
  node - "$config" "$program" "$user" <<'NODE' || exit 1
const fs = require("node:fs");
const [path, program, user] = process.argv.slice(2);
const source = fs.readFileSync(path, "utf8");
const block = source.split(`[program:${program}]`)[1]?.split(/\n\[/, 1)[0] ?? "";
if (!block.includes(`user=${user}`)) process.exit(1);
NODE
}

for config in "$ROOT/supervisord.conf" "$ROOT/control-plane-supervisord.conf"; do
  grep -Fq '[unix_http_server]' "$config" || fail "Supervisor does not use its private Unix socket"
  ! grep -Fq '[inet_http_server]' "$config" || fail "Supervisor exposes unauthenticated HTTP control"
  grep -Fq 'chown=root:ingenium-api' "$config" || fail "API cannot read Supervisor status through the private socket"
  require_pair "$config" ingenium-api ingenium-api
  require_pair "$config" ingenium-api-boundary ingenium-boundary
  require_pair "$config" ingenium-dashboard ingenium-dashboard
  require_pair "$config" ingenium-gateway ingenium-gateway
  require_pair "$config" restore-handoff ingenium-restore
  require_pair "$config" restore-maintenance ingenium-restore
done

grep -Fq 'install -d -o root -g ingenium-api -m 0770 /run/ingenium-supervisor' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail "Supervisor socket directory is not restricted to the API and restore identities"
grep -Fq 'fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail "persistent path provisioning does not use no-follow directory descriptors"
grep -Fq 'fs.fchownSync(descriptor' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail "persistent path ownership is not changed through a validated descriptor"
grep -Fq 'verifyStillLinked(parent, finalName, targetDescriptor)' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail "persistent path replacement races are not rejected"
[[ "$(grep -Fc 'node /app/scripts/validate-root-entrypoint-chain.mjs' "$ROOT/scripts/docker-entrypoint.sh")" -eq 2 ]] \
  || fail "immutable root entrypoint chain is not revalidated before Supervisor"
grep -Fq -- '--groups ingenium-api,ingenium-restore-data,ingenium-opencode-restore' "$ROOT/Dockerfile" \
  || fail "restore identity cannot access the API-group Supervisor socket"

require_pair "$ROOT/supervisord.conf" opencode-web ingenium-opencode
require_pair "$ROOT/supervisord.conf" opencode-internal-proxy ingenium-opencode
require_pair "$ROOT/supervisord.conf" ttyd-opencode ingenium-ttyd
require_pair "$ROOT/supervisord.conf" vscode ingenium-vscode

for script in run-api-boundary-proxy.sh run-gateway.sh start-ttyd.sh start-vscode.sh; do
  ! grep -Eq 'INGENIUM_API_TOKEN_FILE|INGENIUM_EMAIL_ENCRYPTION_KEY_FILE|OPENCODE_SERVER_PASSWORD_FILE' "$ROOT/scripts/$script" \
    || fail "$script receives a deployment secret"
done
! grep -Eq 'INGENIUM_API_TOKEN_FILE|INGENIUM_EMAIL_ENCRYPTION_KEY_FILE' "$ROOT/scripts/start-opencode-web.sh" \
  || fail "OpenCode web receives an unrelated deployment secret"
! grep -Eq 'INGENIUM_API_TOKEN_FILE|INGENIUM_EMAIL_ENCRYPTION_KEY_FILE|OPENCODE_SERVER_PASSWORD_FILE' "$ROOT/scripts/run-restore-maintenance.sh" \
  || fail "restore maintenance receives an unrelated deployment secret"
grep -Fq 'exec env -i' "$ROOT/scripts/run-restore-handoff.sh" \
  || fail "restore handoff does not clear the inherited Supervisor environment"

grep -Fq 'INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE="$token_file"' "$ROOT/scripts/run-dashboard.sh" \
  || fail "Dashboard does not use its isolated bootstrap credential"
grep -Fq '/run/ingenium-secrets/api/installation-api-token' "$ROOT/scripts/run-api.sh" \
  || fail "private API installation credential path is missing"
grep -Fq '/run/ingenium-secrets/opencode/opencode-server-password' "$ROOT/scripts/start-opencode-auth-proxy.sh" \
  || fail "OpenCode internal proxy credential path is missing"

grep -Fq 'INGENIUM_MCP_AUDIENCE: MCP_REPORT_AUDIENCE' "$ROOT/services/ingenium-api/lib/mcp-usefulness-collector.ts" \
  || fail "MCP report child does not use its dedicated audience"
! grep -Fq 'INGENIUM_API_TOKEN_FILE:' "$ROOT/services/ingenium-api/lib/mcp-usefulness-collector.ts" \
  || fail "MCP report child receives the installation bearer"
! grep -Fq 'INGENIUM_INTERNAL_SERVICE:' "$ROOT/services/ingenium-api/lib/mcp-usefulness-collector.ts" \
  || fail "MCP report child receives installation-service authority"
grep -Fq 'MCP_REPORT_CREDENTIAL_DIRECTORY = "/run/ingenium-secrets/api"' "$ROOT/services/ingenium-api/lib/mcp-report-auth.ts" \
  || fail "MCP report credentials are not confined to the API secret directory"
grep -Fq 'INGENIUM_MCP_REPORT_MODE !== "1"' "$ROOT/services/ingenium-server/config/index.ts" \
  || fail "MCP transport does not gate report credential loading"
grep -Fq '/home/ingenium-api/.config' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail "API-owned MCP report HOME is incomplete"

for identity in \
  '1109 --gid 1109 --home-dir /home/ingenium-runtime-manager' \
  '1110 --gid 1110 --home-dir /home/ingenium-runtime-gateway'; do
  grep -Fq -- "$identity" "$ROOT/Dockerfile" || fail "runtime control identity is not immutable: $identity"
done
grep -Fq 'ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "manager"]' "$ROOT/Dockerfile" \
  || fail "runtime manager does not drop from its trusted root entrypoint"
grep -Fq 'ENTRYPOINT ["/app/scripts/runtime-control-entrypoint.sh", "gateway"]' "$ROOT/Dockerfile" \
  || fail "runtime gateway does not drop from its trusted root entrypoint"
[[ "$(grep -Fc '/var/run/docker.sock:/var/run/docker.sock' "$ROOT/docker-compose.yml")" -eq 1 ]] \
  || fail "Docker socket access is not exclusive to the runtime manager"
grep -Fq 'runtime-gateway-healthcheck.mjs' "$ROOT/docker-compose.yml" \
  || fail "runtime gateway has no mandatory healthcheck"

printf 'PASS: Supervisor identities and launcher secret surfaces are isolated\n'
