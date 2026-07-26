#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
ARTIFACTS_ROOT="$REPO_ROOT/tests/artifacts"
TEST_RESULTS_ROOT="$REPO_ROOT/tests/test-results"
MISPLACED_TEST_RESULTS="$REPO_ROOT/tests/tests/test-results"

pass() { printf '✓ PASS: %s\n' "$1"; }
fail() { printf '✗ FAIL: %s\n' "$1"; }

is_canonical_artifact_path() {
    local candidate="$1"
    # Visual-QA output is run-scoped: the first component below visual-qa is
    # the run id and the second component is the evidence file. A file directly
    # under visual-qa is intentionally not canonical. The manual/legacy cases
    # below are retained pre-runner evidence, not permission for future loose
    # files in the repository.
    case "$candidate" in
        "$ARTIFACTS_ROOT/visual-qa"/*/*|\
        "$ARTIFACTS_ROOT/visual-qa"/manual-*|\
        "$ARTIFACTS_ROOT/visual-qa"/manual-*/*|\
        "$ARTIFACTS_ROOT/visual-qa"/legacy-*|\
        "$ARTIFACTS_ROOT/visual-qa"/legacy-*/*|\
        "$ARTIFACTS_ROOT/manual"/*/*|\
        "$ARTIFACTS_ROOT/legacy"/*|\
        "$ARTIFACTS_ROOT/playwright"/*|\
        "$ARTIFACTS_ROOT/test-runs"/*/*|\
        "$ARTIFACTS_ROOT/test-runs"/legacy-*|\
        "$ARTIFACTS_ROOT/test-runs"/legacy-*/*|\
        "$REPO_ROOT/.playwright-mcp"|\
        "$REPO_ROOT/.playwright-mcp"/*|\
        "$TEST_RESULTS_ROOT"|"$TEST_RESULTS_ROOT"/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_artifact_candidate() {
    local candidate="$1"
    case "$candidate" in
        *.png|*.jpg|*.jpeg|*.webp|*.gif|*.zip|*.har|*.snapshot.yml|\
        *-snapshot.md|*-accessibility.md|*/error-context.md|*/.last-run.json)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_unscoped_visual_qa_file() {
    local candidate="$1"
    local visual_root="$ARTIFACTS_ROOT/visual-qa/"
    if [[ "$candidate" != "$visual_root"* ]]; then
        return 1
    fi

    local remainder="${candidate#"$visual_root"}"
    # A direct file is not run-scoped. The named manual/legacy paths are
    # explicit retained evidence and are handled by the legacy classification.
    if [[ "$remainder" == */* || "$remainder" == manual-* || "$remainder" == legacy-* ]]; then
        return 1
    fi
    return 0
}

test_no_root_pngs() {
    local pngs
    pngs=$(find "$REPO_ROOT" -maxdepth 1 -type f -name '*.png' -print)
    if [[ -z "$pngs" ]]; then
        pass 'No *.png files at repo root'
    else
        fail "Found *.png files at repo root:"$'\n'"$pngs"
        return 1
    fi
}

test_no_root_snapshot_md() {
    local snapshots
    snapshots=$(find "$REPO_ROOT" -maxdepth 1 -type f -name '*-snapshot.md' -print)
    if [[ -z "$snapshots" ]]; then
        pass 'No *-snapshot.md files at repo root'
    else
        fail "Found *-snapshot.md files at repo root:"$'\n'"$snapshots"
        return 1
    fi
}

test_no_root_accessibility_md() {
    local accessibility
    accessibility=$(find "$REPO_ROOT" -maxdepth 1 -type f -name '*-accessibility.md' -print)
    if [[ -z "$accessibility" ]]; then
        pass 'No *-accessibility.md files at repo root'
    else
        fail "Found *-accessibility.md files at repo root:"$'\n'"$accessibility"
        return 1
    fi
}

test_artifacts_dir_exists() {
    if [[ -d "$ARTIFACTS_ROOT" ]]; then
        pass 'tests/artifacts/ directory exists'
    else
        fail 'tests/artifacts/ directory does not exist'
        return 1
    fi
}

test_results_dir_exists() {
    if [[ -d "$TEST_RESULTS_ROOT" ]]; then
        pass 'tests/test-results/ directory exists'
    else
        fail 'tests/test-results/ directory does not exist'
        return 1
    fi
}

test_subdirs_exist() {
    local failures=0
    for directory in visual-qa manual legacy; do
        if [[ -d "$ARTIFACTS_ROOT/$directory" ]]; then
            pass "tests/artifacts/$directory/ directory exists"
        else
            fail "tests/artifacts/$directory/ directory does not exist"
            failures=$((failures + 1))
        fi
    done
    return "$failures"
}

test_gitkeep_exists() {
    if [[ -f "$ARTIFACTS_ROOT/.gitkeep" ]]; then
        pass 'tests/artifacts/.gitkeep exists'
    else
        fail 'tests/artifacts/.gitkeep does not exist'
        return 1
    fi
}

test_no_misplaced_test_results() {
    if [[ ! -e "$MISPLACED_TEST_RESULTS" ]]; then
        pass 'No misplaced tests/tests/test-results artifacts'
        return 0
    fi

    local entries
    entries=$(find "$MISPLACED_TEST_RESULTS" -print)
    fail "Found misplaced tests/tests/test-results residual evidence (retained, not deleted):"$'\n'"$entries"
    return 1
}

test_no_loose_artifact_roots() {
    if [[ ! -d "$ARTIFACTS_ROOT" ]]; then
        fail 'Cannot inspect loose artifact roots because tests/artifacts is missing'
        return 1
    fi

    local loose
    loose=$(find "$ARTIFACTS_ROOT" -mindepth 1 -maxdepth 1 \
        ! -name '.gitkeep' \
        ! -name 'visual-qa' \
        ! -name 'manual' \
        ! -name 'legacy' \
        ! -name 'playwright' \
        ! -name 'test-runs' \
        -print)
    if [[ -z "$loose" ]]; then
        pass 'No loose entries directly under tests/artifacts/'
    else
        fail "Found loose entries outside canonical artifact roots:"$'\n'"$loose"
        return 1
    fi
}

test_no_manual_artifacts_in_visual_root() {
    if [[ ! -d "$ARTIFACTS_ROOT/visual-qa" ]]; then
        pass 'No retained manual captures under tests/artifacts/visual-qa/'
        return 0
    fi

    local retained
    retained=$(find "$ARTIFACTS_ROOT/visual-qa" -mindepth 1 -maxdepth 1 \
        \( -type d -o -type f \) -name 'manual-*' -print)
    if [[ -n "$retained" ]]; then
        printf 'ℹ INFO: Retained legacy visual-QA manual evidence (not deleted):%s\n' "$retained"
    fi
    pass 'Retained visual-QA manual evidence is explicitly classified'
}

test_classify_retained_evidence() {
    local found=0
    local retained

    if [[ -d "$REPO_ROOT/.playwright-mcp" ]]; then
        printf 'ℹ INFO: Retained legacy .playwright-mcp evidence (not deleted): %s\n' "$REPO_ROOT/.playwright-mcp"
        found=1
    fi

    if [[ -d "$ARTIFACTS_ROOT/test-runs" ]]; then
        retained=$(find "$ARTIFACTS_ROOT/test-runs" -mindepth 1 -maxdepth 1 \
            -type d -name 'legacy-*' -print)
        if [[ -n "$retained" ]]; then
            printf 'ℹ INFO: Retained legacy test-run evidence (not deleted):%s\n' "$retained"
            found=1
        fi
    fi

    if [[ "$found" -eq 0 ]]; then
        pass 'No retained legacy evidence requiring classification'
    else
        pass 'Known retained legacy evidence is explicitly classified'
    fi
}

test_no_loose_artifacts() {
    local -a loose=()
    local candidate

    # This is a read-only discovery scan. It deliberately excludes dependency
    # trees and known dashboard source assets; it never deletes or relocates a
    # candidate, because an operator must decide how to preserve evidence.
    while IFS= read -r -d '' candidate; do
        if [[ "$candidate" == "$REPO_ROOT/services/"*/public/* ]]; then
            continue
        fi
        if (is_unscoped_visual_qa_file "$candidate" \
            || is_artifact_candidate "$candidate") \
            && ! is_canonical_artifact_path "$candidate"; then
            loose+=("$candidate")
        fi
    done < <(
        find "$REPO_ROOT" \
            \( -path "$REPO_ROOT/.git" -o -path "$REPO_ROOT/node_modules" -o -path '*/node_modules' \
                -o -path '*/.next' -o -path '*/dist' -o -path '*/build' \) -prune -o \
            -type f -print0
    )

    if [[ "${#loose[@]}" -eq 0 ]]; then
        pass 'No loose artifact files outside canonical roots'
    else
        fail "Found loose artifact files outside canonical roots:"$'\n'"$(printf '%s\n' "${loose[@]}")"
        return 1
    fi
}

run_all_tests() {
    local failures=0

    printf '%s\n' '========================================'
    printf 'Artifact Hygiene Tests (%s)\n' "$REPO_ROOT"
    printf '%s\n\n' '========================================'
    printf '%s\n' 'Test Suite: Artifact Containment Hygiene'
    printf '%s\n\n' '=========================================='

    test_no_root_pngs || failures=$((failures + 1))
    test_no_root_snapshot_md || failures=$((failures + 1))
    test_no_root_accessibility_md || failures=$((failures + 1))
    test_artifacts_dir_exists || failures=$((failures + 1))
    test_results_dir_exists || failures=$((failures + 1))
    test_subdirs_exist || failures=$((failures + 1))
    test_gitkeep_exists || failures=$((failures + 1))
    test_no_misplaced_test_results || failures=$((failures + 1))
    test_no_loose_artifact_roots || failures=$((failures + 1))
    test_no_manual_artifacts_in_visual_root || failures=$((failures + 1))
    test_classify_retained_evidence || failures=$((failures + 1))
    test_no_loose_artifacts || failures=$((failures + 1))

    printf '\n%s\n' '========================================'
    printf 'Tests complete: %s failure(s)\n' "$failures"
    printf '%s\n' '========================================'
    return "$failures"
}

run_all_tests
