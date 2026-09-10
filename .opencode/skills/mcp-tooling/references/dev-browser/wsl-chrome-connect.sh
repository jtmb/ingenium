#!/usr/bin/env bash
set -euo pipefail

# wsl-chrome-connect.sh — Drive Windows Chrome from WSL via dev-browser on Windows
#
# Usage:
#   ./wsl-chrome-connect.sh [--json] 'const page = await browser.getPage("x"); ...'
#   ./wsl-chrome-connect.sh [--json] < /path/to/script.js
#   echo '...' | ./wsl-chrome-connect.sh [--json]
#   ./wsl-chrome-connect.sh [--json] <<'EOF' ... EOF
#
# --json requires stdout to contain exactly one JSON value. Without it, any nonempty stdout is valid.
#
# Exit codes:
#   0 — Nonempty output satisfied the selected mode, or usage completed
#   1 — Chrome binary is missing or failed to start
#   2 — The configured timeout is invalid
#   3 — Output is missing, or --json output is not exactly one JSON value
#   124 — The owned cmd.exe/dev-browser command exceeded the wall timeout
#   other — Preserved cmd.exe/dev-browser failure status

WIN_USER="${WIN_USER:-james}"
SCRIPT_TEMP_DIR="${WSL_CHROME_TEMP_DIR:-/mnt/c/Users/${WIN_USER}/AppData/Local/Temp}"
SCRIPT_FILE="wsl-chrome-stdin-$$.js"
SCRIPT_STDIN_CAPTURE="${SCRIPT_TEMP_DIR}/${SCRIPT_FILE}"
JSON_MODE=0

if [ "${1:-}" = "--json" ]; then
  JSON_MODE=1
  shift
fi

# Capture piped input before invoking Windows commands, which can consume the caller's stdin.
if [ $# -ge 1 ]; then
  SCRIPT_CONTENT="$1"
  PIPE_MODE="echo"
elif [ ! -t 0 ]; then
  cat > "$SCRIPT_STDIN_CAPTURE"
  PIPE_MODE="stdin"
else
  PIPE_MODE="none"
fi

if ! DETECTED_USER="$(powershell.exe -Command '[Environment]::UserName' 2>/dev/null < /dev/null | tr -d '\r\n')"; then
  DETECTED_USER=""
fi
WIN_USER="${DETECTED_USER:-james}"

SCRIPT_TEMP_DIR="${WSL_CHROME_TEMP_DIR:-/mnt/c/Users/${WIN_USER}/AppData/Local/Temp}"
SCRIPT_STDIN_CAPTURE="${SCRIPT_TEMP_DIR}/${SCRIPT_FILE}"

CHROME_PATH="${CHROME_PATH:-/mnt/c/Program Files/Google/Chrome/Application/chrome.exe}"
CHROME_PORT=9222
SCRIPT_TIMEOUT_SECONDS="${SCRIPT_TIMEOUT_SECONDS:-30}"
DEV_BROWSER_NPM_PACKAGE="dev-browser"

DEV_BROWSER_CMD="C:\\Users\\${WIN_USER}\\AppData\\Roaming\\npm\\dev-browser.cmd"
CHROME_DATA_DIR="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\chrome-debug"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}🔷${NC} $*" >&2; }
ok()    { echo -e "${GREEN}✅${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}⚠️${NC} $*" >&2; }
err()   { echo -e "${RED}❌${NC} $*" >&2; }

