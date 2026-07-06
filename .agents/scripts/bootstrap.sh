#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────
# bootstrap.sh — AI Bootstrap Repo Initializer
#
# Copies the layered agent instruction system into a target
# project directory. Selects framework-specific overlays and
# provides interactive or CLI-driven setup.
# ───────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────
FRAMEWORK=""
PROJECT_NAME=""
DRY_RUN=false
INTERACTIVE=false
AUTO_MODE=false
BOOTSTRAP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# ── Supported frameworks ──────────────────────────────────
VALID_FRAMEWORKS=("nextjs" "python" "go" "rust" "generic")

# ── Usage ─────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: bootstrap.sh [OPTIONS] TARGET_DIR

Bootstrap a new or existing project with AI agent instructions.

Options:
  --framework FRAMEWORK   Framework overlay: nextjs, python, go, rust, generic
  --project-name NAME     Project name (used in docs templates)
  --auto                  Non-interactive mode (for hooks/CI) — requires --framework
  --dry-run               Show what would be copied without making changes
  --help                  Show this message

Examples:
  bootstrap.sh --framework python /path/to/new-project
  bootstrap.sh --auto --framework python /path/to/new-project   # hook/CI mode
  bootstrap.sh --framework nextjs --project-name "My App" ~/repos/my-app
  bootstrap.sh /path/to/new-project   # Interactive mode

EOF
}

# ── Parse args ────────────────────────────────────────────
TARGET_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --framework)
            FRAMEWORK="$2"; shift 2 ;;
        --project-name)
            PROJECT_NAME="$2"; shift 2 ;;
        --auto)
            AUTO_MODE=true; shift ;;
        --dry-run)
            DRY_RUN=true; shift ;;
        --help)
            usage; exit 0 ;;
        -*)
            echo "Unknown option: $1" >&2; usage; exit 1 ;;
        *)
            TARGET_DIR="$1"; shift ;;
    esac
done

if [[ -z "$TARGET_DIR" ]]; then
    echo "Error: TARGET_DIR is required." >&2
    usage
    exit 1
fi

# ── Auto mode: skip interactive prompts ───────────────────
if $AUTO_MODE && [[ -z "$FRAMEWORK" ]]; then
    echo "Error: --auto requires --framework to be specified." >&2
    exit 1
fi

