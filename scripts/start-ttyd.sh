#!/bin/sh
# ttyd is started only after its OpenCode attach target accepts HTTP requests.
set -eu

/app/scripts/wait-for-opencode.sh

# Keep the browser-facing terminal free of inherited credentials. OpenCode's
# server process owns MCP/plugin access; this process is only an attach client.
# The empty OpenCode password is intentional: browser authentication belongs
# to the local gateway. ttyd's loopback bind, origin check, and injected header
# keep the browser-to-terminal boundary in that gateway.
exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-ttyd" \
  XDG_CONFIG_HOME="/home/ingenium-ttyd/.config" \
  XDG_DATA_HOME="/home/ingenium-ttyd/.local/share" \
  TMPDIR="/home/ingenium-ttyd/.tmp" \
  OPENCODE_SERVER_PASSWORD="" \
  ttyd \
    --interface "${INGENIUM_RUNTIME_BIND_HOST:-127.0.0.1}" \
    --port 4099 \
    --writable \
    --check-origin \
    --auth-header X-Ingenium-Authenticated-User \
    --client-option rendererType=canvas \
    --client-option 'theme={"background":"#000000"}' \
    --client-option fontSize=14 \
    --client-option cursorBlink=true \
    opencode attach http://127.0.0.1:4098 --dir /workspace
