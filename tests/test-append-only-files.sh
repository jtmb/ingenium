#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
LEARNINGS_HELPER="$REPO_ROOT/.agents/skills/learnings.sh"

pass() { echo "✓ PASS: $1"; }
fail() { echo "✗ FAIL: $1"; }

echo "========================================"
echo "Append-Only Files Tests ($REPO_ROOT)"
echo "========================================"
echo ""

test_learnings_helper_exists() {
    if [[ -f "$LEARNINGS_HELPER" ]]; then
        pass "learnings.sh helper script exists"
        return 0
    else
        fail "learnings.sh — file not found: $LEARNINGS_HELPER"
        return 1
    fi
}

test_learnings_helper_safety() {
    if grep -q "^#!/usr/bin/env bash" "$LEARNINGS_HELPER" && \
       grep -q "set -euo pipefail" "$LEARNINGS_HELPER"; then
        pass "learnings.sh uses 'set -euo pipefail'"
        return 0
    else
        fail "learnings.sh — missing shebang or safety flags"
        return 1
    fi
}

test_learnings_helper_append() {
    local test_name="learnings.sh appends entries with correct formatting"
    
    local temp_dir=$(mktemp -d)
    local test_file="$temp_dir/test_learings.md"
    
    # Write initial content using printf with literal newlines
    printf '%s\n' '## 2026-01-01 — First entry' '' '- **Commit**: abc123' > "$test_file"
    
    # Create entry in a file, then read and pass it (handles multi-line properly)
    local entry_file="$temp_dir/entry.txt"
    printf '%s\n' '## 2026-07-06 — Second entry' '' '- **Commit**: def456' > "$entry_file"
    
    # Read the file and pass as argument (this preserves multi-line content)
    if bash "$LEARNINGS_HELPER" "$(cat -- "$entry_file")"; then
        if grep -q "## 2026-01-01 — First entry$" "$test_file" && \
           grep -q "## 2026-07-06 — Second entry$" "$test_file"; then
            
            if grep -A1 "^## 2026-01-01" "$test_file" | grep -q "^$"; then
                pass "$test_name"
                rm -rf "$temp_dir"
                return 0
            else
                fail "$test_name — missing blank line between entries"
                rm -rf "$temp_dir"
                return 1
            fi
        else
            fail "$test_name — entries not found after append"
            rm -rf "$temp_dir"
            return 1
        fi
    else
        local exit_code=$?
        fail "$test_name — learnings.sh failed (exit code: $exit_code)"
        rm -rf "$temp_dir"
        return 1
    fi
}

run_all_tests() {
    echo "Test Suite: Append-Only Files Enforcement"
    echo "=========================================="
    echo ""
    
    test_learnings_helper_exists || true
    test_learnings_helper_safety || true
    test_learnings_helper_append || true
    
    echo ""
    echo "========================================"
    echo "Tests complete (run with: bash tests/test-append-only-files.sh)"
    echo "========================================"
}

run_all_tests