# ── Interactive mode when no framework specified ──────────
if [[ -z "$FRAMEWORK" ]]; then
    INTERACTIVE=true
    echo "─────────────────────────────────────────"
    echo "  AI Bootstrap — Interactive Setup"
    echo "─────────────────────────────────────────"
    echo
    echo "Available frameworks:"
    for i in "${!VALID_FRAMEWORKS[@]}"; do
        printf "  %d) %s\n" "$((i+1))" "${VALID_FRAMEWORKS[$i]}"
    done
    echo
    read -r -p "Choose framework [1-${#VALID_FRAMEWORKS[@]}]: " fw_choice
    if [[ "$fw_choice" =~ ^[0-9]+$ ]] && ((fw_choice >= 1 && fw_choice <= ${#VALID_FRAMEWORKS[@]})); then
        FRAMEWORK="${VALID_FRAMEWORKS[$((fw_choice-1))]}"
    else
        echo "Invalid choice. Defaulting to 'generic'." >&2
        FRAMEWORK="generic"
    fi

    read -r -p "Project name (optional): " PROJECT_NAME

    echo
    echo "Framework: $FRAMEWORK"
    echo "Project:   ${PROJECT_NAME:-<unnamed>}"
    echo "Target:    $TARGET_DIR"
    echo
    read -r -p "Proceed? [Y/n] " confirm
    if [[ "$confirm" =~ ^[Nn] ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# ── Validate framework ────────────────────────────────────
valid=false
for fw in "${VALID_FRAMEWORKS[@]}"; do
    [[ "$FRAMEWORK" == "$fw" ]] && valid=true && break
done
if ! $valid; then
    echo "Error: Invalid framework '$FRAMEWORK'. Choose: ${VALID_FRAMEWORKS[*]}" >&2
    exit 1
fi

# ── Resolve target ────────────────────────────────────────
ORIGINAL_TARGET="$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || true)"
if [[ -z "$TARGET_DIR" ]] && ! $DRY_RUN; then
    mkdir -p "$ORIGINAL_TARGET"
    TARGET_DIR="$(cd "$ORIGINAL_TARGET" 2>/dev/null && pwd || echo "$ORIGINAL_TARGET")"
fi

# ── File list to copy ─────────────────────────────────────
# Each entry: "source_relative_path|destination_relative_path|condition"
# condition: "always", "framework:{name}", "optional"
# Source files live in .agents/ and are copied to .agents/ in target projects
declare -a FILES=(
    "AGENTS.md|AGENTS.md|always"
    "USAGE.md|USAGE.md|always"
    "README.md|README.md|always"
    ".agents/skills/generic-conventions/SKILL.md|.agents/skills/generic-conventions/SKILL.md|always"
    ".agents/skills/project-structure/SKILL.md|.agents/skills/project-structure/SKILL.md|always"
    ".agents/skills/containers/SKILL.md|.agents/skills/containers/SKILL.md|always"
    ".agents/skills/shell-scripts/SKILL.md|.agents/skills/shell-scripts/SKILL.md|always"
    ".agents/skills/sql-database/SKILL.md|.agents/skills/sql-database/SKILL.md|always"
    ".agents/skills/api-design/SKILL.md|.agents/skills/api-design/SKILL.md|always"
    ".agents/skills/kubernetes/SKILL.md|.agents/skills/kubernetes/SKILL.md|always"
    ".agents/skills/typescript-standalone/SKILL.md|.agents/skills/typescript-standalone/SKILL.md|always"
    ".agents/skills/agent-pipelines/SKILL.md|.agents/skills/agent-pipelines/SKILL.md|always"
    ".agents/skills/useful-tests/SKILL.md|.agents/skills/useful-tests/SKILL.md|always"
    ".agents/skills/gitignore/SKILL.md|.agents/skills/gitignore/SKILL.md|always"
    ".agents/skills/postgresql-optimization/SKILL.md|.agents/skills/postgresql-optimization/SKILL.md|always"
    ".agents/skills/debugging-patterns/SKILL.md|.agents/skills/debugging-patterns/SKILL.md|always"
    ".agents/skills/code-review-checklist/SKILL.md|.agents/skills/code-review-checklist/SKILL.md|always"
    ".agents/skills/refactoring-recipes/SKILL.md|.agents/skills/refactoring-recipes/SKILL.md|always"
    ".agents/skills/self-correction-patterns/SKILL.md|.agents/skills/self-correction-patterns/SKILL.md|always"
    ".agents/skills/cli-toolkit/SKILL.md|.agents/skills/cli-toolkit/SKILL.md|always"
    ".agents/skills/regex-reference/SKILL.md|.agents/skills/regex-reference/SKILL.md|always"
    ".agents/skills/error-interpretation/SKILL.md|.agents/skills/error-interpretation/SKILL.md|always"
    ".agents/skills/local-models/SKILL.md|.agents/skills/local-models/SKILL.md|always"
    ".agents/skills/local-models/scripts/vision_call.py|.agents/skills/local-models/scripts/vision_call.py|optional"
    ".agents/skills/skill-load/SKILL.md|.agents/skills/skill-load/SKILL.md|always"
    "docs/README.md|docs/README.md|always"
    "docs/ARCHITECTURE.md|docs/ARCHITECTURE.md|always"
    "docs/TECH-STACK.md|docs/TECH-STACK.md|always"
    "docs/CONVENTIONS.md|docs/CONVENTIONS.md|always"
    ".agents/skills/repo-context/SKILL.md|.agents/skills/repo-context/SKILL.md|optional"
    ".agents/skills/generate-docs/SKILL.md|.agents/skills/generate-docs/SKILL.md|optional"
    ".agents/skills/write-docs/SKILL.md|.agents/skills/write-docs/SKILL.md|optional"
    ".agents/skills/update-skills/SKILL.md|.agents/skills/update-skills/SKILL.md|always"
    ".agents/skills/update-skill-index/SKILL.md|.agents/skills/update-skill-index/SKILL.md|always"
    ".agents/skills/audit-skills/SKILL.md|.agents/skills/audit-skills/SKILL.md|always"
    ".agents/skills/help/SKILL.md|.agents/skills/help/SKILL.md|optional"
    ".agents/skills/web-design-reviewer/SKILL.md|.agents/skills/web-design-reviewer/SKILL.md|optional"
    ".agents/skills/chrome-devtools/SKILL.md|.agents/skills/chrome-devtools/SKILL.md|optional"
    ".agents/skills/playwright-mcp/SKILL.md|.agents/skills/playwright-mcp/SKILL.md|optional"
    ".agents/skills/gh-cli/SKILL.md|.agents/skills/gh-cli/SKILL.md|optional"
    ".agents/skills/gh-cli/templates/issue-report.md|.agents/skills/gh-cli/templates/issue-report.md|optional"
    ".agents/skills/kaban-board/SKILL.md|.agents/skills/kaban-board/SKILL.md|optional"
    ".agents/skills/wsl-cleanup/SKILL.md|.agents/skills/wsl-cleanup/SKILL.md|always"
    ".agents/skills/wsl-cleanup/scripts/wsl-cleanup.sh|.agents/skills/wsl-cleanup/scripts/wsl-cleanup.sh|optional"
    ".agents/skills/learnings.md|.agents/skills/learnings.md|always"
    ".agents/hooks/pre-tool-use.json|.agents/hooks/pre-tool-use.json|always"
    ".agents/hooks/post-tool-use.json|.agents/hooks/post-tool-use.json|always"
    ".agents/hooks/session-start.json|.agents/hooks/session-start.json|always"
    ".agents/workflows/ci.yml|.agents/workflows/ci.yml|optional"
    ".agents/scripts/hook-bootstrap.sh|hook-bootstrap.sh|optional"
)

# Framework-specific skill overlays
case "$FRAMEWORK" in
    nextjs)
        FILES+=(".agents/skills/nextjs-conventions/SKILL.md|.agents/skills/nextjs-conventions/SKILL.md|framework:nextjs")
        ;;
    python)
        FILES+=(".agents/skills/python-conventions/SKILL.md|.agents/skills/python-conventions/SKILL.md|framework:python")
        ;;
    go)
        FILES+=(".agents/skills/go-conventions/SKILL.md|.agents/skills/go-conventions/SKILL.md|framework:go")
        ;;
    rust)
        FILES+=(".agents/skills/rust-conventions/SKILL.md|.agents/skills/rust-conventions/SKILL.md|framework:rust")
        ;;
esac

# ── Copy / dry-run ────────────────────────────────────────
copied=0
skipped=0

for entry in "${FILES[@]}"; do
    IFS='|' read -r src_rel dst_rel condition <<< "$entry"

    # Determine if this file should be included
    include=false
    case "$condition" in
        always) include=true ;;
        framework:*) [[ "$condition" == "framework:$FRAMEWORK" ]] && include=true ;;
        optional) include=true ;;  # Always include optional files if they exist
    esac

    if ! $include; then
        continue
    fi

    src="$BOOTSTRAP_DIR/$src_rel"
    dst="$TARGET_DIR/$dst_rel"

    if [[ ! -f "$src" ]]; then
        # Skip missing optional files silently
        [[ "$condition" == "optional" ]] && continue
        echo "WARNING: Source not found: $src_rel" >&2
        skipped=$((skipped + 1))
        continue
    fi

    if $DRY_RUN; then
        echo "[DRY-RUN] Would copy: $src_rel → $dst_rel"
    else
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        echo "Copied: $src_rel → $dst_rel"
    fi
    copied=$((copied + 1))
