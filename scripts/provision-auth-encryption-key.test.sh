#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
helper="${repo_root}/scripts/provision-auth-encryption-key.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-auth-key.XXXXXX")"
owner="$(id -un)"
group="$(id -gn)"
key_file="${test_root}/auth-encryption-key"

cleanup() {
  case "$test_root" in
    "${TMPDIR:-/tmp}"/ingenium-auth-key.*) ;;
    *) return ;;
  esac
  rm -f "$test_root/auth-encryption-key" "$test_root/key-link" "$test_root/bad-key"
  rmdir "$test_root"
}
trap cleanup EXIT

sh "$helper" "$key_file" "$owner" "$group"
first_inode="$(stat -c '%i' "$key_file")"
if [ "$(stat -c '%a:%U:%G' "$key_file")" != "600:${owner}:${group}" ]; then
  exit 1
fi
if ! grep -qE '^[A-Za-z0-9_-]{43}$' "$key_file"; then
  exit 1
fi

sh "$helper" "$key_file" "$owner" "$group"
if [ "$(stat -c '%i' "$key_file")" != "$first_inode" ]; then
  exit 1
fi

ln -s "$key_file" "$test_root/key-link"
if sh "$helper" "$test_root/key-link" "$owner" "$group"; then
  exit 1
fi
printf 'invalid\n' > "$test_root/bad-key"
chmod 0600 "$test_root/bad-key"
if sh "$helper" "$test_root/bad-key" "$owner" "$group"; then
  exit 1
fi

printf 'PASS: auth encryption key provisioning is persistent and fail-closed\n'
