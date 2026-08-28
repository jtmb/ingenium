#!/bin/sh
set -eu

fail() {
  echo "ERROR: process identity or secret isolation is invalid"
  exit 1
}

users="ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore ingenium-runtime-manager ingenium-runtime-gateway appuser"
uids=""
for user in $users; do
  uid="$(id -u "$user")"
  case " $uids " in *" $uid "*) fail ;; esac
  uids="$uids $uid"
done

api_dir=/run/ingenium-secrets/api
dashboard_dir=/run/ingenium-secrets/dashboard
opencode_dir=/run/ingenium-secrets/opencode
restore_dir=/run/ingenium-secrets/restore

for entry in \
  "$api_dir:ingenium-api:ingenium-api" \
  "$dashboard_dir:ingenium-dashboard:ingenium-dashboard" \
  "$opencode_dir:ingenium-opencode:ingenium-opencode" \
  "$restore_dir:ingenium-restore:ingenium-restore"; do
  path="${entry%%:*}"
  remainder="${entry#*:}"
  owner="${remainder%%:*}"
  group="${remainder#*:}"
  [ "$(stat -c '%F:%U:%G:%a' "$path")" = "directory:$owner:$group:700" ] || fail
done

for file in "$api_dir"/* "$dashboard_dir"/* "$opencode_dir"/* "$restore_dir"/*; do
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c '%a' "$file")" = 600 ] || fail
done

can_read() { runuser -u "$1" -- test -r "$2"; }
can_write_dir() { runuser -u "$1" -- test -w "$2"; }

for file in "$api_dir"/*; do
  can_read ingenium-api "$file" || fail
  for user in ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore appuser; do
    ! can_read "$user" "$file" || fail
  done
done
for file in "$dashboard_dir"/*; do
  can_read ingenium-dashboard "$file" || fail
  for user in ingenium-api ingenium-boundary ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode ingenium-restore appuser; do
    ! can_read "$user" "$file" || fail
  done
done
for file in "$opencode_dir"/*; do
  can_read ingenium-opencode "$file" || fail
  for user in ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-ttyd ingenium-vscode ingenium-restore appuser; do
    ! can_read "$user" "$file" || fail
  done
done
for file in "$restore_dir"/*; do
  can_read ingenium-restore "$file" || fail
  for user in ingenium-api ingenium-boundary ingenium-dashboard ingenium-gateway ingenium-opencode ingenium-ttyd ingenium-vscode appuser; do
    ! can_read "$user" "$file" || fail
  done
done

for entry in "$api_dir:ingenium-api" "$dashboard_dir:ingenium-dashboard" "$opencode_dir:ingenium-opencode" "$restore_dir:ingenium-restore"; do
  path="${entry%%:*}"
  owner="${entry#*:}"
  for user in $users; do
    if [ "$user" = "$owner" ]; then can_write_dir "$user" "$path" || fail; else ! can_write_dir "$user" "$path" || fail; fi
  done
done

cmp -s "$api_dir/opencode-server-password" "$opencode_dir/opencode-server-password" || fail
cmp -s "$api_dir/dashboard-bootstrap-token" "$dashboard_dir/bootstrap-token" || fail
cmp -s "$api_dir/backup-signing-key" "$restore_dir/backup-signing-key" || fail

echo "Process identity and secret isolation validation passed"
