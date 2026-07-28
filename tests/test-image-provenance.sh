#!/usr/bin/env bash
# Static and Compose-rendering checks for OCI image provenance.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"

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
    fail "unsafe '$forbidden' found in $path"
  fi
}

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "Git HEAD is not a lowercase 40-character SHA"

require_text Dockerfile 'ARG IMAGE_REVISION'
require_text Dockerfile 'ARG IMAGE_SOURCE="https://github.com/jtmb/ingenium"'
require_text Dockerfile "grep -Eq '^[0-9a-f]{40}\$'"
require_text Dockerfile 'case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac'
require_text Dockerfile 'case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac'
require_text Dockerfile 'org.opencontainers.image.revision="${IMAGE_REVISION}"'
require_text Dockerfile 'org.opencontainers.image.source="${IMAGE_SOURCE}"'
reject_text Dockerfile 'ENV IMAGE_REVISION'
reject_text Dockerfile 'ENV IMAGE_SOURCE'

require_text docker-compose.yml 'IMAGE_REVISION: "${IMAGE_REVISION:?IMAGE_REVISION must be set to the current Git commit SHA}"'
require_text docker-compose.yml 'IMAGE_SOURCE: "${IMAGE_SOURCE:-https://github.com/jtmb/ingenium}"'
require_text scripts/validate-image-provenance.mjs '"compose", "ps", "-q", "ingenium"'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.revision'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.source'
require_text scripts/validate-image-provenance.mjs 'secret-bearing OCI label key'

node --check "$REPO_ROOT/scripts/validate-image-provenance.mjs"

if ! OPENCODE_SERVER_PASSWORD=compose-config-validation-password \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  IMAGE_REVISION="$REVISION" \
  docker compose --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config | grep -Fq "IMAGE_REVISION: $REVISION"; then
  fail "Compose config does not pass the current Git SHA as IMAGE_REVISION"
fi

printf 'PASS: OCI image provenance static and Compose config contracts\n'
