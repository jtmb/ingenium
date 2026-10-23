#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ingenium-ingenium:compat}"
ENTRYPOINT_SOURCE="$(realpath "${2:-scripts/docker-entrypoint.sh}")"
ENTRYPOINT_ROOT="$(dirname "$(dirname "$ENTRYPOINT_SOURCE")")"
REPO_ROOT="$(realpath "${3:-$ENTRYPOINT_ROOT}")"
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
export FIXTURE_WORKSPACE_SOURCE="$RUN_ROOT/workspace"

compose=(docker compose --project-name "$PROJECT" --project-directory "$RUN_ROOT" -f "$COMPOSE_FILE")
printf 'FIXTURE: Compose project %s at %s\n' "$PROJECT" "$RUN_ROOT"

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    printf 'RETAINED: failed fixture project %s and evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
    exit "$status"
  fi
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

collaboration_file="$RUN_ROOT/workspace/ingenium/source.txt"
mkdir -p "$RUN_ROOT/bin"
node - "$ENTRYPOINT_SOURCE" "$REPO_ROOT" "$RUN_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [entrypoint, repo, root] = process.argv.slice(2);
const source = fs.readFileSync(entrypoint, 'utf8').replaceAll('/app/scripts/normalize-agent-profiles.sh', '/test-bin/normalize-agent-profiles');
fs.writeFileSync(`${root}/entrypoint.sh`, source, { mode: 0o755 });
fs.copyFileSync(`${repo}/scripts/project-agent-profiles.mjs`, `${root}/bin/project-agent-profiles.mjs`);
const helpers = source.slice(0, source.indexOf('DEPLOYMENT_MODE='));
const segment = source.slice(source.indexOf('# Preserve host ownership while granting only the three interactive workspace'), source.indexOf('# Seed OpenCode config'));
fs.writeFileSync(`${root}/bin/workspace-acls`, helpers + segment, { mode: 0o755 });
const mapped = Object.keys(JSON.parse(fs.readFileSync(`${repo}/opencode.json`, 'utf8')).agents).map(name => path.basename(name)).sort();
let count = 0;
for (const relative of fs.readdirSync(`${repo}/.opencode/agents`, { recursive: true })) {
  if (!relative.endsWith('.md') || !mapped.includes(path.basename(relative, '.md'))) continue;
  const target = `${root}/workspace/ingenium/.opencode/agents/${relative}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(`${repo}/.opencode/agents/${relative}`, target);
  count++;
}
if (count !== 11) throw new Error(`Expected 11 mapped profiles, got ${count}`);
if (mapped.includes('ingenium-llm-broker')) throw new Error('Reserved broker must remain unmapped');
fs.copyFileSync(`${repo}/.opencode/agents/execution/ingenium-llm-broker.md`, `${root}/workspace/ingenium/.opencode/agents/execution/ingenium-llm-broker.md`);
fs.writeFileSync(`${root}/expected-agents.json`, JSON.stringify(mapped));
NODE
cat > "$RUN_ROOT/bin/normalize-agent-profiles" <<'EOF'
#!/bin/sh
exec node /test-bin/project-agent-profiles.mjs "$@"
EOF
chmod 0555 "$RUN_ROOT/bin/normalize-agent-profiles"
opencode_root="$RUN_ROOT/workspace/ingenium/.opencode"
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
printf 'SYNTHETIC=value\n' > "$RUN_ROOT/workspace/ingenium/.env"
chmod 0670 "$RUN_ROOT/workspace/ingenium/.env"
retention_root="$RUN_ROOT/workspace/ingenium/tests/artifacts/test-runs/.retention-control"
mkdir -p "$retention_root/quarantine"
printf 'private-retention-fixture\n' > "$retention_root/quarantine/receipt.json"
chmod 0700 "$retention_root" "$retention_root/quarantine"
chmod 0600 "$retention_root/quarantine/receipt.json"
mkdir -p "$RUN_ROOT/workspace/ingenium/packages/ingenium-extension/scripts" \
  "$RUN_ROOT/workspace/unrelated/.opencode/agents/execution" \
  "$RUN_ROOT/workspace/unrelated/packages/ingenium-extension/scripts"
printf 'sibling-retired-profile\n' > "$RUN_ROOT/workspace/unrelated/.opencode/agents/execution/browser-agent.md"
printf 'sibling-bootstrap\n' > "$RUN_ROOT/workspace/unrelated/packages/ingenium-extension/scripts/recovery-bootstrap.js"
printf 'sibling-source\n' > "$RUN_ROOT/workspace/unrelated/source.txt"
chmod 0600 "$RUN_ROOT/workspace/unrelated/source.txt" "$RUN_ROOT/workspace/unrelated/.opencode/agents/execution/browser-agent.md"

cat > "$RUN_ROOT/bin/find" <<'EOF'
#!/bin/sh
if [ "${1:-}" = -P ] || [ "${1:-}" = /workspace ]; then
  if [ "${1:-}" != -P ] || [ "${2:-}" != /workspace/ingenium ]; then
    echo 'ERROR: compatibility workspace traversal must use find -P at /workspace/ingenium' >&2
    exit 1
  fi
fi
exec /usr/bin/find "$@"
EOF

cat > "$RUN_ROOT/bin/setfacl" <<'EOF'
#!/bin/sh
set -eu
workspace_grant=0
file_grant=0
default_grant=0
access_acl='u:ingenium-opencode:rwX,u:ingenium-ttyd:rwX,u:ingenium-vscode:rwX'
default_acl='d:u:ingenium-opencode:rwX,d:u:ingenium-ttyd:rwX,d:u:ingenium-vscode:rwX'
for argument do
  case "$argument" in
    "$access_acl") workspace_grant=1; file_grant=1 ;;
    "$default_acl") workspace_grant=1; default_grant=1 ;;
  esac
done
if [ "$default_grant" -eq 1 ]; then file_grant=0; fi
if [ "$workspace_grant" -eq 1 ]; then
  for argument do
    case "$argument" in
      /workspace/ingenium/.env|\
      /workspace/ingenium/tests/artifacts/test-runs/.retention-control|\
      /workspace/ingenium/.opencode/protected-runtime-index|\
      /workspace/ingenium/.opencode/.ingenium-mcp-credential|\
      /workspace/ingenium/.opencode/.ingenium-learning-credential|\
      /workspace/ingenium/.opencode/.ingenium-repository-sync-credential)
        printf '%s\n' "$argument" >> /tmp/workspace-acl-protected-arguments ;;
    esac
  done
  /usr/bin/setfacl "$@"
  if [ -s /tmp/workspace-acl-protected-arguments ]; then
    exit 1
  fi
  if [ "${FIXTURE_FAIL_WORKSPACE_FILE_ACL:-0}" = 1 ] && [ "$file_grant" -eq 1 ]; then
    printf 'file-acl-failure\n' > /tmp/workspace-acl-injected-failure
    exit 1
  fi
  exit 0
fi
exec /usr/bin/setfacl "$@"
EOF

cat > "$RUN_ROOT/bin/run-entrypoint" <<'EOF'
#!/bin/sh
set -eu
printf 'ACL_FIXTURE_STAGE:run-entrypoint\n' >&2
fixture_assert() {
  label=$1
  shift
  if "$@"; then return 0; fi
  printf 'ACL_FIXTURE_ASSERTION_FAILED:%s\n' "$label" >&2
  exit 1
}
collaboration_file=/workspace/ingenium/source.txt
opencode_root=/workspace/.opencode
printf 'SYNTHETIC=value\n' > /workspace/.env
chown appuser:appuser /workspace/.env
chmod 0600 /workspace/.env
mkdir -p "$opencode_root/protected-runtime-index/coordination-outbox" "$opencode_root/protected-runtime-index/tui-recovery"
: > "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
chown -R appuser:appuser "$opencode_root/protected-runtime-index"
chmod 0700 "$opencode_root/protected-runtime-index" \
  "$opencode_root/protected-runtime-index/coordination-outbox" \
  "$opencode_root/protected-runtime-index/tui-recovery"
chmod 0600 "$opencode_root/protected-runtime-index/coordination-outbox/record.json"
for credential_name in .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
  printf 'fixture-%s\n' "$credential_name" > "$opencode_root/$credential_name"
  chown appuser:appuser "$opencode_root/$credential_name"
  chmod 0600 "$opencode_root/$credential_name"
done
mkdir -p /workspace/.opencode/agents
for repository in /workspace/ingenium; do
  scripts="$repository/packages/ingenium-extension/scripts"
  mkdir -p "$scripts"
  chmod 0755 "$repository/packages" "$repository/packages/ingenium-extension" "$scripts"
  setfacl -m d:u:ingenium-opencode:rwx "$scripts"
  printf 'repository-owned recovery fixture\n' > "$scripts/recovery-bootstrap.js"
  chown appuser:appuser "$scripts/recovery-bootstrap.js"
  chmod 0674 "$scripts/recovery-bootstrap.js"
  getfacl -cp "$scripts/recovery-bootstrap.js" | grep -q '^user:ingenium-opencode:'
  stat -c '%d:%i:%u:%g' "$scripts/recovery-bootstrap.js" > "/tmp/recovery-$(basename "$repository")-identity"
done
snapshot_siblings() {
  for path in /workspace/unrelated /workspace/unrelated/source.txt \
    /workspace/unrelated/.opencode /workspace/unrelated/.opencode/agents \
    /workspace/unrelated/.opencode/agents/execution \
    /workspace/unrelated/.opencode/agents/execution/browser-agent.md \
    /workspace/unrelated/packages/ingenium-extension/scripts/recovery-bootstrap.js \
    /workspace/.env /workspace/.opencode/protected-runtime-index \
    /workspace/.opencode/.ingenium-mcp-credential; do
    stat -c '%n:%a:%u:%g:%d:%i' "$path"
    getfacl -cp "$path"
    if [ -f "$path" ]; then sha256sum "$path"; fi
  done
}
snapshot_siblings > /tmp/sibling-metadata-before
getfacl -cp /workspace > /tmp/workspace-root-acl-before
setfacl -m d:u:ingenium-opencode:rwX,d:u:ingenium-ttyd:rwX,d:u:ingenium-vscode:rwX /workspace
snapshot_siblings > /tmp/sibling-metadata-after-legacy-root-acl
cmp /tmp/sibling-metadata-before /tmp/sibling-metadata-after-legacy-root-acl
assert_siblings_unchanged() {
  snapshot_siblings > /tmp/sibling-metadata-after
  fixture_assert sibling-acl-mode-bytes-unchanged cmp /tmp/sibling-metadata-before /tmp/sibling-metadata-after
  fixture_assert sibling-retired-profile-preserved test "$(cat /workspace/unrelated/.opencode/agents/execution/browser-agent.md)" = sibling-retired-profile
  if getfacl -cp /workspace | grep -q '^default:user:ingenium-'; then
    echo 'ERROR: compatibility root retained inherited interactive ACL' >&2; exit 1
  fi
  for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
    fixture_assert root-search-only test "$(getfacl -cp /workspace | grep "^user:$identity:")" = "user:$identity:--x"
  done
}
assert_recovery_bootstraps() {
  for repository in /workspace/ingenium; do
    bootstrap="$repository/packages/ingenium-extension/scripts/recovery-bootstrap.js"
    fixture_assert "bootstrap-mode:$repository" test "$(stat -c %a "$bootstrap")" = 644
    fixture_assert "bootstrap-identity:$repository" test "$(stat -c '%d:%i:%u:%g' "$bootstrap")" = "$(cat "/tmp/recovery-$(basename "$repository")-identity")"
    fixture_assert "bootstrap-content:$repository" test "$(cat "$bootstrap")" = 'repository-owned recovery fixture'
    fixture_assert "bootstrap-acl:$repository" test "$(getfacl -cp "$bootstrap")" = "$(printf 'user::rw-\ngroup::r--\nother::r--')"
    for identity in ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore ingenium-runtime-manager ingenium-runtime-gateway; do
      fixture_assert "bootstrap-readable:$repository:$identity" runuser -u "$identity" -- test -r "$bootstrap"
      if runuser -u "$identity" -- test -w "$bootstrap"; then
        echo "ERROR: $identity can write recovery bootstrap" >&2; exit 1
      fi
    done
  done
}
snapshot_protected_acl_state() {
  for protected_path in \
    /workspace/ingenium/.env \
    /workspace/.opencode/protected-runtime-index \
    /workspace/.opencode/protected-runtime-index/coordination-outbox \
    /workspace/.opencode/protected-runtime-index/coordination-outbox/record.json \
    /workspace/.opencode/protected-runtime-index/tui-recovery \
    /workspace/ingenium/.opencode/protected-runtime-index \
    /workspace/ingenium/.opencode/protected-runtime-index/coordination-outbox \
    /workspace/ingenium/.opencode/protected-runtime-index/coordination-outbox/record.json \
    /workspace/ingenium/.opencode/protected-runtime-index/tui-recovery \
    /workspace/ingenium/.opencode/.ingenium-mcp-credential \
    /workspace/ingenium/.opencode/.ingenium-learning-credential \
    /workspace/ingenium/.opencode/.ingenium-repository-sync-credential \
    /workspace/ingenium/tests/artifacts/test-runs/.retention-control \
    /workspace/ingenium/tests/artifacts/test-runs/.retention-control/quarantine \
    /workspace/ingenium/tests/artifacts/test-runs/.retention-control/quarantine/receipt.json; do
    printf '%s\n' "$protected_path"
    stat -c '%a:%u:%g' "$protected_path"
    getfacl -cp "$protected_path"
  done
}
: > /tmp/workspace-acl-protected-arguments
: > /tmp/workspace-acl-injected-failure
snapshot_protected_acl_state > /tmp/workspace-acl-before-failure
printf 'ACL_FIXTURE_STAGE:injected-acl-failure\n' >&2
if FIXTURE_FAIL_WORKSPACE_FILE_ACL=1 timeout 15 /test-bin/workspace-acls; then
  echo 'ERROR: injected workspace ACL failure was ignored' >&2; exit 1
else
  fixture_assert injected-failure-exit-status test "$?" -eq 1
fi
assert_siblings_unchanged
fixture_assert failure-marker-nonempty test -s /tmp/workspace-acl-injected-failure
fixture_assert no-protected-path-was-granted test ! -s /tmp/workspace-acl-protected-arguments
snapshot_protected_acl_state > /tmp/workspace-acl-after-failure
fixture_assert protected-metadata-unchanged cmp /tmp/workspace-acl-before-failure /tmp/workspace-acl-after-failure
for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
  fixture_assert collaboration-write-access runuser -u "$identity" -- test -w "$collaboration_file"
done
mkfifo /workspace/ingenium/.opencode/agents/failing.md
if timeout 15 /test-bin/workspace-acls; then
  echo 'ERROR: startup accepted FIFO profile' >&2; exit 1
else
  fixture_assert malformed-profile-rejected test "$?" -eq 1
fi
assert_private_acl() {
  private_acl=$(getfacl -cp "$1")
  if [ "$private_acl" = "$(printf 'user::%s\ngroup::---\nother::---' "$2")" ] ||
     printf '%s\n' "$private_acl" | grep -qx 'mask::---'; then
    return 0
  fi
  printf 'ACL_FIXTURE_PRIVATE_ACL:%s\n%s\n' "$1" "$private_acl" >&2
  return 1
}
assert_protected_files() {
for protected_root in /workspace/ingenium/.opencode; do
  protected_index="$protected_root/protected-runtime-index"
  for directory in "$protected_index" "$protected_index/coordination-outbox" "$protected_index/tui-recovery"; do
     fixture_assert "protected-directory-mode-owner:$directory" test "$(stat -c '%a:%u:%g' "$directory")" = 700:1000:1000
     fixture_assert "protected-directory-private-acl:$directory" assert_private_acl "$directory" rwx
    for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
      if runuser -u "$identity" -- test -x "$directory"; then
        echo "ERROR: $identity can traverse protected state after startup failure" >&2; exit 1
      fi
    done
  done
  for relative in protected-runtime-index/coordination-outbox/record.json .ingenium-mcp-credential .ingenium-learning-credential .ingenium-repository-sync-credential; do
    protected_file="$protected_root/$relative"
     fixture_assert "protected-file-mode-owner:$protected_file" test "$(stat -c '%a:%u:%g' "$protected_file")" = 600:1000:1000
    case "$relative" in
       .ingenium-*) fixture_assert "protected-credential-acl:$protected_file" test "$(getfacl -cp "$protected_file")" = "$(printf 'user::rw-\ngroup::---\nother::---')" ;;
       *) fixture_assert "protected-file-private-acl:$protected_file" assert_private_acl "$protected_file" rw- ;;
    esac
    for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
      if runuser -u "$identity" -- test -r "$protected_file"; then
        echo "ERROR: $identity can read protected file after startup failure" >&2; exit 1
      fi
    done
    case "$relative" in
       .ingenium-*) fixture_assert "protected-credential-content:$protected_file" test "$(cat "$protected_file")" = "fixture-$relative" ;;
       *) fixture_assert "protected-record-empty:$protected_file" test ! -s "$protected_file" ;;
    esac
  done
done
}
printf 'ACL_FIXTURE_STAGE:protected-state-after-normalization-failure\n' >&2
assert_protected_files
assert_recovery_bootstraps
rm /workspace/ingenium/.opencode/agents/failing.md
printf 'FAILED_AGENT_NORMALIZATION_PROTECTED_FILES_OK\n'
agents=/workspace/ingenium/.opencode/agents
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
  assert_siblings_unchanged
  assert_recovery_bootstraps
  assert_protected_files
  printf 'RECOVERY_BOOTSTRAP_ACL_PASS_%s_OK\n' "$pass"
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
      for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
        runuser -u "$identity" -- test -r "$profile"
        if runuser -u "$identity" -- test -w "$profile"; then
          echo "ERROR: $identity can write $profile" >&2; exit 1
        fi
      done
    done
  ' sh {} +
  test "$(stat -c %a /tmp/agent-sentinel/outside.md)" = 600
  test "$(cat /tmp/agent-sentinel/outside.md)" = untouched
  test "$(stat -c '%u:%g' /tmp/agent-sentinel/outside.md)" = "$(cat /tmp/sentinel-owner)"
  printf 'AGENT_ACL_PASS_%s_OK\n' "$pass"
done
rm "$agents/linked-category" "$agents/linked.md" "$agents/ignored-pipe"
credential=/workspace/ingenium/.opencode/.ingenium-learning-credential
held_credential=/workspace/ingenium/.opencode/.learning-held
mv "$credential" "$held_credential"
for malformed in symlink hardlink; do
  if [ "$malformed" = symlink ]; then
    ln -s "$held_credential" "$credential"
  else
    ln "$held_credential" "$credential"
  fi
  if timeout 15 /test-bin/workspace-acls; then
    echo "ERROR: startup accepted $malformed credential" >&2; exit 1
  else
    test "$?" -eq 1
  fi
  rm "$credential"
  printf 'MALFORMED_CREDENTIAL_%s_REJECTED\n' "$malformed"
done
mv "$held_credential" "$credential"
/test-bin/workspace-acls
assert_siblings_unchanged
assert_protected_files
bootstrap=/workspace/ingenium/packages/ingenium-extension/scripts/recovery-bootstrap.js
saved_bootstrap=/workspace/ingenium/recovery-bootstrap-saved
mv "$bootstrap" "$saved_bootstrap"
for malformed in symlink hardlink fifo directory parent-symlink; do
  case "$malformed" in
    symlink) ln -s /tmp/agent-sentinel/outside.md "$bootstrap" ;;
    hardlink) ln "$saved_bootstrap" "$bootstrap" ;;
    fifo) mkfifo "$bootstrap" ;;
    directory) mkdir "$bootstrap" ;;
    parent-symlink)
       mv /workspace/ingenium/packages/ingenium-extension/scripts /workspace/ingenium/packages/ingenium-extension/saved-scripts
       ln -s /tmp/agent-sentinel /workspace/ingenium/packages/ingenium-extension/scripts ;;
  esac
  if timeout 15 /test-bin/workspace-acls; then
    echo "ERROR: startup accepted $malformed recovery bootstrap" >&2; exit 1
  else
    test "$?" -eq 1
  fi
  assert_protected_files
  test "$(stat -c %a /tmp/agent-sentinel/outside.md)" = 600
  test "$(cat /tmp/agent-sentinel/outside.md)" = untouched
  test "$(stat -c '%u:%g' /tmp/agent-sentinel/outside.md)" = "$(cat /tmp/sentinel-owner)"
  test "$(cat "$saved_bootstrap")" = 'repository-owned recovery fixture'
  case "$malformed" in
    directory) rmdir "$bootstrap" ;;
    parent-symlink)
       rm /workspace/ingenium/packages/ingenium-extension/scripts
       mv /workspace/ingenium/packages/ingenium-extension/saved-scripts /workspace/ingenium/packages/ingenium-extension/scripts ;;
    *) rm "$bootstrap" ;;
  esac
  printf 'MALFORMED_RECOVERY_%s_PROTECTED_FILES_OK\n' "$malformed"
done
mv "$saved_bootstrap" "$bootstrap"
if /test-bin/normalize-agent-profiles --normalize-recovery-bootstrap /tmp/agent-sentinel/outside.md; then
  echo 'ERROR: recovery normalization accepted non-allowlisted path' >&2; exit 1
fi
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
assert_siblings_unchanged
mkdir /workspace/new-unrelated
if getfacl -cp /workspace/new-unrelated | grep -q '^user:ingenium-'; then
  echo 'ERROR: new sibling inherited interactive ACL' >&2; exit 1
fi
if [ "${FIXTURE_ACL_ONLY:-0}" = 1 ]; then
  printf 'COMPATIBILITY_WORKSPACE_ACL_ONLY_OK\n'
  exit 0
fi
exec /test-entrypoint.sh
EOF

cat > "$RUN_ROOT/bin/supervisord" <<'EOF'
#!/bin/sh
set -eu
collaboration_file=/workspace/ingenium/source.txt
fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}
for env_path in /workspace/.env /workspace/ingenium/.env; do
  test "$(stat -c '%a:%u:%g' "$env_path")" = 600:1000:1000 \
    || fail "env metadata changed: $env_path"
  test "$(cat "$env_path")" = 'SYNTHETIC=value' || fail "env content changed"
  for identity in ingenium-opencode ingenium-ttyd ingenium-vscode; do
    if runuser -u "$identity" -- test -r "$env_path"; then
      fail "$identity can read $env_path"
    fi
  done
done
for opencode_root in /workspace/.opencode /workspace/ingenium/.opencode; do
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
    test "$(getfacl -cp "$credential_path")" = "$(printf 'user::rw-\ngroup::---\nother::---')" \
      || fail "credential access ACL survived: $credential_path"
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
retention_root=/workspace/ingenium/tests/artifacts/test-runs/.retention-control
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
test "$(stat -c '%a:%u:%g' /run/ingenium-opencode/.ingenium-learning-credential)" = 600:1105:1105 || fail 'learning credential projection is not OpenCode-owned'
runuser -u ingenium-opencode -- test -r /run/ingenium-opencode/.ingenium-learning-credential || fail 'OpenCode cannot read projected learning credential'
cmp /app/.opencode/agents/plan.md /workspace/ingenium/.opencode/agents/plan.md || fail 'workspace Plan profile differs from the image'
cmp /app/.opencode/agents/plan.md /home/ingenium-opencode/.config/opencode/agents/plan.md || fail 'global Plan profile differs from the image'
printf 'COMPATIBILITY_ENTRYPOINT_ACL_OK\n'
EOF
chmod 0555 "$RUN_ROOT/bin/find" "$RUN_ROOT/bin/setfacl" "$RUN_ROOT/bin/run-entrypoint" "$RUN_ROOT/bin/supervisord"

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
        printf 'ing_%012d_%043d\n' 3 4 > /fixture/learning-credential
        chown appuser:appuser /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key /fixture/learning-credential
        chmod 0600 /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key /fixture/learning-credential
    volumes:
      - bootstrap:/fixture

  entrypoint:
    image: ${FIXTURE_IMAGE:?FIXTURE_IMAGE is required}
    network_mode: none
    environment:
      PATH: /test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      INGENIUM_DEPLOYMENT_MODE: compatibility
      INGENIUM_API_TOKEN_FILE: /run/ingenium-bootstrap/api-token
      INGENIUM_LEARNING_CREDENTIAL_FILE: /run/ingenium-bootstrap/learning-credential
      OPENCODE_SERVER_PASSWORD_FILE: /run/ingenium-bootstrap/opencode-server-password
      INGENIUM_EMAIL_ENCRYPTION_KEY_FILE: /run/ingenium-bootstrap/email-encryption-key
      FIXTURE_ACL_ONLY: ${FIXTURE_ACL_ONLY:-0}
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
        source: ${FIXTURE_WORKSPACE_SOURCE:?FIXTURE_WORKSPACE_SOURCE is required}
        target: /workspace
      - type: bind
        source: ${FIXTURE_ROOT:?FIXTURE_ROOT is required}/workspace/ingenium
        target: /home/brajam/repos/ingenium
      - bootstrap:/run/ingenium-bootstrap
    tmpfs:
      - /workspace/.opencode:rw,nosuid,nodev,size=16777216,mode=0700
volumes:
  bootstrap:
EOF

mkdir -p "$RUN_ROOT/missing-workspace" "$RUN_ROOT/symlink-workspace" "$RUN_ROOT/mismatched-workspace/ingenium"
ln -s "$RUN_ROOT/workspace/ingenium" "$RUN_ROOT/symlink-workspace/ingenium"
resources_created=1
"${compose[@]}" run --rm --pull never --no-deps bootstrap
for invalid in missing symlink mismatched; do
  FIXTURE_WORKSPACE_SOURCE="$RUN_ROOT/$invalid-workspace" \
    "${compose[@]}" run --rm --pull never --no-deps --entrypoint /bin/sh entrypoint -ec '
      before=$(getfacl -cp /workspace)
      alias_before=$(stat -c "%d:%i:%a" /home/brajam/repos/ingenium)
      if /test-bin/workspace-acls; then
        echo "ERROR: invalid canonical workspace passed" >&2; exit 1
      else
        test "$?" -eq 1
      fi
      test "$(getfacl -cp /workspace)" = "$before"
      test "$(stat -c "%d:%i:%a" /home/brajam/repos/ingenium)" = "$alias_before"
      printf "CANONICAL_BIND_GUARD_REJECTED\n"
    '
done
timeout --foreground 180s "${compose[@]}" run --rm --pull never --no-deps entrypoint
if [[ "${FIXTURE_ACL_ONLY:-0}" != 1 ]]; then
  npx tsx -e 'import { buildRepositoryManifestV2 } from "./packages/ingenium-extension/resource-sync.ts"; import { readFileSync } from "node:fs"; import assert from "node:assert/strict"; const root = process.argv[1]; const agents = buildRepositoryManifestV2(`${root}/workspace/ingenium`).agents.map(a => a.name).sort(); assert.deepEqual(agents, JSON.parse(readFileSync(`${root}/expected-agents.json`, "utf8"))); console.log(`STRICT_AGENT_SCAN_OK: ${agents.length} mapped agents`);' "$RUN_ROOT"
fi

if [[ "${FIXTURE_ACL_ONLY:-0}" == 1 ]]; then
  printf 'PASS: compatibility workspace ACL segment preserves protected files and collaboration\n'
else
  printf 'PASS: actual compatibility entrypoint preserves protected files and workspace collaboration\n'
fi
