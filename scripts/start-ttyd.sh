#!/bin/sh
# ttyd is started only after its OpenCode attach target accepts HTTP requests.
set -eu

/app/scripts/wait-for-opencode.sh

# Keep the browser-facing terminal free of inherited credentials. The gateway
# supplies the fixed identity, while the MCP child reads the protected token
# through its worktree-relative path rather than an inline bearer value.
# The empty OpenCode password is intentional: browser authentication belongs
# to the local gateway. ttyd's loopback bind, origin check, and injected header
# keep the browser-to-terminal boundary in that gateway.
exec env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/home/appuser" \
  XDG_CONFIG_HOME="/home/appuser/.config" \
  XDG_DATA_HOME="/home/appuser/.local/share" \
  OPENCODE_SERVER_PASSWORD="" \
  INGENIUM_API_URL="http://localhost:4097/api/v1" \
  INGENIUM_API_TOKEN_FILE=".opencode/.ingenium-api-token" \
  INGENIUM_WORKTREE="/workspace" \
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
