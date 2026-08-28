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
  "agent": {
    "ingenium-llm-broker": {
      "disable": true,
      "hidden": false,
      "model": "untrusted/project",
      "mode": "primary",
      "tools": { "bash": true },
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
  },
  "plugin": [
    "file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts",
    "file://{env:PWD}/packages/ingenium-extension/plugins/session-coordinator.ts",
    "file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs"
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
  if docker exec "$CONTAINER" curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:4098/provider; then
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
  const [configResponse, providerResponse, mcpResponse, agentResponse] = await Promise.all([
    fetch("http://127.0.0.1:4098/config"),
    fetch("http://127.0.0.1:4098/provider"),
    fetch("http://127.0.0.1:4098/mcp"),
    fetch("http://127.0.0.1:4098/agent"),
  ]);
  assert(configResponse.status === 200 && providerResponse.status === 200 && mcpResponse.status === 200 && agentResponse.status === 200, "OpenCode route status");
  const config = await configResponse.json();
  assert(config.provider?.["retained-fixture"] && config.mcp?.["retained-fixture"], "normal config retention");
  const normalPlugins = config.plugin.filter((plugin) => !plugin.includes("enforce-reserved-broker.mjs"));
  assert(normalPlugins.length === 5 && new Set(normalPlugins).size === 5, "single canonical normal plugin set");
  assert(config.plugin.filter((plugin) => plugin.includes("enforce-reserved-broker.mjs")).length === 1, "single protected enforcer");
  assert(config.mcp.ingenium.command.join(" ") === "node /app/packages/ingenium-extension/dist/scripts/mcp-server.js", "protected MCP command precedence");
  assert(config.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE === "/run/ingenium-runtime/unavailable", "protected MCP credential precedence");
  const agents = await agentResponse.json();
  const brokers = agents.filter((agent) => agent.name === "ingenium-llm-broker");
  assert(brokers.length === 1, "single broker");
  const broker = brokers[0];
  assert(broker.hidden === true && broker.mode === "subagent" && broker.model === undefined, "broker shape");
  const wildcardDeny = broker.permission.findLastIndex((rule) => rule.permission === "*" && rule.pattern === "*" && rule.action === "deny");
  assert(wildcardDeny !== -1 && broker.permission.slice(wildcardDeny + 1).every((rule) => rule.action === "deny"), "broker wildcard deny");
  const event = await fetch("http://127.0.0.1:4098/event");
  assert(event.status === 200 && event.headers.get("content-type")?.startsWith("text/event-stream"), "event stream");
  await event.body?.cancel();
'

docker exec "$CONTAINER" sh -ec '
  test -f /home/appuser/.config/opencode/runtime/.gitignore
  test -w /home/appuser/.config/opencode/runtime
  test ! -w /usr/local/share/ingenium/opencode-managed
  test ! -w /usr/local/share/ingenium/opencode-managed/opencode.json
  test ! -w /usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md
  test ! -w /usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker.mjs
'

printf 'PASS: OpenCode writable state and protected broker precedence are isolated\n'
