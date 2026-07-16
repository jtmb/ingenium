#!/usr/bin/env bash
# 🔴 CI Gate — prevents DB access leaks from non-API packages
#
# Uses semantic checks instead of naive grep patterns:
#   1. Actual SQL library imports (better-sqlite3, etc.)
#   2. Cross-package imports from DB-access modules
#   3. .db file access patterns
#
# Does NOT flag display text / skill names that happen to contain "sqlite".
set -euo pipefail

EXIT_CODE=0

# colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Common file filters shared by all checks
FILE_FILTERS=(
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs'
  --exclude-dir='node_modules' --exclude-dir='dist' --exclude-dir='.next'
  --exclude-dir='tests' --exclude-dir='__tests__'
)

check_package() {
  local pkg="$1"
  local label="$2"
  local has_leak=0

  # ── Check 1: Actual SQL library imports ────────────────────────────
  # Catches: import ... from 'better-sqlite3', require('better-sqlite3'),
  #          import Database from 'better-sqlite3', etc.
  if grep -rq 'import.*better-sqlite3\|require.*better-sqlite3\|from ["'"'"']better-sqlite3' \
    "${FILE_FILTERS[@]}" \
    "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null; then
    echo -e "${RED}❌ SQL LIBRARY LEAK: $label imports better-sqlite3${NC}"
    grep -rn 'import.*better-sqlite3\|require.*better-sqlite3\|from ["'"'"']better-sqlite3' \
      "${FILE_FILTERS[@]}" \
      "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null
    has_leak=1
  fi

  # ── Check 2: .db file access patterns ──────────────────────────────
  # Catches: path/to/something.db, open('file.db'), etc.
  # Uses word-boundary to avoid matching things like ".dbitems" in URLs
  if grep -rq '\.db\b' \
    "${FILE_FILTERS[@]}" \
    "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null; then
    echo -e "${RED}❌ DB FILE LEAK: $label references .db files${NC}"
    grep -rn '\.db\b' \
      "${FILE_FILTERS[@]}" \
      "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null
    has_leak=1
  fi

  # ── Check 3: Cross-package imports from ingenium-core ──────────────
  # Services (dashboard, server) must talk to the API layer only.
  # They must not import from ingenium-core directly — that package
  # contains DB-access modules like lib/tools/skills, etc.
  if [ "$pkg" = "services/ingenium-dashboard" ] || [ "$pkg" = "services/ingenium-server" ]; then
    if grep -rq "from.*['\"].*ingenium-core" \
      "${FILE_FILTERS[@]}" \
      "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null; then
      echo -e "${RED}❌ CROSS-PACKAGE LEAK: $label imports from ingenium-core (use API instead)${NC}"
      grep -rn "from.*['\"].*ingenium-core" \
        "${FILE_FILTERS[@]}" \
        "$pkg/src/" "$pkg/lib/" "$pkg/scripts/" 2>/dev/null
      has_leak=1
    fi
  fi

  if [ $has_leak -eq 0 ]; then
    echo -e "${GREEN}✅ CLEAN: $label${NC}"
  else
    EXIT_CODE=1
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
  echo "   may import database libraries (better-sqlite3, .db access)."
  echo "   Services must use the API layer — no direct core imports."
  echo "   Move DB logic to the API layer instead."
  exit $EXIT_CODE
fi

echo -e "${GREEN}✅ All DB isolation checks passed${NC}"
