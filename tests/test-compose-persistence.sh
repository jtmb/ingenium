#!/usr/bin/env bash
# Proves the Compose project identity and the three durable named stores survive recreation.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_PARENT="${TEMP_PARENT%/}"
RUN_ROOT="$(mktemp -d "${TEMP_PARENT}/ingenium-compose-persistence.XXXXXX")"
RUN_HOME="${RUN_ROOT}/home"
ALTERNATE_PROJECT_DIRECTORY="${RUN_ROOT}/alternate-project-directory"
RUN_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replace(/-/g, ""))')"
PROJECT="ingenium-persistence-${RUN_ID}"
SENTINEL="compose-persistence:${PROJECT}"
TEST_API_TOKEN="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
TEST_EMAIL_ENCRYPTION_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
TEST_OPENCODE_PASSWORD="compose-persistence-test-password"
ownership_verified=0
resources_created=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

compose_command() (
  unset COMPOSE_FILE INGENIUM_API_TOKEN_FILE
  if [[ "${1:-}" == "--environment-project" ]]; then
    export COMPOSE_PROJECT_NAME="$2"
    shift 2
  else
    unset COMPOSE_PROJECT_NAME
  fi
  export HOME="$RUN_HOME"
  export IMAGE_REVISION="$REVISION"
  export IMAGE_SOURCE="https://github.com/jtmb/ingenium"
  export OPENCODE_SERVER_PASSWORD="$TEST_OPENCODE_PASSWORD"
  export INGENIUM_API_TOKEN="$TEST_API_TOKEN"
  export INGENIUM_EMAIL_ENCRYPTION_KEY="$TEST_EMAIL_ENCRYPTION_KEY"
  export GOOGLE_OAUTH_CLIENT_ID=""
  export GOOGLE_OAUTH_CLIENT_SECRET=""
  export MS_OAUTH_CLIENT_ID=""
  export MS_OAUTH_CLIENT_SECRET=""
  export INGENIUM_BACKUPS_DIR=""
  export INGENIUM_BACKUP_SIGNING_KEY_FILE=""
  export INGENIUM_RESTORE_STAGING_DIR=""
  docker compose "$@"
)

compose() {
  compose_command -p "$PROJECT" --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" "$@"
}

cleanup() {
  local status=$?
  trap - EXIT

  if [[ "$RUN_ROOT" != "${TEMP_PARENT}/ingenium-compose-persistence."* ]]; then
    printf 'RETAINED: unexpected temporary path %s\n' "$RUN_ROOT" >&2
    exit 1
  fi

  if [[ "$ownership_verified" -eq 1 ]]; then
    df -h "$TEMP_PARENT"
    if ! compose down --remove-orphans; then
      printf 'RETAINED: disposable Compose project %s and evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
      exit 1
    fi
    # The entrypoint projects root-owned agent profiles into this disposable bind mount.
    if ! compose run --rm --no-deps --no-tty --entrypoint /bin/sh ingenium -ec 'rm -rf -- /workspace/.opencode'; then
      printf 'RETAINED: disposable Compose project %s and evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
      exit 1
    fi
    if ! compose down --remove-orphans --volumes --rmi local; then
      printf 'RETAINED: disposable Compose project %s and evidence at %s\n' "$PROJECT" "$RUN_ROOT" >&2
      exit 1
    fi
    rm -rf -- "$RUN_ROOT"
  elif [[ "$resources_created" -eq 1 ]]; then
    printf 'RETAINED: disposable Compose project %s and evidence at %s; ownership was not verified\n' "$PROJECT" "$RUN_ROOT" >&2
  else
    rm -rf -- "$RUN_ROOT"
  fi

  exit "$status"
}
trap cleanup EXIT

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail 'Git HEAD is not a lowercase 40-character SHA'
mkdir -p "$RUN_HOME/repos" "$RUN_HOME/.local/share/opencode" "$ALTERNATE_PROJECT_DIRECTORY"
cp "$REPO_ROOT/opencode.json" "$ALTERNATE_PROJECT_DIRECTORY/opencode.json"

assert_default_compose_contract() {
  compose_command --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config --format json | node -e '
    const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (config.name !== "ingenium") throw new Error(`expected canonical project name ingenium, got ${String(config.name)}`);
    const expected = new Map([
      ["/app/.ingenium", "ingenium-data"],
      ["/home/appuser/.config", "opencode-config"],
      ["/home/appuser/.local", "opencode-data"],
    ]);
    const mounts = config.services?.ingenium?.volumes ?? [];
    for (const [target, source] of expected) {
      const mount = mounts.find((candidate) => candidate.target === target);
      if (!mount || mount.type !== "volume" || mount.source !== source) {
        throw new Error(`durable mount ${source}:${target} is missing or changed`);
      }
      if (!Object.hasOwn(config.volumes ?? {}, source)) {
        throw new Error(`named volume ${source} is not declared`);
      }
    }
  '
}

