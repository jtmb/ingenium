#!/bin/sh
set -eu

# Require auth for OpenCode server
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# Ensure writable directories exist
for dir in /app/.ingenium /app/.opencode/skills; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
  fi
done

# Use the pre-created opencode.json if user hasn't mounted one
# (a container-default opencode.json is baked into the image at /app/opencode.json)

exec supervisord -c /app/supervisord.conf
