#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_PROFILE="${ORCHESTRATOR_PROFILE:-$REPO_ROOT/.opencode/agents/primary/ingenium-orchestrator.md}"
AGENTS_FILE="${AGENTS_FILE:-$REPO_ROOT/AGENTS.md}"
MAX_ACTIVE_SUBAGENTS=6
MAX_CONCURRENT_WRITERS=3
MAX_CONCURRENT_TODOS=3
AGENTS_PER_TODO=2
FAILED=0
POLICY_FIXTURE_DIR=""

cleanup_policy_fixtures() {
    if [[ -n "$POLICY_FIXTURE_DIR" && -d "$POLICY_FIXTURE_DIR" ]]; then
        rm -rf "$POLICY_FIXTURE_DIR"
    fi
}

trap cleanup_policy_fixtures EXIT

pass() {
    if [[ "${SCHEDULER_POLICY_QUIET:-0}" != 1 ]]; then
        printf 'PASS: %s\n' "$1"
    fi
}

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    FAILED=1
}

source_label() {
    local source="$1"
    if [[ "$source" == "$REPO_ROOT/"* ]]; then
        printf '%s' "${source#"$REPO_ROOT/"}"
    else
        printf '%s' "$source"
    fi
}

normalize_source() {
    tr '\n' ' ' < "$1" | tr -s '[:space:]' ' '
}

check_normalized_pattern() {
    local source="$1"
    local label="$2"
    local pattern="$3"
    local description="$4"
    local normalized

    normalized="$(normalize_source "$source" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized" =~ $pattern ]]; then
        pass "$label contains $description"
    else
        fail "$(source_label "$source") is missing $description"
    fi
}

check_independent_stream_enumeration() {
    local source="$1"
    local label="$2"

    if awk '
        function finish_stream_block() {
            if (!in_stream_block) return
            if (inline_entries >= 2 || bullet_entries >= 2 ||
                inline_entries + bullet_entries >= 2) enumerated = 1
            inline_entries = 0
            bullet_entries = 0
            in_stream_block = 0
        }

        function count_inline_entries(text,    count, item_index, item) {
            count = split(text, items, /;/)
            for (item_index = 1; item_index <= count; item_index++) {
                item = items[item_index]
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", item)
                if (item ~ /[[:alnum:]]/) inline_entries++
            }
        }

        function start_stream_block(remainder) {
            finish_stream_block()
            found = 1
            in_stream_block = 1
            remainder = $0
            sub(/^[^:]*:[[:space:]]*/, "", remainder)
            if (remainder !~ /^[[:space:]]*$/) count_inline_entries(remainder)
        }

        {
            lower = tolower($0)
            if (lower ~ /^[[:space:]]*independent(([[:space:]-]+work)?[[:space:]-]+streams?|[[:space:]-]+todowrite[[:space:]-]+items?)[[:space:]]*:/) {
                start_stream_block()
                next
            }

            if (!in_stream_block) next
            if ($0 ~ /^[[:space:]]*$/ ||
                $0 ~ /^[[:space:]]*(Phase:|Verification phase|##|UNUSED_CAPACITY)/) {
                finish_stream_block()
                next
            }
            if ($0 ~ /^[[:space:]]*[-*+][[:space:]]+/ ||
                $0 ~ /^[[:space:]]*[0-9]+[.)][[:space:]]+/) {
                bullet_entries++
            }
        }

        END {
            finish_stream_block()
            exit(found && enumerated ? 0 : 1)
        }
    ' "$source"; then
        pass "$label enumerates at least two independent streams"
    else
        fail "$(source_label "$source") must label independent streams and enumerate at least two non-empty entries"
    fi
}

