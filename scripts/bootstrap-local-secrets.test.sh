#!/usr/bin/env bash
# Deterministic regression test that bootstrap does not project the installation
# bearer into the OpenCode worktree.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BOOTSTRAP="$REPO_ROOT/scripts/bootstrap-local-secrets.sh"
TEST_ROOT="$(mktemp -d)"

cleanup() {
  rm -f "$TEST_ROOT/.env"
  rmdir "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

sh "$BOOTSTRAP" "$TEST_ROOT"

if [ -e "$TEST_ROOT/.opencode" ]; then
  fail "bootstrap projected the installation bearer into .opencode"
fi

if ! grep -q '^INGENIUM_API_TOKEN=[A-Za-z0-9_-]\{32,128\}$' "$TEST_ROOT/.env"; then
  fail "bootstrap did not create a valid installation token"
fi

printf 'PASS: bootstrap keeps the installation bearer out of OpenCode\n'
