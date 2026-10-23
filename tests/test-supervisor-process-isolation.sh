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

require_supervisor_file_logs() {
  node - "$1" <<'NODE' || exit 1
const fs = require("node:fs");
const source = fs.readFileSync(process.argv[2], "utf8");
const paths = new Set();
for (const section of source.split(/\n(?=\[)/)) {
  const program = section.match(/^\[program:([^\]]+)\]/)?.[1];
  if (!program || program === "ingenium-gateway") continue;
  for (const stream of ["stdout", "stderr"]) {
    const path = section.match(new RegExp(`^${stream}_logfile=([^\\n]+)$`, "m"))?.[1];
    if (!path?.startsWith("/run/ingenium-supervisor/") || paths.has(path)) process.exit(1);
    paths.add(path);
  }
}
NODE
}

for config in "$ROOT/supervisord.conf" "$ROOT/control-plane-supervisord.conf"; do
  grep -Fq '[unix_http_server]' "$config" || fail "Supervisor does not use its private Unix socket"
  ! grep -Fq '[inet_http_server]' "$config" || fail "Supervisor exposes unauthenticated HTTP control"
  grep -Fq 'chown=root:ingenium-api' "$config" || fail "API cannot read Supervisor status through the private socket"
  require_supervisor_file_logs "$config"
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

node --input-type=module - "$ROOT" <<'NODE'
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const readScript = (name) => fs.readFileSync(join(root, 'scripts', name), 'utf8');
const entrypoint = readScript('docker-entrypoint.sh');
assert.ok(entrypoint.split('\n').filter((line) => line.includes('setfacl'))
  .every((line) => !line.includes('$RUNTIME_OPENCODE')),
  'ttyd must not change the proxy owner-private secret ACL');
for (const literal of [
  'TTYD_UID="$(id -u ingenium-ttyd)"',
  'TTYD_GID="$(id -g ingenium-ttyd)"',
  'RUNTIME_TTYD_SECRET_DIR="${RUNTIME_SECRET_DIR}/ttyd"',
  'RUNTIME_TTYD_PASSWORD_FILE="${RUNTIME_TTYD_SECRET_DIR}/opencode-server-password"',
  'secure_persistent_path directory "$RUNTIME_SECRET_DIR" 0 0 0711',
  'secure_persistent_path directory "$RUNTIME_TTYD_SECRET_DIR" "$TTYD_UID" "$TTYD_GID" 0700',
]) assert.ok(entrypoint.includes(literal), `missing private ttyd provisioning: ${literal}`);
const copy = 'node /app/scripts/read-protected-api-token.mjs \\\n  "$OPENCODE_SERVER_PASSWORD_FILE" \\\n  "$TRUSTED_ARTIFACT_UID" "$TRUSTED_ARTIFACT_GID" "$RUNTIME_TTYD_PASSWORD_FILE" opencode-server 0 0 "$TTYD_UID" "$TTYD_GID"';
assert.ok(entrypoint.includes(copy), 'ttyd must copy the validated protected source with its own identity');
assert.ok(entrypoint.indexOf(copy) < entrypoint.indexOf('export OPENCODE_SERVER_PASSWORD_FILE='));
assert.ok(entrypoint.indexOf('/app/scripts/validate-process-isolation.sh') > entrypoint.lastIndexOf('setfacl'),
  'isolation validation must follow all bootstrap ACL changes');
