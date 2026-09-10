#!/bin/sh
# Next.js's server-only proxy reads its credential from the protected runtime
# file. The loader installs it only after Node has started, never through the
# entrypoint or this launcher's plaintext environment.
set -eu

token_file="/run/ingenium-secrets/dashboard/bootstrap-token"

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-dashboard" \
  NODE_ENV="production" \
  INGENIUM_DASHBOARD_BOOTSTRAP_TOKEN_FILE="$token_file" \
  DASHBOARD_ALLOWED_ORIGINS="${DASHBOARD_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}" \
  PORT="3001" \
  HOSTNAME="127.0.0.1" \
  node /app/services/ingenium-dashboard/server.js
