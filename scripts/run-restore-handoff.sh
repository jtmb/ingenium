#!/bin/sh
set -eu

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-restore" \
  NODE_ENV="production" \
  node /app/scripts/restore-handoff.mjs
