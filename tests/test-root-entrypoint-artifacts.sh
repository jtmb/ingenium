#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ingenium-control-plane:latest}"
MANAGER_IMAGE="${2:-ingenium-runtime-manager:latest}"
GATEWAY_IMAGE="${3:-ingenium-runtime-gateway:latest}"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-root-entrypoint.XXXXXX")"
TOKEN_VOLUME="ingenium-root-entrypoint-$RANDOM-$RANDOM"
POISON_VOLUME="ingenium-root-entrypoint-poison-$RANDOM-$RANDOM"

cleanup() {
  docker volume rm -f "$TOKEN_VOLUME" "$POISON_VOLUME" >/dev/null 2>&1 || true
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT

cat > "$RUN_ROOT/supervisord" <<'EOF'
#!/bin/sh
test ! -e /home/ingenium-opencode/.config/opencode/agents/ingenium-llm-broker.md
test ! -e /workspace/.opencode/agents/ingenium-llm-broker.md
printf 'ROOT_ENTRYPOINT_OK\n'
EOF
chmod 0555 "$RUN_ROOT/supervisord"

cat > "$RUN_ROOT/runtime-control-fixture.js" <<'EOF'
import { readFileSync, statSync } from "node:fs";

const expectedUid = Number.parseInt(process.env.EXPECTED_UID ?? "", 10);
const expectedGid = Number.parseInt(process.env.EXPECTED_GID ?? "", 10);
const expectedSocketGid = Number.parseInt(process.env.EXPECTED_SOCKET_GID ?? "", 10);
const tokenFile = process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE ?? process.env.INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE;
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : "";
const tokenStat = tokenFile ? statSync(tokenFile) : undefined;
const actual = {
  uid: process.getuid?.(),
  gid: process.getgid?.(),
  groups: process.getgroups?.(),
  tokenUid: tokenStat?.uid,
  tokenGid: tokenStat?.gid,
  tokenMode: tokenStat?.mode & 0o777,
  tokenLength: token.length,
};
if (
  actual.uid !== expectedUid ||
  actual.gid !== expectedGid ||
  actual.tokenUid !== expectedUid ||
  actual.tokenGid !== expectedGid ||
  actual.tokenMode !== 0o600 ||
  actual.tokenLength !== 64 ||
  (Number.isInteger(expectedSocketGid) && !actual.groups?.includes(expectedSocketGid))
) {
  console.error(JSON.stringify({ expectedUid, expectedGid, expectedSocketGid, actual }));
  process.exit(1);
}
console.log("RUNTIME_CONTROL_ENTRYPOINT_OK");
EOF

docker volume create "$TOKEN_VOLUME" >/dev/null
docker volume create "$POISON_VOLUME" >/dev/null
docker run --rm --entrypoint sh -v "$TOKEN_VOLUME:/fixture" "$IMAGE" -ec '
  printf "%064d\n" 0 > /fixture/api-token
  printf "%064d\n" 1 > /fixture/opencode-server-password
  printf "%064d\n" 2 > /fixture/email-encryption-key
  printf "%064d\n" 3 > /fixture/runtime-manager-token
  printf "%064d\n" 4 > /fixture/runtime-gateway-token
  chown appuser:appuser /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key /fixture/runtime-manager-token /fixture/runtime-gateway-token
  chmod 0600 /fixture/api-token /fixture/opencode-server-password /fixture/email-encryption-key /fixture/runtime-manager-token /fixture/runtime-gateway-token
'

docker run --rm --entrypoint sh -v "$POISON_VOLUME:/fixture" "$IMAGE" -ec '
  ln -s /app/scripts /fixture/opencode
'
docker run --rm --entrypoint sh \
  -e INGENIUM_DEPLOYMENT_MODE=control-plane \
  -e INGENIUM_API_TOKEN_FILE=/run/ingenium-bootstrap/api-token \
  -e OPENCODE_SERVER_PASSWORD_FILE=/run/ingenium-bootstrap/opencode-server-password \
  -e INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/run/ingenium-bootstrap/email-encryption-key \
  -e INGENIUM_RUNTIME_MANAGER_TOKEN_FILE=/run/ingenium-runtime-manager/runtime-manager-token \
  -e INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE=/run/ingenium-runtime-gateway/runtime-gateway-token \
  -v "$POISON_VOLUME:/home/ingenium-opencode/.config" \
  -v "$TOKEN_VOLUME:/run/ingenium-bootstrap" \
  -v "$TOKEN_VOLUME:/run/ingenium-runtime-manager" \
  -v "$TOKEN_VOLUME:/run/ingenium-runtime-gateway" \
  "$IMAGE" -ec '
    protected_before="$(stat -c "%d:%i:%u:%g:%a" /app/scripts)"
    if /app/entrypoint.sh; then
      echo "ERROR: root entrypoint accepted a persistent config symlink" >&2
      exit 1
    fi
    test "$protected_before" = "$(stat -c "%d:%i:%u:%g:%a" /app/scripts)"
  '

docker run --rm --entrypoint node "$IMAGE" /app/scripts/validate-root-entrypoint-chain.mjs

docker image inspect "$MANAGER_IMAGE" "$GATEWAY_IMAGE" | node -e '
  const images = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const expected = ["manager", "gateway"];
  for (const [index, role] of expected.entries()) {
    const config = images[index]?.Config;
    if (config?.User !== "root") process.exit(1);
    if (config?.Entrypoint?.join(" ") !== `/app/scripts/runtime-control-entrypoint.sh ${role}`) process.exit(1);
    if (!config?.Healthcheck?.Test?.length) process.exit(1);
  }
'

for service in \
  "manager|$MANAGER_IMAGE|1109|/app/services/ingenium-api/dist/scripts/runtime-manager.js" \
  "gateway|$GATEWAY_IMAGE|1110|/app/services/ingenium-api/dist/scripts/runtime-gateway.js"; do
  IFS='|' read -r role service_image service_uid service_script <<EOF
$service
EOF
  socket_args=()
  if [[ "$role" == manager ]]; then
    socket_gid="$(stat -c '%g' /var/run/docker.sock)"
    socket_args+=(
      -e "EXPECTED_SOCKET_GID=$socket_gid"
      --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly
    )
  fi
  output="$(docker run --rm \
    -e "EXPECTED_UID=$service_uid" \
    -e "EXPECTED_GID=$service_uid" \
    -e "INGENIUM_RUNTIME_${role^^}_BOOTSTRAP_TOKEN_FILE=/run/ingenium-bootstrap/runtime-${role}-token" \
    "${socket_args[@]}" \
    --mount "type=bind,src=$RUN_ROOT/runtime-control-fixture.js,dst=$service_script,readonly" \
    -v "$TOKEN_VOLUME:/run/ingenium-bootstrap" \
    "$service_image")"
  [[ "$output" == *RUNTIME_CONTROL_ENTRYPOINT_OK* ]]
done

for user in appuser ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore ingenium-runtime-manager ingenium-runtime-gateway; do
docker run --rm --user "$user" --entrypoint sh "$IMAGE" -ec '
  for artifact in \
    /app/entrypoint.sh \
    /app/scripts/read-protected-api-token.mjs \
    /app/scripts/validate-root-entrypoint-chain.mjs \
    /app/services/ingenium-api/dist/scripts/restore-maintenance.js \
    /app/packages/ingenium-core/dist/lib/index.js \
    /usr/local/share/ingenium/opencode-managed/opencode.json \
    /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker.mjs \
    /usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md \
    /etc/opencode/opencode.json; do
    if { printf tamper >> "$artifact"; } 2>/dev/null; then exit 1; fi
    replacement="/tmp/$(basename "$artifact").replacement"
    printf replacement > "$replacement"
    if mv -f "$replacement" "$artifact" 2>/dev/null; then exit 1; fi
  done
  for directory in /app/scripts /app/node_modules /app/packages/ingenium-core /app/services/ingenium-api/dist /usr/local/share/ingenium/opencode-managed /usr/local/share/ingenium/opencode-managed/agents /usr/local/share/ingenium/opencode-managed/plugins /etc/opencode; do
    if mv "$directory" "$directory.replaced" 2>/dev/null; then exit 1; fi
  done
  broker=/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md
  before="$(stat -c "%d:%i:%a:%u:%g" "$broker")"
  if chmod 0644 "$broker" 2>/dev/null; then exit 1; fi
  if mv "$broker" /tmp/ingenium-llm-broker.moved 2>/dev/null; then exit 1; fi
  if rm "$broker" 2>/dev/null; then exit 1; fi
  if touch /usr/local/share/ingenium/opencode-managed/agents/sibling.md 2>/dev/null; then exit 1; fi
  test "$before" = "$(stat -c "%d:%i:%a:%u:%g" "$broker")"
'
done

docker run --rm --user appuser \
  -e HOME=/home/appuser \
  -e XDG_CONFIG_HOME=/home/appuser/.config \
  -e OPENCODE_CONFIG_DIR=/home/appuser/.config/opencode/runtime \
  --tmpfs /home/appuser:rw,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=0700 \
  --entrypoint sh "$IMAGE" -ec '
    workspace="$(mktemp -d)"
    mkdir -p "$workspace/.opencode/agents/execution"
    mkdir -p /home/appuser/.config/opencode
    cat > /home/appuser/.config/opencode/opencode.jsonc <<"EOF"
{
  "provider": { "retained-global": { "npm": "@ai-sdk/openai" } },
  "mcp": { "retained-global": { "enabled": false } },
  "agent": {
    "ingenium-llm-broker": {
      "disable": true,
      "hidden": false,
      "model": "untrusted/global",
      "mode": "primary",
      "permission": { "*": "allow", "bash": "allow" }
    }
  }
}
EOF
    cat > "$workspace/opencode.json" <<"EOF"
{
  "agent": {
    "ingenium-llm-broker": {
      "disable": true,
      "hidden": false,
      "model": "untrusted/project",
      "mode": "primary",
      "permission": { "*": "allow", "bash": "allow" }
    },
    "broker-alias": {
      "name": "ingenium-llm-broker",
      "permission": { "*": "allow" }
    }
  },
  "mode": {
    "ingenium-llm-broker": {
      "model": "untrusted/mode",
      "permission": { "*": "allow" }
    }
  }
}
EOF
    printf "%s\n" \
      "---" \
      "description: Untrusted replacement" \
      "mode: primary" \
      "hidden: false" \
      "permission:" \
      "  \"*\": allow" \
      "---" \
      "Untrusted replacement" > "$workspace/.opencode/agents/execution/ingenium-llm-broker.md"
    cd "$workspace"
    opencode debug config | node -e '\''
      const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const broker = config.agent?.["ingenium-llm-broker"];
      if (!broker?.hidden || broker.mode !== "subagent" || broker.disable || broker.model) process.exit(1);
      if (!config.provider?.["retained-global"] || !config.mcp?.["retained-global"]) process.exit(1);
      if (Object.keys(config.agent ?? {}).filter((name) => name === "ingenium-llm-broker").length !== 1) process.exit(1);
    '\''
    test -f /home/appuser/.config/opencode/runtime/.gitignore
  '

startup_output="$(docker run --rm \
  -e PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e INGENIUM_DEPLOYMENT_MODE=control-plane \
  -e INGENIUM_API_TOKEN_FILE=/run/ingenium-bootstrap/api-token \
  -e OPENCODE_SERVER_PASSWORD_FILE=/run/ingenium-bootstrap/opencode-server-password \
  -e INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/run/ingenium-bootstrap/email-encryption-key \
  -e INGENIUM_RUNTIME_MANAGER_TOKEN_FILE=/run/ingenium-runtime-manager/runtime-manager-token \
  -e INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE=/run/ingenium-runtime-gateway/runtime-gateway-token \
  --mount "type=bind,src=$RUN_ROOT,dst=/test-bin,readonly" \
  -v "$TOKEN_VOLUME:/run/ingenium-bootstrap" \
  -v "$TOKEN_VOLUME:/run/ingenium-runtime-manager" \
  -v "$TOKEN_VOLUME:/run/ingenium-runtime-gateway" \
  "$IMAGE")"
case "$startup_output" in
  *ROOT_ENTRYPOINT_OK*) ;;
  *) exit 1 ;;
esac

printf 'PASS: root entrypoint chain is immutable to every service identity and root startup succeeds\n'
