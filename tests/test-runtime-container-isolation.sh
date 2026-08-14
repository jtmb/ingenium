#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
revision="$(git -C "$repo_root" rev-parse HEAD)"
root="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-runtime-containers.XXXXXX")"
project="ingenium-runtime-fixture-$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
export RUNTIME_IMAGE="ingenium-user-runtime:${revision}"
export RUNTIME_ONE_WORKSPACE="$root/one"
export RUNTIME_TWO_WORKSPACE="$root/two"
mkdir -p "$RUNTIME_ONE_WORKSPACE" "$RUNTIME_TWO_WORKSPACE"

compose() {
  docker compose -p "$project" -f "$repo_root/tests/runtime-isolation.compose.yml" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  compose down --remove-orphans
  if [[ "$root" == "${TMPDIR:-/tmp}/ingenium-runtime-containers."* ]]; then
    rm -rf -- "$root"
  fi
  exit "$status"
}
trap cleanup EXIT

compose up --detach
running=0
for _attempt in {1..20}; do
  running="$(compose ps --status running --quiet | wc -l)"
  [[ "$running" -eq 2 ]] && break
  sleep 0.25
done
[[ "$running" -eq 2 ]]

verified=0
for _attempt in {1..40}; do
  if [[ -f "$RUNTIME_ONE_WORKSPACE/verified" && -f "$RUNTIME_TWO_WORKSPACE/verified" ]]; then
    verified=1
    break
  fi
  sleep 0.25
done
[[ "$verified" -eq 1 ]]

[[ -f "$RUNTIME_ONE_WORKSPACE/one" && ! -e "$RUNTIME_ONE_WORKSPACE/two" ]]
[[ -f "$RUNTIME_TWO_WORKSPACE/two" && ! -e "$RUNTIME_TWO_WORKSPACE/one" ]]
compose config --format json | node -e '
  const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  for (const service of Object.values(config.services)) {
    if (service.ports?.length || service.network_mode === "host" || service.privileged) process.exit(1);
    if (service.cap_drop?.join() !== "ALL" || service.read_only !== true) process.exit(1);
  }
'

printf 'PASS: two runtime containers isolate environment, network, and workspace mounts\n'