compose_name() {
  local project_directory="$1"
  shift
  compose_command "$@" --project-directory "$project_directory" -f "$REPO_ROOT/docker-compose.yml" config --format json | node -e '
    const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    process.stdout.write(`${config.name ?? ""}\n`);
  '
}

assert_default_compose_contract
[[ "$(compose_name "$ALTERNATE_PROJECT_DIRECTORY")" == "ingenium" ]] \
  || fail 'canonical Compose project name changed with project-directory selection'
[[ "$(compose_name "$REPO_ROOT" --environment-project explicit-environment-override)" == "explicit-environment-override" ]] \
  || fail 'COMPOSE_PROJECT_NAME did not retain its documented explicit override behavior'
[[ "$(compose_name "$REPO_ROOT" -p explicit-flag-override)" == "explicit-flag-override" ]] \
  || fail '-p did not retain its documented explicit override behavior'

verify_run_owned_volume() {
  local logical_volume="$1"
  local volume_name="${PROJECT}_${logical_volume}"
  [[ "$volume_name" != ingenium_* ]] || fail "test selected a normal Ingenium volume: $volume_name"
  docker volume inspect "$volume_name" | PERSISTENCE_PROJECT="$PROJECT" PERSISTENCE_VOLUME="$logical_volume" PERSISTENCE_VOLUME_NAME="$volume_name" node -e '
      const [volume] = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      if (volume?.Name !== process.env.PERSISTENCE_VOLUME_NAME) throw new Error("unexpected volume identity");
      if (volume?.Labels?.["com.docker.compose.project"] !== process.env.PERSISTENCE_PROJECT) {
        throw new Error("volume is not owned by this disposable Compose project");
      }
      if (volume?.Labels?.["com.docker.compose.volume"] !== process.env.PERSISTENCE_VOLUME) {
        throw new Error("volume logical name does not match this disposable Compose project");
      }
    '
}

assert_no_project_containers() {
  local remaining
  remaining="$(compose ps --all --quiet)"
  [[ -z "$remaining" ]] || fail "Compose recreation left containers behind: $remaining"
}

runtime_state() {
  local runtime_name="$1"
  compose ps --all --format json | PERSISTENCE_RUNTIME_NAME="$runtime_name" node -e '
    const text = require("node:fs").readFileSync(0, "utf8").trim();
    const containers = !text ? [] : text.startsWith("[")
      ? JSON.parse(text)
      : text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const runtime = containers.find((container) => container.Name === process.env.PERSISTENCE_RUNTIME_NAME);
    process.stdout.write(`${runtime?.State ?? "missing"}\n`);
  '
}

start_runtime() {
  local runtime_name="$1"
  local state
  local attempt

  # `docker compose run` keeps service ports unpublished unless -P is requested.
  compose run --detach --no-deps --no-tty --name "$runtime_name" ingenium
  for ((attempt = 1; attempt <= 45; attempt += 1)); do
    state="$(runtime_state "$runtime_name")"
    if [[ "$state" == "running" ]]; then
      return
    fi
    if [[ "$state" == "exited" || "$state" == "dead" ]]; then
      break
    fi
    sleep 1
  done

  compose ps --all
  compose logs --tail 200
  fail "container entrypoint did not remain running (state: $state)"
}

write_sentinels() {
  compose run --rm --no-deps --no-tty --entrypoint /bin/sh \
    -e "PERSISTENCE_SENTINEL=$SENTINEL" \
    ingenium -ec '
      set -eu
      for sentinel_path in \
        /app/.ingenium/.compose-persistence-sentinel \
        /home/appuser/.config/opencode/.compose-persistence-sentinel \
        /home/appuser/.local/share/opencode/.compose-persistence-sentinel; do
        printf "%s\n" "$PERSISTENCE_SENTINEL" > "$sentinel_path"
      done
    '
}

verify_sentinels() {
  compose run --rm --no-deps --no-tty --entrypoint /bin/sh \
    -e "PERSISTENCE_SENTINEL=$SENTINEL" \
    ingenium -ec '
      set -eu
      for sentinel_path in \
        /app/.ingenium/.compose-persistence-sentinel \
        /home/appuser/.config/opencode/.compose-persistence-sentinel \
        /home/appuser/.local/share/opencode/.compose-persistence-sentinel; do
        [ -f "$sentinel_path" ] || { printf "missing sentinel: %s\n" "$sentinel_path" >&2; exit 1; }
        [ "$(cat "$sentinel_path")" = "$PERSISTENCE_SENTINEL" ] \
          || { printf "changed sentinel: %s\n" "$sentinel_path" >&2; exit 1; }
      done
    '
}

resources_created=1
compose build ingenium
start_runtime "${PROJECT}-initial"
write_sentinels

for logical_volume in ingenium-data opencode-config opencode-data vscode-data; do
  verify_run_owned_volume "$logical_volume"
done
ownership_verified=1

for cycle in 1 2; do
  compose down --remove-orphans
  assert_no_project_containers
  start_runtime "${PROJECT}-cycle-${cycle}"
  verify_sentinels
done

printf 'PASS: canonical Compose identity and durable sentinels survived two recreate cycles\n'