const isolation = readScript('validate-process-isolation.sh');
assert.ok(entrypoint.includes('node /app/scripts/opencode-auth-proxy.mjs --prepare-gateway'));
for (const literal of [
  'gateway_dir=/run/ingenium-opencode-gateway',
  '--verify-gateway-directory',
  'runuser -u "$user" -- test -x "$gateway_dir"',
  'case " $(id -G "$user") " in *" 1104 "*) fail ;; esac',
]) assert.ok(isolation.includes(literal), `missing gateway isolation check: ${literal}`);
for (const literal of [
  'ttyd_dir=/run/ingenium-secrets/ttyd',
  '"$ttyd_dir:ingenium-ttyd:ingenium-ttyd"',
  'regular file:ingenium-ttyd:ingenium-ttyd:600',
  'can_read ingenium-ttyd "$file" || fail',
  '! can_read "$user" "$ttyd_dir" || fail',
  '! can_read "$user" "$file" || fail',
  '"$ttyd_dir:ingenium-ttyd"',
  'cmp -s "$opencode_dir/opencode-server-password" "$ttyd_dir/opencode-server-password" || fail',
]) assert.ok(isolation.includes(literal), `missing ttyd isolation check: ${literal}`);

const temporary = fs.mkdtempSync('/tmp/opencode/ttyd-isolation-');
try {
  const privateFile = join(temporary, 'run/ingenium-secrets/opencode/opencode-server-password');
  const ttydFile = join(temporary, 'run/ingenium-secrets/ttyd/opencode-server-password');
  const runtimeFile = join(temporary, 'run/ingenium-runtime/opencode-server-password');
  for (const file of [privateFile, ttydFile, runtimeFile]) fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(privateFile, `${'p'.repeat(64)}\n`, { mode: 0o600 });
  fs.writeFileSync(ttydFile, `${'t'.repeat(64)}\n`, { mode: 0o600 });
  fs.writeFileSync(runtimeFile, `${'r'.repeat(64)}\n`, { mode: 0o600 });

  const { readPassword } = await import(pathToFileURL(join(root, 'scripts/opencode-auth-proxy.mjs')));
  assert.ok(readPassword(privateFile) === 'p'.repeat(64));
  fs.chmodSync(dirname(privateFile), 0o710);
  assert.throws(() => readPassword(privateFile), 'proxy must reject an ACL-expanded directory mask');
  fs.chmodSync(dirname(privateFile), 0o700);
  fs.chmodSync(privateFile, 0o640);
  assert.throws(() => readPassword(privateFile), 'proxy must reject an ACL-expanded file mask');
  fs.chmodSync(privateFile, 0o600);

  // Substitute only paths and external processes; never run the bootstrap or host OpenCode config.
  const launcher = readScript('start-ttyd.sh').split('exec env -i')[0]
    .replace('/app/scripts/wait-for-opencode.sh', ':')
    .replaceAll('/run/', `${temporary}/run/`);
  const readiness = readScript('wait-for-opencode.sh').replaceAll('/run/', `${temporary}/run/`);
  const curlStub = `curl() {
    if [ -n "$EXPECTED_PASSWORD" ]; then
      case " $* " in *" --config - "*) ;; *) return 1 ;; esac
      [ "$(cat)" = "$(printf 'user = "opencode:%s"' "$EXPECTED_PASSWORD")" ]
    else
      case " $* " in *" --config "*) return 1 ;; esac
    fi
  }
  `;
  for (const expected of ['t'.repeat(64), 'r'.repeat(64), '']) {
    const env = {
      PATH: '/usr/bin:/bin', HOME: temporary, EXPECTED_PASSWORD: expected,
      INGENIUM_OPENCODE_READINESS_CLEAN_ENV: '1', OPENCODE_READINESS_ATTEMPTS: '1',
    };
    for (const [name, source] of [
      ['ttyd', `${launcher}\n[ "$opencode_server_password" = "$EXPECTED_PASSWORD" ]`],
      ['readiness', `${curlStub}\n${readiness}`],
    ]) {
      const result = spawnSync('/bin/sh', ['-c', source], { env, cwd: temporary, encoding: 'utf8' });
      assert.equal(result.status, 0, `${name} did not select its isolated credential or runtime fallback`);
    }
    if (expected.startsWith('t')) fs.unlinkSync(ttydFile);
    if (expected.startsWith('r')) fs.unlinkSync(runtimeFile);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('PASS: ttyd private-copy contract, strict proxy masks, and isolated credential/readiness fallbacks');
NODE

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
