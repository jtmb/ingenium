#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?runtime image is required}"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-runtime-entrypoint.XXXXXX")"

cleanup() {
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT

mkdir -p \
  "$RUN_ROOT/bin" \
  "$RUN_ROOT/clean-workspace" \
  "$RUN_ROOT/poisoned-workspace/packages/ingenium-core/dist/lib" \
  "$RUN_ROOT/poisoned-workspace/node_modules" \
  "$RUN_ROOT/missing-trusted" \
  "$RUN_ROOT/mismatched-trusted"

cat > "$RUN_ROOT/bin/supervisord" <<'EOF'
#!/bin/sh
printf 'RUNTIME_ENTRYPOINT_OK\n'
EOF
chmod 0555 "$RUN_ROOT/bin/supervisord"

cat > "$RUN_ROOT/poisoned-workspace/packages/ingenium-core/package.json" <<'EOF'
{"name":"ingenium-core","type":"module","exports":"./dist/lib/index.js"}
EOF
cat > "$RUN_ROOT/poisoned-workspace/packages/ingenium-core/dist/lib/index.js" <<'EOF'
export const agents = {};
EOF
ln -s ../packages/ingenium-core "$RUN_ROOT/poisoned-workspace/node_modules/ingenium-core"
cat > "$RUN_ROOT/mismatched-trusted/index.js" <<'EOF'
export const agents = {};
EOF

runtime() {
  local workspace="$1"
  shift
  docker run --rm -i \
    --user 1000:1000 \
    --workdir /workspace \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /home/appuser:rw,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=0700 \
    --tmpfs /home/appuser/.tmp:rw,exec,nosuid,nodev,size=67108864,uid=1000,gid=1000,mode=0700 \
    --tmpfs /run/ingenium-runtime:rw,noexec,nosuid,nodev,size=1048576,uid=1000,gid=1000,mode=0700 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=67108864,uid=1000,gid=1000,mode=0700 \
    --mount "type=bind,src=$RUN_ROOT/bin,dst=/test-bin,readonly" \
    --mount "type=bind,src=$workspace,dst=/workspace" \
    -e PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -e HOME=/home/appuser \
    -e XDG_CONFIG_HOME=/home/appuser/.config \
    -e XDG_DATA_HOME=/home/appuser/.local/share \
    -e XDG_STATE_HOME=/home/appuser/.local/state \
    -e TMPDIR=/home/appuser/.tmp \
    -e INGENIUM_API_URL=http://ingenium-control-plane:4096/api/v1 \
    -e INGENIUM_PROJECT=ingenium \
    -e INGENIUM_PROJECT_ID=00000000-0000-4000-8000-000000000001 \
    -e INGENIUM_ORGANIZATION_ID=00000000-0000-4000-8000-000000000002 \
    -e INGENIUM_RUNTIME_ID=00000000-0000-4000-8000-000000000003 \
    -e INGENIUM_RUNTIME_OWNER_ID=00000000-0000-4000-8000-000000000004 \
    -e INGENIUM_WORKSPACE_ID=acceptance-ingenium \
    -e INGENIUM_STORAGE_MAPPING_HASH=922b93ac1aff4ac89dcda1db549d5766e6654d6d2413bbb27a085aee0a2da1f2 \
    -e INGENIUM_WORKTREE=/workspace \
    -e INGENIUM_MCP_AUDIENCE=runtime \
    -e INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/capability \
    -e INGENIUM_DEPLOYMENT_MODE=user-runtime \
    "$@" \
    --entrypoint /app/scripts/runtime-entrypoint.sh \
    "$IMAGE"
}

capability="ing_AAAAAAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

normal_output="$(printf '%s\n' "$capability" | runtime "$RUN_ROOT/clean-workspace")"
[[ "$normal_output" == *RUNTIME_ENTRYPOINT_OK* ]]

poisoned_output="$(printf '%s\n' "$capability" | runtime "$RUN_ROOT/poisoned-workspace" -e NODE_PATH=/workspace/node_modules)"
[[ "$poisoned_output" == *RUNTIME_ENTRYPOINT_OK* ]]

if printf '%s\n' "$capability" | runtime "$RUN_ROOT/clean-workspace" \
  --mount "type=bind,src=$RUN_ROOT/missing-trusted,dst=/app/packages/ingenium-core/dist/lib,readonly" \
  >"$RUN_ROOT/missing.out" 2>"$RUN_ROOT/missing.err"; then
  exit 1
fi
grep -q 'Trusted Ingenium Core broker validator is unavailable' "$RUN_ROOT/missing.err"

if printf '%s\n' "$capability" | runtime "$RUN_ROOT/clean-workspace" \
  --mount "type=bind,src=$RUN_ROOT/mismatched-trusted/index.js,dst=/app/packages/ingenium-core/dist/lib/index.js,readonly" \
  >"$RUN_ROOT/mismatched.out" 2>"$RUN_ROOT/mismatched.err"; then
  exit 1
fi
grep -q 'Trusted Ingenium Core broker validator is unavailable' "$RUN_ROOT/mismatched.err"

printf 'PASS: runtime entrypoint uses only the immutable trusted Ingenium Core artifact\n'
