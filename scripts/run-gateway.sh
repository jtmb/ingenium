#!/bin/sh
# Nginx runs without inherited credentials; browser traffic reaches only local
# gateway roots and no browser bearer token is injected.
set -eu

case "${INGENIUM_DEPLOYMENT_MODE:-compatibility}" in
  compatibility) aliases="/app/nginx/runtime-aliases-compatibility.conf" ;;
  control-plane) aliases="/app/nginx/runtime-aliases-production.conf" ;;
  *) echo "ERROR: INGENIUM_DEPLOYMENT_MODE is invalid"; exit 64 ;;
esac
ln -sf "$aliases" /run/ingenium-gateway/runtime-aliases.conf

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  /usr/sbin/nginx -c /app/nginx/gateway.conf -g "daemon off;"
