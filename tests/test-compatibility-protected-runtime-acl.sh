#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ingenium-ingenium:compat}"
ENTRYPOINT_SOURCE="$(realpath "${2:-scripts/docker-entrypoint.sh}")"
REPO_ROOT="$(dirname "$(dirname "$ENTRYPOINT_SOURCE")")"
TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_PARENT="${TEMP_PARENT%/}"
RUN_ROOT="$(mktemp -d "$TEMP_PARENT/ingenium-compatibility-acl.XXXXXX")"
PROJECT="${RUN_ROOT##*/}"
PROJECT="${PROJECT,,}"
PROJECT="${PROJECT//[^a-z0-9_-]/-}"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { printf 'ERROR: invalid Compose project name %s\n' "$PROJECT" >&2; exit 1; }
COMPOSE_FILE="$RUN_ROOT/compose.yml"
resources_created=0

export FIXTURE_IMAGE="$IMAGE"
export FIXTURE_ENTRYPOINT_SOURCE="$RUN_ROOT/entrypoint.sh"
export FIXTURE_ROOT="$RUN_ROOT"

compose=(docker compose --project-name "$PROJECT" --project-directory "$RUN_ROOT" -f "$COMPOSE_FILE")
printf 'FIXTURE: Compose project %s at %s\n' "$PROJECT" "$RUN_ROOT"

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$resources_created" -eq 1 ]] && ! "${compose[@]}" rm --force --stop; then
    printf 'RETAINED: Compose project %s and fixture evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
    exit 1
  fi
  if [[ "$resources_created" -eq 1 ]]; then
    docker volume rm "${PROJECT}_bootstrap"
  fi
  if [[ "$RUN_ROOT" != "$TEMP_PARENT/ingenium-compatibility-acl."* ]]; then
    printf 'RETAINED: unexpected fixture path %s\n' "$RUN_ROOT" >&2
    exit 1
  fi
  df -h "$TEMP_PARENT"
  rm -rf -- "$RUN_ROOT"
  [[ ! -e "$RUN_ROOT" ]] || { printf 'RETAINED: fixture cleanup failed at %s\n' "$RUN_ROOT" >&2; exit 1; }
  printf 'CLEANUP: removed Compose project %s and fixture %s\n' "$PROJECT" "$RUN_ROOT"
  exit "$status"
}
trap cleanup EXIT

