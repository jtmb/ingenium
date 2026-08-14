#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
revision="$(git -C "$repo_root" rev-parse HEAD)"
root="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-runtime-manager.XXXXXX")"
fixture_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
runtime_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
project="ingenium-runtime-manager-${fixture_id}"
export CONTROL_PLANE_CONTAINER="${project}-control-plane"
export RUNTIME_GATEWAY_CONTAINER="${project}-runtime-gateway"
export CONTROL_PLANE_HOST_PORT="$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close();})')"
export MANAGER_HOST_PORT="$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close();})')"
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
export MANAGER_TOKEN_FILE="$root/token"
export WORKSPACE_MAP_FILE="$root/workspaces.json"
export PROVISION_REQUEST_FILE="$root/provision.json"
export RUNTIME_WORKSPACE_HOST="$root/workspace"
export RUNTIME_MANAGER_IMAGE="ingenium-runtime-manager:latest"
export RUNTIME_IMAGE="ingenium-user-runtime:${revision}"
export RUNTIME_NETWORK_PREFIX="ingenium-runtime-test-${fixture_id}-"
runtime_name="ingenium-runtime-${runtime_id//-/}"
runtime_network="${RUNTIME_NETWORK_PREFIX}${runtime_id//-/}"
mkdir -p "$RUNTIME_WORKSPACE_HOST"
printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$MANAGER_TOKEN_FILE"
chmod 0600 "$MANAGER_TOKEN_FILE"
node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const workspaceId = "manager-fixture-workspace";
  const storagePath = process.env.RUNTIME_WORKSPACE_HOST;
  fs.writeFileSync(process.env.WORKSPACE_MAP_FILE, JSON.stringify({ version: 1, workspaces: [{ id: workspaceId, hostPath: storagePath, validationPath: "/mnt/runtime-workspace" }] }));
  fs.writeFileSync(process.env.PROVISION_REQUEST_FILE, JSON.stringify({
    runtimeId: process.argv[1],
    backendName: `ingenium-runtime-${process.argv[1].replaceAll("-", "")}`,
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectName: "manager-fixture",
    ownerUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    workspaceId,
    storagePath,
    storageMappingHash: crypto.createHash("sha256").update(`${workspaceId}\0${storagePath}`).digest("hex"),
    securityEpoch: 0,
    revision: 1,
    capability: `ing_${"d".repeat(12)}_${"e".repeat(43)}`,
    capabilityExpiresAt: new Date(Date.now() + 300000).toISOString(),
    limits: { cpuMillis: 1000, memoryBytes: 1073741824, pidsLimit: 256, diskBytes: 2147483648, processLimit: 128 },
  }));
' "$runtime_id"
chmod 0600 "$WORKSPACE_MAP_FILE" "$PROVISION_REQUEST_FILE"

compose() {
  docker compose -p "$project" -f "$repo_root/tests/runtime-manager.compose.yml" "$@"
}

manager_request() {
  method="$1"
  path="$2"
  body_file="${3:-}"
  node -e '
    (async () => {
      const fs = require("node:fs");
      const [method, path, bodyFile] = process.argv.slice(1);
      const token = fs.readFileSync(process.env.MANAGER_TOKEN_FILE, "utf8").trim();
      const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : undefined;
      const response = await fetch(`http://127.0.0.1:${process.env.MANAGER_HOST_PORT}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body,
      });
      const text = await response.text();
      process.stdout.write(`${response.status}\n${text}\n`);
      if (!response.ok) process.exit(1);
    })().catch(() => process.exit(1));
  ' "$method" "$path" "$body_file"
}

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    compose ps
    compose logs
  fi
  manager_request DELETE "/v1/runtimes/$runtime_id" || true
  compose down --remove-orphans
  if [[ "$root" == "${TMPDIR:-/tmp}/ingenium-runtime-manager."* ]]; then
    rm -rf -- "$root"
  fi
  exit "$status"
}
trap cleanup EXIT

compose up --detach
healthy=0
for _attempt in {1..40}; do
  if manager_request GET /v1/health; then
    healthy=1
    break
  fi
  sleep 0.25
done
[[ "$healthy" -eq 1 ]]

manager_request POST /v1/runtimes "$PROVISION_REQUEST_FILE"
ready=0
for _attempt in {1..120}; do
  state="$(manager_request GET "/v1/runtimes/$runtime_id")"
  if [[ "$state" == *'"state":"running"'* ]]; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" -eq 1 ]]

docker inspect "$runtime_name" --format '{{json .HostConfig}}' | node -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  if (!config.ReadonlyRootfs || config.Privileged || config.PublishAllPorts || Object.keys(config.PortBindings ?? {}).length) process.exit(1);
  if (config.Binds.some((bind) => bind.includes("docker.sock"))) process.exit(1);
'
services_ready=0
for _attempt in {1..120}; do
  if node -e '
    const response = await fetch(`http://127.0.0.1:${process.env.CONTROL_PLANE_HOST_PORT}/probe?runtime=${process.argv[1]}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) process.exit(1);
  ' "$runtime_name"; then
    services_ready=1
    break
  fi
  sleep 1
done
[[ "$services_ready" -eq 1 ]]

manager_request DELETE "/v1/runtimes/$runtime_id"
[[ -z "$(docker container ls --all --filter "name=^/${runtime_name}$" --format '{{.ID}}')" ]]
[[ -z "$(docker network ls --filter "name=^${runtime_network}$" --format '{{.ID}}')" ]]

printf 'PASS: runtime manager provisions, shares private runtime services, and removes owned container/network resources\n'
