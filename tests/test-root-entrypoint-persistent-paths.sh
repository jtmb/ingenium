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
if (boundary < 0 || !source.includes("secure_persistent_path()") || !source.includes("remove_verified_stale_socket()")) process.exit(1);
fs.writeFileSync(helperPath, `${source.slice(0, boundary)}
if [ \"\${1:-}\" = \"--remove-stale-socket\" ]; then
  shift
  remove_verified_stale_socket \"$@\"
else
  secure_persistent_path \"$@\"
fi
`, { mode: 0o700 });
NODE

helper() {
  sh "$RUN_ROOT/helper.sh" "$@"
}

symlink_gid() {
  node -e 'process.stdout.write(String(require("node:fs").lstatSync(process.argv[1]).gid))' "$1"
}

uid="$(id -u)"
gid="$(id -g)"
runtime_gid="$gid"
for candidate in $(id -G); do
  if [[ "$candidate" != "$gid" ]]; then
    runtime_gid="$candidate"
    break
  fi
done
protected="$RUN_ROOT/protected"
mkdir -p "$protected"
chgrp "$runtime_gid" "$protected"
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

mkdir -p "$RUN_ROOT/package/.config/opencode/node_modules/.bin" "$RUN_ROOT/package/.config/opencode/node_modules/tool" \
  "$RUN_ROOT/package/.config/opencode/runtime"
chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime"
chmod 2770 "$RUN_ROOT/package/.config/opencode/runtime"
mkdir -p "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin" \
  "$RUN_ROOT/package/.config/opencode/runtime/node_modules/runtime-tool"
printf '#!/bin/sh\n' > "$RUN_ROOT/package/.config/opencode/node_modules/tool/cli"
printf '#!/bin/sh\n' > "$RUN_ROOT/package/.config/opencode/runtime/node_modules/runtime-tool/cli"
ln -s ../tool/cli "$RUN_ROOT/package/.config/opencode/node_modules/.bin/tool"
ln -s ../runtime-tool/cli "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/runtime-tool"
helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660
[[ "$(readlink "$RUN_ROOT/package/.config/opencode/node_modules/.bin/tool")" == ../tool/cli ]] \
  || fail 'contained package-manager executable link changed during validation'
[[ "$(readlink "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/runtime-tool")" == ../runtime-tool/cli ]] \
  || fail 'contained runtime package-manager executable link changed during validation'
[[ "$(symlink_gid "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/runtime-tool")" == "$runtime_gid" ]] \
  || fail 'runtime package-manager executable link lost its primary group'
chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime"

identity_status=0
timeout --kill-after=1s 2s sh "$RUN_ROOT/helper.sh" tree "$RUN_ROOT/package/.config" "$((uid + 1))" "$gid" 2770 0660 \
  || identity_status=$?
case "$identity_status" in
  1) printf 'IDENTITY: deterministic exact-UID mismatch rejected\n' ;;
  124|137) fail 'deterministic exact-UID mismatch validation timed out' ;;
  *) fail "deterministic exact-UID mismatch returned unexpected status $identity_status" ;;
esac

race_gid_a="$gid"
race_gid_b=""
for candidate in $(id -G); do
  if [[ "$candidate" != "$race_gid_a" ]]; then
    race_gid_b="$candidate"
    break
  fi
done
if [[ -z "$race_gid_b" ]]; then
  printf 'SKIP: runtime pathname-exchange cross-GID race requires two usable GIDs; id -G: %s\n' "$(id -G)"
else
  race_root="$RUN_ROOT/runtime-path-race"
  race_config="$race_root/package/.config"
  race_runtime="$race_config/opencode/runtime"
  race_spare="$race_root/spare"
  for runtime_root in "$race_runtime" "$race_spare"; do
    mkdir -p "$runtime_root/node_modules/.bin" "$runtime_root/node_modules/tool"
    printf '#!/bin/sh\n' > "$runtime_root/node_modules/tool/cli"
    ln -s ../tool/cli "$runtime_root/node_modules/.bin/tool"
  done
  if ! chgrp "$race_gid_a" "$race_runtime" \
    || ! chgrp "$race_gid_b" "$race_spare" \
    || ! chgrp -h "$race_gid_b" "$race_runtime/node_modules/.bin/tool" \
    || ! chgrp -h "$race_gid_a" "$race_spare/node_modules/.bin/tool"; then
    printf 'SKIP: runtime pathname-exchange cross-GID race could not use declared GIDs %s,%s; id -G: %s\n' \
      "$race_gid_a" "$race_gid_b" "$(id -G)"
  else
    [[ "$(stat -c '%d:%u:%g' "$race_runtime")" == "$(stat -c '%d' "$race_config"):$uid:$race_gid_a" ]] \
      || fail 'first runtime race root lacks the required device/UID/GID identity'
    [[ "$(stat -c '%d:%u:%g' "$race_spare")" == "$(stat -c '%d' "$race_config"):$uid:$race_gid_b" ]] \
      || fail 'second runtime race root lacks the required device/UID/GID identity'
    [[ "$(symlink_gid "$race_runtime/node_modules/.bin/tool")" == "$race_gid_b" ]] \
      || fail 'first runtime race link is not cross-mismatched'
    [[ "$(symlink_gid "$race_spare/node_modules/.bin/tool")" == "$race_gid_a" ]] \
      || fail 'second runtime race link is not cross-mismatched'

    node - "$RUN_ROOT/helper.sh" "$race_config" "$race_runtime" "$race_spare" "$uid" "$gid" <<'NODE'
