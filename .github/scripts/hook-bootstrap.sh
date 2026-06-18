#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────
# hook-bootstrap.sh — Auto-bootstrap from git repo via hook
#
# Called by a Copilot SessionStart hook (or CI hook). Detects
# whether the current project is already bootstrapped. If not,
# pulls the bootstrap repo and applies the correct framework
# overlay — all non-interactive.
#
# Usage:
#   hook-bootstrap.sh                          # auto-detect framework
#   hook-bootstrap.sh --framework nextjs       # force framework
#   hook-bootstrap.sh --bootstrap-repo-url URL # custom repo URL
#   hook-bootstrap.sh --no-cache               # force re-bootstrap
# ───────────────────────────────────────────────────────────
set -euo pipefail

BOOTSTRAP_REPO_URL="${GH_LLM_BOOTSTRAP_URL:-https://github.com/brajam/copilot-ai-bootstrap.git}"
BOOTSTRAP_REPO_REF="${GH_LLM_BOOTSTRAP_REF:-main}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/gh-llm-bootstrap"
FORCE=false
FRAMEWORK=""

# ── Parse args ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --framework) FRAMEWORK="$2"; shift 2 ;;
        --bootstrap-repo-url) BOOTSTRAP_REPO_URL="$2"; shift 2 ;;
        --no-cache) FORCE=true; shift ;;
        --help) echo "Usage: hook-bootstrap.sh [--framework FW] [--no-cache]"; exit 0 ;;
        *) shift ;;
    esac
done

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── Already bootstrapped? ─────────────────────────────────
if [[ -f "$PROJECT_ROOT/AGENTS.md" ]] && ! $FORCE; then
    # Already bootstrapped — nothing to do, signal success
    echo '{"continue": true}'
    exit 0
fi

# ── Pull or update the bootstrap repo ─────────────────────
if [[ -d "$CACHE_DIR/.git" ]]; then
    git -C "$CACHE_DIR" fetch --quiet origin "$BOOTSTRAP_REPO_REF"
    git -C "$CACHE_DIR" checkout --quiet "origin/$BOOTSTRAP_REPO_REF"
    git -C "$CACHE_DIR" pull --quiet --ff-only origin "$BOOTSTRAP_REPO_REF" 2>/dev/null || true
else
    git clone --quiet --depth 1 --branch "$BOOTSTRAP_REPO_REF" \
        "$BOOTSTRAP_REPO_URL" "$CACHE_DIR"
fi

# ── Auto-detect framework if not specified ────────────────
if [[ -z "$FRAMEWORK" ]]; then
    if [[ -f "$PROJECT_ROOT/package.json" ]]; then
        # Check for Next.js specifically
        if grep -q '"next"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
            FRAMEWORK="nextjs"
        else
            FRAMEWORK="generic"
        fi
    elif [[ -f "$PROJECT_ROOT/pyproject.toml" ]] || [[ -f "$PROJECT_ROOT/setup.py" ]] || [[ -f "$PROJECT_ROOT/setup.cfg" ]]; then
        FRAMEWORK="python"
    elif [[ -f "$PROJECT_ROOT/go.mod" ]]; then
        FRAMEWORK="go"
    elif [[ -f "$PROJECT_ROOT/Cargo.toml" ]]; then
        FRAMEWORK="rust"
    else
        FRAMEWORK="generic"
    fi
fi

# ── Bootstrap ─────────────────────────────────────────────
"$CACHE_DIR/.github/scripts/bootstrap.sh" --framework "$FRAMEWORK" --project-name "$(basename "$PROJECT_ROOT")" "$PROJECT_ROOT"

# ── Signal success to the hook system ─────────────────────
echo '{"continue": true}'
