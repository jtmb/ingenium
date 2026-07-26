#!/bin/sh
# OpenCode is served only through the local gateway and intentionally
# receives no API, OAuth, OpenCode-server, or gateway credentials.
set -eu

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  XDG_DATA_HOME="/home/appuser/.local/share" \
  OPENCODE_SERVER_PASSWORD="" \
  INGENIUM_PROJECT="global-default" \
  opencode web --port 4098 --hostname 127.0.0.1
