#!/bin/sh
set -eu

key_file="${1:?auth encryption key path is required}"
owner="${2:?auth encryption key owner is required}"
group="${3:?auth encryption key group is required}"
parent="$(dirname "$key_file")"

fail() {
  echo "ERROR: auth encryption key provisioning failed"
  exit 1
}

if [ -L "$parent" ] || [ ! -d "$parent" ]; then
  fail
fi
if [ -L "$key_file" ] || { [ -e "$key_file" ] && [ ! -f "$key_file" ]; }; then
  fail
fi

if [ ! -e "$key_file" ]; then
  temporary="$(mktemp "${parent}/.auth-encryption-key.XXXXXX")"
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  umask 077
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")' > "$temporary"
  chown "${owner}:${group}" "$temporary"
  chmod 0600 "$temporary"
  if ! ln "$temporary" "$key_file"; then
    rm -f "$temporary"
    trap - EXIT HUP INT TERM
    if [ -L "$key_file" ] || [ ! -f "$key_file" ]; then
      fail
    fi
  else
    rm -f "$temporary"
    trap - EXIT HUP INT TERM
  fi
fi

if [ "$(stat -c '%a:%U:%G' "$key_file")" != "600:${owner}:${group}" ]; then
  fail
fi
node -e '
  const fs = require("node:fs");
  const descriptor = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const value = fs.readFileSync(descriptor, "utf8");
    if (!/^[A-Za-z0-9_-]{43}\n$/.test(value) || Buffer.from(value.trim(), "base64url").length !== 32) process.exit(1);
  } finally {
    fs.closeSync(descriptor);
  }
' "$key_file" || fail
