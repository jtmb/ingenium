#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORCHESTRATOR_PROFILE="${ORCHESTRATOR_PROFILE:-$REPO_ROOT/.opencode/agents/primary/ingenium-orchestrator.md}"
AGENTS_FILE="${AGENTS_FILE:-$REPO_ROOT/AGENTS.md}"
MAX_ACTIVE_SUBAGENTS=6
MAX_CONCURRENT_WRITERS=3
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
            if (lower ~ /^[[:space:]]*independent([[:space:]-]+work)?[[:space:]-]+streams?[[:space:]]*:/) {
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
            awk 'tolower($0) !~ /independent([[:space:]-]+work)?[[:space:]-]+streams?[[:space:]]*:/ { print }' \
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
            awk 'tolower($0) !~ /(manufactur|invent[[:space:]]+speculative)/ { print }' \
                "$source" > "$destination"
            ;;
        review)
            awk 'tolower($0) !~ /(qa|security|review)/ { print }' "$source" > "$destination"
            ;;
        full)
            awk 'tolower($0) !~ /full[[:space:]]+(independent|phase)/ { print }' \
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
fi

if [[ "$FAILED" -eq 0 && "${SCHEDULER_POLICY_SKIP_FIXTURES:-0}" != 1 ]]; then
    run_negative_policy_fixtures
fi

if [[ "$FAILED" -ne 0 ]]; then
    printf 'Scheduler-policy validation failed; update both canonical policy sources before dispatching work.\n' >&2
    exit 1
fi

printf 'PASS: canonical orchestrator scheduler policy is synchronized and structurally complete\n'