collaboration_file="$RUN_ROOT/workspace/repo/source.txt"
mkdir -p "$RUN_ROOT/bin"
node - "$ENTRYPOINT_SOURCE" "$REPO_ROOT" "$RUN_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [entrypoint, repo, root] = process.argv.slice(2);
const source = fs.readFileSync(entrypoint, 'utf8').replaceAll('/app/scripts/normalize-agent-profiles.sh', '/test-bin/normalize-agent-profiles');
fs.writeFileSync(`${root}/entrypoint.sh`, source, { mode: 0o755 });
fs.copyFileSync(`${repo}/scripts/project-agent-profiles.mjs`, `${root}/bin/project-agent-profiles.mjs`);
const helpers = source.slice(0, source.indexOf('DEPLOYMENT_MODE='));
const segment = source.slice(source.indexOf('setfacl -R -m u:ingenium-opencode:rwX'), source.indexOf('# Seed OpenCode config'));
fs.writeFileSync(`${root}/bin/workspace-acls`, helpers + segment, { mode: 0o755 });
const mapped = Object.keys(JSON.parse(fs.readFileSync(`${repo}/opencode.json`, 'utf8')).agent).sort();
let count = 0;
for (const relative of fs.readdirSync(`${repo}/.opencode/agents`, { recursive: true })) {
  if (!relative.endsWith('.md') || !mapped.includes(path.basename(relative, '.md'))) continue;
  const target = `${root}/workspace/repo/.opencode/agents/${relative}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(`${repo}/.opencode/agents/${relative}`, target);
  count++;
}
if (count !== 11) throw new Error(`Expected 11 mapped profiles, got ${count}`);
fs.writeFileSync(`${root}/expected-agents.json`, JSON.stringify(mapped));
NODE
cat > "$RUN_ROOT/bin/normalize-agent-profiles" <<'EOF'
#!/bin/sh
exec node /test-bin/project-agent-profiles.mjs "$@"
EOF
chmod 0555 "$RUN_ROOT/bin/normalize-agent-profiles"
opencode_root="$RUN_ROOT/workspace/repo/.opencode"
mkdir -p "$opencode_root/protected-runtime-index/coordination-outbox" "$opencode_root/protected-runtime-index/tui-recovery"
: > "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
chmod 0770 "$opencode_root/protected-runtime-index" \
  "$opencode_root/protected-runtime-index/coordination-outbox" \
  "$opencode_root/protected-runtime-index/tui-recovery"
chmod 0670 "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
  printf 'fixture-%s\n' "$credential_name" > "$opencode_root/$credential_name"
  chmod 0670 "$opencode_root/$credential_name"
done
: > "$collaboration_file"
chmod 0600 "$collaboration_file"
printf 'SYNTHETIC=value\n' > "$RUN_ROOT/workspace/repo/.env"
chmod 0670 "$RUN_ROOT/workspace/repo/.env"
retention_root="$RUN_ROOT/workspace/repo/tests/artifacts/test-runs/.retention-control"
mkdir -p "$retention_root/quarantine"
printf 'private-retention-fixture\n' > "$retention_root/quarantine/receipt.json"
chmod 0700 "$retention_root" "$retention_root/quarantine"
chmod 0600 "$retention_root/quarantine/receipt.json"

cat > "$RUN_ROOT/bin/find" <<'EOF'
#!/bin/sh
if [ "${1:-}" = /workspace ]; then
  echo "ERROR: compatibility entrypoint traversed /workspace twice" >&2
  exit 1
fi
exec /usr/bin/find "$@"
EOF

cat > "$RUN_ROOT/bin/run-entrypoint" <<'EOF'
#!/bin/sh
set -eu
opencode_root=/workspace/.opencode
printf 'SYNTHETIC=value\n' > /workspace/.env
chown appuser:appuser /workspace/.env
chmod 0670 /workspace/.env
mkdir -p "$opencode_root/protected-runtime-index/coordination-outbox" "$opencode_root/protected-runtime-index/tui-recovery"
: > "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
chown -R appuser:appuser "$opencode_root/protected-runtime-index"
chmod 0770 "$opencode_root/protected-runtime-index" \
  "$opencode_root/protected-runtime-index/coordination-outbox" \
  "$opencode_root/protected-runtime-index/tui-recovery"
chmod 0670 "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
  printf 'fixture-%s\n' "$credential_name" > "$opencode_root/$credential_name"
  chown appuser:appuser "$opencode_root/$credential_name"
  chmod 0670 "$opencode_root/$credential_name"
done
mkdir -p /workspace/.opencode/agents
mkfifo /workspace/.opencode/agents/failing.md
if timeout 15 /test-bin/workspace-acls; then
  echo 'ERROR: startup accepted FIFO profile' >&2; exit 1
else
  test "$?" -eq 1
fi
for protected_root in /workspace/.opencode /workspace/repo/.opencode; do
  protected_index="$protected_root/protected-runtime-index"
  for directory in "$protected_index" "$protected_index/coordination-outbox" "$protected_index/tui-recovery"; do
    test "$(stat -c '%a:%u:%g' "$directory")" = 700:1000:1000
    getfacl -cp "$directory" | grep -qx 'mask::---'
    for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
      if runuser -u "$identity" -- test -x "$directory"; then
        echo "ERROR: $identity can traverse protected state after startup failure" >&2; exit 1
      fi
    done
  done
  for relative in protected-runtime-index/coordination-outbox/record.json .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
    protected_file="$protected_root/$relative"
    test "$(stat -c '%a:%u:%g' "$protected_file")" = 600:1000:1000
    getfacl -cp "$protected_file" | grep -qx 'mask::---'
    for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
      if runuser -u "$identity" -- test -r "$protected_file"; then
        echo "ERROR: $identity can read protected file after startup failure" >&2; exit 1
      fi
    done
    case "$relative" in
      .ingenium-*) test "$(cat "$protected_file")" = "fixture-$relative" ;;
      *) test ! -s "$protected_file" ;;
    esac
  done
done
rm /workspace/.opencode/agents/failing.md
printf 'FAILED_AGENT_NORMALIZATION_PROTECTED_FILES_OK\n'
agents=/workspace/repo/.opencode/agents
setfacl -R -m d:u:ingenium-opencode:rwx "$agents"
# Recreate the files under default ACLs, as an editor's atomic save would.
find "$agents" -type f -name '*.md' -exec sh -ec '
  for profile do
    cat "$profile" > "$profile.new"
    chown --reference="$profile" "$profile.new"
    mv "$profile.new" "$profile"
  done
' sh {} +
find "$agents" -type f -name '*.md' -exec chmod 0674 {} +
find "$agents" -type f -name '*.md' -exec sha256sum {} + > /tmp/profile-contents
find "$agents" -type f -name '*.md' -exec stat -c '%n:%u:%g' {} + > /tmp/profile-owners
mkdir -p /tmp/agent-sentinel
printf 'untouched\n' > /tmp/agent-sentinel/outside.md
chmod 0600 /tmp/agent-sentinel/outside.md
stat -c '%u:%g' /tmp/agent-sentinel/outside.md > /tmp/sentinel-owner
ln -s /tmp/agent-sentinel "$agents/linked-category"
ln -s /tmp/agent-sentinel/outside.md "$agents/linked.md"
mkfifo "$agents/ignored-pipe"
for pass in 1 2; do
  /test-bin/workspace-acls
  sha256sum -c /tmp/profile-contents
  find "$agents" -type f -name '*.md' -exec stat -c '%n:%u:%g' {} + > /tmp/current-owners
  cmp /tmp/profile-owners /tmp/current-owners
  find "$agents" -type d -exec sh -ec '
    for directory do
      if getfacl -cp "$directory" | grep -q "^default:"; then exit 1; fi
      for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
        runuser -u "$identity" -- test -x "$directory"
        runuser -u "$identity" -- test -w "$directory"
      done
    done
  ' sh {} +
  find "$agents" -type f -name '*.md' -exec sh -ec '
    for profile do
      test "$(stat -c %a "$profile")" = 644
      test "$(getfacl -cp "$profile")" = "$(printf "user::rw-\ngroup::r--\nother::r--")"
    done
  ' sh {} +
  test "$(stat -c %a /tmp/agent-sentinel/outside.md)" = 600
  test "$(cat /tmp/agent-sentinel/outside.md)" = untouched
  test "$(stat -c '%u:%g' /tmp/agent-sentinel/outside.md)" = "$(cat /tmp/sentinel-owner)"
  printf 'AGENT_ACL_PASS_%s_OK\n' "$pass"
done
rm "$agents/linked-category" "$agents/linked.md" "$agents/ignored-pipe"
mkdir /tmp/unsafe-agents
mkfifo /tmp/unsafe-agents/pipe.md
if timeout 5 /test-bin/normalize-agent-profiles --remove-workspace-acls /tmp/unsafe-agents; then
  echo 'ERROR: irregular Markdown accepted' >&2; exit 1
else
  test "$?" -eq 1
fi
ln -s /tmp/agent-sentinel /tmp/linked-agents
if /test-bin/normalize-agent-profiles --remove-workspace-acls /tmp/linked-agents; then
  echo 'ERROR: symlink agent root accepted' >&2; exit 1
fi
rm /tmp/unsafe-agents/pipe.md
ln /tmp/agent-sentinel/outside.md /tmp/unsafe-agents/hardlink.md
if /test-bin/normalize-agent-profiles --remove-workspace-acls /tmp/unsafe-agents; then
  echo 'ERROR: hardlinked Markdown accepted' >&2; exit 1
fi
test "$(stat -c %a /tmp/agent-sentinel/outside.md)" = 600
exec /test-entrypoint.sh
EOF

cat > "$RUN_ROOT/bin/supervisord" <<'EOF'
#!/bin/sh
set -eu
collaboration_file=/workspace/repo/source.txt
fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}
for env_path in /workspace/.env /workspace/repo/.env; do
  test "$(stat -c '%a:%u:%g' "$env_path")" = 600:1000:1000 \
    || fail "env metadata changed: $env_path"
  test "$(cat "$env_path")" = 'SYNTHETIC=value' || fail "env content changed"
  for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
    if runuser -u "$identity" -- test -r "$env_path"; then
      fail "$identity can read $env_path"
    fi
  done
done
for opencode_root in /workspace/.opencode /workspace/repo/.opencode; do
  protected_index="$opencode_root/protected-runtime-index"
  for protected_directory in "$protected_index" "$protected_index/coordination-outbox" "$protected_index/tui-recovery"; do
    test "$(stat -c '%a:%u:%g' "$protected_directory")" = 700:1000:1000 \
      || fail "private directory metadata changed: $protected_directory"
  done
  protected_record="$protected_index/coordination-outbox/record.json"
  test "$(stat -c '%a:%u:%g' "$protected_record")" = 600:1000:1000 \
    || fail "protected record metadata changed: $protected_record"
  for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
    credential_path="$opencode_root/$credential_name"
    test "$(stat -c '%a:%u:%g' "$credential_path")" = 600:1000:1000 \
      || fail "credential metadata changed: $credential_path"
    test "$(cat "$credential_path")" = "fixture-$credential_name" \
      || fail "credential content changed: $credential_path"
  done
  for identity in ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore ingenium-runtime-manager ingenium-runtime-gateway; do
    if runuser -u "$identity" -- test -x "$protected_index"; then
      fail "$identity can traverse $protected_index"
    fi
    if runuser -u "$identity" -- test -r "$protected_record"; then
      fail "$identity can read $protected_record"
    fi
    for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
      if runuser -u "$identity" -- test -r "$opencode_root/$credential_name"; then
        fail "$identity can read $opencode_root/$credential_name"
      fi
    done
  done
done
for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
  if ! runuser -u "$identity" -- test -r "$collaboration_file"; then
    fail "$identity cannot read the collaboration file"
  fi
  runuser -u "$identity" -- test -w "$collaboration_file" \
    || fail "$identity cannot write the collaboration file"
done
retention_root=/workspace/repo/tests/artifacts/test-runs/.retention-control
for directory in "$retention_root" "$retention_root/quarantine"; do
  test "$(stat -c '%a:%u:%g' "$directory")" = 700:1000:1000 || fail 'retention directory privacy changed'
  if getfacl -cp "$directory" | grep -q '^default:'; then fail 'retention default ACL survived'; fi
done
test "$(stat -c '%a:%u:%g' "$retention_root/quarantine/receipt.json")" = 600:1000:1000 || fail 'retention receipt privacy changed'
for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
  if runuser -u "$identity" -- test -r "$retention_root/quarantine/receipt.json"; then
    fail "$identity can read retention state"
  fi
done
test "$(stat -c '%a:%u:%g' /run/ingenium-opencode)" = 700:1105:1105 || fail 'MCP runtime directory is not private'
printf 'COMPATIBILITY_ENTRYPOINT_ACL_OK\n'
EOF
chmod 0555 "$RUN_ROOT/bin/find" "$RUN_ROOT/bin/run-entrypoint" "$RUN_ROOT/bin/supervisord"

cat > "$COMPOSE_FILE" <<'EOF'
services:
  bootstrap:
    image: ${FIXTURE_IMAGE:?FIXTURE_IMAGE is required}
    network_mode: none
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        printf "%064d\n" 0 > /fixture/api-token
        printf "%064d\n" 1 > /fixture/opencode-server-password
        printf "%064d\n" 2 > /fixture/email-encryption-key
        chown appuser:appuser /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key
        chmod 0600 /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key
    volumes:
      - bootstrap:/fixture

  entrypoint:
    image: ${FIXTURE_IMAGE:?FIXTURE_IMAGE is required}
    network_mode: none
    environment:
      PATH: /test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      INGENIUM_DEPLOYMENT_MODE: compatibility
      INGENIUM_API_TOKEN_FILE: /run/ingenium-bootstrap/api-token
      OPENCODE_SERVER_PASSWORD_FILE: /run/ingenium-bootstrap/opencode-server-password
      INGENIUM_EMAIL_ENCRYPTION_KEY_FILE: /run/ingenium-bootstrap/email-encryption-key
    entrypoint: ["/test-bin/run-entrypoint"]
    volumes:
      - type: bind
        source: ${FIXTURE_ENTRYPOINT_SOURCE:?FIXTURE_ENTRYPOINT_SOURCE is required}
        target: /test-entrypoint.sh
        read_only: true
      - type: bind
        source: ${FIXTURE_ROOT:?FIXTURE_ROOT is required}/bin
        target: /test-bin
        read_only: true
      - type: bind
        source: ${FIXTURE_ROOT:?FIXTURE_ROOT is required}/workspace
        target: /workspace
      - bootstrap:/run/ingenium-bootstrap
    tmpfs:
      - /workspace/.opencode:rw,nosuid,nodev,size=16777216,mode=0700
volumes:
  bootstrap:
EOF

resources_created=1
"${compose[@]}" run --rm --no-deps bootstrap
timeout --foreground 180s "${compose[@]}" run --rm --no-deps entrypoint
npx tsx -e 'import { buildRepositoryManifestV2 } from "./packages/ingenium-extension/resource-sync.ts"; import { readFileSync } from "node:fs"; import assert from "node:assert/strict"; const root = process.argv[1]; const agents = buildRepositoryManifestV2(`${root}/workspace/repo`).agents.map(a => a.name).sort(); assert.deepEqual(agents, JSON.parse(readFileSync(`${root}/expected-agents.json`, "utf8"))); console.log(`STRICT_AGENT_SCAN_OK: ${agents.length} mapped agents`);' "$RUN_ROOT"

printf 'PASS: actual compatibility entrypoint preserves protected files and workspace collaboration\n'
