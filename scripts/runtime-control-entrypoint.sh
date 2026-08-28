#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: runtime control bootstrap requires root"
  exit 1
fi

role="${1:-}"
case "$role" in
  manager)
    service_user="ingenium-runtime-manager"
    bootstrap_file="${INGENIUM_RUNTIME_MANAGER_BOOTSTRAP_TOKEN_FILE:?INGENIUM_RUNTIME_MANAGER_BOOTSTRAP_TOKEN_FILE is required}"
    token_file="/run/ingenium-secrets/runtime-manager/token"
    command="/app/services/ingenium-api/dist/scripts/runtime-manager.js"
    ;;
  gateway)
    service_user="ingenium-runtime-gateway"
    bootstrap_file="${INGENIUM_RUNTIME_GATEWAY_BOOTSTRAP_TOKEN_FILE:?INGENIUM_RUNTIME_GATEWAY_BOOTSTRAP_TOKEN_FILE is required}"
    token_file="/run/ingenium-secrets/runtime-gateway/token"
    command="/app/services/ingenium-api/dist/scripts/runtime-gateway.js"
    ;;
  *)
    echo "ERROR: runtime control role is invalid"
    exit 1
    ;;
esac

service_uid="$(cat "/usr/local/share/ingenium/runtime-${role}-uid")"
service_gid="$(cat "/usr/local/share/ingenium/runtime-${role}-gid")"
bootstrap_uid="$(cat /usr/local/share/ingenium/appuser-uid)"
bootstrap_gid="$(cat /usr/local/share/ingenium/appuser-gid)"
if [ "$service_uid" != "$(id -u "$service_user")" ] || [ "$service_gid" != "$(id -g "$service_user")" ]; then
  echo "ERROR: runtime control identity is invalid"
  exit 1
fi

install -d -o root -g root -m 0700 /run/ingenium-bootstrap
install -d -o root -g root -m 0711 /run/ingenium-secrets
install -d -o "$service_uid" -g "$service_gid" -m 0700 "$(dirname "$token_file")"
node /app/scripts/read-protected-api-token.mjs \
  "$bootstrap_file" "$bootstrap_uid" "$bootstrap_gid" "$token_file" installation-api 0 0 "$service_uid" "$service_gid"

if [ "$role" = "manager" ]; then
  workspace_bootstrap_file="${INGENIUM_RUNTIME_WORKSPACE_BOOTSTRAP_MAP_FILE:?INGENIUM_RUNTIME_WORKSPACE_BOOTSTRAP_MAP_FILE is required}"
  workspace_file="/run/ingenium-secrets/runtime-manager/workspaces.json"
  if [ "$(stat -c '%F:%u:%g:%a' "$workspace_bootstrap_file")" != "regular file:${bootstrap_uid}:${bootstrap_gid}:600" ]; then
    echo "ERROR: runtime workspace map metadata is invalid"
    exit 1
  fi
  install -o "$service_uid" -g "$service_gid" -m 0400 "$workspace_bootstrap_file" "$workspace_file"
  export INGENIUM_RUNTIME_WORKSPACE_MAP_FILE="$workspace_file"
  export INGENIUM_RUNTIME_MANAGER_TOKEN_FILE="$token_file"
  socket_gid="$(stat -c '%g' /var/run/docker.sock)"
  exec setpriv --reuid="$service_uid" --regid="$service_gid" --groups="$socket_gid" \
    --inh-caps=-all --ambient-caps=-all --bounding-set=-all node "$command"
fi

export INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE="$token_file"
exec setpriv --reuid="$service_uid" --regid="$service_gid" --clear-groups \
  --inh-caps=-all --ambient-caps=-all --bounding-set=-all node "$command"