check_capacity_blocks() {
    local source="$1"
    local label="$2"

    if awk '
        function finish_capacity_block() {
            if (!in_capacity_block) return
            if (capacity_is_empty) {
                valid_blocks++
            } else if (slot_entries == 0) {
                invalid_blocks++
            } else if (invalid_reason || reason_entries != slot_entries) {
                invalid_blocks++
            } else {
                valid_blocks++
            }
            in_capacity_block = 0
            capacity_is_empty = 0
            slot_entries = 0
            reason_entries = 0
            invalid_reason = 0
        }

        {
            lower = tolower($0)
            if (lower ~ /unused_capacity[[:space:]]*:/) {
                finish_capacity_block()
                found_marker = 1
                in_capacity_block = 1
                capacity_is_empty = lower ~ /unused_capacity[[:space:]]*:[[:space:]]*none[[:space:]]*$/
                next
            }

            if (!in_capacity_block) next
            if ($0 ~ /^[[:space:]]*$/ ||
                $0 ~ /^[[:space:]]*(Phase:|Verification phase|##|###|GOOD|BAD)/) {
                finish_capacity_block()
                next
            }

            if (lower ~ /^[[:space:]]*(active|writer)[[:space:]-]+slots?[[:space:]]*/) {
                if (lower ~ /none[[:space:]]*$/) next
                slot_entries++
                if (lower ~ /(token|turn[[:space:]-]+pressure|cost|convenience|task[[:space:]]+is[[:space:]]+simple|waiting[[:space:]]+for[[:space:]]+the[[:space:]]+user|waiting[[:space:]]+for[[:space:]]+user)/) {
                    invalid_reason = 1
                }
                if (lower ~ /(depend|territory|overlap|conflict|unavailable|matching[[:space:]-]+role|premature|review[[:space:]-]+only|read[[:space:]-]+only|no[[:space:]]+other|no[[:space:]]+(implementation|remediation)|reserved[[:space:]]+for)/) {
                    reason_entries++
                }
            }
        }

        END {
            finish_capacity_block()
            exit(found_marker && invalid_blocks == 0 && valid_blocks > 0 ? 0 : 1)
        }
    ' "$source"; then
        pass "$label uses per-slot UNUSED_CAPACITY entries with concrete allowed reasons"
    else
        fail "$(source_label "$source") must justify every non-empty UNUSED_CAPACITY slot with one allowed dependency, territory, availability, or review reason (and no invalid reason)"
    fi
}

check_full_phase_example() {
    local source="$1"
    local label="$2"

    if awk '
        function finish_phase() {
            if (in_full_phase && dispatch_lines >= 6 && has_empty_capacity) found = 1
        }

        {
            lower = tolower($0)
            if (lower ~ /^[[:space:]]*(phase:|good|verification phase)/) {
                finish_phase()
                in_full_phase = 0
                dispatch_lines = 0
                has_empty_capacity = 0
                if (lower ~ /(^|[^0-9])6[[:space:]-]+active/ &&
                    lower ~ /(^|[^0-9])3[[:space:]-]+writers?/) {
                    in_full_phase = 1
                }
                next
            }
            if (!in_full_phase) next
            if (lower ~ /unused_capacity[[:space:]]*:[[:space:]]*none/) has_empty_capacity = 1
            if ($0 ~ /^[[:space:]]+@[^[:space:]]+/ ||
                $0 ~ /^[[:space:]]*[-*+][[:space:]]+@[^[:space:]]+/) {
                dispatch_lines++
            }
        }

        END {
            finish_phase()
            exit(found ? 0 : 1)
        }
    ' "$source"; then
        pass "$label includes a full 6-active/3-writer phase example"
    else
        fail "$(source_label "$source") must include a 6-active/3-writer example with six dispatch entries and UNUSED_CAPACITY: none"
    fi
}

check_underfilled_phase_example() {
    local source="$1"
    local label="$2"

    if awk '
        function finish_capacity() {
            if (!in_capacity) return
            if (!capacity_empty && capacity_slots > 0 &&
                capacity_reasons == capacity_slots && !capacity_invalid) {
                capacity_valid = 1
            }
            in_capacity = 0
            capacity_empty = 0
            capacity_slots = 0
            capacity_reasons = 0
            capacity_invalid = 0
        }

        function finish_phase() {
            finish_capacity()
            if (in_underfilled_phase && capacity_valid) found = 1
            in_underfilled_phase = 0
            capacity_valid = 0
        }

        {
            lower = tolower($0)
            if (lower ~ /^[[:space:]]*(phase:|good|verification phase)/) {
                finish_phase()
                in_underfilled_phase = lower ~ /(^|[^0-9])[1-5][[:space:]-]+active/
                next
            }
            if (!in_underfilled_phase) next

            if (lower ~ /unused_capacity[[:space:]]*:/) {
                finish_capacity()
                in_capacity = 1
                capacity_empty = lower ~ /unused_capacity[[:space:]]*:[[:space:]]*none[[:space:]]*$/
                next
            }
            if (!in_capacity) next
            if ($0 ~ /^[[:space:]]*$/ ||
                $0 ~ /^[[:space:]]*(Phase:|Verification phase|##|###|GOOD|BAD)/) {
                finish_capacity()
                next
            }

            if (lower ~ /^[[:space:]]*(active|writer)[[:space:]-]+slots?[[:space:]]*/) {
                if (lower ~ /none[[:space:]]*$/) next
                capacity_slots++
                if (lower ~ /(token|turn[[:space:]-]+pressure|cost|convenience|task[[:space:]]+is[[:space:]]+simple|waiting[[:space:]]+for[[:space:]]+(the[[:space:]]+)?user)/) capacity_invalid = 1
                if (lower ~ /(depend|territory|overlap|conflict|unavailable|matching[[:space:]-]+role|premature|review[[:space:]-]+only|read[[:space:]-]+only|no[[:space:]]+other|no[[:space:]]+(implementation|remediation)|reserved[[:space:]]+for)/) capacity_reasons++
            }
        }

        END {
            finish_phase()
            exit(found ? 0 : 1)
        }
    ' "$source"; then
        pass "$label includes an underfilled phase with a concrete UNUSED_CAPACITY reason"
    else
        fail "$(source_label "$source") must include an underfilled phase and a concrete reason for its unused slot"
    fi
}

check_human_readable_response_contract() {
    local source="$1"
    local label="$2"

    check_normalized_pattern "$source" "$label" \
        'plain-language[[:space:]-]+introduction|one[[:space:]]+to[[:space:]]+three[[:space:]]+plain[[:space:]]+sentences.{0,180}(goal|why).{0,120}immediate[[:space:]]+approach' \
        'a plain-language introduction'
    check_normalized_pattern "$source" "$label" \
        'plain-language[[:space:]-]+post-phase[[:space:]]+explanation|after every implementation or evidence transition.{0,240}what happened.{0,100}what changed.{0,100}(result|next dependency)' \
        'interpreted implementation/evidence transition summaries'
    check_normalized_pattern "$source" "$label" \
        'human-readable execution summary.{0,120}headings|terminal responses use.{0,220}status.{0,180}what i did.{0,180}where the proof is' \
        'terminal human-readable response headings'
    check_normalized_pattern "$source" "$label" \
        'source behavior.{0,180}(not deployed|runtime).{0,180}proof|distinguish evidence.{0,300}source tests prove.{0,300}deployed canaries prove.{0,300}actual model/session artifacts prove' \
        'the source/runtime/model proof boundary'
    check_normalized_pattern "$source" "$label" \
        'raw[[:space:]]+(subagent|agent)[[:space:]]+json.{0,120}(tool|output)|avoid raw[[:space:]]+agent[[:space:]]+json.{0,80}tool dumps|raw[[:space:]]+subagent[[:space:]]+json.{0,80}tool output' \
        'the prohibition on raw subagent/tool dumps as final responses'
    check_normalized_pattern "$source" "$label" \
        'pre-dispatch[[:space:]]+task contract|structured task contract.{0,100}mandatory' \
        'the structured task contract'
    check_normalized_pattern "$source" "$label" \
        'in_scope.{0,300}out_of_scope.{0,300}acceptance criteria.{0,300}stop_condition.{0,300}verification plan.{0,300}escalation rule' \
        'the structured task contract fields'
}

allocation_is_valid() {
    local active_count="$1"
    local writer_count="$2"
    local non_writer_count="$3"
    local available_non_writer_slots

    if ! [[ "$active_count" =~ ^[0-9]+$ &&
            "$writer_count" =~ ^[0-9]+$ &&
            "$non_writer_count" =~ ^[0-9]+$ ]]; then
        return 1
    fi

    available_non_writer_slots=$((MAX_ACTIVE_SUBAGENTS - writer_count))
    (( active_count <= MAX_ACTIVE_SUBAGENTS &&
       writer_count <= MAX_CONCURRENT_WRITERS &&
       non_writer_count <= available_non_writer_slots &&
       writer_count + non_writer_count == active_count ))
}

todo_allocation_is_valid() {
    local allocation="$1"
    local todo_agents
    local active_count=0
    local -a todo_allocations=()

    [[ "$allocation" =~ ^[0-9]+(,[0-9]+)*$ ]] || return 1
    IFS=',' read -r -a todo_allocations <<< "$allocation"
    if (( ${#todo_allocations[@]} == 0 || ${#todo_allocations[@]} > MAX_CONCURRENT_TODOS )); then
        return 1
    fi

    for todo_agents in "${todo_allocations[@]}"; do
        if (( todo_agents != AGENTS_PER_TODO )); then
            return 1
        fi
        active_count=$((active_count + todo_agents))
    done

    (( active_count <= MAX_ACTIVE_SUBAGENTS ))
}

structural_todo_allocation_is_valid() {
    local fixture="$1"

    printf '%s\n' "$fixture" | awk -F'|' \
        -v max_active="$MAX_ACTIVE_SUBAGENTS" \
        -v max_writers="$MAX_CONCURRENT_WRITERS" \
        -v max_todos="$MAX_CONCURRENT_TODOS" \
        -v agents_per_todo="$AGENTS_PER_TODO" '
        function trim(value) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            return value
        }

        function finish_pair() {
            if (!in_pair) {
                valid = 0
                return
            }
            if (pair_agents != agents_per_todo || pair_dependencies != 1 ||
                pair_territories != pair_writers) valid = 0
            in_pair = 0
        }

        function territories_overlap(left, right) {
            return left == right || index(left, right "/") == 1 ||
                index(right, left "/") == 1
        }

        BEGIN { valid = 1 }

        /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }

        {
            record = trim($1)

            if (record == "TODO_PAIR") {
                if (in_pair) {
                    valid = 0
                    finish_pair()
                }
                pair_name = trim($2)
                if (NF != 2 || pair_name == "" || seen_todo[pair_name]++) valid = 0
                pair_count++
                pair_agents = 0
                pair_writers = 0
                pair_dependencies = 0
                pair_territories = 0
                in_pair = 1
                next
            }

            if (record == "AGENT") {
                agent = trim($2)
                role = trim($3)
                key = pair_count SUBSEP agent
                if (!in_pair || NF != 3 || agent == "" ||
                    (role != "writer" && role != "read-only") || seen_agent[key]++) {
                    valid = 0
                    next
                }
                agent_role[key] = role
                pair_agents++
                active_count++
                if (role == "writer") {
                    pair_writers++
                    writer_count++
                }
                next
            }

            if (record == "DEPENDENCY") {
                dependency = trim($2)
                if (!in_pair || NF != 2 || dependency == "") valid = 0
                pair_dependencies++
                next
            }

            if (record == "TERRITORY") {
                agent = trim($2)
                territory = trim($3)
                gsub(/\/+$/, "", territory)
                key = pair_count SUBSEP agent
                if (!in_pair || NF != 3 || territory == "" ||
                    agent_role[key] != "writer" || declared_territory[key]++) {
                    valid = 0
                    next
                }
                for (index_value = 1; index_value <= territory_count; index_value++) {
                    if (territories_overlap(territory, territories[index_value])) valid = 0
                }
                territories[++territory_count] = territory
                pair_territories++
                next
            }

            if (record == "END_TODO_PAIR") {
                if (NF != 1) valid = 0
                finish_pair()
                next
            }

            if (record == "TOTALS") {
                declared_todos = trim($2)
                declared_active = trim($3)
                declared_writers = trim($4)
                if (in_pair || NF != 4 || totals_seen++ ||
                    declared_todos !~ /^[0-9]+$/ ||
                    declared_active !~ /^[0-9]+$/ ||
                    declared_writers !~ /^[0-9]+$/) valid = 0
                next
            }

            valid = 0
        }

        END {
            if (in_pair) {
                valid = 0
                finish_pair()
            }
            if (totals_seen != 1 || pair_count < 1 || pair_count > max_todos ||
                active_count > max_active || writer_count > max_writers ||
                active_count != pair_count * agents_per_todo ||
                declared_todos + 0 != pair_count ||
                declared_active + 0 != active_count ||
                declared_writers + 0 != writer_count) valid = 0
            exit(valid ? 0 : 1)
        }
    '
}

expect_structural_todo_fixture() {
    local label="$1"
    local expected="$2"
    local fixture="$3"
    local actual

    if structural_todo_allocation_is_valid "$fixture"; then
        actual='accept'
    else
        actual='reject'
    fi

    if [[ "$actual" == "$expected" ]]; then
        pass "structural Todo fixture $label is $actual"
    else
        fail "structural Todo fixture $label expected $expected but was $actual"
    fi
}

run_allocation_fixture_tests() {
    local fixture_file
    local label expected active_count writer_count non_writer_count actual

    POLICY_FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-scheduler-policy.XXXXXX")"
    fixture_file="$POLICY_FIXTURE_DIR/allocations.tsv"
    printf '%s\n' \
        'zero-writers-six-read-only|accept|6|0|6' \
        'one-writer-five-read-only|accept|6|1|5' \
        'two-writers-four-read-only|accept|6|2|4' \
        'three-writers-three-read-only|accept|6|3|3' \
        'three-writers-four-read-only|reject|7|3|4' \
        'four-writers|reject|4|4|0' \
        'unclassified-active-agent|reject|6|1|4' \
        > "$fixture_file"

    while IFS='|' read -r label expected active_count writer_count non_writer_count; do
        if allocation_is_valid "$active_count" "$writer_count" "$non_writer_count"; then
            actual='accept'
        else
            actual='reject'
        fi

        if [[ "$actual" == "$expected" ]]; then
            pass "allocation fixture $label is $actual"
        else
            fail "allocation fixture $label expected $expected but was $actual"
        fi
    done < "$fixture_file"

    POLICY_FIXTURE_DIR=""
    cleanup_policy_fixtures
}

run_todo_allocation_fixture_tests() {
    local fixture_file
    local label expected allocation actual

    POLICY_FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-scheduler-policy.XXXXXX")"
    fixture_file="$POLICY_FIXTURE_DIR/todo-allocations.tsv"
    printf '%s\n' \
        'one-selected-todo-two-agents|accept|2' \
        'two-selected-todos-four-agents|accept|2,2' \
        'three-selected-todos-six-agents|accept|2,2,2' \
        'singleton-allocation|reject|1' \
        'third-agent-on-one-todo|reject|3' \
        'uneven-four-agent-allocation|reject|3,1' \
        'six-agents-on-six-todos|reject|1,1,1,1,1,1' \
        'four-todo-pairs|reject|2,2,2,2' \
        > "$fixture_file"

    while IFS='|' read -r label expected allocation; do
        if todo_allocation_is_valid "$allocation"; then
            actual='accept'
        else
            actual='reject'
        fi

        if [[ "$actual" == "$expected" ]]; then
            pass "Todo allocation fixture $label is $actual"
        else
            fail "Todo allocation fixture $label expected $expected but was $actual"
        fi
    done < "$fixture_file"

    POLICY_FIXTURE_DIR=""
    cleanup_policy_fixtures
}

run_structural_todo_fixture_tests() {
    expect_structural_todo_fixture 'one-pair-two-agents' accept $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTOTALS|1|2|1'
    expect_structural_todo_fixture 'two-pairs-four-agents' accept $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|writer-b|writer\nAGENT|reader-b|read-only\nDEPENDENCY|none\nTERRITORY|writer-b|src/b\nEND_TODO_PAIR\nTOTALS|2|4|2'
    expect_structural_todo_fixture 'three-pairs-six-agents' accept $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|writer-b|writer\nAGENT|reader-b|read-only\nDEPENDENCY|none\nTERRITORY|writer-b|src/b\nEND_TODO_PAIR\nTODO_PAIR|todo-c\nAGENT|writer-c|writer\nAGENT|reader-c|read-only\nDEPENDENCY|todo-a\nTERRITORY|writer-c|src/c\nEND_TODO_PAIR\nTOTALS|3|6|3'

    expect_structural_todo_fixture 'singleton-pair' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTOTALS|1|1|1'
    expect_structural_todo_fixture 'third-agent-in-pair' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nAGENT|reader-b|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTOTALS|1|3|1'
    expect_structural_todo_fixture 'four-todo-pairs' reject $'TODO_PAIR|todo-a\nAGENT|reader-a1|read-only\nAGENT|reader-a2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|reader-b1|read-only\nAGENT|reader-b2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-c\nAGENT|reader-c1|read-only\nAGENT|reader-c2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-d\nAGENT|reader-d1|read-only\nAGENT|reader-d2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTOTALS|4|8|0'
    expect_structural_todo_fixture 'uneven-pairs-with-valid-aggregate' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|writer-b|writer\nAGENT|reader-b1|read-only\nAGENT|reader-b2|read-only\nDEPENDENCY|none\nTERRITORY|writer-b|src/b\nEND_TODO_PAIR\nTOTALS|2|4|2'
    expect_structural_todo_fixture 'declared-total-mismatch' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTOTALS|1|4|1'
    expect_structural_todo_fixture 'six-todo-pairs' reject $'TODO_PAIR|todo-a\nAGENT|reader-a1|read-only\nAGENT|reader-a2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|reader-b1|read-only\nAGENT|reader-b2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-c\nAGENT|reader-c1|read-only\nAGENT|reader-c2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-d\nAGENT|reader-d1|read-only\nAGENT|reader-d2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-e\nAGENT|reader-e1|read-only\nAGENT|reader-e2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTODO_PAIR|todo-f\nAGENT|reader-f1|read-only\nAGENT|reader-f2|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTOTALS|6|12|0'
    expect_structural_todo_fixture 'missing-dependency-declaration' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nTERRITORY|writer-a|src/a\nEND_TODO_PAIR\nTOTALS|1|2|1'
    expect_structural_todo_fixture 'missing-territory-declaration' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nEND_TODO_PAIR\nTOTALS|1|2|1'
    expect_structural_todo_fixture 'overlapping-writer-territories' reject $'TODO_PAIR|todo-a\nAGENT|writer-a|writer\nAGENT|reader-a|read-only\nDEPENDENCY|none\nTERRITORY|writer-a|services/api\nEND_TODO_PAIR\nTODO_PAIR|todo-b\nAGENT|writer-b|writer\nAGENT|reader-b|read-only\nDEPENDENCY|none\nTERRITORY|writer-b|services/api/routes\nEND_TODO_PAIR\nTOTALS|2|4|2'
}

validate_source() {
    local source="$1"
    local label="$2"
    local reason_phrase
    local reason_pattern

    check_normalized_pattern "$source" "$label" \
        '6[-[:space:]]+active[[:space:]]*/[[:space:]]*3[-[:space:]]+writer' \
        'the 6-active/3-writer scheduler limit'
    check_normalized_pattern "$source" "$label" \
        'active[[:space:]]+subagents[[:space:]]+per[[:space:]]+phase[^|]*\|[[:space:]]*6' \
        'the six-active limit table entry'
    check_normalized_pattern "$source" "$label" \
        'concurrent[[:space:]]+writers[[:space:]]+per[[:space:]]+wave[^|]*\|[[:space:]]*3' \
        'the three-writer limit table entry'
    check_normalized_pattern "$source" "$label" \
        '6[[:space:]]*(−|-)[[:space:]]*w.{0,100}(read[-[:space:]]*only|non[-[:space:]]*writer)' \
        'the dynamic 6-writers non-writer capacity rule'
    check_normalized_pattern "$source" "$label" \
        '(exactly[[:space:]]+two[[:space:]]+agents?.{0,140}(each[[:space:]]+(active[[:space:]]+)?|selected[[:space:]]+)todos?|todos?.{0,140}exactly[[:space:]]+one[[:space:]]+pair[[:space:]]+of[[:space:]]+exactly[[:space:]]+two[[:space:]]+agents?)' \
        'the exactly-two-agents-per-selected-Todo rule'
    check_normalized_pattern "$source" "$label" \
        '(up[[:space:]]+to|at[[:space:]]+most)[[:space:]]+three[[:space:]]+(independent,[[:space:]]+dependency-ready[[:space:]]+)?todos?.{0,80}(concurrent|phase|pair)' \
        'the max-three-selected-Todos rule'
    check_normalized_pattern "$source" "$label" \
        '((one|1).{0,80}(two|2).{0,80}(three|3)[[:space:]]+(eligible[[:space:]])?todos?.{0,160}(2|two).{0,80}(4|four).{0,80}(6|six)[[:space:]]+agents?|(one|1)[[:space:]]+(eligible[[:space:]])?todos?.{0,100}(2|two)[[:space:]]+agents?.{0,100}(two|2).{0,100}(4|four)[[:space:]]+agents?.{0,100}(three|3).{0,100}(6|six)[[:space:]]+agents?)' \
        'the 1/2/3-Todo to 2/4/6-agent allocation rule'
    check_normalized_pattern "$source" "$label" \
        '(no|never|do[[:space:]]+not).{0,100}third[[:space:]]+agent.{0,80}todo|third[[:space:]]+agent.{0,80}(no|never|do[[:space:]]+not)' \
        'the third-agent-per-Todo prohibition'
    check_independent_stream_enumeration "$source" "$label"
    check_normalized_pattern "$source" "$label" \
        'dispatch.{0,100}currently safe.{0,100}one[[:space:]]+parallel[[:space:]]+call|dispatch.{0,100}one[[:space:]]+parallel[[:space:]]+call' \
        'parallel dispatch in one call'
    check_normalized_pattern "$source" "$label" \
        'each[[:space:]]+unused[[:space:]]+active[[:space:]]+slots?.{0,100}writer[[:space:]]+slots?.{0,180}concrete.{0,180}(reason|dependency|territory)' \
        'the per-slot UNUSED_CAPACITY rule and allowed-reason declaration'
    check_normalized_pattern "$source" "$label" \
        'concrete[[:space:]]+dependency' \
        'concrete dependency as an allowed unused-capacity reason'
    check_normalized_pattern "$source" "$label" \
        'territory[[:space:]-]+collision' \
        'territory collision as an allowed unused-capacity reason'
    check_normalized_pattern "$source" "$label" \
        'unavailable[[:space:]]+matching[[:space:]]+role' \
        'unavailable matching role as an allowed unused-capacity reason'
    check_normalized_pattern "$source" "$label" \
        'premature[-[:space:]]+review' \
        'premature review as an allowed unused-capacity reason'
    check_capacity_blocks "$source" "$label"

    for reason_phrase in 'token[-[:space:]]+pressure' 'cost' 'convenience'; do
        reason_pattern="(${reason_phrase}).{0,180}(invalid|not[-[:space:]]+valid|forbidden|prohibited).{0,80}unused_capacity|invalid.{0,180}unused_capacity.{0,180}(${reason_phrase})"
        check_normalized_pattern "$source" "$label" "$reason_pattern" \
            "the prohibition on $reason_phrase as an UNUSED_CAPACITY reason"
    done

    check_normalized_pattern "$source" "$label" \
        '((no|never|must[[:space:]]+not|do[[:space:]]+not).{0,120}(manufactur|invent).{0,120}(task|work)|(task|work).{0,120}(never|must[[:space:]]+not|do[[:space:]]+not)(.{0,80})(manufactur|invent)|speculative[[:space:]]+tasks?.{0,120}(forbidden|prohibited|not[[:space:]]+allowed))' \
        'the prohibition on manufactured or speculative tasks'
    check_normalized_pattern "$source" "$label" \
        '((reviewer|reviewers|qa|security).{0,220}(after|once|wait|depend|before|until|only).{0,100}(final[-[:space:]]+(implementation[-[:space:]]+)?wave|relevant[-[:space:]]+implementation.{0,40}finalized|post[-[:space:]]+wave)|((final[-[:space:]]+(implementation[-[:space:]]+)?wave|post[-[:space:]]+wave).{0,220}(reviewer|reviewers|qa|security)))' \
        'the reviewer-after-final-wave (implementation/post-wave) dependency'
    check_normalized_pattern "$source" "$label" \
        '(qa|security).{0,180}(once|after|wait|depend).{0,160}(implementation|wave|final)' \
        'the single reviewer barrier after finalized implementation'
    check_normalized_pattern "$source" "$label" \
        'open[-[:space:]]+roadmap.{0,260}(task|item).{0,100}remains?[[:space:]]+open.{0,260}immediately[[:space:]]+dispatch.{0,100}next' \
        'immediate next dispatch while the roadmap remains open'
    check_full_phase_example "$source" "$label"
    check_underfilled_phase_example "$source" "$label"
    check_human_readable_response_contract "$source" "$label"
}

create_negative_policy_fixture() {
    local source="$1"
    local kind="$2"
    local destination="$3"

    case "$kind" in
        independent)
            awk 'tolower($0) !~ /independent(([[:space:]-]+work)?[[:space:]-]+streams?|[[:space:]-]+todowrite[[:space:]-]+items?)[[:space:]]*:/ { print }' \
                "$source" > "$destination"
            ;;
        parallel)
            awk 'tolower($0) !~ /parallel/ { print }' "$source" > "$destination"
            ;;
        capacity)
            awk '{ line = $0; gsub(/[Pp]remature/, "cost", line); print line }' \
                "$source" > "$destination"
            ;;
        manufactured)
            awk '{ line = $0; gsub(/[Mm]anufactur(e|ed|ing)?/, "create", line); gsub(/[Ii]nvent(ed|ing)?/, "add", line); print line }' \
                "$source" > "$destination"
            ;;
        review)
            awk 'tolower($0) !~ /(qa|security|review)/ { print }' "$source" > "$destination"
            ;;
        full)
            awk '{ line = $0; if (tolower(line) ~ /^[[:space:]]*good.*three.*todos.*6[[:space:]-]+active.*3[[:space:]-]+writers?/) gsub(/\(6[[:space:]]+active,[^)]*3[[:space:]]+writers?\)/, "", line); print line }' \
                "$source" > "$destination"
            ;;
        underfilled)
            awk 'tolower($0) !~ /(^|[^0-9])[1-5][[:space:]-]+active/ { print }' \
                "$source" > "$destination"
            ;;
        *)
            fail "unknown negative policy fixture kind: $kind"
            return 1
            ;;
    esac
}

