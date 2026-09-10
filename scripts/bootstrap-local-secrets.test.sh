#!/usr/bin/env bash
# Deterministic regression test that bootstrap does not project the installation
# bearer into the OpenCode worktree.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BOOTSTRAP="$REPO_ROOT/scripts/bootstrap-local-secrets.sh"
TEST_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TEST_ROOT/config" "$TEST_ROOT/.env"
  rmdir "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

XDG_CONFIG_HOME="$TEST_ROOT/config" sh "$BOOTSTRAP" "$TEST_ROOT"

if [ -e "$TEST_ROOT/.opencode" ]; then
  fail "bootstrap projected the installation bearer into .opencode"
fi

TOKEN_FILE="$TEST_ROOT/config/ingenium/live-production/installation-api.token"
OPENCODE_FILE="$TEST_ROOT/config/ingenium/live-production/opencode/opencode-server.password"
EMAIL_FILE="$TEST_ROOT/config/ingenium/live-production/email/email-encryption.key"
if ! grep -q '^INGENIUM_API_TOKEN=$' "$TEST_ROOT/.env" \
  || ! grep -F -x -q "INGENIUM_API_TOKEN_FILE=$TOKEN_FILE" "$TEST_ROOT/.env"; then
  fail "bootstrap did not configure the protected installation token file"
fi
if ! grep -q '^OPENCODE_SERVER_PASSWORD=$' "$TEST_ROOT/.env" \
  || ! grep -F -x -q "OPENCODE_SERVER_PASSWORD_FILE=$OPENCODE_FILE" "$TEST_ROOT/.env" \
  || ! grep -q '^INGENIUM_EMAIL_ENCRYPTION_KEY=$' "$TEST_ROOT/.env" \
  || ! grep -F -x -q "INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=$EMAIL_FILE" "$TEST_ROOT/.env"; then
  fail "bootstrap did not configure protected deployment secret files"
fi
for secret in "$OPENCODE_FILE" "$EMAIL_FILE"; do
  [ "$(stat -c '%a' "$secret")" = "600" ] || fail "deployment secret mode is unsafe"
  [ "$(stat -c '%a' "$(dirname "$secret")")" = "700" ] || fail "deployment secret parent mode is unsafe"
done
if [ "$(stat -c '%a' "$TOKEN_FILE")" != "600" ] \
  || [ "$(stat -c '%a' "$(dirname "$TOKEN_FILE")")" != "700" ]; then
  fail "bootstrap did not enforce owner-only token permissions"
fi
before="$(sha256sum "$TOKEN_FILE")"
XDG_CONFIG_HOME="$TEST_ROOT/config" sh "$BOOTSTRAP" "$TEST_ROOT"
[ "$before" = "$(sha256sum "$TOKEN_FILE")" ] || fail "bootstrap rotated without --rotate"
XDG_CONFIG_HOME="$TEST_ROOT/config" sh "$BOOTSTRAP" --rotate "$TEST_ROOT"
[ "$before" != "$(sha256sum "$TOKEN_FILE")" ] || fail "bootstrap --rotate reused the prior token"
opencode_before="$(sha256sum "$OPENCODE_FILE")"
email_before="$(sha256sum "$EMAIL_FILE")"
XDG_CONFIG_HOME="$TEST_ROOT/config" sh "$BOOTSTRAP" --rotate-opencode-password --rotate-email-encryption-key "$TEST_ROOT"
[ "$opencode_before" != "$(sha256sum "$OPENCODE_FILE")" ] || fail "OpenCode password rotation reused the prior value"
[ "$email_before" != "$(sha256sum "$EMAIL_FILE")" ] || fail "email key rotation reused the prior value"

printf 'PASS: bootstrap keeps a rotatable installation bearer in an owner-only host file\n'
