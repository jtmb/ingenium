#!/usr/bin/env bash
# Verify the bounded global OpenCode agent projection used at container startup.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
NORMALIZER="$REPO_ROOT/scripts/normalize-agent-profiles.sh"
TEMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_mode() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(stat -c '%a' "$path")"
  [[ "$actual" == "$expected" ]] || fail "expected $path mode $expected, got $actual"
}

SOURCE_AGENTS_DIR="$TEMP_ROOT/source-agents"
GLOBAL_AGENTS_DIR="$TEMP_ROOT/global-config/opencode/agents"
WORKSPACE_AGENTS_DIR="$TEMP_ROOT/workspace/.opencode/agents"
mkdir -p "$SOURCE_AGENTS_DIR/chat" "$SOURCE_AGENTS_DIR/execution" "$SOURCE_AGENTS_DIR/research" \
  "$GLOBAL_AGENTS_DIR" "$WORKSPACE_AGENTS_DIR"

cp "$REPO_ROOT/.opencode/agents/chat/ingenium-chat.md" "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
cp "$REPO_ROOT/.opencode/agents/execution/ingenium-llm-broker.md" \
  "$SOURCE_AGENTS_DIR/execution/ingenium-llm-broker.md"
printf '%s\n' 'unowned source profile' > "$SOURCE_AGENTS_DIR/research/unowned.md"
printf '%s\n' 'operator-managed global profile' > "$GLOBAL_AGENTS_DIR/operator-profile.md"
chmod 0600 "$GLOBAL_AGENTS_DIR/operator-profile.md"
printf '%s\n' 'workspace compatibility profile' > "$WORKSPACE_AGENTS_DIR/workspace-profile.md"
chmod 0600 "$WORKSPACE_AGENTS_DIR/workspace-profile.md"

sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"

cmp -s "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md" "$GLOBAL_AGENTS_DIR/ingenium-chat.md" \
  || fail 'global chat profile differs from the server-owned source'
cmp -s "$SOURCE_AGENTS_DIR/execution/ingenium-llm-broker.md" "$GLOBAL_AGENTS_DIR/ingenium-llm-broker.md" \
  || fail 'global broker profile differs from the server-owned source'
[[ ! -e "$GLOBAL_AGENTS_DIR/unowned.md" ]] || fail 'unowned source profile was projected globally'
[[ "$(<"$GLOBAL_AGENTS_DIR/operator-profile.md")" == 'operator-managed global profile' ]] \
  || fail 'operator-managed global profile content was modified'
require_mode "$GLOBAL_AGENTS_DIR/operator-profile.md" 600
require_mode "$GLOBAL_AGENTS_DIR/ingenium-chat.md" 644
require_mode "$GLOBAL_AGENTS_DIR/ingenium-llm-broker.md" 644

grep -q '^  edit: deny$' "$GLOBAL_AGENTS_DIR/ingenium-chat.md" \
  || fail 'global chat profile lost its edit denial'
grep -q '^  write: deny$' "$GLOBAL_AGENTS_DIR/ingenium-chat.md" \
  || fail 'global chat profile lost its write denial'
grep -q '^  bash: deny$' "$GLOBAL_AGENTS_DIR/ingenium-chat.md" \
  || fail 'global chat profile lost its shell denial'
grep -q '^  "\*": deny$' "$GLOBAL_AGENTS_DIR/ingenium-llm-broker.md" \
  || fail 'global broker profile lost its wildcard denial'

chat_metadata_before="$(stat -c '%i:%Y:%a' "$GLOBAL_AGENTS_DIR/ingenium-chat.md")"
broker_metadata_before="$(stat -c '%i:%Y:%a' "$GLOBAL_AGENTS_DIR/ingenium-llm-broker.md")"
sleep 1
sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"
[[ "$chat_metadata_before" == "$(stat -c '%i:%Y:%a' "$GLOBAL_AGENTS_DIR/ingenium-chat.md")" ]] \
  || fail 'idempotent projection rewrote the unchanged chat profile'
[[ "$broker_metadata_before" == "$(stat -c '%i:%Y:%a' "$GLOBAL_AGENTS_DIR/ingenium-llm-broker.md")" ]] \
  || fail 'idempotent projection rewrote the unchanged broker profile'

sh "$NORMALIZER" "$WORKSPACE_AGENTS_DIR"
[[ "$(<"$WORKSPACE_AGENTS_DIR/workspace-profile.md")" == 'workspace compatibility profile' ]] \
  || fail 'workspace profile content changed during normalization'
require_mode "$WORKSPACE_AGENTS_DIR/workspace-profile.md" 644

printf 'PASS: bounded global OpenCode agent projection and workspace compatibility\n'
