#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
wrapper="$repo_root/.opencode/skills/mcp-tooling/references/dev-browser/wsl-chrome-connect.sh"
root="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-wsl-chrome-connect.XXXXXX")"
stub_bin="$root/bin"
chrome_path="$root/chrome.exe"
powershell_log="$root/powershell.log"
chrome_log="$root/chrome.log"
startup_checked="$root/startup.checked"
mkdir -p "$stub_bin"
: > "$powershell_log"

cat > "$chrome_path" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CHROME_LOG"
STUB

cleanup() {
  if [[ -n "$root" && -d "$root" ]]; then
    rm -rf -- "$root"
  fi
}
trap cleanup EXIT

cat > "$stub_bin/powershell.exe" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$POWERSHELL_LOG"
case "$*" in
  *"[Environment]::UserName"*) printf 'fixture-user\r\n' ;;
  *"Invoke-WebRequest"*)
    if [[ "$STUB_CASE" == "startup" && ! -e "$STARTUP_CHECKED" ]]; then
      : > "$STARTUP_CHECKED"
      printf 'NOT_RUNNING\r\n'
    else
      printf '{"Browser":"fixture"}\r\n'
    fi
    ;;
  *"Get-Command dev-browser.cmd"*) printf 'dev-browser.cmd\r\n' ;;
esac
STUB

cat > "$stub_bin/cmd.exe" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "${STUB_CASE:?}" in
  nonzero)
    printf '{"partial":true}\n'
    printf 'fixture child failure\n' >&2
    exit 42
    ;;
  plaintext)
    printf 'starting\nOK\n'
    ;;
  json_error)
    printf '{"message":"Error: expected evidence text"}\n'
    ;;
  valid)
    printf '[{"ok":true},null,7,"result"]\n'
    printf 'fixture child notice\n' >&2
    ;;
  startup)
    printf '{"launched":true}\n'
    ;;
  empty)
    ;;
  timeout)
    printf 'fixture child started\n' >&2
    sleep 5
    ;;
esac
STUB

chmod +x "$chrome_path" "$stub_bin/powershell.exe" "$stub_bin/cmd.exe"

run_case() {
  local case_name="$1"
  local mode="${2:-default}"
  local wrapper_args=()
  if [[ "$mode" == "json" ]]; then
    wrapper_args+=(--json)
  fi
  wrapper_args+=('console.log(JSON.stringify({fixture:true}))')
  stdout_file="$root/${case_name}-${mode}.stdout"
  stderr_file="$root/${case_name}-${mode}.stderr"
  set +e
  PATH="$stub_bin:$PATH" \
    CHROME_PATH="$chrome_path" \
    WSL_CHROME_TEMP_DIR="$root" \
    SCRIPT_TIMEOUT_SECONDS=1 \
    CHROME_LOG="$chrome_log" \
    POWERSHELL_LOG="$powershell_log" \
    STARTUP_CHECKED="$startup_checked" \
    STUB_CASE="$case_name" \
    bash "$wrapper" "${wrapper_args[@]}" \
    > "$stdout_file" 2> "$stderr_file"
  status=$?
  set -e
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_status() {
  [[ "$status" -eq "$1" ]] || fail "$2 (expected $1, got $status)"
}

assert_contains() {
  grep -Fq -- "$1" "$2" || fail "$3"
}

run_case plaintext
assert_status 0 'default mode rejected nonempty plaintext'
[[ "$(<"$stdout_file")" == $'starting\nOK' ]] || fail 'default plaintext output changed'

run_case plaintext json
assert_status 3 '--json mode accepted stdout chatter and plaintext'
[[ ! -s "$stdout_file" ]] || fail '--json mode leaked invalid stdout'
assert_contains 'characters of invalid JSON; content withheld' "$stderr_file" '--json diagnostic was missing'
if grep -Fq -- 'starting' "$stderr_file"; then
  fail '--json diagnostic leaked invalid output content'
fi

run_case json_error json
assert_status 0 '--json mode misclassified a JSON Error: string'
[[ "$(<"$stdout_file")" == '{"message":"Error: expected evidence text"}' ]] || fail 'JSON Error: result changed'

run_case valid json
assert_status 0 'valid nested JSON failed'
[[ "$(<"$stdout_file")" == '[{"ok":true},null,7,"result"]' ]] || fail 'valid JSON result structure changed'
assert_contains 'fixture child notice' "$stderr_file" 'valid-run child stderr was suppressed'

run_case startup json
assert_status 0 'isolated Chrome startup failed'
[[ "$(<"$stdout_file")" == '{"launched":true}' ]] || fail 'startup JSON result changed'
assert_contains '--user-data-dir=' "$chrome_log" 'startup did not use an isolated Chrome profile'
if grep -Fq -- 'Stop-Process' "$powershell_log"; then
  fail 'startup path signaled Chrome'
fi

for mode in default json; do
  run_case nonzero "$mode"
  assert_status 42 "$mode mode did not preserve child failure status"
  [[ "$(<"$stdout_file")" == '{"partial":true}' ]] || fail "$mode mode did not preserve valid child stdout on failure"
  assert_contains 'fixture child failure' "$stderr_file" "$mode mode suppressed child stderr"

  run_case empty "$mode"
  assert_status 3 "$mode mode accepted empty output"
  assert_contains 'No output from dev-browser' "$stderr_file" "$mode mode did not report empty output"

  SECONDS=0
  run_case timeout "$mode"
  elapsed=$SECONDS
  assert_status 124 "$mode mode did not report wall timeout status"
  [[ "$elapsed" -lt 4 ]] || fail "$mode mode wall timeout took ${elapsed}s"
  assert_contains 'cleanup of the owned cmd.exe process tree is unconfirmed' "$stderr_file" "$mode mode did not retain unknown timeout cleanup outcome"
  assert_contains 'Chrome was not signaled' "$stderr_file" "$mode mode did not preserve the Chrome boundary"
done

if grep -Fq -- 'Stop-Process' "$powershell_log"; then
  fail 'timeout path signaled Chrome'
fi

if grep -Eqi -- 'Stop-Process|taskkill[^[:cntrl:]]*/IM[[:space:]]+chrome|(^|[^[:alnum:]_])(pkill|killall)[[:space:]][^[:cntrl:]]*chrome' "$wrapper"; then
  fail 'wrapper contains an all-Chrome signaling pattern'
fi

printf 'PASS: wsl-chrome-connect preserves plaintext by default and validates explicit JSON evidence\n'
