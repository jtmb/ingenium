#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────
# test-agent-validation.sh — Validate ALL agent .md files
# under .opencode/agents/.  Agent count is determined dynamically at runtime.
#
# Tests:
#   1. Agent frontmatter validity (name, description, model)
#   2. Permission completeness (edit and write)
#   3. No stale skill references (every skill listed exists)
#   4. No duplicate skills within the same agent
#   5. Task block safety (read-only agents can't spawn
#      write-capable subagents)
#   6. No stale git-workflows references
#   7. Skill count consistency (filesystem vs SKILL-INDEX.md)
#
# Usage:
#   tests/test-agent-validation.sh           # run all tests
#   tests/test-agent-validation.sh -v        # verbose output
# ───────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$REPO_ROOT/.opencode/agents"
SKILLS_DIR="$REPO_ROOT/.opencode/skills"
SKILL_INDEX="$REPO_ROOT/.opencode/SKILL-INDEX.md"
VERBOSE=false
PASSED=0
FAILED=0
TEST_FAILED=false

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
    TEST_FAILED=true
    if [[ -n "${2:-}" ]]; then
        red "  ✗ FAIL: $1 — $2"
    else
        red "  ✗ FAIL: $1"
    fi
}

info() {
    $VERBOSE && dim "  · $*" || true
}

section() {
    echo ""
    echo "━━━ $1 ━━━"
}

# ── Agent File Discovery ──────────────────────────────────
# Returns all agent .md files sorted by path.
# Skips .md files that don't start with --- (non-agent files like
# browser-agent-errors.md).
find_agent_files() {
    local all_files
    all_files=$(find "$AGENTS_DIR" -name "*.md" -type f | sort)
    for f in $all_files; do
        local bn
        bn=$(basename "$f")
        # Skip documentation/non-agent files — browser-agent-errors.md, etc.
        if [[ "$bn" == browser-agent-errors* || "$bn" == *-errors.md ]]; then
            $VERBOSE && yellow "  ⚠ SKIP: Excluding non-agent file: $bn" >&2
            continue
        fi
        local first_line
        first_line=$(head -1 "$f")
        if [[ "$first_line" == "---" ]]; then
            echo "$f"
        else
            yellow "  ⚠ WARNING: Skipping non-agent file (no --- frontmatter): $bn" >&2
        fi
    done
}

# Returns just the agent name (basename without .md)
agent_name_from_path() {
    basename "$1" .md
}

# ── Frontmatter Extraction ────────────────────────────────
# Extract YAML frontmatter from a .md file (content between --- fences)
extract_frontmatter() {
    local file="$1"
    awk '/^---$/ { count++; next } count == 1 { print } count == 2 { exit }' "$file"
}

# Extract a top-level YAML block from frontmatter (content after key: until
# next top-level key at column 0).
extract_yaml_block() {
    local key="$1"
    awk -v key="^${key}:" '$0 ~ key{found=1; next} found && /^[a-zA-Z]/{exit} found{print}'
}

# Extract a value for a top-level field in the frontmatter (e.g. name, model)
get_field_value() {
    local fm="$1"
    local field="$2"
    echo "$fm" | grep "^${field}:" | head -1 | sed 's/^'"${field}"': *//'
}

# ── Agent Capability Detection ────────────────────────────
# Check if an agent is write-capable (edit:allow OR write:allow)
is_agent_write_capable() {
    local agent_name="$1"

    # Search all subdirectories for this agent file
    local file
    file=$(find "$AGENTS_DIR" -name "${agent_name}.md" -type f 2>/dev/null | head -1)

    if [[ -z "$file" ]]; then
        # If agent file doesn't exist, assume not write-capable (conservative)
        return 1
    fi

    local fm
    fm=$(extract_frontmatter "$file")
    local perm_block
    perm_block=$(extract_yaml_block "permission" <<< "$fm")

    local edit_val
    edit_val=$(echo "$perm_block" | grep "^  edit:" | head -1 | awk '{print $2}')
    local write_val
    write_val=$(echo "$perm_block" | grep "^  write:" | head -1 | awk '{print $2}')

    if [[ "$edit_val" == "allow" || "$write_val" == "allow" ]]; then
        return 0
    fi
    return 1
}

