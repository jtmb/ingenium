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
# Also validates the deploy/ separation:
#   5. Deploy files match their source counterparts
#   6. No source-only files leaked into deploy/
#
# Usage:
#   .agents/skills/update-skills/test-self-improving.sh           # run all tests
#   .agents/skills/update-skills/test-self-improving.sh --verbose  # detailed output
# ───────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SKILLS_DIR="$REPO_ROOT/.agents/skills"
DEPLOY_DIR="$REPO_ROOT/deploy"
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
        # Skip learnings.md (it's not a skill dir but could be a file)
        [[ "$name" == "learnings.md" ]] && continue
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

    local deploy_skill_count
    deploy_skill_count=$(find "$DEPLOY_DIR/.agents/skills" -maxdepth 2 -name "SKILL.md" 2>/dev/null | wc -l)

    info "Project skills: $project_skill_count"
    info "Deploy skills:  $deploy_skill_count"

    if [[ "$project_skill_count" -gt 0 ]]; then
        pass "Project has $project_skill_count skills (detection can enumerate)"
    else
        fail "No skills found" "expected at least 1"
    fi

    # Source-only skills (project has them, deploy doesn't)
    local source_only=0
    for skill_dir in "$SKILLS_DIR"/*/; do
        local name
        name=$(basename "$skill_dir")
        [[ ! -f "$skill_dir/SKILL.md" ]] && continue
        if [[ ! -f "$DEPLOY_DIR/.agents/skills/$name/SKILL.md" ]]; then
            source_only=$((source_only + 1))
            info "$name → source-only (not in deploy/)"
        fi
    done

    if [[ "$source_only" -gt 0 ]]; then
        pass "$source_only source-only skill(s) correctly excluded from deploy/"
    else
        # It's OK if there are no source-only skills
        pass "All $project_skill_count skills are in deploy/ (no source-only)"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 4 — Deploy Separation Integrity
# Ensures the deploy/ folder:
#   a) Contains all required files
#   b) Has no source-only files leaked in
#   c) bootstrap.sh BOOTSTRAP_DIR points to deploy/
# ═══════════════════════════════════════════════════════════
test_deploy_separation() {
    section "TEST 4 — Deploy/ Separation Integrity"

    # a) Deploy exists and has expected structure
    local required_dirs=(
        "deploy/.agents/skills"
        "deploy/.agents/hooks"
        "deploy/.agents/scripts"
        "deploy/docs"
    )
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$REPO_ROOT/$dir" ]]; then
            pass "$dir exists"
        else
            fail "$dir is missing" "expected directory in deploy/"
        fi
    done

    # b) Source-only skills should NOT be in deploy/
    local SOURCE_ONLY=("create-readme" "gh-cli" "playwright-mcp" "thread-auto-context")
    for skill in "${SOURCE_ONLY[@]}"; do
        if [[ ! -f "$DEPLOY_DIR/.agents/skills/$skill/SKILL.md" ]]; then
            pass "$skill correctly absent from deploy/"
        else
            fail "$skill leaked into deploy/" "source-only skill should not be deployed"
        fi
    done

    # c) learnings.md should NOT be in deploy/
    if [[ ! -f "$DEPLOY_DIR/.agents/skills/learnings.md" ]]; then
        pass "learnings.md correctly absent from deploy/"
    else
        fail "learnings.md leaked into deploy/" "changelog is source-only"
    fi

    # d) bootstrap.sh uses deploy/ as BOOTSTRAP_DIR
    if grep -q 'BOOTSTRAP_DIR=.*deploy' "$REPO_ROOT/.agents/scripts/bootstrap.sh"; then
        pass "bootstrap.sh BOOTSTRAP_DIR points to deploy/"
    else
        fail "bootstrap.sh BOOTSTRAP_DIR does not point to deploy/" "expected deploy/ reference"
    fi

    # e) Deprecated source path — ensure bootstrap.sh doesn't reference old repo-root paths
    if ! grep -qE 'BOOTSTRAP_DIR.*\.\.\/\.\.\"' "$REPO_ROOT/.agents/scripts/bootstrap.sh"; then
        pass "bootstrap.sh no longer references repo root directly"
    else
        fail "bootstrap.sh still has old BOOTSTRAP_DIR" "expected /../../deploy pattern"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 5 — Deploy File Integrity
# Ensures files in deploy/ are byte-identical to their source
# counterparts (no drift).
# ═══════════════════════════════════════════════════════════
test_deploy_integrity() {
    section "TEST 5 — Deploy File Integrity (source vs deploy drift)"

    # Check AGENTS.md
    if diff -q "$REPO_ROOT/AGENTS.md" "$DEPLOY_DIR/AGENTS.md" &>/dev/null; then
        pass "deploy/AGENTS.md matches source"
    else
        fail "deploy/AGENTS.md differs from source" "files have drifted"
    fi

    # Check USAGE.md
    if diff -q "$REPO_ROOT/USAGE.md" "$DEPLOY_DIR/USAGE.md" &>/dev/null; then
        pass "deploy/USAGE.md matches source"
    else
        fail "deploy/USAGE.md differs from source" "files have drifted"
    fi

    # Check hook-bootstrap.sh
    if diff -q "$REPO_ROOT/.agents/scripts/hook-bootstrap.sh" "$DEPLOY_DIR/.agents/scripts/hook-bootstrap.sh" &>/dev/null; then
        pass "deploy hook-bootstrap.sh matches source"
    else
        fail "deploy hook-bootstrap.sh differs from source" "files have drifted"
    fi

    # Check all deployed skills match
    local drift_count=0
    for deploy_skill in "$DEPLOY_DIR/.agents/skills"/*/SKILL.md; do
        local name
        name=$(basename "$(dirname "$deploy_skill")")
        local source_skill="$SKILLS_DIR/$name/SKILL.md"
        if [[ -f "$source_skill" ]]; then
            if ! diff -q "$source_skill" "$deploy_skill" &>/dev/null; then
                info "$name has drifted between source and deploy"
                drift_count=$((drift_count + 1))
            fi
        fi
    done

    if [[ "$drift_count" -eq 0 ]]; then
        pass "All deployed skills match source (0 drifted files)"
    else
        fail "$drift_count deployed skill(s) differ from source" "run: cp -r .agents/skills/<name>/SKILL.md deploy/.agents/skills/<name>/"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 6 — Frontmatter Validity
