#!/bin/sh
set -eu

# Require auth for OpenCode server
if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: OPENCODE_SERVER_PASSWORD environment variable is required"
  exit 1
fi

# DB directory is pre-created; ensure it's writable
if [ ! -d /app/.ingenium ]; then
  mkdir -p /app/.ingenium
fi

# Use the pre-created opencode.json if user hasn't mounted one
# (a container-default opencode.json is baked into the image at /app/opencode.json)

exec supervisord -c /app/supervisord.conf