const fs = require("node:fs");
const { once } = require("node:events");
const { spawn, spawnSync } = require("node:child_process");
const [helper, config, runtime, spare, uid, gid] = process.argv.slice(2);
const swap = `${spare}.swap`;

function invokeHelper() {
  return spawnSync("timeout", ["--kill-after=1s", "2s", "sh", helper, "tree", config, uid, gid, "2770", "0660"], {
    stdio: "ignore",
  }).status;
}

async function main() {
  if (invokeHelper() !== 1) throw new Error("first stable cross-GID mismatch was not rejected");
  fs.renameSync(runtime, swap);
  fs.renameSync(spare, runtime);
  fs.renameSync(swap, spare);
  if (invokeHelper() !== 1) throw new Error("second stable cross-GID mismatch was not rejected");

  const racer = spawn("python3", ["-c", `
import ctypes
import os
import sys

runtime, spare, ready = sys.argv[1:]
renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
open(ready, "w").close()
while True:
    if renameat2(-100, os.fsencode(runtime), -100, os.fsencode(spare), 2) != 0:
        raise OSError(ctypes.get_errno(), "renameat2 exchange failed")
  `, runtime, spare, `${spare}.ready`], { stdio: "ignore" });
  try {
    for (let attempt = 0; attempt < 100 && !fs.existsSync(`${spare}.ready`); attempt += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    if (!fs.existsSync(`${spare}.ready`) || racer.exitCode !== null) throw new Error("runtime pathname racer did not start");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = invokeHelper();
      if (status !== 1) throw new Error(`runtime pathname race helper ${attempt + 1} returned ${status}`);
    }
  } finally {
    if (racer.exitCode === null && racer.signalCode === null) {
      racer.kill("SIGTERM");
      await once(racer, "exit");
    }
  }
  if (racer.exitCode === null && racer.signalCode === null) throw new Error("runtime pathname racer was not reaped");
  process.stdout.write("RACE: 42 cross-GID helper invocations rejected; pathname racer reaped\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
NODE
  fi
fi

ln -s ../../../../../protected "$RUN_ROOT/package/.config/opencode/node_modules/.bin/escape"
if helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660; then
  fail 'escaping package-manager executable link was accepted'
fi
rm "$RUN_ROOT/package/.config/opencode/node_modules/.bin/escape"
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'escaping package-manager link changed the protected target'

chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime"
chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin"
chmod 2770 "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin"
ln -s ../../../../../../protected "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/escape"
chgrp -h "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/escape"
[[ "$(symlink_gid "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/escape")" == "$runtime_gid" ]] \
  || fail 'runtime escape link metadata does not match the runtime GID fixture'
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'runtime escape link group setup changed the protected target'
if helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660; then
  fail 'escaping runtime package-manager executable link was accepted'
fi
rm "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/escape"
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'escaping runtime package-manager link changed the protected target'

chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime"
chgrp "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin"
chmod 2770 "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin"
mkfifo "$RUN_ROOT/package/.config/opencode/runtime/node_modules/runtime-tool/fifo"
ln -s ../runtime-tool/fifo "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/fifo"
chgrp -h "$runtime_gid" "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/fifo"
[[ "$(symlink_gid "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/fifo")" == "$runtime_gid" ]] \
  || fail 'runtime FIFO link metadata does not match the runtime GID fixture'
fifo_status=0
timeout 2 sh "$RUN_ROOT/helper.sh" tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660 || fifo_status=$?
case "$fifo_status" in
  1) ;;
  124) fail 'runtime package-manager FIFO validation timed out' ;;
  *) fail "runtime package-manager FIFO returned unexpected status $fifo_status" ;;
esac
rm "$RUN_ROOT/package/.config/opencode/runtime/node_modules/.bin/fifo" \
  "$RUN_ROOT/package/.config/opencode/runtime/node_modules/runtime-tool/fifo"

ln -s ../missing/cli "$RUN_ROOT/package/.config/opencode/node_modules/.bin/dangling"
if helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660; then
  fail 'dangling package-manager executable link was accepted'
fi
rm "$RUN_ROOT/package/.config/opencode/node_modules/.bin/dangling"