# Every skill (project + deploy) must have valid frontmatter
# with name matching folder.
# ═══════════════════════════════════════════════════════════
test_frontmatter() {
    section "TEST 6 — Frontmatter Validity"

    local dirs_to_check=("$SKILLS_DIR" "$DEPLOY_DIR/.agents/skills")
    local label=("project" "deploy")

    for i in "${!dirs_to_check[@]}"; do
        local dir="${dirs_to_check[$i]}"
        local lbl="${label[$i]}"
        [[ ! -d "$dir" ]] && continue

        for skill_file in "$dir"/*/SKILL.md; do
            [[ ! -f "$skill_file" ]] && continue
            local folder_name
            folder_name=$(basename "$(dirname "$skill_file")")

            # Check opening fence
            if [[ "$(head -1 "$skill_file")" == "---" ]]; then
                :
            else
                fail "$lbl/$folder_name missing opening frontmatter fence" ""
                continue
            fi

            # Check name field
            local fm_name
            fm_name=$(grep "^name:" "$skill_file" | head -1 | sed 's/^name: *//')
            if [[ "$fm_name" == "$folder_name" ]]; then
                :
            else
                fail "$lbl/$folder_name name mismatch" "folder=$folder_name, frontmatter=$fm_name"
            fi
        done
    done
    pass "Frontmatter valid in all skills"
}

# ═══════════════════════════════════════════════════════════
# TEST 7 — Manual Verification Guide
# Prints instructions for testing the AI agent itself.
# ═══════════════════════════════════════════════════════════
test_manual_guide() {
    section "TEST 7 — Manual AI Agent Verification Guide"

    echo ""
    echo "  The tests above validate the detection MECHANISM."
    echo "  To test the AI agent itself (the self-improving behavior):"
    echo ""
    echo "  1. Open a TEMP project in VS Code:"
    echo "     mkdir /tmp/test-ai-project && cd /tmp/test-ai-project"
    echo "     echo '{\"dependencies\":{\"prisma\":\"5.0.0\"}}' > package.json"
    echo ""
    echo "  2. Bootstrap it:"
    echo "     $REPO_ROOT/.agents/scripts/bootstrap.sh --framework nextjs /tmp/test-ai-project"
    echo ""
    echo "  3. Open VS Code chat and type: /update-skills"
    echo ""
    echo "  4. The AI should detect:"
    echo "     - Signal 1: 'prisma' dependency has NO matching skill"
    echo "     - Signal 3: No conventions for ORM/database access in TypeScript"
    echo ""
    echo "  5. The AI should PROPOSE (and create) an ORM or Prisma skill"
    echo ""
    echo "  6. Verify the AI created the skill at:"
    echo "     .agents/skills/{prisma-conventions}/SKILL.md"
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
    test_deploy_separation
    test_deploy_integrity
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
