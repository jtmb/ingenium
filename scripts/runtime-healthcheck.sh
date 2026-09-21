#!/bin/sh
set -eu

# OpenCode V2 requires HTTP basic auth on every route. The runtime boundary
# provisions its own server secret at OPENCODE_SERVER_PASSWORD_FILE; without it
# the probe fails closed instead of reporting a healthy server that no client
# can reach.
password_file="${OPENCODE_SERVER_PASSWORD_FILE:-/run/ingenium-runtime/opencode-server-password}"
if [ ! -r "$password_file" ]; then
  echo "OpenCode readiness secret is unavailable: $password_file" >&2
  exit 1
fi
opencode_auth() {
  printf 'user = "opencode:%s"\n' "$(cat "$password_file")"
}

opencode_auth | curl --fail --silent --max-time 3 --config - --output /dev/null http://127.0.0.1:4098/api/info
opencode_auth | curl --fail --silent --max-time 3 --config - --output /dev/null http://127.0.0.1:4098/api/provider
opencode_auth | curl --fail --silent --max-time 3 --config - --output /dev/null http://127.0.0.1:4098/api/mcp
curl --fail --silent --max-time 3 --output /dev/null --header "X-Ingenium-Authenticated-User: runtime" http://127.0.0.1:4099/
curl --fail --silent --max-time 3 --output /dev/null http://127.0.0.1:4100/healthz