done

# ── .gitignore ─────────────────────────────────────────────
gitignore="$TARGET_DIR/.gitignore"
gitignore_entries=(
    "# AI-generated files"
    ".agents/skills/*/SKILL.md.bak"
)

if ! $DRY_RUN; then
    if [[ -f "$gitignore" ]]; then
        # Only append entries not already present
        for entry in "${gitignore_entries[@]}"; do
            if ! grep -qF "$entry" "$gitignore" 2>/dev/null; then
                echo "$entry" >> "$gitignore"
            fi
        done
        echo "Updated: .gitignore (appended AI entries)"
    else
        printf '%s\n' "${gitignore_entries[@]}" > "$gitignore"
        echo "Created: .gitignore"
    fi
else
    echo "[DRY-RUN] Would create/update .gitignore"
fi

# ── Summary ────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────"
if $DRY_RUN; then
    echo "  DRY RUN — no files were changed"
fi
echo "  Framework: $FRAMEWORK"
echo "  Target:    $TARGET_DIR"
echo "  Copied:    $copied files"
echo "  Skipped:   $skipped files"
echo "─────────────────────────────────────────"
echo
if $AUTO_MODE; then
    echo "Bootstrapped via hook. The AI will follow rules automatically."
else
    echo "Next steps:"
    echo "  1. Read USAGE.md for how to add your own rules"
    echo "  2. Edit docs/ to describe your project"
    echo "  3. Open in your editor with AI support — the AI will follow the rules automatically"
    echo
    if $INTERACTIVE || [[ -n "$PROJECT_NAME" ]]; then
        echo "Tip: Run '/generate-docs' to have the AI fill in docs/ templates."
        echo
    fi
fi
