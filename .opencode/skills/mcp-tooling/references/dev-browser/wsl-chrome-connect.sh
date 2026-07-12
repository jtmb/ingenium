#!/bin/bash
# wsl-chrome-connect.sh — Drive Windows Chrome from WSL via dev-browser on Windows
#
# Usage:
#   ./wsl-chrome-connect.sh 'const page = await browser.getPage("x"); ...'   # inline script
#   ./wsl-chrome-connect.sh < /path/to/script.js                             # pipe from file
#   echo '...' | ./wsl-chrome-connect.sh                                     # pipe from stdin
#   ./wsl-chrome-connect.sh <<'EOF' ... EOF                                  # heredoc
#
# What it does:
#   1. Checks if Windows Chrome is running with --remote-debugging-port=9222
#   2. Launches Chrome on Windows if not running (with correct flags)
#   3. Installs dev-browser on Windows if not present
#   4. Pipes your script to `dev-browser --connect http://localhost:9222`
#   5. Returns the JSON output from the script
#
# Requirements:
#   - WSL2 with access to /mnt/c/ (Windows C: drive)
#   - Chrome installed on Windows at default path
#   - Node.js and npm on Windows (for dev-browser install)
#
# Exit codes:
#   0 — Script executed successfully
#   1 — Chrome binary not found
#   2 — Script timed out
#   3 — Script execution error

# No set -e: we handle errors explicitly with exit codes

# ─── Capture stdin before anything else (piped/heredoc input) ─────────────────
# This MUST be first — any command (especially powershell.exe) can consume stdin.
WIN_USER="james"  # Temporary default; updated after capture via powershell
SCRIPT_TEMP_DIR="/mnt/c/Users/${WIN_USER}/AppData/Local/Temp"
SCRIPT_FILE="wsl-chrome-stdin-$$.js"
SCRIPT_STDIN_CAPTURE="${SCRIPT_TEMP_DIR}/${SCRIPT_FILE}"

if [ $# -ge 1 ]; then
  SCRIPT_CONTENT="$1"
  PIPE_MODE="echo"
elif [ ! -t 0 ]; then
  cat > "$SCRIPT_STDIN_CAPTURE"
  PIPE_MODE="stdin"
else
  PIPE_MODE="none"
fi

# Now it's safe to use powershell.exe (stdin already captured)
DETECTED_USER="$(powershell.exe -Command '[Environment]::UserName' 2>/dev/null < /dev/null | tr -d '\r\n')"
WIN_USER="${DETECTED_USER:-james}"

# Update temp paths with actual username
SCRIPT_TEMP_DIR="/mnt/c/Users/${WIN_USER}/AppData/Local/Temp"
SCRIPT_STDIN_CAPTURE="${SCRIPT_TEMP_DIR}/${SCRIPT_FILE}"

# ─── Configuration ───────────────────────────────────────────────────────────

CHROME_PATH="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
CHROME_PORT=9222
SCRIPT_TIMEOUT_SECONDS=30
DEV_BROWSER_NPM_PACKAGE="dev-browser"

DEV_BROWSER_CMD="C:\\Users\\${WIN_USER}\\AppData\\Roaming\\npm\\dev-browser.cmd"
CHROME_DATA_DIR="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\chrome-debug"

# ─── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}🔷${NC} $*" >&2; }
ok()    { echo -e "${GREEN}✅${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}⚠️${NC} $*" >&2; }
err()   { echo -e "${RED}❌${NC} $*" >&2; }

# ─── Step 1: Check Chrome binary ──────────────────────────────────────────────

if [ ! -f "$CHROME_PATH" ]; then
  err "Chrome not found at: $CHROME_PATH"
  err "Adjust CHROME_PATH in the script or install Chrome on Windows."
  exit 1
fi

# ─── Step 2: Check if Chrome is already listening on port 9222 ────────────────

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
  info "Chrome not running on port ${CHROME_PORT}. Launching..."

  # Kill any stale Chrome instances that might block the port
  powershell.exe -Command "
    Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force
  " 2>/dev/null < /dev/null || true
  sleep 2

  # Launch Chrome with remote debugging
  "$CHROME_PATH" \
    --remote-debugging-port=${CHROME_PORT} \
    --remote-allow-origins=* \
    --user-data-dir="${CHROME_DATA_DIR}" \
    --no-first-run \
    --new-window about:blank > /dev/null 2>&1 &

  # Wait for Chrome to be ready (poll from Windows side)
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

# ─── Step 3: Ensure dev-browser is installed on Windows ──────────────────────

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

# ─── Step 4: Check if we have input ──────────────────────────────────────────

if [ "${PIPE_MODE}" = "none" ] && [ $# -eq 0 ]; then
  # No input — print usage
  echo ""
  echo "  Usage: $0 '<script>'           # inline script"
  echo "         $0 < script.js           # pipe from file"
  echo "         echo '...' | $0          # pipe from stdin"
  echo "         $0 <<'EOF' ... EOF       # heredoc"
  echo ""
  echo "  Examples:"
  echo "    $0 'const p = await browser.getPage(\"x\");" >&2
  echo "    await p.goto(\"https://example.com\");" >&2
  echo "    console.log(await p.title());'"
  echo ""
  echo "    echo 'console.log(1+1)' | $0"
  echo ""
  exit 0
fi

# ─── Step 5: Execute the script via dev-browser on Windows ────────────────────

info "Executing script via dev-browser on Windows..."
info "Timeout: ${SCRIPT_TIMEOUT_SECONDS}s"

if [ "${PIPE_MODE}" = "echo" ]; then
  # Inline: write to temp file
  WIN_SCRIPT="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\wsl-chrome-run-$$.js"
  WSL_SCRIPT="${SCRIPT_TEMP_DIR}/wsl-chrome-run-$$.js"
  echo "$SCRIPT_CONTENT" > "$WSL_SCRIPT"
else
  # Stdin was already captured at the top into SCRIPT_STDIN_CAPTURE
  WIN_SCRIPT="C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\${SCRIPT_FILE}"
  WSL_SCRIPT="$SCRIPT_STDIN_CAPTURE"
fi

OUTPUT=$(cmd.exe /c "type ${WIN_SCRIPT} | ${DEV_BROWSER_CMD} --connect http://localhost:9222 --timeout ${SCRIPT_TIMEOUT_SECONDS}" 2>&1) || true

# Clean up temp files
rm -f "$SCRIPT_STDIN_CAPTURE" "$WSL_SCRIPT" 2>/dev/null || true

# ─── Step 6: Process output ──────────────────────────────────────────────────

# Filter out cosmetic cmd.exe UNC path warnings
OUTPUT=$(echo "$OUTPUT" | grep -v "CMD.EXE was started" | grep -v "UNC paths are not supported" | grep -v "Defaulting to Windows directory" | grep -v "wsl.localhost" || true)

if [ -z "$OUTPUT" ]; then
  err "No output from dev-browser. Script may have timed out or failed."
  exit 3
fi

# Check for known error patterns
if echo "$OUTPUT" | grep -qi "Error:"; then
  err "dev-browser reported an error:"
  echo "$OUTPUT" >&2
  exit 3
fi

# Print the clean output (stdout only — status messages go to stderr)
echo "$OUTPUT"

# If output is valid JSON, report success
if echo "$OUTPUT" | python3 -m json.tool > /dev/null 2>&1; then
  ok "Script completed successfully"
fi

exit 0
