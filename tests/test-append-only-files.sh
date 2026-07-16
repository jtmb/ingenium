#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
OBSERVATIONS_FILE="$REPO_ROOT/.opencode/skills/observations.md"
SKILLS_DIR="$REPO_ROOT/.opencode/skills"

pass() { echo "✓ PASS: $1"; }
fail() { echo "✗ FAIL: $1"; }

echo "========================================"
echo "Append-Only Files Tests ($REPO_ROOT)"
echo "========================================"
echo ""

test_observations_file_exists() {
    if [[ -f "$OBSERVATIONS_FILE" ]]; then
        pass "observations.md exists at .opencode/skills/observations.md"
        return 0
    else
        fail "observations.md — file not found: $OBSERVATIONS_FILE"
        return 1
    fi
}

test_observations_file_format() {
    if [[ ! -f "$OBSERVATIONS_FILE" ]]; then
        fail "observations.md — cannot validate format (file missing)"
        return 1
    fi

    # Each entry must have observation_type, importance, and content fields
    local entries
    entries=$(grep -c '\*\*observation_type\*\*' "$OBSERVATIONS_FILE" || true)
    local has_importance
    has_importance=$(grep -c '\*\*importance\*\*' "$OBSERVATIONS_FILE" || true)
    local has_content
    has_content=$(grep -c '\*\*content\*\*' "$OBSERVATIONS_FILE" || true)

    if [[ "$entries" -gt 0 ]] && [[ "$has_importance" -eq "$entries" ]] && [[ "$has_content" -eq "$entries" ]]; then
        pass "observations.md has $entries properly formatted observation entries"
        return 0
    else
        fail "observations.md — format mismatch (type:$entries importance:$has_importance content:$has_content)"
        return 1
    fi
}

test_no_destructive_delete_skill_calls() {
    # deleteSkill() must never be called in tool code — use archiveSkill() instead.
    # The function is defined but should only be referenced in comments, never invoked.
    local destructive
    destructive=$(grep -rn 'deleteSkill(' "$REPO_ROOT/packages/ingenium-core/lib/tools/" 2>/dev/null \
        | grep -v 'export function' \
        | grep -v ' \* ' \
        | grep -v '/\*\*' \
        || true)

    if [[ -z "$destructive" ]]; then
        pass "No destructive deleteSkill() calls in tool code (archiveSkill() is used instead)"
        return 0
    else
        fail "Destructive deleteSkill() calls found in tool code:"$'\n'"$destructive"
        return 1
    fi
}

test_skills_directory_structure() {
    if [[ ! -d "$SKILLS_DIR" ]]; then
        fail "skills directory not found: $SKILLS_DIR"
        return 1
    fi

    # At minimum, skills directory should exist and contain SKILL.md files
    local skill_count
    skill_count=$(find "$SKILLS_DIR" -name 'SKILL.md' | wc -l)

    if [[ "$skill_count" -gt 0 ]]; then
        pass "Skills directory has $skill_count skill definitions (SKILL.md files)"
        return 0
    else
        fail "Skills directory exists but contains no SKILL.md files"
        return 1
    fi
}

run_all_tests() {
    local failures=0

    echo "Test Suite: Append-Only Files Enforcement"
    echo "=========================================="
    echo ""

    test_observations_file_exists || ((failures++))
    test_observations_file_format || ((failures++))
    test_no_destructive_delete_skill_calls || ((failures++))
    test_skills_directory_structure || ((failures++))

    echo ""
    echo "========================================"
    echo "Tests complete: $failures failure(s)"
    echo "========================================"

    return "$failures"
}

run_all_tests