expect_negative_policy_fixture() {
    local label="$1"
    local target="$2"
    local fixture="$3"
    local orchestrator_source="$ORCHESTRATOR_PROFILE"
    local agents_source="$AGENTS_FILE"

    if [[ "$target" == 'orchestrator' ]]; then
        orchestrator_source="$fixture"
    else
        agents_source="$fixture"
    fi

    if ORCHESTRATOR_PROFILE="$orchestrator_source" \
       AGENTS_FILE="$agents_source" \
       SCHEDULER_POLICY_SKIP_FIXTURES=1 \
       SCHEDULER_POLICY_QUIET=1 \
       bash "$SCRIPT_DIR/test-orchestrator-scheduler-policy.sh"; then
        fail "negative policy fixture was accepted: $label"
    else
        pass "negative policy fixture was rejected: $label"
    fi
}

run_negative_policy_fixtures() {
    local fixture
    local target
    local kind

    POLICY_FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-scheduler-negative.XXXXXX")"
    for target in orchestrator agents; do
        for kind in independent parallel capacity manufactured review full underfilled; do
            fixture="$POLICY_FIXTURE_DIR/${target}-${kind}.md"
            if [[ "$target" == 'orchestrator' ]]; then
                create_negative_policy_fixture "$ORCHESTRATOR_PROFILE" "$kind" "$fixture"
            else
                create_negative_policy_fixture "$AGENTS_FILE" "$kind" "$fixture"
            fi
            expect_negative_policy_fixture "$target $kind" "$target" "$fixture"
        done
    done

    POLICY_FIXTURE_DIR=""
    cleanup_policy_fixtures
}

sources_ready=1
for source in "$ORCHESTRATOR_PROFILE" "$AGENTS_FILE"; do
    if [[ -f "$source" && -r "$source" ]]; then
        pass "canonical scheduler policy source is readable: $(source_label "$source")"
    else
        fail "scheduler policy source is missing or unreadable: $source"
        sources_ready=0
    fi
done

if [[ "$sources_ready" -eq 1 ]]; then
    validate_source "$ORCHESTRATOR_PROFILE" 'orchestrator profile'
    validate_source "$AGENTS_FILE" 'AGENTS.md'
fi

if [[ "$FAILED" -eq 0 ]]; then
    run_allocation_fixture_tests
    run_todo_allocation_fixture_tests
    run_structural_todo_fixture_tests
fi

if [[ "$FAILED" -eq 0 && "${SCHEDULER_POLICY_SKIP_FIXTURES:-0}" != 1 ]]; then
    run_negative_policy_fixtures
fi

if [[ "$FAILED" -ne 0 ]]; then
    printf 'Scheduler-policy validation failed; update both canonical policy sources before dispatching work.\n' >&2
    exit 1
fi

printf 'PASS: canonical orchestrator scheduler policy is synchronized and structurally complete\n'
