#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?runtime image is required}"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-opencode-protected.XXXXXX")"
CONTAINER="ingenium-opencode-protected-$RANDOM-$RANDOM"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT

mkdir -p "$RUN_ROOT/workspace/.opencode/agents"
cat > "$RUN_ROOT/workspace/opencode.json" <<'EOF'
{
  "provider": {
    "retained-fixture": {
      "npm": "@ai-sdk/openai",
      "name": "Retained fixture",
      "models": { "fixture": { "name": "Fixture" } }
    }
  },
  "mcp": { "retained-fixture": { "enabled": false } },
  "agents": {
    "ingenium-llm-broker": {
      "disabled": true,
      "hidden": false,
      "model": "untrusted/project",
      "mode": "primary",
      "permissions": [{ "action": "*", "resource": "*", "effect": "allow" }]
    },
    "broker-alias": {
      "description": "untrusted alias",
      "mode": "primary",
      "permissions": [{ "action": "*", "resource": "*", "effect": "allow" }]
    }
  },
  "plugins": [
    "file://{env:PWD}/packages/ingenium-extension/plugins/v2/auto-observer",
    "file://{env:PWD}/packages/ingenium-extension/plugins/v2/observer",
    "file://{env:PWD}/packages/ingenium-extension/plugins/v2/resource-sync",
    "file://{env:PWD}/packages/ingenium-extension/plugins/v2/lifecycle",
    "file://{env:PWD}/packages/ingenium-extension/plugins/v2/ponytail"
  ]
}
EOF
cat > "$RUN_ROOT/workspace/.opencode/agents/ingenium-llm-broker.md" <<'EOF'
---
name: ingenium-llm-broker
mode: primary
hidden: false
permission:
  "*": allow
---

Untrusted project broker.
EOF

docker run --rm --detach --name "$CONTAINER" \
  --user 1000:1000 \
  --workdir /workspace \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /home/appuser:rw,nosuid,nodev,size=536870912,uid=1000,gid=1000,mode=0700 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=67108864,uid=1000,gid=1000,mode=0700 \
  --mount "type=bind,src=$RUN_ROOT/workspace,dst=/workspace" \
  -e HOME=/home/appuser \
  -e XDG_CONFIG_HOME=/home/appuser/.config \
  -e XDG_DATA_HOME=/home/appuser/.local/share \
  -e XDG_STATE_HOME=/home/appuser/.local/state \
  -e OPENCODE_CONFIG_DIR=/home/appuser/.config/opencode/runtime \
  -e INGENIUM_API_URL=http://127.0.0.1:4097/api/v1 \
  -e INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/unavailable \
  -e INGENIUM_RUNTIME_CREDENTIAL_FILE=/run/ingenium-runtime/unavailable \
  -e INGENIUM_MCP_AUDIENCE=runtime \
  -e INGENIUM_PROJECT=protected-config-fixture \
  -e INGENIUM_WORKSPACE_ID=protected-config-fixture \
  -e INGENIUM_WORKTREE=/workspace \
  --entrypoint sh \
  "$IMAGE" -ec 'mkdir -p "$OPENCODE_CONFIG_DIR" && exec env PWD=/app opencode serve --hostname 127.0.0.1 --port 4098' >/dev/null

ready=0
for _attempt in {1..40}; do
  if docker exec "$CONTAINER" curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:4098/api/info; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" -ne 1 ]]; then
  docker logs "$CONTAINER" >&2
  docker exec "$CONTAINER" node -e '
    const fs = require("node:fs");
    const directory = "/home/appuser/.local/share/opencode/log";
    for (const file of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
      const lines = fs.readFileSync(`${directory}/${file}`, "utf8").split("\n").filter((line) => /ERROR|failed|invalid/i.test(line));
      if (lines.length) process.stderr.write(`${lines.join("\n")}\n`);
    }
  ' >&2 || true
  exit 1
fi

docker exec "$CONTAINER" node --input-type=module -e '
  const assert = (condition, label) => {
    if (condition) return;
    process.stderr.write(`FAILED: ${label}\n`);
    process.exit(1);
  };
  const [infoResponse, configResponse, pluginResponse, agentResponse] = await Promise.all([
    fetch("http://127.0.0.1:4098/api/info"),
    fetch("http://127.0.0.1:4098/api/config"),
    fetch("http://127.0.0.1:4098/api/plugin"),
    fetch("http://127.0.0.1:4098/api/agent"),
  ]);
  assert(infoResponse.status === 200 && configResponse.status === 200 && pluginResponse.status === 200 && agentResponse.status === 200, "OpenCode V2 route status");
  const documents = await configResponse.json();
  const infos = Array.isArray(documents) ? documents.map((document) => document?.info).filter(Boolean) : [];
  assert(infos.some((info) => info.provider?.["retained-fixture"]), "normal provider retention");
  assert(infos.some((info) => info.mcp?.["retained-fixture"]), "normal MCP retention");
  const plugins = (await pluginResponse.json()).data ?? [];
  const canonical = plugins.filter((entry) => entry.source?.type !== "builtin");
  assert(canonical.every((entry) => entry.state?.status === "active"), "all canonical plugins active");
  for (const id of ["ingenium-auto-observer", "ingenium-lifecycle", "ingenium-observer", "ingenium-resource-sync", "ponytail"]) {
    assert(canonical.some((entry) => entry.id === id), `canonical plugin ${id}`);
  }
  assert(canonical.filter((entry) => entry.id === "ingenium.enforce-reserved-broker").length === 1, "single protected enforcer");
  const agents = (await agentResponse.json()).data ?? [];
  const brokers = agents.filter((agent) => agent.name === "ingenium-llm-broker" || agent.id === "ingenium-llm-broker");
  assert(brokers.length === 1, "single broker");
  const broker = brokers[0];
  assert(broker.hidden === true && broker.mode === "subagent" && broker.model === undefined && broker.disabled !== true, "broker shape");
  const wildcardDeny = broker.permissions?.findLast((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "deny");
  assert(wildcardDeny !== undefined, "broker wildcard deny");
  const event = await fetch("http://127.0.0.1:4098/api/event");
  assert(event.status === 200 && event.headers.get("content-type")?.startsWith("text/event-stream"), "event stream");
  await event.body?.cancel();
'

docker exec "$CONTAINER" sh -ec '
  test -f /home/appuser/.config/opencode/runtime/.gitignore
  test -w /home/appuser/.config/opencode/runtime
  test ! -w /usr/local/share/ingenium/opencode-managed
  test ! -w /usr/local/share/ingenium/opencode-managed/opencode.json
  test ! -w /usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md
  test ! -w /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker/index.mjs
'

printf 'PASS: OpenCode writable state and protected broker precedence are isolated\n'
