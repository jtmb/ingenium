#!/usr/bin/env bash
# run.sh — Start Ingenium services for development
# Usage: ./run.sh [command] [service]
#
# Commands:
#   dev       Start all services in dev mode (default)
#   build     Build all packages
#   test      Run all tests
#   check     Type-check all packages
#
# Services (start individually):
#   api       ingenium-api (port 4097)
#   server    ingenium-server (stdio MCP)
#   dashboard ingenium-dashboard (port 3000)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CMD="${1:-dev}"
SERVICE="${2:-}"

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Prerequisites ────────────────────────────────────────
check_prereqs() {
  if ! command -v node &>/dev/null; then
    err "Node.js is not installed. Install Node.js 22+ first."
    exit 1
  fi
  local NODE_VER
  NODE_VER="$(node --version | cut -d'v' -f2 | cut -d'.' -f1)"
  if [ "$NODE_VER" -lt 22 ]; then
    err "Node.js 22+ required (found v$NODE_VER)"
    exit 1
  fi
  if ! command -v npm &>/dev/null; then
    err "npm is not installed."
    exit 1
  fi
}

# ── Build ────────────────────────────────────────────────
build_all() {
  info "Building Ingenium packages..."
  cd "$ROOT/packages/ingenium-core" && npm run build && cd "$ROOT"
  cd "$ROOT/services/ingenium-api" && npm run build && cd "$ROOT"
  cd "$ROOT/services/ingenium-server" && npm run build && cd "$ROOT"
  cd "$ROOT/services/ingenium-dashboard" && npm run build && cd "$ROOT"
  ok "All packages built"
}

# ── Type-check ───────────────────────────────────────────
typecheck_all() {
  info "Type-checking all packages..."
  cd "$ROOT/packages/ingenium-core" && npx tsc --noEmit && ok "ingenium-core" && cd "$ROOT"
  cd "$ROOT/services/ingenium-api" && npx tsc --noEmit && ok "ingenium-api" && cd "$ROOT"
  cd "$ROOT/services/ingenium-server" && npx tsc --noEmit && ok "ingenium-server" && cd "$ROOT"
  cd "$ROOT/services/ingenium-dashboard" && npx tsc --noEmit && ok "ingenium-dashboard" && cd "$ROOT"
  ok "All type-checks passed"
}

# ── Tests ────────────────────────────────────────────────
run_tests() {
  info "Running tests..."
  cd "$ROOT" && bash tests/enforce-no-db-leaks.sh
  cd "$ROOT/packages/ingenium-core" && npx vitest run && ok "core tests" && cd "$ROOT"
  cd "$ROOT" && bash tests/test-agent-validation.sh && ok "agent validation"
  ok "All tests passed"
}

# ── Start API ────────────────────────────────────────────
start_api() {
  # Ensure core is built (migration files need to be in dist)
  cd "$ROOT/packages/ingenium-core" && npm run build --silent 2>/dev/null && cd "$ROOT"
  info "Starting ingenium-api on port 4097..."
  cd "$ROOT/services/ingenium-api"
  INGENIUM_CORE_DB_PATH="$ROOT/.ingenium/data" \
  NODE_ENV=production \
    npx tsx scripts/api-server.ts &
  API_PID=$!
  echo "$API_PID" > /tmp/ingenium-api.pid

  # Wait for health check
  for i in $(seq 1 30); do
    if curl -sf http://localhost:4097/api/v1/health >/dev/null 2>&1; then
      ok "ingenium-api ready on http://localhost:4097"
      return 0
    fi
    sleep 0.5
  done
  err "ingenium-api failed to start within 15 seconds"
  return 1
}

# ── Start Server ─────────────────────────────────────────
start_server() {
  info "Starting ingenium-server..."
  # Ensure core is built
  cd "$ROOT/packages/ingenium-core" && npm run build --silent 2>/dev/null && cd "$ROOT"
  cd "$ROOT/services/ingenium-server"
  INGENIUM_API_URL="${INGENIUM_API_URL:-http://localhost:4097/api/v1}" \
  NODE_ENV=production \
    npx tsx scripts/mcp-server.ts &
  SRV_PID=$!
  echo "$SRV_PID" > /tmp/ingenium-server.pid
  ok "ingenium-server running (PID $SRV_PID)"
  cd "$ROOT"
}

# ── Start Dashboard ──────────────────────────────────────
start_dashboard() {
  info "Starting ingenium-dashboard on port 3000..."
  cd "$ROOT/services/ingenium-dashboard"
  # Next.js requires development mode for dev server
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4097/api/v1}" \
  NODE_ENV=development \
    npx next dev --port 3000 &
  DASH_PID=$!
  echo "$DASH_PID" > /tmp/ingenium-dashboard.pid
  ok "ingenium-dashboard starting on http://localhost:3000"
  cd "$ROOT"
}

# ── Start All (Dev Mode) ─────────────────────────────────
start_dev() {
  info "=" 60
  info "Starting Ingenium in development mode"
  info "=" 60
  echo ""

  # Ensure dependencies and build
  cd "$ROOT" && npm install --silent 2>/dev/null
  cd "$ROOT/packages/ingenium-core" && npm run build --silent 2>/dev/null && cd "$ROOT"

  # Cleanup handler
  cleanup() {
    echo ""
    warn "Shutting down Ingenium services..."
    [ -f /tmp/ingenium-api.pid ]      && kill "${API_PID:-}" 2>/dev/null  || true
    [ -f /tmp/ingenium-server.pid ]   && kill "${SRV_PID:-}" 2>/dev/null || true
    [ -f /tmp/ingenium-dashboard.pid ] && kill "${DASH_PID:-}" 2>/dev/null || true
    rm -f /tmp/ingenium-*.pid
    ok "All services stopped"
  }
  trap cleanup EXIT INT TERM

  # Start services
  start_api
  echo ""
  start_server
  echo ""
  start_dashboard
  echo ""
  ok "All services started. Press Ctrl+C to stop."
  echo ""
  info "  API:       http://localhost:4097"
  info "  Dashboard: http://localhost:3000"
  info "  MCP:       stdio (configure in opencode.json)"
  echo ""

  # Wait for any to exit
  wait
}

# ── Main Dispatch ────────────────────────────────────────
main() {
  check_prereqs

  case "$CMD" in
    dev|start)
      if [ -n "$SERVICE" ]; then
        case "$SERVICE" in
          api)       start_api ;;
          server)    start_server ;;
          dashboard) start_dashboard ;;
          *)         err "Unknown service: $SERVICE. Use: api, server, dashboard" && exit 1 ;;
        esac
      else
        start_dev
      fi
      ;;
    build)
      build_all
      ;;
    test)
      run_tests
      ;;
    check|typecheck)
      typecheck_all
      ;;
    *)
      echo "Usage: $0 [command] [service]"
      echo ""
      echo "Commands:"
      echo "  dev              Start all services in dev mode (default)"
      echo "  build            Build all packages"
      echo "  test             Run all tests"
      echo "  check            Type-check all packages"
      echo ""
      echo "Services (start individually):"
      echo "  api              ingenium-api (port 4097)"
      echo "  server           ingenium-server (stdio MCP)"
      echo "  dashboard        ingenium-dashboard (port 3000)"
      exit 0
      ;;
  esac
}

main
