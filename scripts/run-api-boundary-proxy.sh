#!/bin/sh
# The public boundary forwards only bounded bearer shapes. Credential
# verification remains in the private API process.
set -eu

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-boundary" \
  NODE_ENV="production" \
  INGENIUM_API_PROXY_PORT="4097" \
  INGENIUM_API_UPSTREAM_PORT="4096" \
  node /app/scripts/api-boundary-proxy.mjs
