#!/bin/sh
# ttyd is started only after its OpenCode attach target accepts HTTP requests.
set -eu

/app/scripts/wait-for-opencode.sh

# OpenCode V2 requires HTTP basic auth; use this identity's private copy,
# never an ACL on the proxy's owner-private secret.
opencode_server_password=""
if [ "${INGENIUM_EXECUTION_SCOPE:-project}" = workspace ]; then
  if [ ! -r /run/ingenium-runtime/opencode-server-password ]; then echo "ERROR: workspace OpenCode secret unavailable"; exit 1; fi
  opencode_server_password="$(cat /run/ingenium-runtime/opencode-server-password)"
else
for candidate in \
  /run/ingenium-secrets/ttyd/opencode-server-password \
  /run/ingenium-runtime/opencode-server-password; do
  if [ -r "$candidate" ]; then
    opencode_server_password="$(cat "$candidate")"
    break
  fi
done
fi

# Workspace audiences share the original runtime's private derived credential.
# A generic proxy header cannot authenticate a different runtime at a reused IP.
if [ "${INGENIUM_EXECUTION_SCOPE:-project}" = workspace ]; then
  if [ -z "$opencode_server_password" ]; then echo "ERROR: workspace terminal secret unavailable"; exit 1; fi
  mkdir -p /home/ingenium-ttyd/.config /home/ingenium-ttyd/.local/share /home/ingenium-ttyd/.tmp
  set -- --credential "opencode:$opencode_server_password"
else
  set -- --auth-header X-Ingenium-Authenticated-User
fi

# Keep the browser-facing terminal free of inherited credentials. OpenCode's
# server process owns MCP/plugin access; this process is only an attach client.
# The gateway validates the browser session. Workspace ttyd also verifies the
# original runtime's Basic credential; Project ttyd keeps its proxy-header mode.
exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/ingenium-ttyd" \
  XDG_CONFIG_HOME="/home/ingenium-ttyd/.config" \
  XDG_DATA_HOME="/home/ingenium-ttyd/.local/share" \
  TMPDIR="/home/ingenium-ttyd/.tmp" \
  OPENCODE_SERVER_PASSWORD="$opencode_server_password" \
  ttyd \
    --interface "${INGENIUM_RUNTIME_BIND_HOST:-127.0.0.1}" \
    --port 4099 \
    --writable \
    --check-origin \
    "$@" \
    --client-option rendererType=canvas \
    --client-option 'theme={"background":"#000000"}' \
    --client-option fontSize=14 \
    --client-option cursorBlink=true \
    opencode --server http://127.0.0.1:4098 /workspace
