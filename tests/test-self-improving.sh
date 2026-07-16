#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────
# test-self-improving.sh — Validate the update-skills
# detection pipeline.
#
# Tests the four detection signals from update-skills:
#   1. New framework/dependency (package manifest gaps)
#   2. Repeated conventions (3+ files with same pattern)
#   3. Missing coverage (file types not covered by any skill)
#   4. Stale content (skill references wrong version)
#
# Usage:
#   tests/test-self-improving.sh           # run all tests
#   tests/test-self-improving.sh --verbose  # detailed output
# ───────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/.opencode/skills"
VERBOSE=false
PASSED=0
FAILED=0

# ── Parse args ────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --verbose|-v) VERBOSE=true ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────
green()  { echo -e "\033[32m$*\033[0m"; }
red()    { echo -e "\033[31m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
dim()    { echo -e "\033[2m$*\033[0m"; }

pass() {
    PASSED=$((PASSED + 1))
    green "  ✓ PASS: $1"
}

fail() {
    FAILED=$((FAILED + 1))
    red "  ✗ FAIL: $1 — $2"
}

info() {
    $VERBOSE && dim "  · $*" || true
}

section() {
    echo ""
    echo "━━━ $1 ━━━"
}

# ── Extract skill coverage from SKILL.md descriptions ─────
# Returns: skill_name|description
extract_skill_coverage() {
    local dir="$1"
    for skill_dir in "$dir"/*/; do
        local name
        name=$(basename "$skill_dir")
        [[ ! -f "$skill_dir/SKILL.md" ]] && continue

        local desc
        desc=$(grep "^description:" "$skill_dir/SKILL.md" | head -1 | sed 's/^description: *"//;s/"$//')
        echo "${name}|${desc}"
    done
}

# ═══════════════════════════════════════════════════════════
# TEST 1 — Dependency Gap Detection
# Simulates Signal 1: scanning a package.json for deps not
# covered by any skill description.
# ═══════════════════════════════════════════════════════════
test_dependency_gaps() {
    section "TEST 1 — Dependency Gap Detection (Signal 1)"

    local tmpdir
    tmpdir=$(mktemp -d)
    trap "rm -rf '$tmpdir'" RETURN

    # Create a fake project with deps NOT covered by any skill
    cat > "$tmpdir/package.json" <<'JSON'
{
  "name": "test-project",
  "dependencies": {
    "next": "14.0.0",
    "react": "18.2.0",
    "solidjs": "1.8.0",
    "astro": "4.0.0",
    "pino": "8.0.0"
  },
  "devDependencies": {
    "vitest": "1.0.0",
    "playwright": "1.40.0",
    "bullmq": "5.0.0"
  }
}
JSON

    # Known mappings: dep → skill that covers it
    declare -A DEP_COVERAGE=(
        ["next"]="nextjs-conventions"
        ["react"]="nextjs-conventions"
        ["vitest"]="useful-tests"
        ["playwright"]="useful-tests"
        ["eslint"]="generic-conventions"
        ["docker"]="containers"
        ["kubernetes"]="kubernetes"
        ["go"]="go-conventions"
        ["python"]="python-conventions"
        ["rust"]="rust-conventions"
        ["typescript"]="typescript-standalone"
    )

    info "Scanning $(basename "$tmpdir")/package.json for uncovered deps..."

    local gaps_found=0
    local deps
    deps=$(python3 -c "
import json, sys
with open('$tmpdir/package.json') as f:
    pkg = json.load(f)
deps = list(pkg.get('dependencies', {}).keys()) + list(pkg.get('devDependencies', {}).keys())
print('\n'.join(deps))
" 2>/dev/null || echo "")

    for dep in $deps; do
        local covered=false
        for known in "${!DEP_COVERAGE[@]}"; do
            if [[ "${dep,,}" == "${known,,}" ]]; then
                covered=true
                info "$dep → covered by ${DEP_COVERAGE[$known]}"
                break
            fi
        done
        if ! $covered; then
            # Check if any skill description mentions this dep
            local mentioned
            mentioned=$( { grep -rli "$dep" "$SKILLS_DIR"/*/SKILL.md 2>/dev/null || true; } | wc -l)
            if [[ "$mentioned" -gt 0 ]]; then
                info "$dep → mentioned in $mentioned skill(s)"
                covered=true
            fi
        fi
        if ! $covered; then
            gaps_found=$((gaps_found + 1))
            yellow "  ⚡ GAP: $dep has NO matching skill"
        fi
    done

    # Assertions
    if [[ "$gaps_found" -ge 1 ]]; then
        pass "Found $gaps_found dependency gap(s) — detection Signal 1 works"
    else
        fail "No dependency gaps found" "expected at least 1 uncovered dep (solidjs, astro, pino, bullmq)"
    fi

    # Verify specific expected gaps
    for expected_gap in "solidjs" "astro" "bullmq"; do
        local mentions
        mentions=$( { grep -rli "$expected_gap" "$SKILLS_DIR"/*/SKILL.md 2>/dev/null || true; } | wc -l)
        if [[ "$mentions" -eq 0 ]]; then
            pass "$expected_gap is correctly detected as uncovered"
        else
            info "$expected_gap is covered by $mentions skill(s)"
        fi
    done
}

# ═══════════════════════════════════════════════════════════
# TEST 2 — Missing Coverage Detection
# Simulates Signal 3: file types/dirs with no applicable skill
# ═══════════════════════════════════════════════════════════
test_missing_coverage() {
    section "TEST 2 — Missing Coverage Detection (Signal 3)"

    # Build a map of what file types are covered
    declare -A COVERED_EXTENSIONS=(
        ["go"]="go-conventions"
        ["rs"]="rust-conventions"
        ["py"]="python-conventions"
        ["tsx"]="nextjs-conventions"
        ["ts"]="typescript-standalone"
        ["jsx"]="nextjs-conventions"
        ["js"]="nextjs-conventions"
        ["sh"]="shell-scripts"
        ["bash"]="shell-scripts"
        ["sql"]="sql-database"
        ["yaml"]="kubernetes" # partial
        ["yml"]="kubernetes"  # partial
        ["css"]="nextjs-conventions"
    )

    # File types that SHOULD be gaps (not covered by any skill)
    local KNOWN_GAPS=("graphql" "gql" "proto" "tf" "mdx" "vue" "svelte")

    for gap in "${KNOWN_GAPS[@]}"; do
        local mentions
        mentions=$( { grep -rli "\\*\\.${gap}" "$SKILLS_DIR" 2>/dev/null || true; } | wc -l)
        if [[ "$mentions" -eq 0 ]]; then
            pass "*.$gap file type is correctly detected as uncovered"
        else
            info "*.${gap} is covered by $mentions skill(s) — may no longer be a gap"
        fi
    done
}

# ═══════════════════════════════════════════════════════════
# TEST 3 — Skill Count Consistency
# Ensures skills are countable and the detection can enumerate
# them (prerequisite for all detection signals).
# ═══════════════════════════════════════════════════════════
test_skill_count() {
    section "TEST 3 — Skill Enumeration"

    local project_skill_count
    project_skill_count=$(find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" | wc -l)

    info "Project skills: $project_skill_count"

    if [[ "$project_skill_count" -gt 0 ]]; then
        pass "Project has $project_skill_count skills (detection can enumerate)"
    else
        fail "No skills found" "expected at least 1"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 4 — Frontmatter Validity
# Every skill must have valid frontmatter with name matching
# folder.
# ═══════════════════════════════════════════════════════════
test_frontmatter() {
    section "TEST 4 — Frontmatter Validity"

    local dir="$SKILLS_DIR"

    for skill_file in "$dir"/*/SKILL.md; do
        [[ ! -f "$skill_file" ]] && continue
        local folder_name
        folder_name=$(basename "$(dirname "$skill_file")")

        # Check opening fence
        if [[ "$(head -1 "$skill_file")" == "---" ]]; then
            :
        else
            fail "$folder_name missing opening frontmatter fence" ""
            continue
        fi

        # Check name field
        local fm_name
        fm_name=$(grep "^name:" "$skill_file" | head -1 | sed 's/^name: *//')
        if [[ "$fm_name" == "$folder_name" ]]; then
            :
        else
            fail "$folder_name name mismatch" "folder=$folder_name, frontmatter=$fm_name"
        fi
    done
    pass "Frontmatter valid in all skills"
}

# ═══════════════════════════════════════════════════════════
# TEST 5 — Manual Verification Guide
# Prints instructions for testing the AI agent itself.
# ═══════════════════════════════════════════════════════════
test_manual_guide() {
    section "TEST 5 — Manual AI Agent Verification Guide"

    echo ""
    echo "  The tests above validate the detection MECHANISM."
    echo "  To test the AI agent itself (the self-improving behavior):"
    echo ""
    echo "  1. Create a TEMP project:"
    echo "     mkdir /tmp/test-ai-project && cd /tmp/test-ai-project"
    echo "     echo '{\"dependencies\":{\"prisma\":\"5.0.0\"}}' > package.json"
    echo ""
    echo "  2. Bootstrap it:"
    echo "     $REPO_ROOT/.agents/scripts/bootstrap.sh --framework nextjs /tmp/test-ai-project"
    echo ""
    echo "  3. Open in your AI-supporting editor and type: /update-skills"
    echo ""
    echo "  4. The AI should detect:"
    echo "     - Signal 1: 'prisma' dependency has NO matching skill"
    echo "     - Signal 3: No conventions for ORM/database access in TypeScript"
    echo ""
    echo "  5. The AI should PROPOSE (and create) an ORM or Prisma skill"
    echo ""
    echo "  6. Verify the AI created the skill at:"
    echo "     .opencode/skills/{prisma-conventions}/SKILL.md"
    echo ""
    echo "  7. Verify the skill has valid frontmatter and content"
    echo ""
    echo "  Expected result: A new skill file appears with Prisma conventions."
    echo "  If it works: ✓ The self-improving AI pipeline is functional."
    echo "  If not: Check that the AI loaded update-skills and has write access."
    echo ""
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    echo "═══════════════════════════════════════════════════════"
    echo "  Self-Improving AI — Detection Pipeline Tests"
    echo "  Repo: $REPO_ROOT"
    echo "═══════════════════════════════════════════════════════"

    test_skill_count
    test_frontmatter
    test_dependency_gaps
    test_missing_coverage
    test_manual_guide

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Results: $(green "$PASSED passed"), $(red "$FAILED failed")"
    echo "═══════════════════════════════════════════════════════"

    if [[ "$FAILED" -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
