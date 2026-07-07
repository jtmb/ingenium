#!/usr/bin/env bash
# 🔴 CI Gate — prevents DB access leaks from non-API packages
set -euo pipefail

EXIT_CODE=0

# colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

check_package() {
  local pkg="$1"
  local label="$2"
  if grep -rq 'better-sqlite3\|\.db\|sqlite' "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null; then
    echo -e "${RED}❌ LEAK: $label has direct database references${NC}"
    grep -rn 'better-sqlite3\|\.db\|sqlite' "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null
    EXIT_CODE=1
  else
    echo -e "${GREEN}✅ CLEAN: $label${NC}"
  fi
}

echo "═══════════════════════════════════════════"
echo "  DB Isolation Enforcement"
echo "═══════════════════════════════════════════"

# These packages MUST NOT have DB access
check_package "services/ingenium-server" "ingenium-server"
check_package "services/ingenium-dashboard" "ingenium-dashboard"

# These packages ARE allowed DB access
echo -e "${GREEN}✅ ALLOWED: ingenium-core (DB access expected)${NC}"
echo -e "${GREEN}✅ ALLOWED: ingenium-api (DB access expected)${NC}"

echo "═══════════════════════════════════════════"

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ DB leaks detected in non-API packages."
  echo "   Only packages/ingenium-core and services/ingenium-api"
  echo "   may import database libraries (better-sqlite3, sqlite, .db)."
  echo "   Move DB logic to the API layer instead."
  exit $EXIT_CODE
fi

echo -e "${GREEN}✅ All DB isolation checks passed${NC}"