# ── Skill List Extraction ─────────────────────────────────
# Extract skill names from the agent frontmatter.
# Supports both a top-level skills: block (legacy) and the
# permission.skill: nested block (standard agent format).
# Returns one bare skill name per line (no @ prefix).
extract_skill_list() {
    local fm="$1"

    # Check for inline empty list (legacy top-level skills: [])
    if echo "$fm" | grep -q '^skills: \[\]' 2>/dev/null; then
        return 0
    fi

    # Check for inline list: skills: [a, b, c] — uncommon, handle gracefully
    local inline_list
    inline_list=$(echo "$fm" | grep '^skills: \[' 2>/dev/null | sed 's/^skills: \[//;s/\]$//' | tr ',' '\n' | sed 's/^ *"//;s/" *$//' || true)
    if [[ -n "$inline_list" ]]; then
        echo "$inline_list" | sed 's/^ *//;s/ *$//'
        return 0
    fi

    # Extract multi-line top-level skills block (legacy)
    local skills_block
    skills_block=$(extract_yaml_block "skills" <<< "$fm")
    if [[ -n "$skills_block" ]]; then
        # Parse YAML list items: "  - skillname" or "- skillname"
        local result
        result=$(echo "$skills_block" | grep -- '- ' 2>/dev/null \
            | sed 's/^[[:space:]]*- //' \
            | sed 's/[[:space:]]*#.*//' \
            | sed 's/[[:space:]]*$//' || true)
        if [[ -n "$result" ]]; then
            echo "$result"
            return 0
        fi
    fi

    # NEW: Extract from permission.skill nested block (standard agent format)
    # Agent frontmatter uses: permission: → skill: → "@skill-name": allow
    local perm_block
    perm_block=$(extract_yaml_block "permission" <<< "$fm")
    if [[ -n "$perm_block" ]]; then
        # Extract skill names from lines matching: "@skill-name": allow
        # These appear under the "skill:" sub-key within the permission block.
        # Strip the @ prefix and surrounding quotes to get bare skill names.
        echo "$perm_block" | grep -E '^\s+"@[^"]+":\s*allow' \
            | sed 's/.*"@\([^"]*\)".*/\1/' || true
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 1 — Agent Frontmatter Validity
# Check every agent file has --- fences and required fields.
# ═══════════════════════════════════════════════════════════
test_frontmatter_validity() {
    section "TEST 1 — Agent Frontmatter Validity"

    local errors=0
    local files
    files=$(find_agent_files)
    local count=0

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")
        count=$((count + 1))

        # Check opening fence
        if [[ "$(head -1 "$file")" != "---" ]]; then
            fail "$name" "Missing opening --- frontmatter fence"
            errors=$((errors + 1))
            continue
        fi

        # Check closing fence
        local fence_count
        fence_count=$(grep -c '^---' "$file" || true)
        if [[ "$fence_count" -lt 2 ]]; then
            fail "$name" "Missing closing --- frontmatter fence (found $fence_count)"
            errors=$((errors + 1))
            continue
        fi

        local fm
        fm=$(extract_frontmatter "$file")
        if [[ -z "$fm" ]]; then
            fail "$name" "Empty frontmatter section"
            errors=$((errors + 1))
            continue
        fi

        # Check required fields
        local missing_fields=""

        if ! echo "$fm" | grep -q "^name:"; then
            missing_fields="${missing_fields}name "
        fi
        if ! echo "$fm" | grep -q "^description:"; then
            missing_fields="${missing_fields}description "
        fi
        if ! echo "$fm" | grep -q "^model:"; then
            missing_fields="${missing_fields}model "
        fi

        if [[ -n "$missing_fields" ]]; then
            fail "$name" "Missing required frontmatter field(s): $missing_fields"
            errors=$((errors + 1))
            continue
        fi

        # Validate name matches file basename
        local fm_name
        fm_name=$(get_field_value "$fm" "name" | tr -d '[:space:]')
        if [[ "$fm_name" != "$name" ]]; then
            fail "$name" "Frontmatter name '$fm_name' doesn't match filename '$name'"
            errors=$((errors + 1))
            continue
        fi

        info "$name — frontmatter valid (name: $fm_name)"
    done

    if [[ "$errors" -eq 0 ]]; then
        pass "All $count agent files have valid frontmatter (--- fences + name, description, model)"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 2 — Permission Completeness
# Every agent must have explicit edit: in permission.
# write: is required only for write-capable agents
# (edit: allow OR write: allow). Read-only agents
# (edit: deny AND not write: allow) may omit write:.
# ═══════════════════════════════════════════════════════════
test_permission_completeness() {
    section "TEST 2 — Permission Completeness"

    local errors=0
    local files
    files=$(find_agent_files)
    local count=0

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")
        count=$((count + 1))

        local fm
        fm=$(extract_frontmatter "$file")

        # Check permission block exists
        if ! echo "$fm" | grep -q "^permission:"; then
            fail "$name" "Missing 'permission:' block in frontmatter"
            errors=$((errors + 1))
            continue
        fi

        # Extract permission block
        local perm_block
        perm_block=$(extract_yaml_block "permission" <<< "$fm")

        # Check edit: field (always required)
        if ! echo "$perm_block" | grep -q "^  edit:"; then
            fail "$name" "Missing 'edit:' in permission block"
            errors=$((errors + 1))
            continue
        fi

        local edit_val
        edit_val=$(echo "$perm_block" | grep "^  edit:" | head -1 | awk '{print $2}')

        # Determine if agent has an explicit write: field
        local has_write=false
        local write_val=""
        if echo "$perm_block" | grep -q "^  write:"; then
            has_write=true
            write_val=$(echo "$perm_block" | grep "^  write:" | head -1 | awk '{print $2}')
        fi

        # write: is required for write-capable agents (edit: allow OR write: allow)
        # Read-only agents (edit: deny AND not write: allow) may omit write:
        if [[ "$edit_val" == "allow" || "$write_val" == "allow" ]]; then
            # This agent is write-capable — must have write: field
            if ! $has_write; then
                fail "$name" "Missing 'write:' in permission block (write-capable agent: edit=$edit_val)"
                errors=$((errors + 1))
                continue
            fi
        fi

        info "$name — edit: $edit_val, write: ${write_val:-<none>}"
    done

    if [[ "$errors" -eq 0 ]]; then
        pass "All $count agent files have valid permission blocks"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 3 — No Stale Skill References
# Every skill referenced in an agent's skills: list must exist
# as .opencode/skills/<skillname>/SKILL.md.
# ═══════════════════════════════════════════════════════════
test_stale_skill_references() {
    section "TEST 3 — No Stale Skill References"

    local total_refs=0
    local stale_refs=0
    local files
    files=$(find_agent_files)

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        local fm
        fm=$(extract_frontmatter "$file")

        # Extract skill list
        local skill_list
        skill_list=$(extract_skill_list "$fm")

        if [[ -z "$skill_list" ]]; then
            info "$name — no skills to check (empty list)"
            continue
        fi

        while IFS= read -r skill; do
            [[ -z "$skill" ]] && continue
            total_refs=$((total_refs + 1))

            local skill_file="$SKILLS_DIR/$skill/SKILL.md"
            if [[ ! -f "$skill_file" ]]; then
                fail "$name" "References non-existent skill '$skill' (expected $skill_file)"
                stale_refs=$((stale_refs + 1))
            else
                info "$name → $skill ✓"
            fi
        done <<< "$skill_list"
    done

    if [[ "$stale_refs" -eq 0 ]]; then
        if [[ "$total_refs" -gt 0 ]]; then
            pass "$total_refs skill references checked — all valid"
        else
            pass "No stale skill references (no agent has a non-empty skills list)"
        fi
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 4 — No Duplicate Skills
# Within a single agent's skills: list, no skill may appear
# more than once.
# ═══════════════════════════════════════════════════════════
test_no_duplicate_skills() {
    section "TEST 4 — No Duplicate Skills"

    local duplicate_count=0
    local files
    files=$(find_agent_files)

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        local fm
        fm=$(extract_frontmatter "$file")
        local skill_list
        skill_list=$(extract_skill_list "$fm")

        if [[ -z "$skill_list" ]]; then
            info "$name — no skills to check for duplicates"
            continue
        fi

        # Find duplicates
        local dupes
        dupes=$(echo "$skill_list" | sort | uniq -d)

        if [[ -n "$dupes" ]]; then
            while IFS= read -r dup; do
                [[ -z "$dup" ]] && continue
                fail "$name" "Duplicate skill '$dup' appears multiple times"
                duplicate_count=$((duplicate_count + 1))
            done <<< "$dupes"
        else
            info "$name — no duplicate skills"
        fi
    done

    if [[ "$duplicate_count" -eq 0 ]]; then
        pass "No duplicate skill references in any agent"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 5 — Task Block Safety
# Read-only agents (edit: deny + write: deny) must not be able
# to spawn write-capable subagents (edit: allow or write: allow)
# via their task: allow list.
# ═══════════════════════════════════════════════════════════
test_task_block_safety() {
    section "TEST 5 — Task Block Safety"

    local files
    files=$(find_agent_files)

    # ── Phase 1: Build write-capable agent index ──
    declare -A WRITE_CAPABLE_AGENTS
    local all_agent_names=""

    for file in $files; do
        local agent_name
        agent_name=$(agent_name_from_path "$file")
        all_agent_names="$all_agent_names $agent_name"

        if is_agent_write_capable "$agent_name"; then
            WRITE_CAPABLE_AGENTS["$agent_name"]=1
            info "$agent_name — write-capable (indexed)"
        else
            info "$agent_name — read-only (indexed)"
        fi
    done

    # ── Phase 2: Check every read-only agent's task block ──
    local violations=0

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        local fm
        fm=$(extract_frontmatter "$file")

        # Determine agent mode and permissions
        local agent_mode
        agent_mode=$(get_field_value "$fm" "mode" | tr -d '[:space:]')

        local perm_block
        perm_block=$(extract_yaml_block "permission" <<< "$fm")

        local edit_val
        edit_val=$(echo "$perm_block" | grep "^  edit:" | head -1 | awk '{print $2}') || true
        local write_val
        write_val=$(echo "$perm_block" | grep "^  write:" | head -1 | awk '{print $2}') || true

        # Primary/coordinator agents are exempt — their job is to spawn
        # write-capable subagents for privileged operations
        if [[ "$agent_mode" == "primary" ]]; then
            info "$name — primary/coordinator agent, exempt from task block safety check"
            continue
        fi

        # Only check read-only agents (not write-capable)
        # An agent is write-capable if edit: allow OR write: allow
        if [[ "$edit_val" == "allow" || "$write_val" == "allow" ]]; then
            info "$name — write-capable, skipping task block safety check"
            continue
        fi

        # Extract allowed subagents from task block
        # Lines in the permission block between "  task:" and next 2-space key
        local task_allows
        task_allows=$(echo "$perm_block" | sed -n '/^  task:/,/^  [a-z]/p' \
            | grep '": "allow"' \
            | sed 's/.*"\(.*\)": "allow".*/\1/' \
            | grep -v '^\*$' || true)

        local local_violations=0

        while IFS= read -r allowed_agent; do
            [[ -z "$allowed_agent" ]] && continue

            # Trim whitespace
            allowed_agent=$(echo "$allowed_agent" | tr -d '[:space:]')

            if [[ -n "${WRITE_CAPABLE_AGENTS[$allowed_agent]:-}" ]]; then
                fail "$name" "Read-only agent can spawn write-capable subagent '$allowed_agent'"
                violations=$((violations + 1))
                local_violations=$((local_violations + 1))
            fi
        done <<< "$task_allows"

        if [[ "$local_violations" -eq 0 ]]; then
            info "$name — task block is safe (no write-capable subagent allowed)"
        fi
    done

    if [[ "$violations" -eq 0 ]]; then
        pass "All read-only agents have safe task blocks"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 6 — No Stale git-workflows References
# The git-workflows skill was deleted — ensure no agent
# references it.
# ═══════════════════════════════════════════════════════════
test_no_git_workflows() {
    section "TEST 6 — No Stale git-workflows References"

    local files
    files=$(find_agent_files)
    local found=false

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        if grep -q "git-workflows" "$file"; then
            fail "$name" "Contains stale reference to 'git-workflows' (skill deleted)"
            found=true
        fi
    done

    if ! $found; then
        pass "No agent references the deleted 'git-workflows' skill"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 7 — Skill Count Consistency
# Compare actual skill directories against SKILL-INDEX.md count.
# ═══════════════════════════════════════════════════════════
test_skill_count_consistency() {
    section "TEST 7 — Skill Count Consistency"

    # Count actual skill directories (dirs with SKILL.md)
    local actual_count
    actual_count=$(find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" | wc -l)

    # Extract count from SKILL-INDEX.md
    # Look for "Total: N items" or count entries in the "# Skills" table
    local index_count=0
    local total_line
    total_line=$(grep "^\\*\\*Total:" "$SKILL_INDEX" 2>/dev/null | head -1 || true)

    if [[ -n "$total_line" ]]; then
        # Extract number from "**Total: N items**"
        index_count=$(echo "$total_line" | sed 's/.*Total: *//;s/ *items.*//')
    fi

    # Fallback: count entries in the skills table at the bottom
    if [[ "$index_count" -eq 0 ]]; then
        index_count=$(grep -c '^| [0-9]' "$SKILL_INDEX" 2>/dev/null || true)
        info "Falling back to counting table entries in SKILL-INDEX.md"
    fi

    info "Actual skill directories: $actual_count"
    info "SKILL-INDEX.md reported:  $index_count"

    local diff=$(( actual_count - index_count ))
    local abs_diff=${diff#-}

    if [[ "$abs_diff" -eq 0 ]]; then
        pass "Skill count matches: $actual_count directories = $index_count in SKILL-INDEX.md"
    else
        fail "Skill count mismatch" "$actual_count actual vs $index_count in SKILL-INDEX.md (diff=$diff)"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 8 — Frontmatter-Model vs Body-Model Identity Match
# Detect body text like "You are qwen3.5-9b running locally"
# that contradicts the frontmatter model: field.
# ═══════════════════════════════════════════════════════════
test_model_identity_match() {
    section "TEST 8 — Model Identity Match (frontmatter vs body)"

    local errors=0
    local files
    files=$(find_agent_files)

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        local fm
        fm=$(extract_frontmatter "$file")
        local fm_model
        fm_model=$(get_field_value "$fm" "model" | tr -d '[:space:]')

        # Skip if no frontmatter model (unlikely; caught by TEST 1)
        if [[ -z "$fm_model" ]]; then
            continue
        fi

        # Extract just the core model name (last segment after final /)
        # e.g., "lmstudio/qwen/qwen3.5-9b" → "qwen3.5-9b"
        #       "deepseek/deepseek-v4-pro" → "deepseek-v4-pro"
        #       "opencode/deepseek-v4-flash-free" → "deepseek-v4-flash-free"
        local fm_core
        fm_core=$(echo "$fm_model" | sed 's|.*/||' | tr '[:upper:]' '[:lower:]')

        # Search body text for "You are" identity statements
        local body
        body=$(awk '/^---$/ { count++; next } count >= 2 { print }' "$file")

        # Find "You are ..." pattern (until end of line or sentence)
        local body_models
        body_models=$(echo "$body" | grep -oPi 'You are\s+[^\n.]*' | head -5 || true)

        if [[ -z "$body_models" ]]; then
            info "$name — no 'You are' identity statement found in body"
            continue
        fi

        # Check if any body statement mentions a model that differs from frontmatter
        local mismatch=false
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local normalized_body
            normalized_body=$(echo "$line" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')

            # Only check if body mentions specific model names
            if echo "$normalized_body" | grep -qiE 'qwen|deepseek|claude|gpt|llama|mistral|gemini'; then
                # Check if body mentions the same model family as frontmatter
                local fm_family=""
                if [[ "$fm_core" == deepseek-* ]]; then fm_family="deepseek"; fi
                if [[ "$fm_core" == qwen* ]]; then fm_family="qwen"; fi
                if [[ "$fm_core" == claude* ]]; then fm_family="claude"; fi

                # If body mentions a different model family, flag as mismatch
                if [[ -n "$fm_family" ]]; then
                    if ! echo "$normalized_body" | grep -qi "$fm_family"; then
                        fail "$name" "Body model identity '$line' conflicts with frontmatter model '$fm_model' (expected family: $fm_family)"
                        errors=$((errors + 1))
                        mismatch=true
                    else
                        info "$name — body mentions $fm_family family (matches frontmatter: $fm_model)"
                    fi
                else
                    # Fallback: check for core model name in body
                    if ! echo "$normalized_body" | grep -qi "$fm_core"; then
                        fail "$name" "Body model identity '$line' conflicts with frontmatter model '$fm_model'"
                        errors=$((errors + 1))
                        mismatch=true
                    fi
                fi
            fi
        done <<< "$body_models"

        if ! $mismatch; then
            [[ -n "$body_models" ]] && info "$name — body model identity matches frontmatter" || true
        fi
    done

    if [[ "$errors" -eq 0 ]]; then
        pass "All agent body model identities match frontmatter model field"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 9 — Body-Referenced Skills Must Be Subset of
# Frontmatter-Allowed Skills
# ═══════════════════════════════════════════════════════════
test_body_skills_in_frontmatter() {
    section "TEST 9 — Body Skills ⊆ Frontmatter Skills"

    local errors=0
    local files
    files=$(find_agent_files)

    # Get list of all known skill names from the skills directory
    local known_skills
    known_skills=$(find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" -exec dirname {} \; | xargs -I{} basename {} | sort -u)

    for file in $files; do
        local name
        name=$(agent_name_from_path "$file")

        local fm
        fm=$(extract_frontmatter "$file")

        # Get frontmatter-allowed skills (bare names, no @ prefix)
        local fm_skills
        fm_skills=$(extract_skill_list "$fm" | sort -u || true)

        # Extract body text after frontmatter
        local body
        body=$(awk '/^---$/ { count++; next } count >= 2 { print }' "$file")

        # Search body for @word references in "Required Skills" or skill requirement sections
        local body_at_refs
        body_at_refs=$(echo "$body" | grep -oP '@([a-z][a-z0-9-]*)' | sed 's/^@//' | sort -u || true)

        if [[ -z "$body_at_refs" ]]; then
            info "$name — no @ references found in body"
            continue
        fi

        # Filter to only skill names (not agent names like ingenium-orchestrator)
        local body_skills=""
        while IFS= read -r ref; do
            [[ -z "$ref" ]] && continue
            # Check if this is a known skill name
            if echo "$known_skills" | grep -qxF "$ref"; then
                body_skills="${body_skills}${ref}"$'\n'
            fi
        done <<< "$body_at_refs"
        body_skills=$(echo "$body_skills" | sort -u | grep -v '^$' || true)

        if [[ -z "$body_skills" ]]; then
            info "$name — no skill @references found in body"
            continue
        fi

        # Check each body skill against frontmatter skills
        local body_violations=0
        while IFS= read -r bskill; do
            [[ -z "$bskill" ]] && continue
            # Check if this skill exists in the frontmatter skill allow list
            if ! echo "$fm_skills" | grep -qxF "$bskill"; then
                fail "$name" "Body references skill '@$bskill' not in frontmatter skill permissions"
                errors=$((errors + 1))
                body_violations=$((body_violations + 1))
            fi
        done <<< "$body_skills"

        if [[ "$body_violations" -eq 0 ]]; then
            info "$name — all body-referenced skills are in frontmatter permissions"
        fi
    done

    if [[ "$errors" -eq 0 ]]; then
        pass "All agent body skill references are subset of frontmatter-allowed skills"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 10 — AGENTS.md Table Entries Must Appear in a Task Block
# Every subagent listed in the AGENTS.md agent table must either
# be reachable from another agent's task block or marked as
# standalone (prompt-engineer, browser-agent).
# ═══════════════════════════════════════════════════════════
test_agents_table_task_block_coverage() {
    section "TEST 10 — AGENTS.md Agent Table Task Block Coverage"

    local errors=0
    local agents_md="$REPO_ROOT/AGENTS.md"

    if [[ ! -f "$agents_md" ]]; then
        fail "Cannot find AGENTS.md" "Expected at $agents_md"
        return
    fi

    # Parse agent table from AGENTS.md — extract bold names from table rows
    # Table rows begin with "| **agent-name** |"
    local table_agents
    table_agents=$(grep -oP '^\| \*\*\K[^*]+(?=\*\* \|)' "$agents_md" || true)

    # Collect all task block allowed subagents from ALL agent files
    declare -A TASK_TARGETS
    local files
    files=$(find_agent_files)

    for file in $files; do
        local fm
        fm=$(extract_frontmatter "$file")

        # Extract task block from permission
        local perm_block
        perm_block=$(extract_yaml_block "permission" <<< "$fm")

        # Get allowed subagents from task block
        local task_allows
        task_allows=$(echo "$perm_block" | sed -n '/^  task:/,/^  [a-z]/p' \
            | grep '": "allow"' \
            | sed 's/.*"\(.*\)": "allow".*/\1/' \
            | grep -v '^\*$' || true)

        while IFS= read -r allowed_agent; do
            [[ -z "$allowed_agent" ]] && continue
            allowed_agent=$(echo "$allowed_agent" | tr -d '[:space:]')
            TASK_TARGETS["$allowed_agent"]=1
        done <<< "$task_allows"
    done

    # Standalone agents: documented in AGENTS.md as not spawned by others
    local standalone_agents="ingenium-prompt-engineer"

    # Check each subagent from the table (skip primary/orchestrator)
    while IFS= read -r agent; do
        [[ -z "$agent" ]] && continue

        # Skip the primary orchestrator — its job is to spawn, not be spawned
        if [[ "$agent" == "ingenium-orchestrator" ]]; then
            continue
        fi

        # Check if standalone
        if echo "$standalone_agents" | grep -qxF "$agent"; then
            info "$agent — standalone agent (documented as not spawned by others)"
            continue
        fi

        if [[ -n "${TASK_TARGETS[$agent]:-}" ]]; then
            info "$agent — referenced in at least one agent's task block"
        else
            fail "$agent" "Not referenced in any agent's task block and not listed as standalone"
            errors=$((errors + 1))
        fi
    done <<< "$table_agents"

    if [[ "$errors" -eq 0 ]]; then
        pass "All AGENTS.md table subagents appear in at least one task block or are marked standalone"
    fi
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    echo "═══════════════════════════════════════════════════════"
    echo "  Agent Validation Tests"
    echo "  Agents dir: $AGENTS_DIR"
    echo "  Skills dir: $SKILLS_DIR"
    echo "═══════════════════════════════════════════════════════"

    test_frontmatter_validity
    test_permission_completeness
    test_stale_skill_references
    test_no_duplicate_skills
    test_task_block_safety
    test_no_git_workflows
    test_skill_count_consistency
    test_model_identity_match
    test_body_skills_in_frontmatter
    test_agents_table_task_block_coverage

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Results: $(green "$PASSED passed"), $(red "$FAILED failed")"
    echo "═══════════════════════════════════════════════════════"

    if $TEST_FAILED; then
        exit 1
    fi
}

main "$@"
