#!/bin/sh
set -eu

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-opencode" \
  NODE_ENV="production" \
  OPENCODE_SERVER_PASSWORD_FILE="/run/ingenium-secrets/opencode/opencode-server-password" \
  node /app/scripts/opencode-auth-proxy.mjs
