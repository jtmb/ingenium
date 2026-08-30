#!/bin/sh
# Create or rotate protected local deployment credentials.
set -eu

fail() {
  echo "ERROR: $1"
  exit 1
}

rotate=0
rotate_opencode=0
rotate_email=0
while [ "${1:-}" != "" ]; do
  case "$1" in
    --rotate) rotate=1 ;;
    --rotate-opencode-password) rotate_opencode=1 ;;
    --rotate-email-encryption-key) rotate_email=1 ;;
    --*) fail "unsupported option" ;;
    *) break ;;
  esac
  shift
done
repo_root="${1:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
env_file="${repo_root}/.env"
config_home="${XDG_CONFIG_HOME:-${HOME:?HOME is required}/.config}"
token_file="${INGENIUM_API_TOKEN_FILE:-${config_home}/ingenium/live-production/installation-api.token}"
token_dir="$(dirname "$token_file")"
opencode_password_file="${OPENCODE_SERVER_PASSWORD_FILE:-${config_home}/ingenium/live-production/opencode/opencode-server.password}"
email_key_file="${INGENIUM_EMAIL_ENCRYPTION_KEY_FILE:-${config_home}/ingenium/live-production/email/email-encryption.key}"

random_secret() {
  if [ ! -r /dev/urandom ] || ! command -v od >/dev/null 2>&1; then
    fail "a secure /dev/urandom source and od are required to generate local credentials"
  fi
  # 32 random bytes encoded as hex: shell-safe and base64url-compatible.
  LC_ALL=C od -An -N 32 -tx1 /dev/urandom | tr -d ' \n'
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
case "$token_file" in
  /*) ;;
  *) fail "INGENIUM_API_TOKEN_FILE must be an absolute path" ;;
esac
if [ -L "$token_dir" ] || { [ -e "$token_dir" ] && [ ! -d "$token_dir" ]; }; then
  fail "installation token parent must be a real directory"
fi

create_secret_file() {
  target="$1"
  should_rotate="$2"
  parent="$(dirname "$target")"
  case "$target" in
    /*) ;;
    *) fail "deployment secret path must be absolute" ;;
  esac
  if [ -L "$parent" ] || { [ -e "$parent" ] && [ ! -d "$parent" ]; }; then
    fail "deployment secret parent must be a real directory"
  fi
  mkdir -p "$parent"
  chmod 0700 "$parent"
  if [ "$(stat -c '%u:%g:%a' "$parent")" != "$(id -u):$(id -g):700" ]; then
    fail "deployment secret parent must be owned by the current user with mode 0700"
  fi
  if [ -L "$target" ] || { [ -e "$target" ] && [ ! -f "$target" ]; }; then
    fail "deployment secret path must be a regular non-symlink file"
  fi
  if [ "$should_rotate" -eq 1 ] || [ ! -e "$target" ]; then
    secret="$(random_secret)"
    temporary="$(mktemp "${parent}/.deployment-secret.XXXXXX")"
    trap 'rm -f "$temporary"' EXIT HUP INT TERM
    printf '%s\n' "$secret" > "$temporary"
    chmod 0600 "$temporary"
    mv -f "$temporary" "$target"
    trap - EXIT HUP INT TERM
    unset secret temporary
  fi
  chmod 0600 "$target"
  if [ "$(stat -c '%u:%g:%a' "$target")" != "$(id -u):$(id -g):600" ]; then
    fail "deployment secret file must be owned by the current user with mode 0600"
  fi
}

create_secret_file "$opencode_password_file" "$rotate_opencode"
create_secret_file "$email_key_file" "$rotate_email"
mkdir -p "$token_dir"
chmod 0700 "$token_dir"
if [ "$(stat -c '%u:%g:%a' "$token_dir")" != "$(id -u):$(id -g):700" ]; then
  fail "installation token parent must be owned by the current user with mode 0700"
fi
if [ -L "$token_file" ] || { [ -e "$token_file" ] && [ ! -f "$token_file" ]; }; then
  fail "installation token path must be a regular non-symlink file"
fi

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

if [ "$rotate" -eq 1 ] || [ ! -e "$token_file" ]; then
  api_token="$(random_secret)"
  if ! valid_api_token "$api_token"; then
    fail "secure API token generation failed"
  fi
  token_tmp="$(mktemp "${token_dir}/.installation-api-token.XXXXXX")"
  trap 'rm -f "$token_tmp"' EXIT HUP INT TERM
  printf '%s\n' "$api_token" > "$token_tmp"
  chmod 0600 "$token_tmp"
  mv -f "$token_tmp" "$token_file"
  trap - EXIT HUP INT TERM
fi

chmod 0600 "$token_file"
if [ "$(stat -c '%u:%g:%a' "$token_file")" != "$(id -u):$(id -g):600" ]; then
  fail "installation token file must be owned by the current user with mode 0600"
fi
api_token="$(cat "$token_file")"
if ! valid_api_token "$api_token"; then
  fail "installation token file must contain 32 to 128 base64url characters"
fi
unset api_token

replace_env_value INGENIUM_API_TOKEN ""
replace_env_value INGENIUM_API_TOKEN_FILE "$token_file"
replace_env_value OPENCODE_SERVER_PASSWORD ""
replace_env_value OPENCODE_SERVER_PASSWORD_FILE "$opencode_password_file"
replace_env_value INGENIUM_EMAIL_ENCRYPTION_KEY ""
replace_env_value INGENIUM_EMAIL_ENCRYPTION_KEY_FILE "$email_key_file"

if [ "$rotate" -eq 1 ]; then
  printf 'Rotated protected installation API token at %s\n' "$token_file"
else
  printf 'Verified protected installation API token at %s\n' "$token_file"
fi
if [ "$rotate_opencode" -eq 1 ]; then
  printf 'Rotated protected OpenCode server password at %s\n' "$opencode_password_file"
fi
if [ "$rotate_email" -eq 1 ]; then
  printf 'Rotated protected email encryption key at %s\n' "$email_key_file"
fi
