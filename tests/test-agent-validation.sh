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
    echo "$fm" | grep "^${field}:" | head -1 | sed 's/^'"${field}"': *//' || true
}

# ── Agent Capability Detection ────────────────────────────
# Check if an agent is write-capable (edit:allow OR write:allow).
# Supports both flat form (edit: allow) and nested YAML form
# (edit:\n  "*": allow) used by software-engineer agents.
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

    # Check flat form: "  edit: allow" or "  write: allow"
    if echo "$perm_block" | grep -qE '^  (edit|write): allow$'; then
        return 0
    fi

    # Check nested form: "  edit:" followed by a value containing "allow"
    # at a deeper indent (e.g., "    \"*\": allow"). Extract the edit block
    # and look for "allow" within it.
    local edit_block
    edit_block=$(echo "$perm_block" | awk '/^  edit:/{found=1; print; next} found && /^  [a-z]/{exit} found{print}')
    if echo "$edit_block" | grep -q 'allow'; then
        return 0
    fi

    local write_block
    write_block=$(echo "$perm_block" | awk '/^  write:/{found=1; print; next} found && /^  [a-z]/{exit} found{print}')
    if echo "$write_block" | grep -q 'allow'; then
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

        # Check required fields — ingenium-chat is exempt from model: requirement
        # because it inherits the model from the requesting context (Settings → OpenCode config).
        local missing_fields=""

        if ! echo "$fm" | grep -q "^name:"; then
            missing_fields="${missing_fields}name "
        fi
        if ! echo "$fm" | grep -q "^description:"; then
            missing_fields="${missing_fields}description "
        fi
        if ! echo "$fm" | grep -q "^model:"; then
            if [[ "$name" != "ingenium-chat" ]]; then
                missing_fields="${missing_fields}model "
            fi
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
        # e.g., "qwen/qwen3.5-9b" → "qwen3.5-9b"
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

    # Extract the Agent Table section only (between "## Agent Table" and next "## " heading)
    # This avoids parsing non-agent tables like Concurrency Limits, Writer Tiers, etc.
    local agent_table_section
    agent_table_section=$(awk '
      /^## Agent Table$/ { capture=1; next }
      capture && /^## / { capture=0; exit }
      capture { print }
    ' "$agents_md")

    # Parse agent names from the Agent Table section — extract bold first-column labels
    # Agent table rows look like: | **agent-name** | Type | Model | Skills Allowed |
    local table_agents
    table_agents=$(echo "$agent_table_section" | grep -oP '^\| \*\*\K[^*]+(?=\*\* \|)' || true)

    # Regression guard: verify no policy/label-table rows leaked into agent name extraction
    local non_agent_patterns="Active subagents per phase|Concurrent writers per wave|Remaining capacity|Write territory overlap|Fast|Premium|Terra|Transport name|Catalog name|Exposed tool name"
    local leaked
    leaked=$(echo "$table_agents" | grep -E "$non_agent_patterns" || true)
    if [[ -n "$leaked" ]]; then
        fail "Parser regression" "Policy/label table rows incorrectly parsed as agent names: $(echo "$leaked" | tr '\n' ' ')"
        errors=$((errors + 1))
    else
        info "No policy-table labels leaked into agent name extraction"
    fi

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
    # ingenium-chat is a primary conversational agent, not a subagent
    local standalone_agents="ingenium-prompt-engineer ingenium-chat"

    # Check each subagent from the table (skip primary/orchestrator)
    while IFS= read -r agent; do
        [[ -z "$agent" ]] && continue

        # Skip primary agents — their job is to spawn, not be spawned
        if [[ "$agent" == "ingenium-orchestrator" || "$agent" == "ingenium-chat" ]]; then
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
# TEST 11 — Orchestration Policy: 12-Active/6-Writer + Terra Routing
# Validates the canonical concurrency policy and Terra critical
# routing are present where required and stale max-6 rules are absent.
# ═══════════════════════════════════════════════════════════
test_orchestration_policy() {
    section "TEST 11 — Orchestration Policy (12-active/6-writer + Terra routing)"

    local errors=0
    local ORCHESTRATOR="$AGENTS_DIR/primary/ingenium-orchestrator.md"
    local WORKFLOW_SOURCE="$SKILLS_DIR/engineering-workflow/references/sources/agent-workflow-patterns/source-index.md"
    local AGENT_LIMITS="$SKILLS_DIR/engineering-workflow/references/sources/agent-workflow-patterns/references/agent-limits.md"

    # ── Helper: scan a file for stale unqualified max-6-agents wording ──
    # Legitimate: "6 concurrent writers", "max 6 writers", "6-writer cap"
    # Stale:      "max 6 agents", "maximum of 6 agents", "6 concurrent agents"
    check_no_stale_max6_agents() {
        local file="$1"
        local label="$2"
        # Patterns that describe a 6-agent limit (stale — policy is now 12 agents / 6 writers).
        # These explicitly reference "agent(s)" in the limit context, not "writer(s)".
        local stale
        stale=$(grep -Pin \
            'max(imum)?\s*(of\s*)?6\s+concurrent\s+agents?\b|'\
'max(imum)?\s*(of\s*)?6\s+agents?\b(?!\s*(and|with|\/|\-)\s*\d)|'\
'\b6\s+concurrent\s+agents?\b|'\
'\b6\s+agent\s+limit\b|'\
'maximum\s+of\s+6\s+(active\s+)?agents?\s' \
            "$file" || true)
        if [[ -z "$stale" ]]; then
            pass "No stale max-6-agents language in $label"
            return 0
        else
            fail "$label" "Contains stale max-6-agents language: $stale"
            errors=$((errors + 1))
            return 1
        fi
    }

    # ── 11a: Terra is in the orchestrator task allow-list ──
    local orch_fm
    orch_fm=$(extract_frontmatter "$ORCHESTRATOR")
    local terra_allow
    terra_allow=$(echo "$orch_fm" | grep -c '"ingenium-software-engineer-terra": "allow"' || true)
    if [[ "$terra_allow" -ge 1 ]]; then
        pass "Terra is in orchestrator task allow-list"
    else
        fail "Orchestrator" "ingenium-software-engineer-terra not found in task allow-list"
        errors=$((errors + 1))
    fi

    # ── 11b: Check ALL three canonical policy sources for stale max-6-agents ──
    check_no_stale_max6_agents "$ORCHESTRATOR" "orchestrator profile"
    check_no_stale_max6_agents "$WORKFLOW_SOURCE" "workflow source-index"
    check_no_stale_max6_agents "$AGENT_LIMITS" "agent-limits.md"

    # ── 11c: agent-limits.md reference file exists ──
    if [[ -f "$AGENT_LIMITS" ]]; then
        pass "agent-limits.md reference file exists"
    else
        fail "agent-limits.md" "Missing reference file at $AGENT_LIMITS"
        errors=$((errors + 1))
    fi

    # ── 11d: Orchestrator body contains 12-active/6-writer policy ──
    local orch_body
    orch_body=$(awk '/^---$/ { count++; next } count >= 2 { print }' "$ORCHESTRATOR")
    local has_12active
    has_12active=$(echo "$orch_body" | grep -cP '12.*active.*subagents.*per.*phase|12-Active.*6-Writer|12\s*active.*per\s*phase' || true)
    local has_6writer
    has_6writer=$(echo "$orch_body" | grep -cP '6\s*-?\s*[Ww]riter|Concurrent\s+writers.*\|.*\s+6\b' || true)
    local has_territory
    has_territory=$(echo "$orch_body" | grep -ciP 'exclusive.*territor|write.*territor.*overlap|territory.*reservation' || true)

    local orch_policy_ok=true
    if [[ "$has_12active" -lt 1 ]]; then
        fail "Orchestrator" "Missing 12-active subagents policy language in body"
        errors=$((errors + 1))
        orch_policy_ok=false
    fi
    if [[ "$has_6writer" -lt 1 ]]; then
        fail "Orchestrator" "Missing 6-concurrent-writers policy language in body"
        errors=$((errors + 1))
        orch_policy_ok=false
    fi
    if [[ "$has_territory" -lt 1 ]]; then
        fail "Orchestrator" "Missing exclusive write territory language in body"
        errors=$((errors + 1))
        orch_policy_ok=false
    fi
    if $orch_policy_ok; then
        pass "Orchestrator contains 12-active/6-writer policy with territory protocol"
    fi

    # ── 11e: Orchestrator contains Terra critical routing guidance ──
    local has_terra_routing
    has_terra_routing=$(echo "$orch_body" | \
        grep -cP 'FIRST CHOICE.*auth.*secrets.*permissions|Terra.*first.*choice.*auth' || true)
    if [[ "$has_terra_routing" -ge 1 ]]; then
        pass "Orchestrator contains Terra critical routing (first choice for auth/secrets)"
    else
        fail "Orchestrator" "Missing Terra critical routing guidance (first choice for auth/secrets/permissions)"
        errors=$((errors + 1))
    fi

    # ── 11f: source-index references agent-limits.md ──
    local refs_limits
    refs_limits=$(grep -c 'references/agent-limits.md' "$WORKFLOW_SOURCE" || true)
    if [[ "$refs_limits" -ge 1 ]]; then
        pass "Workflow source-index references agent-limits.md"
    else
        fail "Workflow source-index" "Missing reference to agent-limits.md"
        errors=$((errors + 1))
    fi

    if [[ "$errors" -eq 0 ]]; then
        pass "All orchestration policy checks passed"
    fi
}

# ═══════════════════════════════════════════════════════════
# TEST 12 — Luna Visual QA Migration
# Protect the visual-QA profile, its read-only permission boundary,
# exclusive orchestrator delegation, and mandatory visual gates.
# ═══════════════════════════════════════════════════════════
test_luna_visual_qa_migration() {
    section "TEST 12 — Luna Visual QA Migration"

    local errors=0
    local vision_agent="ingenium-qa-vision"
    local legacy_agent="vision""-bridge"
    local profile="$AGENTS_DIR/execution/${vision_agent}.md"
    local legacy_profile="$AGENTS_DIR/research/${legacy_agent}.md"
    local orchestrator="$AGENTS_DIR/primary/ingenium-orchestrator.md"
    local plan_template="$REPO_ROOT/next-steps-plan/next-steps-template.md"
    local deepseek_protocol="$SKILLS_DIR/local-models/references/deep-seek.md"
    local agents_md="$REPO_ROOT/AGENTS.md"
    local agents_doc="$REPO_ROOT/docs/configure/agents.md"

    if [[ -e "$legacy_profile" ]]; then
        fail "Legacy visual profile" "Deprecated profile still exists: $legacy_profile"
        errors=$((errors + 1))
    else
        pass "Legacy visual profile is absent"
    fi

    local stale_refs
    stale_refs=$(grep -R -n -F --exclude-dir=.git "$legacy_agent" "$REPO_ROOT" || true)
    if [[ -n "$stale_refs" ]]; then
        fail "Legacy visual references" "Found stale references: $stale_refs"
        errors=$((errors + 1))
    else
        pass "No stale legacy visual references remain"
    fi

    local spaced_legacy_refs=""
    local migration_file
    for migration_file in "$profile" "$orchestrator" "$plan_template" "$deepseek_protocol"; do
        if [[ -f "$migration_file" ]]; then
            local matches
            matches=$(grep -inE 'vision[[:space:]]+bridge' "$migration_file" || true)
            if [[ -n "$matches" ]]; then
                spaced_legacy_refs="${spaced_legacy_refs}${migration_file}: ${matches}"$'\n'
            fi
        fi
    done
    if [[ -z "$spaced_legacy_refs" ]]; then
        pass "No case-insensitive spaced legacy visual references remain in migration paths"
    else
        fail "Legacy visual references" "Found spaced remnants: $spaced_legacy_refs"
        errors=$((errors + 1))
    fi

    if [[ ! -f "$profile" ]]; then
        fail "$vision_agent" "Missing profile: $profile"
        errors=$((errors + 1))
        return
    fi

    local fm
    fm=$(extract_frontmatter "$profile")
    local model
    model=$(get_field_value "$fm" "model" | tr -d '[:space:]')
    if [[ "$model" == "openai/gpt-5.6-luna" ]]; then
        pass "$vision_agent uses openai/gpt-5.6-luna"
    else
        fail "$vision_agent" "Expected model openai/gpt-5.6-luna, found '$model'"
        errors=$((errors + 1))
    fi

    local permission_checks=(
        '^  read: allow$'
        '^  glob: allow$'
        '^  grep: allow$'
        '^  playwright_\*: allow$'
        '^  edit: deny$'
        '^  write: deny$'
        '^  bash: deny$'
        '^    "\*": "deny"$'
        '^    "\*": deny$'
    )
    local missing_permission=false
    for pattern in "${permission_checks[@]}"; do
        if ! echo "$fm" | grep -qE "$pattern"; then
            missing_permission=true
            fail "$vision_agent" "Missing required permission pattern: $pattern"
            errors=$((errors + 1))
        fi
    done
    if ! $missing_permission; then
        pass "$vision_agent has the required read-only Playwright permissions"
    fi

    # OpenCode's schema permits individual permission keys in addition to
    # wildcard keys. Deny interaction and evaluation tools explicitly.
    local forbidden_playwright_tools=(
        playwright_browser_click playwright_browser_drag playwright_browser_drop
        playwright_browser_evaluate playwright_browser_file_upload playwright_browser_fill_form playwright_browser_find
        playwright_browser_handle_dialog playwright_browser_hover playwright_browser_mouse_click_xy
        playwright_browser_mouse_down playwright_browser_mouse_drag_xy playwright_browser_mouse_move_xy
        playwright_browser_mouse_up playwright_browser_mouse_wheel playwright_browser_navigate_back
        playwright_browser_press_key playwright_browser_run_code_unsafe playwright_browser_select_option
        playwright_browser_type playwright_browser_wait_for
        playwright_browser_press_sequentially playwright_browser_check playwright_browser_uncheck
        playwright_browser_keydown playwright_browser_keyup playwright_browser_cookie_clear
        playwright_browser_cookie_delete playwright_browser_cookie_set playwright_browser_cookie_get
        playwright_browser_cookie_list playwright_browser_localstorage_clear playwright_browser_localstorage_delete
        playwright_browser_localstorage_set playwright_browser_localstorage_get playwright_browser_localstorage_list
        playwright_browser_sessionstorage_clear playwright_browser_sessionstorage_delete playwright_browser_sessionstorage_set
        playwright_browser_sessionstorage_get playwright_browser_sessionstorage_list playwright_browser_set_storage_state
        playwright_browser_storage_state playwright_browser_route playwright_browser_reload
        playwright_browser_network_state_set playwright_browser_pdf_save playwright_browser_annotate
        playwright_browser_navigate_forward
    )
    local missing_denies=0
    local forbidden_tool
    for forbidden_tool in "${forbidden_playwright_tools[@]}"; do
        if ! echo "$fm" | grep -qE "^  ${forbidden_tool}: deny$"; then
            fail "$vision_agent" "Forbidden Playwright action is not explicitly denied: $forbidden_tool"
            errors=$((errors + 1))
            missing_denies=$((missing_denies + 1))
        fi
    done
    if [[ "$missing_denies" -eq 0 ]]; then
        pass "$vision_agent explicitly denies all forbidden Playwright actions"
    fi

    local denied_playwright_count
    denied_playwright_count=$(echo "$fm" | grep -cE '^  playwright_browser_.*: deny$' || true)
    if [[ "$denied_playwright_count" -ge 49 ]]; then
        pass "$vision_agent denies $denied_playwright_count Playwright actions across interaction, storage, cookie, keyboard, navigation, and form domains"
    else
        fail "$vision_agent" "Expected at least 49 explicit Playwright action denies, found $denied_playwright_count"
        errors=$((errors + 1))
    fi

    local task_block
    task_block=$(echo "$fm" | awk '/^  task:/{found=1; print; next} found && /^  [a-z]/{exit} found{print}')
    if [[ "$task_block" == $'  task:\n    "*": "deny"' ]]; then
        pass "$vision_agent task permission denies every delegation target"
    else
        fail "$vision_agent" "Task permission must contain only \"*\": \"deny\""
        errors=$((errors + 1))
    fi

    local skill
    for skill in development-conventions engineering-workflow mcp-tooling; do
        if ! echo "$fm" | grep -q "\"@${skill}\": allow"; then
            fail "$vision_agent" "Missing allowed skill @$skill"
            errors=$((errors + 1))
        fi
    done
    if echo "$fm" | grep -q '^    "\*": deny$'; then
        pass "$vision_agent denies all remaining skills"
    else
        fail "$vision_agent" "Missing deny-all skill permission"
        errors=$((errors + 1))
    fi
    local actual_skills expected_skills
    actual_skills=$(extract_skill_list "$fm" | sort)
    expected_skills=$(printf '%s\n' development-conventions engineering-workflow mcp-tooling | sort)
    if [[ "$actual_skills" == "$expected_skills" ]]; then
        pass "$vision_agent allows exactly the approved skills"
    else
        fail "$vision_agent" "Unexpected allowed skills: $actual_skills"
        errors=$((errors + 1))
    fi

    local orch_fm
    orch_fm=$(extract_frontmatter "$orchestrator")
    if echo "$orch_fm" | grep -q "\"${vision_agent}\": \"allow\""; then
        pass "Orchestrator may spawn $vision_agent"
    else
        fail "Orchestrator" "Missing task allow-list entry for $vision_agent"
        errors=$((errors + 1))
    fi

    local non_orchestrator_allows=""
    local file
    for file in $(find_agent_files); do
        [[ "$file" == "$orchestrator" ]] && continue
        if extract_frontmatter "$file" | grep -q "\"${vision_agent}\": \"allow\""; then
            non_orchestrator_allows="${non_orchestrator_allows}${file}"$'\n'
        fi
    done
    if [[ -z "$non_orchestrator_allows" ]]; then
        pass "Only the orchestrator may spawn $vision_agent"
    else
        fail "$vision_agent" "Unexpected task allow-list entries: $non_orchestrator_allows"
        errors=$((errors + 1))
    fi

    local orch_body
    orch_body=$(awk '/^---$/ { count++; next } count >= 2 { print }' "$orchestrator")
    for phrase in "mandatory changed-route visual gate" "final full-site desktop/mobile visual sweep"; do
        if echo "$orch_body" | grep -qiF "$phrase"; then
            pass "Orchestrator contains '$phrase'"
        else
            fail "Orchestrator" "Missing required visual gate phrase: $phrase"
            errors=$((errors + 1))
        fi
    done

    local architecture_diagram
    architecture_diagram=$(awk '/^## Architecture$/ { capture=1; next } capture && /^## / { exit } capture { print }' "$orchestrator")
    local per_task_line visual_gate_line deploy_line
    per_task_line=$(echo "$architecture_diagram" | grep -nF '├─► For each task:' | cut -d: -f1 | head -1 || true)
    visual_gate_line=$(echo "$architecture_diagram" | grep -nF '@ingenium-qa-vision changed-route visual gate' | cut -d: -f1 | head -1 || true)
    deploy_line=$(echo "$architecture_diagram" | grep -nF 'Deploy + health verification' | cut -d: -f1 | head -1 || true)
    if [[ -n "$per_task_line" && -n "$visual_gate_line" && -n "$deploy_line" \
        && "$visual_gate_line" -gt "$per_task_line" && "$visual_gate_line" -gt "$deploy_line" ]]; then
        pass "Orchestrator diagram places the changed-route visual gate after per-task QA/test and deploy/health verification"
    else
        fail "Orchestrator" "Architecture diagram must place the changed-route visual gate after the per-task block and deploy/health verification"
        errors=$((errors + 1))
    fi

    local vision_body
    vision_body=$(awk '/^---$/ { count++; next } count >= 2 { print }' "$profile")
    local vision_policy_phrases=(
        'http://localhost:3000'
        'http://localhost:4097'
        'about:blank'
        'browser_evaluate'
        'BLOCKED — sensitive content'
        '/secrets'
        '/config'
        'Settings **Providers**'
        '**Config** tabs'
        'email bodies or attachments'
        'private message contents'
    )
    local missing_vision_policy=0
    local phrase
    for phrase in "${vision_policy_phrases[@]}"; do
        if ! echo "$vision_body" | grep -qF "$phrase"; then
            fail "$vision_agent" "Missing passive/sensitive-data policy phrase: $phrase"
            errors=$((errors + 1))
            missing_vision_policy=$((missing_vision_policy + 1))
        fi
    done
    if [[ "$missing_vision_policy" -eq 0 ]]; then
        pass "$vision_agent contains localhost-only and sensitive-page rules"
    fi

    local forbidden_body_actions='evaluate|type/fill|click|press keys|hover|drag/drop/upload|mouse controls|dialogs|select options'
    if echo "$vision_body" | grep -qiE "$forbidden_body_actions"; then
        pass "$vision_agent body explicitly prohibits interactive Playwright actions"
    else
        fail "$vision_agent" "Missing explicit body prohibition for interactive Playwright actions"
        errors=$((errors + 1))
    fi

    local restart_file
    for restart_file in "$agents_md" "$agents_doc"; do
        if grep -qiE 'After an OpenCode restart.*known non-sensitive dashboard state' "$restart_file" \
            && grep -qiE 'BLOCKED.*stop and reconfigure.*not a pass' "$restart_file"; then
            pass "Restart/smoke gate present in $(basename "$restart_file")"
        else
            fail "Restart/smoke gate" "Missing required Luna restart/smoke language in $restart_file"
            errors=$((errors + 1))
        fi
    done

    local docs_table
    docs_table=$(awk '
        /^## Agent Table$/ { capture=1; next }
        capture && /^---$/ { exit }
        capture { print }
    ' "$agents_doc")
    local docs_agent_count
    docs_agent_count=$(echo "$docs_table" | grep -cP '^\| \*\*[^*]+\*\* \|' || true)
    if [[ "$docs_agent_count" -eq 13 ]]; then
        pass "docs/configure/agents.md lists 13 public agents"
    else
        fail "docs/configure/agents.md" "Expected 13 public agents in Agent Table, found $docs_agent_count"
        errors=$((errors + 1))
    fi

    if [[ "$errors" -eq 0 ]]; then
        pass "Luna visual QA migration checks passed"
    fi
}
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
    test_orchestration_policy
    test_luna_visual_qa_migration

    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Results: $(green "$PASSED passed"), $(red "$FAILED failed")"
    echo "═══════════════════════════════════════════════════════"

    if $TEST_FAILED; then
        exit 1
    fi
}

main "$@"
