#!/bin/sh
# The public boundary consumes the protected API token file and clears the
# inherited container environment before starting Node.
set -eu

token_file="${INGENIUM_API_TOKEN_FILE:-/run/ingenium-secrets/api-token}"

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  NODE_ENV="production" \
  INGENIUM_API_TOKEN_FILE="$token_file" \
  INGENIUM_API_PROXY_PORT="4097" \
  INGENIUM_API_UPSTREAM_PORT="4096" \
  node /app/scripts/api-boundary-proxy.mjs
