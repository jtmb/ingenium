#!/usr/bin/env bash
# Deterministic regression test for bootstrap token-file parent-path safety.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
BOOTSTRAP="$REPO_ROOT/scripts/bootstrap-local-secrets.sh"
TEST_ROOT="$(mktemp -d)"
OUTSIDE_DIR="$(mktemp -d)"

cleanup() {
  rm -f "$TEST_ROOT/.env" "$TEST_ROOT/.opencode"
  rmdir "$TEST_ROOT" "$OUTSIDE_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  exit 1
}

ln -s "$OUTSIDE_DIR" "$TEST_ROOT/.opencode"

if sh "$BOOTSTRAP" "$TEST_ROOT"; then
  fail "bootstrap accepted a symlinked .opencode parent"
fi

if [ -e "$OUTSIDE_DIR/.ingenium-api-token" ]; then
  fail "bootstrap wrote a token through the symlinked .opencode parent"
fi

printf 'PASS: bootstrap rejects symlinked .opencode token parent\n'
