#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-persistent-paths.XXXXXX")"

cleanup() {
  rm -rf -- "$RUN_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

node - "$ROOT/scripts/docker-entrypoint.sh" "$RUN_ROOT/helper.sh" <<'NODE'
const fs = require("node:fs");
const [sourcePath, helperPath] = process.argv.slice(2);
const source = fs.readFileSync(sourcePath, "utf8");
const boundary = source.indexOf("\nDEPLOYMENT_MODE=");
if (boundary < 0 || !source.includes("secure_persistent_path()")) process.exit(1);
fs.writeFileSync(helperPath, `${source.slice(0, boundary)}\nsecure_persistent_path \"$@\"\n`, { mode: 0o700 });
NODE

helper() {
  sh "$RUN_ROOT/helper.sh" "$@"
}

uid="$(id -u)"
gid="$(id -g)"
protected="$RUN_ROOT/protected"
mkdir -p "$protected"
chmod 0751 "$protected"
protected_before="$(stat -c '%d:%i:%u:%g:%a' "$protected")"

mkdir -p "$RUN_ROOT/config"
ln -s "$protected" "$RUN_ROOT/config/opencode"
if helper tree "$RUN_ROOT/config" "$uid" "$gid" 0700 0600; then
  fail 'config directory symlink was accepted'
fi
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'config directory symlink changed the protected target'

mkdir -p "$RUN_ROOT/ancestor"
ln -s "$protected" "$RUN_ROOT/ancestor/redirect"
if helper directory "$RUN_ROOT/ancestor/redirect/child" "$uid" "$gid" 0700; then
  fail 'ancestor symlink was accepted'
fi
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'ancestor symlink changed the protected target'

printf 'not a directory\n' > "$RUN_ROOT/not-directory"
if helper directory "$RUN_ROOT/not-directory" "$uid" "$gid" 0700; then
  fail 'non-directory persistent path was accepted'
fi
if helper directory "$RUN_ROOT/ancestor/../protected" "$uid" "$gid" 0700; then
  fail 'non-canonical path escape was accepted'
fi

mkdir -p "$RUN_ROOT/race/managed" "$RUN_ROOT/race/spare"
for index in $(seq 1 200); do
  printf 'fixture\n' > "$RUN_ROOT/race/managed/$index"
  printf 'fixture\n' > "$RUN_ROOT/race/spare/$index"
done
node - "$RUN_ROOT/helper.sh" "$RUN_ROOT/race" "$uid" "$gid" <<'NODE'
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const [helper, root, uid, gid] = process.argv.slice(2);
const racer = spawn(process.execPath, ["-e", `
  const fs = require("node:fs");
  const path = require("node:path");
  const root = process.argv[1];
  const active = path.join(root, "managed");
  const spare = path.join(root, "spare");
  const swap = path.join(root, "swap");
  fs.writeFileSync(path.join(root, "ready"), "ready");
  for (;;) {
    try {
      fs.renameSync(active, swap);
      fs.renameSync(spare, active);
      fs.renameSync(swap, spare);
    } catch {}
  }
`, root], { stdio: "ignore" });
try {
  for (let attempt = 0; attempt < 100 && !fs.existsSync(`${root}/ready`); attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  let rejected = false;
  for (let attempt = 0; attempt < 20 && !rejected; attempt += 1) {
    rejected = spawnSync("sh", [helper, "tree", `${root}/managed`, uid, gid, "0700", "0600"], {
      stdio: "ignore",
    }).status !== 0;
  }
  if (!rejected) process.exitCode = 1;
} finally {
  racer.kill("SIGTERM");
}
NODE

mkdir -p "$RUN_ROOT/valid"
helper directory "$RUN_ROOT/valid/config" "$uid" "$gid" 2770
helper directory "$RUN_ROOT/valid/config/opencode" "$uid" "$gid" 2770
printf 'configuration\n' > "$RUN_ROOT/valid/config/opencode/opencode.jsonc"
helper tree "$RUN_ROOT/valid/config" "$uid" "$gid" 2770 0660
helper directory "$RUN_ROOT/valid/config/opencode/runtime" "$uid" "$gid" 0700
first_state="$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config")|$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config/opencode/opencode.jsonc")|$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config/opencode/runtime")"
helper tree "$RUN_ROOT/valid/config" "$uid" "$gid" 2770 0660
helper directory "$RUN_ROOT/valid/config/opencode/runtime" "$uid" "$gid" 0700
restart_state="$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config")|$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config/opencode/opencode.jsonc")|$(stat -c '%u:%g:%a' "$RUN_ROOT/valid/config/opencode/runtime")"
[[ "$first_state" == "$uid:$gid:2770|$uid:$gid:660|$uid:$gid:700" ]] \
  || fail "unexpected first-start ownership/modes: $first_state"
[[ "$restart_state" == "$first_state" ]] || fail 'restart changed persistent ownership/modes'

[[ "$(grep -Fc 'node /app/scripts/validate-root-entrypoint-chain.mjs' "$ROOT/scripts/docker-entrypoint.sh")" -eq 2 ]] \
  || fail 'immutable root chain is not revalidated after persistent setup'

printf 'PASS: persistent path provisioning rejects links, non-directories, escapes, and races while preserving restart metadata\n'
