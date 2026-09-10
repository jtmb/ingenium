#!/bin/sh
set -eu

handoff_file="/run/ingenium-secrets/api/cloudflare-tunnel.handoff"
secret_dir="/run/ingenium-secrets/cloudflare"
credential_file="${secret_dir}/credential"
child_pid=""

cleanup() {
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  rm -f "$credential_file" "$handoff_file"
}
trap cleanup EXIT INT TERM

[ -f "$handoff_file" ] && [ ! -L "$handoff_file" ]
[ "$(stat -c '%U:%G:%a' "$handoff_file")" = "ingenium-api:ingenium-api:600" ]
[ "$(stat -c '%F:%U:%G:%a' "$secret_dir")" = "directory:ingenium-cloudflare:ingenium-cloudflare:700" ]

temporary="$(mktemp "${secret_dir}/.credential.XXXXXX")"
install -o ingenium-cloudflare -g ingenium-cloudflare -m 0600 "$handoff_file" "$temporary"
mv -T "$temporary" "$credential_file"
rm -f "$handoff_file"

setpriv --reuid=1111 --regid=1111 --clear-groups \
  /usr/local/bin/cloudflared tunnel --no-autoupdate run --token-file "$credential_file" &
child_pid=$!
wait "$child_pid"
child_pid=""