ln -s cycle-b "$RUN_ROOT/package/.config/opencode/node_modules/.bin/cycle-a"
ln -s cycle-a "$RUN_ROOT/package/.config/opencode/node_modules/.bin/cycle-b"
if helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660; then
  fail 'cyclic package-manager executable links were accepted'
fi
rm "$RUN_ROOT/package/.config/opencode/node_modules/.bin/cycle-a" "$RUN_ROOT/package/.config/opencode/node_modules/.bin/cycle-b"

ln -s /etc/passwd "$RUN_ROOT/package/.config/opencode/node_modules/.bin/absolute"
if helper tree "$RUN_ROOT/package/.config" "$uid" "$gid" 2770 0660; then
  fail 'absolute package-manager executable link was accepted'
fi
rm "$RUN_ROOT/package/.config/opencode/node_modules/.bin/absolute"

node - "$RUN_ROOT/helper.sh" "$RUN_ROOT/socket/code-server-ipc.sock" "$uid" "$gid" <<'NODE'
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { once } = require("node:events");
const { spawn, spawnSync } = require("node:child_process");
const [helper, socketPath, uid, gid] = process.argv.slice(2);
let activeChild;

fs.mkdirSync(path.dirname(socketPath), { recursive: true });

async function createSocket() {
  const child = spawn(process.execPath, ["-e", `
    const net = require("node:net");
    const server = net.createServer();
    server.listen(process.argv[1], () => process.send("ready"));
  `, socketPath], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  await once(child, "message");
  activeChild = child;
  return child;
}

async function leaveStaleSocket(child) {
  child.kill("SIGKILL");
  await once(child, "exit");
  activeChild = undefined;
}

async function main() {
  try {
    const live = await createSocket();
    const liveResult = spawnSync("sh", [helper, "--remove-stale-socket", socketPath, uid, gid]);
    if (liveResult.status === 0 || !fs.lstatSync(socketPath).isSocket()) throw new Error("live socket was removed");

    await leaveStaleSocket(live);
    const staleResult = spawnSync("sh", [helper, "--remove-stale-socket", socketPath, uid, gid]);
    if (staleResult.status !== 0 || fs.existsSync(socketPath)) throw new Error("stale socket was retained");

    const foreign = await createSocket();
    await leaveStaleSocket(foreign);
    const foreignResult = spawnSync("sh", [helper, "--remove-stale-socket", socketPath, String(Number(uid) + 1), gid]);
    if (foreignResult.status === 0 || !fs.lstatSync(socketPath).isSocket()) throw new Error("foreign socket was removed");
  } finally {
    if (activeChild) await leaveStaleSocket(activeChild);
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  }
}

main().catch(() => process.exit(1));
NODE

legacy_dir="$RUN_ROOT/legacy/.opencode"
legacy_token="$legacy_dir/.ingenium-api-token"
mkdir -p "$legacy_dir"
printf 'mismatched legacy residue\n' > "$legacy_token"
legacy_before="$(stat -c '%d:%i:%u:%g:%a:%s' "$legacy_token")"
helper directory "$legacy_dir" - - -
[[ "$(stat -c '%d:%i:%u:%g:%a:%s' "$legacy_token")" == "$legacy_before" ]] \
  || fail 'mismatched legacy token residue was inspected or changed'
rm "$legacy_token"
ln -s "$protected" "$legacy_token"
helper directory "$legacy_dir" - - -
[[ -L "$legacy_token" && "$(readlink "$legacy_token")" == "$protected" ]] \
  || fail 'legacy token symlink residue was inspected or changed'
[[ "$(stat -c '%d:%i:%u:%g:%a' "$protected")" == "$protected_before" ]] \
  || fail 'legacy token symlink changed its protected target'

if grep -Fq '.ingenium-api-token' "$ROOT/scripts/docker-entrypoint.sh"; then
  fail 'root entrypoint still names legacy workspace token residue'
fi
grep -Fq '${INGENIUM_API_TOKEN_FILE:?INGENIUM_API_TOKEN_FILE is required}' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail 'root entrypoint no longer requires the canonical protected token source'
grep -Fq '${INGENIUM_LEARNING_CREDENTIAL_FILE:?INGENIUM_LEARNING_CREDENTIAL_FILE is required}' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail 'root entrypoint no longer requires the protected learning credential source'
grep -Fq 'export INGENIUM_API_TOKEN_FILE="$RUNTIME_API_TOKEN_FILE"' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail 'root entrypoint no longer exports the service-owned canonical token copy'
grep -Fq 'export INGENIUM_LEARNING_CREDENTIAL_FILE="$RUNTIME_LEARNING_CREDENTIAL_FILE"' "$ROOT/scripts/docker-entrypoint.sh" \
  || fail 'root entrypoint no longer exports the OpenCode-owned learning credential copy'

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

printf 'PASS: startup helpers preserve canonical-token isolation, accept only contained package links, and remove only verified stale sockets\n'
