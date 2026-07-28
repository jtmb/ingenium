#!/usr/bin/env bash
# Verify the bounded global OpenCode agent projection used at container startup.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
NORMALIZER="$REPO_ROOT/scripts/normalize-agent-profiles.sh"
PROJECTOR="$REPO_ROOT/scripts/project-agent-profiles.mjs"
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
OUTSIDE_PROFILE="$TEMP_ROOT/outside-profile.md"
mkdir -p "$SOURCE_AGENTS_DIR/chat" "$SOURCE_AGENTS_DIR/execution" "$SOURCE_AGENTS_DIR/research" \
  "$GLOBAL_AGENTS_DIR" "$WORKSPACE_AGENTS_DIR"

[[ -f "$PROJECTOR" ]] || fail "descriptor-safe projector is missing"

cp "$REPO_ROOT/.opencode/agents/chat/ingenium-chat.md" "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
cp "$REPO_ROOT/.opencode/agents/execution/ingenium-llm-broker.md" \
  "$SOURCE_AGENTS_DIR/execution/ingenium-llm-broker.md"
printf '%s\n' 'unowned source profile' > "$SOURCE_AGENTS_DIR/research/unowned.md"
printf '%s\n' 'operator-managed global profile' > "$GLOBAL_AGENTS_DIR/operator-profile.md"
chmod 0600 "$GLOBAL_AGENTS_DIR/operator-profile.md"
printf '%s\n' 'workspace compatibility profile' > "$WORKSPACE_AGENTS_DIR/workspace-profile.md"
chmod 0600 "$WORKSPACE_AGENTS_DIR/workspace-profile.md"
printf '%s\n' 'outside profile must remain unchanged' > "$OUTSIDE_PROFILE"
chmod 0600 "$OUTSIDE_PROFILE"

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

# A target symlink must fail closed instead of following it to an unrelated
# file. Restore the allowlisted target through the projector afterwards.
rm "$GLOBAL_AGENTS_DIR/ingenium-chat.md"
ln -s "$OUTSIDE_PROFILE" "$GLOBAL_AGENTS_DIR/ingenium-chat.md"
if sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"; then
  fail 'projection accepted a symlinked allowlisted target'
fi
[[ "$(<"$OUTSIDE_PROFILE")" == 'outside profile must remain unchanged' ]] \
  || fail 'projection followed the target symlink'
rm "$GLOBAL_AGENTS_DIR/ingenium-chat.md"
sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"

# Source and target-directory symlinks are rejected before any profile can be
# read or written. The operator-managed profile remains outside the allowlist.
rm "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
ln -s "$OUTSIDE_PROFILE" "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
if sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"; then
  fail 'projection accepted a symlinked source profile'
fi
rm "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
cp "$REPO_ROOT/.opencode/agents/chat/ingenium-chat.md" "$SOURCE_AGENTS_DIR/chat/ingenium-chat.md"
ln -s "$GLOBAL_AGENTS_DIR" "$TEMP_ROOT/global-agents-link"
if sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$TEMP_ROOT/global-agents-link"; then
  fail 'projection accepted a symlinked target directory'
fi
[[ "$(<"$GLOBAL_AGENTS_DIR/operator-profile.md")" == 'operator-managed global profile' ]] \
  || fail 'symlink rejection modified an unrelated profile'

# Race a target pathname between a regular file and a symlink while repeatedly
# projecting. The helper may fail closed on a raced lookup, but it must never
# follow the link or write outside its allowlisted target name.
node - "$NORMALIZER" "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR" "$OUTSIDE_PROFILE" <<'NODE'
const { readFileSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const [normalizer, source, targetDirectory, outside] = process.argv.slice(2);
const target = `${targetDirectory}/ingenium-chat.md`;
(async () => {
const racer = spawn(process.execPath, ["-e", `
  const { rmSync, symlinkSync, writeFileSync } = require("node:fs");
  const [target, outside] = process.argv.slice(1);
  let running = true;
  process.on("SIGTERM", () => { running = false; });
  function race() {
    if (!running) return;
    try { rmSync(target, { force: true }); symlinkSync(outside, target); } catch {}
    try { rmSync(target, { force: true }); writeFileSync(target, "racer replacement\\n", { mode: 0o644 }); } catch {}
    setImmediate(race);
  }
  race();
`, target, outside], { stdio: "ignore" });
try {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const result = spawnSync("sh", [normalizer, "--project-server-owned", source, targetDirectory]);
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`unexpected projector status ${String(result.status)}`);
    }
  }
} finally {
  racer.kill("SIGTERM");
  if (racer.exitCode === null) {
    await new Promise((resolve) => racer.once("exit", resolve));
  }
  rmSync(target, { force: true });
}
if (readFileSync(outside, "utf8") !== "outside profile must remain unchanged\n") {
  throw new Error("raced projection wrote through an untrusted symlink");
}
})().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
NODE
sh "$NORMALIZER" --project-server-owned "$SOURCE_AGENTS_DIR" "$GLOBAL_AGENTS_DIR"

sh "$NORMALIZER" "$WORKSPACE_AGENTS_DIR"
[[ "$(<"$WORKSPACE_AGENTS_DIR/workspace-profile.md")" == 'workspace compatibility profile' ]] \
  || fail 'workspace profile content changed during normalization'
require_mode "$WORKSPACE_AGENTS_DIR/workspace-profile.md" 644
ln -s "$OUTSIDE_PROFILE" "$WORKSPACE_AGENTS_DIR/symlinked-profile.md"
sh "$NORMALIZER" "$WORKSPACE_AGENTS_DIR"
require_mode "$OUTSIDE_PROFILE" 600

printf 'PASS: bounded global OpenCode agent projection and workspace compatibility\n'
