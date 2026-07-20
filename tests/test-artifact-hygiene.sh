#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"

pass() { echo "✓ PASS: $1"; }
fail() { echo "✗ FAIL: $1"; }

echo "========================================"
echo "Artifact Hygiene Tests ($REPO_ROOT)"
echo "========================================"
echo ""

test_no_root_pngs() {
    local pngs
    pngs=$(find "$REPO_ROOT" -maxdepth 1 -name "*.png" 2>/dev/null)
    if [[ -z "$pngs" ]]; then
        pass "No *.png files at repo root"
        return 0
    else
        fail "Found *.png files at repo root:"$'\n'"$pngs"
        return 1
    fi
}

test_no_root_snapshot_md() {
    local snaps
    snaps=$(find "$REPO_ROOT" -maxdepth 1 -name "*-snapshot.md" 2>/dev/null)
    if [[ -z "$snaps" ]]; then
        pass "No *-snapshot.md files at repo root"
        return 0
    else
        fail "Found *-snapshot.md files at repo root:"$'\n'"$snaps"
        return 1
    fi
}

test_no_root_accessibility_md() {
    local accs
    accs=$(find "$REPO_ROOT" -maxdepth 1 -name "*-accessibility.md" 2>/dev/null)
    if [[ -z "$accs" ]]; then
        pass "No *-accessibility.md files at repo root"
        return 0
    else
        fail "Found *-accessibility.md files at repo root:"$'\n'"$accs"
        return 1
    fi
}

test_artifacts_dir_exists() {
    if [[ -d "$REPO_ROOT/tests/artifacts" ]]; then
        local subdirs
        subdirs=$(ls -1 "$REPO_ROOT/tests/artifacts/" 2>/dev/null || true)
        pass "tests/artifacts/ directory exists (contains: ${subdirs})"
        return 0
    else
        fail "tests/artifacts/ directory does not exist"
        return 1
    fi
}

test_results_dir_exists() {
    if [[ -d "$REPO_ROOT/tests/test-results" ]]; then
        pass "tests/test-results/ directory exists"
        return 0
    else
        fail "tests/test-results/ directory does not exist"
        return 1
    fi
}

test_subdirs_exist() {
    local failures=0
    for dir in visual-qa manual legacy; do
        if [[ -d "$REPO_ROOT/tests/artifacts/$dir" ]]; then
            pass "tests/artifacts/$dir/ directory exists"
        else
            fail "tests/artifacts/$dir/ directory does not exist"
            ((failures++))
        fi
    done
    return "$failures"
}

test_gitkeep_exists() {
    if [[ -f "$REPO_ROOT/tests/artifacts/.gitkeep" ]]; then
        pass "tests/artifacts/.gitkeep exists"
        return 0
    else
        fail "tests/artifacts/.gitkeep does not exist"
        return 1
    fi
}

run_all_tests() {
    local failures=0

    echo "Test Suite: Artifact Containment Hygiene"
    echo "=========================================="
    echo ""

    test_no_root_pngs || ((failures++))
    test_no_root_snapshot_md || ((failures++))
    test_no_root_accessibility_md || ((failures++))
    test_artifacts_dir_exists || ((failures++))
    test_results_dir_exists || ((failures++))
    test_subdirs_exist || ((failures++))
    test_gitkeep_exists || ((failures++))

    echo ""
    echo "========================================"
    echo "Tests complete: $failures failure(s)"
    echo "========================================"

    return "$failures"
}

run_all_tests
