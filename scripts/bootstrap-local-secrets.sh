#!/bin/sh
# Create only a missing local API credential without touching the email
# encryption key. The resulting files are ignored by Git and mode 0600.
set -eu

repo_root="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
env_file="${repo_root}/.env"
opencode_dir="${repo_root}/.opencode"
token_file="${opencode_dir}/.ingenium-api-token"

fail() {
  echo "ERROR: $1"
  exit 1
}

random_secret() {
  if [ ! -r /dev/urandom ] || ! command -v od >/dev/null 2>&1; then
    fail "a secure /dev/urandom source and od are required to generate local credentials"
  fi
  # 32 random bytes encoded as hex: shell-safe and base64url-compatible.
  LC_ALL=C od -An -N 32 -tx1 /dev/urandom | tr -d ' \n'
}

value_for() {
  key="$1"
  matches="$(grep -c "^${key}=" "$env_file" || true)"
  if [ "$matches" -gt 1 ]; then
    fail "${key} is declared more than once in .env"
  fi
  if [ "$matches" -eq 0 ]; then
    return 0
  fi
  grep "^${key}=" "$env_file" | cut -d= -f2-
}

replace_env_value() {
  key="$1"
  value="$2"
  tmp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
  trap 'rm -f "$tmp_file"' EXIT HUP INT TERM
  found=0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "${key}="*)
        if [ "$found" -ne 0 ]; then
          fail "${key} is declared more than once in .env"
        fi
        printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
        found=1
        ;;
      *)
        printf '%s\n' "$line" >> "$tmp_file"
        ;;
    esac
  done < "$env_file"

  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
  fi
  chmod 0600 "$tmp_file"
  mv "$tmp_file" "$env_file"
  trap - EXIT HUP INT TERM
}

valid_api_token() {
  value="$1"
  length="$(printf '%s' "$value" | LC_ALL=C wc -c)"
  [ "$length" -ge 32 ] && [ "$length" -le 128 ] &&
    printf '%s' "$value" | LC_ALL=C grep -qE '^[A-Za-z0-9_-]+$'
}

umask 077
if [ -L "$env_file" ]; then
  fail ".env must not be a symbolic link"
fi
if [ -e "$env_file" ] && [ ! -f "$env_file" ]; then
  fail ".env must be a regular file"
fi
if [ ! -e "$env_file" ]; then
  : > "$env_file"
fi
chmod 0600 "$env_file"

api_token="$(value_for INGENIUM_API_TOKEN)"
if [ -z "$api_token" ]; then
  api_token="$(random_secret)"
  if ! valid_api_token "$api_token"; then
    fail "secure API token generation failed"
  fi
  replace_env_value INGENIUM_API_TOKEN "$api_token"
elif ! valid_api_token "$api_token"; then
  fail "INGENIUM_API_TOKEN in .env must contain 32 to 128 base64url characters"
fi

# Keep a protected host OpenCode token-file fallback without placing the token
# in tracked opencode.json. Never overwrite a mismatched value: that would
# silently rotate a credential and break a running deployment.
if [ -L "$opencode_dir" ]; then
  fail ".opencode must not be a symbolic link"
fi
if [ -e "$opencode_dir" ] && [ ! -d "$opencode_dir" ]; then
  fail ".opencode must be a directory"
fi
mkdir -p "$opencode_dir"
if [ -L "$opencode_dir" ]; then
  fail ".opencode must not be a symbolic link"
fi
if [ -L "$token_file" ]; then
  fail ".opencode/.ingenium-api-token must not be a symbolic link"
fi
if [ -e "$token_file" ] && [ ! -f "$token_file" ]; then
  fail ".opencode/.ingenium-api-token must be a regular file"
fi
if [ -f "$token_file" ]; then
  existing_token="$(tr -d '\r\n' < "$token_file")"
  if [ "$existing_token" != "$api_token" ]; then
    fail ".opencode/.ingenium-api-token does not match INGENIUM_API_TOKEN in .env"
  fi
else
  printf '%s\n' "$api_token" > "$token_file"
fi
chmod 0600 "$token_file"
