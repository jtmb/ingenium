#!/bin/sh
# ttyd is started only after its OpenCode attach target accepts HTTP requests.
set -eu

/app/scripts/wait-for-opencode.sh

exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  XDG_DATA_HOME="/home/appuser/.local/share" \
  OPENCODE_SERVER_PASSWORD="" \
  INGENIUM_PROJECT="global-default" \
  ttyd \
    --interface 127.0.0.1 \
    --port 4099 \
    --writable \
    --check-origin \
    --auth-header X-Ingenium-Authenticated-User \
    --client-option rendererType=canvas \
    --client-option 'theme={"background":"#000000"}' \
    --client-option fontSize=14 \
    --client-option cursorBlink=true \
    opencode attach http://127.0.0.1:4098 --dir /workspace
