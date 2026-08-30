#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
OBSERVATIONS_FILE="$REPO_ROOT/.opencode/skills/observations.md"
SKILLS_DIR="$REPO_ROOT/.opencode/skills"
ROADMAP_FILE="$REPO_ROOT/docs/reference/ROADMAP.md"
REFERENCE_INDEX_FILE="$REPO_ROOT/docs/reference/index.md"
ARCHIVE_ROADMAP_FILE="$REPO_ROOT/docs/reference/archive/ROADMAP-2026-07-31-phase-0.md"
ARCHIVE_CHECKSUM_FILE="$ARCHIVE_ROADMAP_FILE.sha256"
ARCHIVE_INDEX_FILE="$REPO_ROOT/docs/reference/archive/index.md"

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

validate_roadmap_markers() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        fail "ROADMAP.md — file not found: $file"
        return 1
    fi

    local task_heading_lines marker_lines evidence_lines
    task_heading_lines=$(awk '
        /^```/ { in_fence = !in_fence; next }
        in_fence { next }
        /^#### [A-Z][A-Z0-9]*-[0-9]{3} — .+$/ {
            heading = $0
            sub(/^#### /, "", heading)
            sub(/ — .*/, "", heading)
            print heading
        }
    ' "$file" || true)
    if [[ -z "$task_heading_lines" ]]; then
        fail "ROADMAP.md — no canonical task headings found (expected #### ID — Title)"
        return 1
    fi

    declare -A known_ids=()
    local task
    while IFS= read -r task; do
        if [[ -n "${known_ids[$task]+x}" ]]; then
            fail "ROADMAP.md — duplicate canonical task heading ID: $task"
            return 1
        fi
        known_ids[$task]=1
    done <<<"$task_heading_lines"

    marker_lines=$(awk '
        /^```/ { in_fence = !in_fence; next }
        in_fence { next }
        /^### Historical work marker log$/ { in_log=1; historical=1; next }
        /^### Work marker log( \(continued\))?$/ { in_log=1; historical=0; next }
        /^### / { in_log=0; historical=0 }
        /<!--/ && !in_log { print "__MARKER_OUTSIDE_APPROVED_LOG__"; next }
        in_log && !historical && /<!--/ { print NR "\t" $0 }
    ' "$file" || true)
    if [[ "$marker_lines" == *"__MARKER_OUTSIDE_APPROVED_LOG__"* ]]; then
        fail "ROADMAP.md — work marker is outside an approved marker-log heading"
        return 1
    fi

    local id_pattern='[A-Z][A-Z0-9]*-[0-9]{3}'
    local timestamp_pattern='[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z'
    local marker_pattern="^<!-- \\(work-(started|complete)\\) ($id_pattern) ($timestamp_pattern) ([^[:space:]]+) -->$"
    local supersession_pattern="^<!-- roadmap:supersede task=($id_pattern) kind=work-complete original=($timestamp_pattern) replacement=($timestamp_pattern) reason=clock-skew -->$"
    declare -A active_ids=()
    declare -A completed_ids=()
    declare -A evidence_ids=()
    declare -A superseded_original_timestamps=()
    declare -A superseded_replacement_timestamps=()
    declare -A supersession_declaration_lines=()
    declare -A completion_counts=()
    declare -A completion_lines=()
    declare -A start_timestamps=()
    declare -A start_lines=()
    local evidence_pattern
    evidence_pattern="^Evidence ($id_pattern):[[:space:]]+.+$"
    local line_with_number line_number line kind task timestamp actor
    local original_timestamp replacement_timestamp completion_key completion_count

    # Supersession declarations are pre-scanned so only the exact referenced
    # completion can be ignored during the append-only state walk.
    if [[ -n "$marker_lines" ]]; then
        while IFS= read -r line_with_number; do
            line_number="${line_with_number%%$'\t'*}"
            line="${line_with_number#*$'\t'}"
            if [[ "$line" =~ $supersession_pattern ]]; then
                task="${BASH_REMATCH[1]}"
                original_timestamp="${BASH_REMATCH[2]}"
                replacement_timestamp="${BASH_REMATCH[3]}"
                if [[ -z "${known_ids[$task]+x}" ]]; then
                    fail "ROADMAP.md — unknown supersession task ID: $task"
                    return 1
                fi
                if [[ -n "${superseded_original_timestamps[$task]+x}" ]]; then
                    fail "ROADMAP.md — duplicate supersession declaration: $task"
                    return 1
                fi
                if [[ "$original_timestamp" == "$replacement_timestamp" ]]; then
                    fail "ROADMAP.md — supersession must name distinct original and replacement timestamps: $task"
                    return 1
                fi
                superseded_original_timestamps["$task"]="$original_timestamp"
                superseded_replacement_timestamps["$task"]="$replacement_timestamp"
                supersession_declaration_lines["$task"]="$line_number"
            elif [[ ! "$line" =~ $marker_pattern ]]; then
                fail "ROADMAP.md — malformed work marker: $line"
                return 1
            fi
        done <<<"$marker_lines"
    fi

    # Collect marker occurrences before applying state transitions. This makes
    # missing, duplicate, cross-task, and out-of-order supersessions fail closed.
    if [[ -n "$marker_lines" ]]; then
        while IFS= read -r line_with_number; do
            line_number="${line_with_number%%$'\t'*}"
            line="${line_with_number#*$'\t'}"
            if [[ ! "$line" =~ $marker_pattern ]]; then
                continue
            fi
            kind="(work-${BASH_REMATCH[1]})"
            task="${BASH_REMATCH[2]}"
            timestamp="${BASH_REMATCH[3]}"
            if [[ "$kind" == "(work-started)" ]]; then
                if [[ -z "${start_timestamps[$task]+x}" ]]; then
                    start_timestamps["$task"]="$timestamp"
                    start_lines["$task"]="$line_number"
                fi
            else
                completion_key="$task|$timestamp"
                completion_count="${completion_counts[$completion_key]:-0}"
                completion_counts["$completion_key"]=$((completion_count + 1))
                completion_lines["$completion_key"]="$line_number"
            fi
        done <<<"$marker_lines"
    fi

    local superseded_task original_key replacement_key original_line replacement_line start_timestamp start_line
    for superseded_task in "${!superseded_original_timestamps[@]}"; do
        original_timestamp="${superseded_original_timestamps[$superseded_task]}"
        replacement_timestamp="${superseded_replacement_timestamps[$superseded_task]}"
        original_key="$superseded_task|$original_timestamp"
        replacement_key="$superseded_task|$replacement_timestamp"
        if [[ "${completion_counts[$original_key]:-0}" -ne 1 ]]; then
            fail "ROADMAP.md — supersession original completion must exist exactly once: $superseded_task"
            return 1
        fi
        if [[ "${completion_counts[$replacement_key]:-0}" -ne 1 ]]; then
            fail "ROADMAP.md — supersession replacement completion must exist exactly once: $superseded_task"
            return 1
        fi
        original_line="${completion_lines[$original_key]}"
        replacement_line="${completion_lines[$replacement_key]}"
        if [[ -z "${start_timestamps[$superseded_task]+x}" ]]; then
            fail "ROADMAP.md — supersession task has no start marker: $superseded_task"
            return 1
        fi
        start_timestamp="${start_timestamps[$superseded_task]}"
        start_line="${start_lines[$superseded_task]}"
        if [[ ! "$replacement_timestamp" > "$start_timestamp" ]]; then
            fail "ROADMAP.md — supersession replacement timestamp must be after task start: $superseded_task"
            return 1
        fi
        if (( original_line <= start_line || original_line >= replacement_line )); then
            fail "ROADMAP.md — supersession completion order is invalid: $superseded_task"
            return 1
        fi
        if (( ${supersession_declaration_lines[$superseded_task]} <= replacement_line )); then
            fail "ROADMAP.md — supersession declaration must follow replacement completion: $superseded_task"
            return 1
        fi
    done

    if [[ -n "$marker_lines" ]]; then
        while IFS= read -r line_with_number; do
            line="${line_with_number#*$'\t'}"
            [[ "$line" =~ $marker_pattern ]] || continue
            kind="(work-${BASH_REMATCH[1]})"
            task="${BASH_REMATCH[2]}"
            timestamp="${BASH_REMATCH[3]}"
            actor="${BASH_REMATCH[4]}"
            if [[ -z "${known_ids[$task]+x}" ]]; then
                fail "ROADMAP.md — unknown work marker ID: $task"
                return 1
            fi
            if [[ "$kind" != "(work-started)" && "$kind" != "(work-complete)" ]]; then
                fail "ROADMAP.md — malformed work marker: $line"
                return 1
            fi
            if [[ "$kind" == "(work-started)" ]]; then
                if [[ -n "${active_ids[$task]+x}" ]]; then
                    fail "ROADMAP.md — task has duplicate active start marker: $task"
                    return 1
                fi
                if [[ -n "${completed_ids[$task]+x}" ]]; then
                    fail "ROADMAP.md — task restarted after completion: $task"
                    return 1
                fi
                active_ids[$task]=1
            else
                if [[ -n "${superseded_original_timestamps[$task]+x}" ]] &&
                    [[ "$timestamp" == "${superseded_original_timestamps[$task]}" ]]; then
                    continue
                fi
                if [[ -z "${active_ids[$task]+x}" ]]; then
                    fail "ROADMAP.md — completion marker has no matching active start: $line"
                    return 1
                fi
                unset 'active_ids[$task]'
                completed_ids[$task]=1
            fi
        done <<<"$marker_lines"
    fi

    evidence_lines=$(awk '
        /^```/ { in_fence = !in_fence; next }
        in_fence { next }
        /^### Historical work marker log$/ { in_log=1; historical=1; next }
        /^### Work marker log( \(continued\))?$/ { in_log=1; historical=0; next }
        /^### / { in_log=0; historical=0 }
        in_log && !historical && /^Evidence / { print }
    ' "$file" || true)
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        if [[ ! "$line" =~ $evidence_pattern ]]; then
            fail "ROADMAP.md — malformed implementation evidence: $line"
            return 1
        fi
        task="${BASH_REMATCH[1]}"
        if [[ -z "${known_ids[$task]+x}" ]]; then
            fail "ROADMAP.md — unknown evidence ID: $task"
            return 1
        fi
        evidence_ids[$task]=1
    done <<<"$evidence_lines"

    for task in "${!completed_ids[@]}"; do
        if [[ -z "${evidence_ids[$task]+x}" ]]; then
            fail "ROADMAP.md — completed task has no implementation evidence: $task"
            return 1
        fi
    done
    if [[ -z "$marker_lines" && -z "$evidence_lines" ]]; then
        pass "ROADMAP.md has canonical task IDs and no work markers yet (valid baseline state)"
    else
        pass "ROADMAP.md work markers are append-only with independent active tasks"
    fi
}

test_roadmap_marker_protocol() {
    if [[ ! -f "$ROADMAP_FILE" ]]; then
        fail "ROADMAP.md — file not found: $ROADMAP_FILE"
        return 1
    fi
    if [[ -e "$REPO_ROOT/docs/reference/roadmap.md" ]]; then
        fail "ROADMAP.md — lowercase duplicate roadmap path exists"
        return 1
    fi
    if ! validate_roadmap_markers "$ROADMAP_FILE"; then
        return 1
    fi
    pass "ROADMAP.md has canonical casing and valid append-only markers"
}

test_roadmap_index_link() {
    local expected='| [Roadmap](./ROADMAP.md) | Canonical execution-ready roadmap contracts, gates, dependencies, and work-marker protocol |'
    if [[ ! -f "$REFERENCE_INDEX_FILE" ]]; then
        fail "reference index — file not found: $REFERENCE_INDEX_FILE"
        return 1
    fi
    if grep -Fqx "$expected" "$REFERENCE_INDEX_FILE"; then
        pass "Reference index links the canonical ./ROADMAP.md path"
        return 0
    fi
    fail "Reference index does not link the canonical ./ROADMAP.md path"
    return 1
}

test_roadmap_archive_contract() {
    if [[ ! -f "$ARCHIVE_ROADMAP_FILE" ]]; then
        fail "ROADMAP archive — exact archive path is missing: $ARCHIVE_ROADMAP_FILE"
        return 1
    fi
    if [[ ! -f "$ARCHIVE_CHECKSUM_FILE" ]]; then
        fail "ROADMAP archive — sidecar checksum is missing: $ARCHIVE_CHECKSUM_FILE"
        return 1
    fi
    if [[ ! -f "$ARCHIVE_INDEX_FILE" ]]; then
        fail "ROADMAP archive — archive index is missing: $ARCHIVE_INDEX_FILE"
        return 1
    fi

    local actual_hash expected_hash
    actual_hash=$(sha256sum "$ARCHIVE_ROADMAP_FILE" | awk '{ print $1 }')
    expected_hash=$(awk 'NF { print $1; exit }' "$ARCHIVE_CHECKSUM_FILE")
    if [[ ! "$expected_hash" =~ ^[[:xdigit:]]{64}$ ]]; then
        fail "ROADMAP archive — sidecar does not contain a SHA-256 checksum"
        return 1
    fi
    if [[ "${actual_hash,,}" != "${expected_hash,,}" ]]; then
        fail "ROADMAP archive — sidecar checksum does not match the archive"
        return 1
    fi
    if ! grep -Eq '^[[:xdigit:]]{64}[[:space:]]+(.*/)?ROADMAP-2026-07-31-phase-0\.md$' "$ARCHIVE_CHECKSUM_FILE"; then
        fail "ROADMAP archive — sidecar does not name the exact archived roadmap"
        return 1
    fi
    if ! grep -Fq '](./ROADMAP-2026-07-31-phase-0.md)' "$ARCHIVE_INDEX_FILE"; then
        fail "ROADMAP archive — archive index does not link the exact archived roadmap"
        return 1
    fi
    if ! grep -Fq '](./ROADMAP-2026-07-31-phase-0.md.sha256)' "$ARCHIVE_INDEX_FILE"; then
        fail "ROADMAP archive — archive index does not link the checksum sidecar"
        return 1
    fi
    if ! grep -Fq '](./archive/ROADMAP-2026-07-31-phase-0.md)' "$REFERENCE_INDEX_FILE"; then
        fail "ROADMAP archive — canonical reference index does not link the exact archive"
        return 1
    fi
    if ! grep -Fq '](./archive/index.md)' "$REFERENCE_INDEX_FILE"; then
        fail "ROADMAP archive — canonical reference index does not link the archive index"
        return 1
    fi
    pass "ROADMAP archive has the exact path, matching sidecar checksum, and index links"
}

test_roadmap_marker_parser_cases() {
    local tmp
    tmp=$(mktemp -d)
    trap 'rm -rf "${tmp:-}"' RETURN
    local valid='#### BUG-000 — Fixture task
### Work marker log
<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->
<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->
Evidence BUG-000: implementation tests passed'
    printf '%s\n' "$valid" >"$tmp/valid.md"
    if ! validate_roadmap_markers "$tmp/valid.md"; then fail "marker parser rejected valid pair"; return 1; fi
    printf '#### BUG-000 — Clock-skew fixture\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2025-12-31T23:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2025-12-31T23:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: authoritative replacement implementation tests passed\n' >"$tmp/duplicate-clock-skew.md"
    if ! validate_roadmap_markers "$tmp/duplicate-clock-skew.md"; then fail "marker parser rejected clock-skew completion supersession"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent name -->\n' >"$tmp/malformed.md"
    if validate_roadmap_markers "$tmp/malformed.md" >/dev/null 2>&1; then fail "marker parser accepted malformed marker"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n' >"$tmp/ordering.md"
    if validate_roadmap_markers "$tmp/ordering.md" >/dev/null 2>&1; then fail "marker parser accepted out-of-order markers"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\n<!-- (work-started) BUG-999 2026-01-01T00:00:00Z agent-name -->\n' >"$tmp/unknown.md"
    if validate_roadmap_markers "$tmp/unknown.md" >/dev/null 2>&1; then fail "marker parser accepted unknown ID"; return 1; fi
    printf '#### BUG-003 — Parallel task A\n#### BUG-004 — Parallel task B\n### Work marker log\n<!-- (work-started) BUG-003 2026-01-01T00:00:00Z agent-a -->\n<!-- (work-started) BUG-004 2026-01-01T00:00:01Z agent-b -->\n<!-- (work-complete) BUG-004 2026-01-01T01:00:00Z agent-b -->\n<!-- (work-complete) BUG-003 2026-01-01T01:00:01Z agent-a -->\nEvidence BUG-003: implementation tests passed\nEvidence BUG-004: implementation tests passed\n' >"$tmp/parallel.md"
    if ! validate_roadmap_markers "$tmp/parallel.md"; then fail "marker parser rejected independent parallel starts"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:01Z agent-name -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/duplicate-complete.md"
    if validate_roadmap_markers "$tmp/duplicate-complete.md" >/dev/null 2>&1; then fail "marker parser accepted duplicate completion"; return 1; fi
    printf '#### BUG-000 — Fixture task\n#### BUG-001 — Continued task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\nEvidence BUG-000: implementation tests passed\n### Work marker log (continued)\n<!-- (work-started) BUG-001 2026-01-01T02:00:00Z agent-name -->\n' >"$tmp/continued.md"
    if ! validate_roadmap_markers "$tmp/continued.md"; then fail "marker parser rejected a continued marker log"; return 1; fi
    printf '#### BUG-000 — Fixture task\n#### BUG-001 — Outside task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n### Other heading\n<!-- (work-started) BUG-001 2026-01-01T02:00:00Z agent-name -->\n' >"$tmp/outside-heading.md"
    if validate_roadmap_markers "$tmp/outside-heading.md" >/dev/null 2>&1; then fail "marker parser accepted marker outside approved heading"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n### Work marker log (continued)\n<!-- (work-started) BUG-000 2026-01-01T02:00:00Z agent-name -->\n' >"$tmp/restart.md"
    if validate_roadmap_markers "$tmp/restart.md" >/dev/null 2>&1; then fail "marker parser accepted restart after completion"; return 1; fi
    printf '#### BUG-000 — Supersession abuse\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-started original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-start.md"
    if validate_roadmap_markers "$tmp/supersede-start.md" >/dev/null 2>&1; then fail "marker parser accepted start supersession"; return 1; fi
    printf '#### BUG-000 — Evidence supersession abuse\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=evidence original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-evidence.md"
    if validate_roadmap_markers "$tmp/supersede-evidence.md" >/dev/null 2>&1; then fail "marker parser accepted evidence supersession"; return 1; fi
    printf '#### BUG-000 — Missing replacement\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-missing.md"
    if validate_roadmap_markers "$tmp/supersede-missing.md" >/dev/null 2>&1; then fail "marker parser accepted missing supersession replacement"; return 1; fi
    printf '#### BUG-000 — Missing authoritative evidence\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\n' >"$tmp/supersede-no-evidence.md"
    if validate_roadmap_markers "$tmp/supersede-no-evidence.md" >/dev/null 2>&1; then fail "marker parser accepted supersession without authoritative evidence"; return 1; fi
    printf '#### BUG-000 — Mismatch task\n#### BUG-001 — Other task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-started) BUG-001 2026-01-01T00:30:00Z agent-name -->\n<!-- (work-complete) BUG-001 2026-01-01T02:00:00Z other-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\nEvidence BUG-001: implementation tests passed\n' >"$tmp/supersede-mismatch.md"
    if validate_roadmap_markers "$tmp/supersede-mismatch.md" >/dev/null 2>&1; then fail "marker parser accepted cross-task supersession"; return 1; fi
    printf '#### BUG-000 — Declaration order\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-order.md"
    if validate_roadmap_markers "$tmp/supersede-order.md" >/dev/null 2>&1; then fail "marker parser accepted supersession declaration before replacement"; return 1; fi
    printf '#### BUG-000 — Timestamp order\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T02:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T03:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T03:00:00Z replacement=2026-01-01T01:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-timestamp-order.md"
    if validate_roadmap_markers "$tmp/supersede-timestamp-order.md" >/dev/null 2>&1; then fail "marker parser accepted replacement timestamp before task start"; return 1; fi
    printf '#### BUG-000 — Duplicate declaration\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-duplicate.md"
    if validate_roadmap_markers "$tmp/supersede-duplicate.md" >/dev/null 2>&1; then fail "marker parser accepted duplicate supersession declarations"; return 1; fi
    printf '#### BUG-000 — Malformed declaration\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-000 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=manual -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-malformed.md"
    if validate_roadmap_markers "$tmp/supersede-malformed.md" >/dev/null 2>&1; then fail "marker parser accepted non-allowlisted supersession reason"; return 1; fi
    printf '#### BUG-000 — Unknown declaration task\n### Work marker log\n<!-- (work-started) BUG-000 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T01:00:00Z agent-name -->\n<!-- (work-complete) BUG-000 2026-01-01T02:00:00Z replacement-agent -->\n<!-- roadmap:supersede task=BUG-999 kind=work-complete original=2026-01-01T01:00:00Z replacement=2026-01-01T02:00:00Z reason=clock-skew -->\nEvidence BUG-000: implementation tests passed\n' >"$tmp/supersede-unknown.md"
    if validate_roadmap_markers "$tmp/supersede-unknown.md" >/dev/null 2>&1; then fail "marker parser accepted unknown supersession task"; return 1; fi
    printf '#### DOC-100 — Validator coverage\n### Work marker log\n<!-- (work-started) DOC-100 2026-01-01T00:00:00Z agent-name -->\n<!-- (work-complete) DOC-100 2026-01-01T01:00:00Z agent-name -->\nEvidence DOC-100: validator tests passed\n' >"$tmp/doc-100.md"
    if ! validate_roadmap_markers "$tmp/doc-100.md"; then fail "marker parser rejected DOC-100"; return 1; fi
    printf '#### DOC-100 — First title\n#### DOC-100 — Duplicate title\n' >"$tmp/duplicate-heading.md"
    if validate_roadmap_markers "$tmp/duplicate-heading.md" >/dev/null 2>&1; then fail "marker parser accepted duplicate canonical heading ID"; return 1; fi
    printf '### Work marker log\n' >"$tmp/no-ids.md"
    if validate_roadmap_markers "$tmp/no-ids.md" >/dev/null 2>&1; then fail "marker parser accepted a roadmap with no canonical IDs"; return 1; fi
    printf '#### BUG-000 — Fixture task\n### Work marker log\nEvidence BUG-999: unknown evidence\n' >"$tmp/unknown-evidence.md"
    if validate_roadmap_markers "$tmp/unknown-evidence.md" >/dev/null 2>&1; then fail "marker parser accepted unknown evidence ID"; return 1; fi
    mkdir -p "$tmp/archive"
    printf '#### ARCHIVE-001 — Archived-only task\n' >"$tmp/archive/ROADMAP-2026-07-31-phase-0.md"
    printf '#### DOC-100 — Current task\n### Work marker log\n<!-- (work-started) ARCHIVE-001 2026-01-01T00:00:00Z agent-name -->\n' >"$tmp/archive-only.md"
    if validate_roadmap_markers "$tmp/archive-only.md" >/dev/null 2>&1; then fail "marker parser accepted ID defined only in the archive"; return 1; fi
    pass "Marker parser accepts valid/parallel/continued/DOC-100/clock-skew fixtures and rejects malformed, abuse, missing, mismatch, ordering, duplicate, restart, unknown, duplicate-heading, and archive-only cases"
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
    test_roadmap_marker_protocol || ((failures++))
    test_roadmap_index_link || ((failures++))
    test_roadmap_archive_contract || ((failures++))
    test_roadmap_marker_parser_cases || ((failures++))

    echo ""
    echo "========================================"
    echo "Tests complete: $failures failure(s)"
    echo "========================================"

    return "$failures"
}

run_all_tests