if ! [[ "$SCRIPT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  err "SCRIPT_TIMEOUT_SECONDS must be a positive integer."
  exit 2
fi

if [ ! -f "$CHROME_PATH" ]; then
  err "Chrome not found at: $CHROME_PATH"
  err "Adjust CHROME_PATH in the script or install Chrome on Windows."
  exit 1
fi

check_chrome() {
  powershell.exe -Command "
    try {
      \$r = Invoke-WebRequest -Uri 'http://127.0.0.1:${CHROME_PORT}/json/version' -UseBasicParsing -TimeoutSec 3
      Write-Output \$r.Content
    } catch {
      Write-Output 'NOT_RUNNING'
    }
  " 2>/dev/null < /dev/null | tr -d '\r\n'
}

CHROME_STATUS=$(check_chrome)

if [ "$CHROME_STATUS" = "NOT_RUNNING" ]; then
  info "Chrome not running on port ${CHROME_PORT}. Launching an isolated session..."
  "$CHROME_PATH" \
    --remote-debugging-port=${CHROME_PORT} \
    --remote-allow-origins=* \
    --user-data-dir="${CHROME_DATA_DIR}" \
    --incognito \
    --disable-save-password-bubble \
    --no-first-run \
    --new-window about:blank > /dev/null 2>&1 &

  info "Waiting for Chrome to start..."
  for i in $(seq 1 15); do
    sleep 2
    STATUS=$(check_chrome)
    if [ "$STATUS" != "NOT_RUNNING" ] && [ -n "$STATUS" ]; then
      ok "Chrome ready after $((i * 2)) seconds"
      CHROME_STATUS="$STATUS"
      break
    fi
  done

  if [ "$CHROME_STATUS" = "NOT_RUNNING" ] || [ -z "$CHROME_STATUS" ]; then
    err "Chrome did not start within 30 seconds. Check Windows Task Manager."
    exit 1
  fi
else
  ok "Chrome already running on port ${CHROME_PORT}"
fi

if ! powershell.exe -Command "Get-Command dev-browser.cmd -ErrorAction SilentlyContinue" 2>/dev/null < /dev/null | grep -q dev-browser; then
  info "dev-browser not found on Windows. Installing..."
  powershell.exe -Command "npm install -g ${DEV_BROWSER_NPM_PACKAGE}" 2>&1 < /dev/null | tail -1
  ok "dev-browser installed"

  info "Installing Playwright Chromium (one-time download)..."
  powershell.exe -Command "dev-browser install" 2>&1 < /dev/null | tail -1
  ok "Playwright Chromium installed"
else
  ok "dev-browser already installed on Windows"
fi

if [ "${PIPE_MODE}" = "none" ] && [ $# -eq 0 ]; then
  echo ""
  echo "  Usage: $0 [--json] '<script>'           # inline script"
  echo "         $0 [--json] < script.js           # pipe from file"
  echo "         echo '...' | $0 [--json]          # pipe from stdin"
  echo "         $0 [--json] <<'EOF' ... EOF       # heredoc"
  echo ""
  exit 0
fi

info "Executing script via dev-browser on Windows..."
info "Timeout: ${SCRIPT_TIMEOUT_SECONDS}s"

if [ "${PIPE_MODE}" = "echo" ]; then
  WIN_SCRIPT="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\wsl-chrome-run-$$.js"
  WSL_SCRIPT="${SCRIPT_TEMP_DIR}/wsl-chrome-run-$$.js"
  echo "$SCRIPT_CONTENT" > "$WSL_SCRIPT"
else
  WIN_SCRIPT="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\${SCRIPT_FILE}"
  WSL_SCRIPT="$SCRIPT_STDIN_CAPTURE"
fi

if OUTPUT=$(timeout --kill-after=2s -- "${SCRIPT_TIMEOUT_SECONDS}s" \
  cmd.exe /c "type ${WIN_SCRIPT} | ${DEV_BROWSER_CMD} --connect http://localhost:9222 --timeout ${SCRIPT_TIMEOUT_SECONDS}"); then
  COMMAND_STATUS=0
else
  COMMAND_STATUS=$?
fi

rm -f "$SCRIPT_STDIN_CAPTURE" "$WSL_SCRIPT" || true

OUTPUT_IS_JSON=0
if [ "$JSON_MODE" -eq 1 ] && [ -n "$OUTPUT" ] && printf '%s' "$OUTPUT" | python3 -c '
import json
import sys

def reject_nonstandard_constant(value):
    raise ValueError(value)

try:
    json.load(sys.stdin, parse_constant=reject_nonstandard_constant)
except (ValueError, UnicodeError):
    raise SystemExit(1)
'; then
  OUTPUT_IS_JSON=1
fi

if [ "$COMMAND_STATUS" -ne 0 ]; then
  if [ -n "$OUTPUT" ]; then
    if [ "$JSON_MODE" -eq 0 ] || [ "$OUTPUT_IS_JSON" -eq 1 ]; then
      printf '%s\n' "$OUTPUT"
    else
      err "dev-browser returned ${#OUTPUT} characters of non-JSON stdout; content withheld."
    fi
  fi
  if [ "$COMMAND_STATUS" -eq 124 ]; then
    err "dev-browser exceeded the ${SCRIPT_TIMEOUT_SECONDS}s wall timeout; cleanup of the owned cmd.exe process tree is unconfirmed. Chrome was not signaled."
  else
    err "dev-browser exited with status ${COMMAND_STATUS}."
  fi
  exit "$COMMAND_STATUS"
fi

if [ -z "$OUTPUT" ]; then
  err "No output from dev-browser."
  exit 3
fi

if [ "$JSON_MODE" -eq 1 ] && [ "$OUTPUT_IS_JSON" -eq 0 ]; then
  err "dev-browser returned ${#OUTPUT} characters of invalid JSON; content withheld."
  exit 3
fi

printf '%s\n' "$OUTPUT"
ok "Script completed successfully"
