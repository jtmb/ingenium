#!/usr/bin/env bash
# Static and rendered Docker Compose checks for the /workspace bind-mount contract.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
RENDER_HOME="/tmp/ingenium-workspace-contract-home"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_text() {
  local path="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$REPO_ROOT/$path" || fail "missing '$expected' in $path"
}

reject_text() {
  local path="$1"
  local forbidden="$2"
  if grep -Fq -- "$forbidden" "$REPO_ROOT/$path"; then
    fail "forbidden '$forbidden' found in $path"
  fi
}

require_text docker-compose.yml '${HOME:?HOME must be set for the /workspace bind mount}/repos:/workspace'
reject_text docker-compose.yml 'opencodeweb_workspace'
reject_text docker-compose.yml '${HOME:-~}/repos'

# The configured HOME value must render as the bind source; Compose does not
# create or inspect the host directory when rendering its configuration.
rendered_config="$(
  HOME="$RENDER_HOME" \
  OPENCODE_SERVER_PASSWORD_FILE=/tmp/opencode-server.password \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/tmp/email-encryption.key \
  INGENIUM_RUNTIME_ROOT_DOMAIN=runtime.example.test \
  DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.test \
  IMAGE_REVISION="$REVISION" \
  docker compose --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config
)"

expected_mount=$'        source: /tmp/ingenium-workspace-contract-home/repos\n        target: /workspace'
[[ "$rendered_config" == *"$expected_mount"* ]] || fail 'rendered Compose config does not bind ${HOME}/repos to /workspace'

# HOME is required rather than silently falling back to an arbitrary host path.
if env -u HOME \
  OPENCODE_SERVER_PASSWORD_FILE=/tmp/opencode-server.password \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/tmp/email-encryption.key \
  INGENIUM_RUNTIME_ROOT_DOMAIN=runtime.example.test \
  DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.test \
  IMAGE_REVISION="$REVISION" \
  docker compose --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config; then
  fail 'Compose config succeeded without HOME'
fi

printf 'PASS: workspace bind-mount static and rendered Compose contracts\n'
