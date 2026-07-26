#!/bin/sh
# Nginx runs without inherited credentials; browser traffic reaches only local
# gateway roots and no browser bearer token is injected.
set -eu

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  /usr/sbin/nginx -c /app/nginx/gateway.conf -g "daemon off;"
