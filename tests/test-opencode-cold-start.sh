#!/usr/bin/env bash
set -euo pipefail
image="${1:?Pass the built Ingenium image}"
test_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm --network none --read-only --user 0:0 \
  --tmpfs /run:rw,nosuid,nodev,noexec,mode=755 \
  --mount "type=bind,source=${test_directory}/fixtures/opencode-cold-start.mjs,target=/cold-start-test.mjs,readonly" \
  --entrypoint /usr/local/bin/node "$image" /cold-start-test.mjs
