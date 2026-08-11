#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PHASE_SCRIPT="$REPO_ROOT/scripts/phase-commit.sh"
BOOTSTRAP_BASELINE_SHA="3421f6b9fa9f87f2e400acb7a544723eb878fd60"
BOOTSTRAP_START_SHA="c828ba4b80e03b83e6564263a8add2bec8f85f20"
TMP_ROOT=""
TEST_REPO=""
TESTS=0
FAILURES=0

pass() {
  TESTS=$((TESTS + 1))
  printf 'PASS: %s\n' "$1"
}

fail() {
  TESTS=$((TESTS + 1))
  FAILURES=$((FAILURES + 1))
  printf 'FAIL: %s\n' "$1"
}

expect_failure() {
  local label="$1"
  shift

  if "$@"; then
    fail "$label"
  else
    pass "$label"
  fi
}

expect_secret_path_rejection() {
  local label="$1"
  local expected_path="$2"
  local output
  shift 2

  if output="$("$@" 2>&1)"; then
    fail "$label"
  elif [[ "$output" == *'staged secret content is forbidden:'* && "$output" == *"$expected_path"* && "$output" != *'PRIVATE'* ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

expect_precommit_preflight_failure() {
  local label="$1"
  local output
  shift

  if output="$("$@" 2>&1)"; then
    fail "$label"
  elif [[ "$output" == *'pre-commit hook failed; phase state remains active'* && "$output" != *'staged secret content is forbidden:'* ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

run_phase() {
  local repo="$1"
  shift
  (
    cd "$repo"
    env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$PHASE_SCRIPT" "$@"
  )
}

run_phase_with_git_environment() {
  local repo="$1"
  local variable="$2"
  local value="$3"
  shift 3

  (
    cd "$repo"
    env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$variable=$value" "$PHASE_SCRIPT" "$@"
  )
}

stage_literal_path() {
  local repo="$1"
  local path="$2"

  git -C "$repo" add -- ":(literal)$path"
}

worktree_git_dir() {
  local repo="$1"
  local git_dir

  git_dir="$(git -C "$repo" rev-parse --git-dir)"
  if [[ "$git_dir" != /* ]]; then
    git_dir="$repo/$git_dir"
  fi
  (
    cd "$git_dir"
    pwd -P
  )
}

state_path() {
  printf '%s/phase-commit.state\n' "$(worktree_git_dir "$1")"
}

lock_path() {
  printf '%s/phase-commit.lock\n' "$(worktree_git_dir "$1")"
}

assert_exists() {
  local path="$1"
  local label="$2"

  if [[ -e "$path" && ! -L "$path" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_absent() {
  local path="$1"
  local label="$2"

  if [[ ! -e "$path" && ! -L "$path" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_mode_600() {
  local path="$1"
  local label="$2"
  local mode

  mode="$(stat -c '%a' "$path")"
  if [[ "$mode" == '600' ]]; then
    pass "$label"
  else
    fail "$label (found mode $mode)"
  fi
}

assert_head() {
  local repo="$1"
  local expected="$2"
  local label="$3"
  local actual

  actual="$(git -C "$repo" rev-parse HEAD)"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_subject() {
  local repo="$1"
  local expected="$2"
  local label="$3"
  local subject

  subject="$(git -C "$repo" show -s --format=%s HEAD)"
  if [[ "$subject" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_trailer() {
  local repo="$1"
  local key="$2"
  local expected="$3"
  local label="$4"
  local trailers

  trailers="$(git -C "$repo" show -s --format=%B HEAD | git interpret-trailers --parse)"
  if [[ $'\n'"$trailers"$'\n' == *$'\n'"$key: $expected"$'\n'* ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_empty_commit() {
  local repo="$1"
  local label="$2"
  local changed_paths

  changed_paths="$(git -C "$repo" diff-tree --no-commit-id --name-only -r HEAD)"
  if [[ -z "$changed_paths" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_path_absent_from_head() {
  local repo="$1"
  local path="$2"
  local label="$3"
  local listed

  listed="$(git -C "$repo" ls-tree -r --name-only HEAD -- "$path")"
  if [[ -z "$listed" ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_literal_path_in_head() {
  local repo="$1"
  local path="$2"
  local label="$3"
  local -a entries=()

  mapfile -d '' entries < <(git -C "$repo" ls-tree -r -z HEAD -- ":(literal)$path")
  if [[ ${#entries[@]} -eq 1 ]]; then
    pass "$label"
  else
    fail "$label"
  fi
}

write_private_key_fixture() {
  local path="$1"

  printf '%s%s%s\n%s\n%s%s%s\n' \
    '-----BE' 'GIN PRIVATE' ' KEY-----' \
    'test-only' \
    '-----EN' 'D PRIVATE' ' KEY-----' > "$path"
}

write_phase_config() {
  local repo="$1"
  local baseline="$2"

  mkdir -p "$repo/config"
  printf '%s\n' \
    '# Isolated test policy.' \
    "PHASE_HISTORY_BASELINE=$baseline" > "$repo/config/phase-commit.conf"
}

make_raw_repo() {
  local name="$1"

  TEST_REPO="$TMP_ROOT/$name"
  mkdir "$TEST_REPO"
  git init -q "$TEST_REPO"
  git -C "$TEST_REPO" config user.name 'Phase Commit Test'
  git -C "$TEST_REPO" config user.email 'phase-commit-test@example.invalid'
  git -C "$TEST_REPO" config commit.gpgSign false
  git -C "$TEST_REPO" config core.hooksPath "$TEST_REPO/.git/hooks"
  cp "$REPO_ROOT/.gitignore" "$TEST_REPO/.gitignore"
  printf 'seed\n' > "$TEST_REPO/seed.txt"
  git -C "$TEST_REPO" add .gitignore seed.txt
  git -C "$TEST_REPO" commit -qm 'chore: baseline'
}

manual_begin() {
  local repo="$1"
  local phase_id="$2"
  local id_key="${3:-Phase-Id}"
  local boundary_key="${4:-Phase-Boundary}"
  local extra_trailers="${5:-}"

  git -C "$repo" commit --allow-empty \
    -m "chore(phase): begin $phase_id" \
    -m "$id_key: $phase_id"$'\n'"$boundary_key: begin"${extra_trailers:+$'\n'"$extra_trailers"}
}

manual_end() {
  local repo="$1"
  local phase_id="$2"
  local start_sha="$3"
  local subject="$4"
  local start_value="${5:-$start_sha}"
  local id_key="${6:-Phase-Id}"
  local boundary_key="${7:-Phase-Boundary}"
  local start_key="${8:-Phase-Start}"

  git -C "$repo" commit \
    -m "$subject" \
    -m "$id_key: $phase_id"$'\n'"$boundary_key: end"$'\n'"$start_key: $start_value"
}

make_enforced_repo() {
  local name="$1"
  local baseline bootstrap_start

  make_raw_repo "$name"
  baseline="$(git -C "$TEST_REPO" rev-parse HEAD)"
  manual_begin "$TEST_REPO" bootstrap
  bootstrap_start="$(git -C "$TEST_REPO" rev-parse HEAD)"
  write_phase_config "$TEST_REPO" "$baseline"
  git -C "$TEST_REPO" add config/phase-commit.conf
  manual_end "$TEST_REPO" bootstrap "$bootstrap_start" 'chore: establish phase policy'
  run_phase "$TEST_REPO" verify-history
}

write_hook() {
  local repo="$1"
  local name="$2"
  shift 2
  local hook_dir

  hook_dir="$(worktree_git_dir "$repo")/hooks"
  mkdir -p "$hook_dir"
  printf '%s\n' '#!/usr/bin/env bash' "$@" > "$hook_dir/$name"
  chmod 700 "$hook_dir/$name"
}

cleanup() {
  local status=$?

  if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
    case "$TMP_ROOT" in
      /tmp/phase-commit.* | "${TMPDIR:-/tmp}"/phase-commit.*) rm -rf -- "$TMP_ROOT" ;;
      *) printf 'Refusing to remove unexpected test directory: %s\n' "$TMP_ROOT" >&2 ;;
    esac
  fi
  exit "$status"
}

test_clean_begin_end_status_and_range() {
  local repo state start status_output baseline

  make_enforced_repo 'clean'
  repo="$TEST_REPO"
  mkdir "$repo/test-results"
  printf 'ignored report\n' > "$repo/test-results/report.txt"
  run_phase "$repo" begin clean-phase
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  assert_exists "$state" 'clean begin creates state'
  assert_mode_600 "$state" 'state is mode 600'
  assert_empty_commit "$repo" 'begin marker is empty'
  assert_trailer "$repo" 'Phase-Id' 'clean-phase' 'begin records Phase-Id'
  status_output="$(run_phase "$repo" status)"
  if [[ "$status_output" == *'active phase: clean-phase'* && "$status_output" == *'source: state'* ]]; then
    pass 'status reports a valid active phase'
  else
    fail 'status reports a valid active phase'
  fi
  expect_failure 'final verify-history rejects an open phase' run_phase "$repo" verify-history
  printf 'feature\n' > "$repo/feature.txt"
  git -C "$repo" add feature.txt
  run_phase "$repo" end clean-phase 'feat(repo): commit verified phase changes'
  assert_absent "$state" 'successful end clears state'
  assert_subject "$repo" 'feat(repo): commit verified phase changes' 'end preserves its conventional subject'
  assert_trailer "$repo" 'Phase-Start' "$start" 'end records begin SHA'
  run_phase "$repo" verify-history
  baseline="$(awk -F= '/^PHASE_HISTORY_BASELINE=/{print $2}' "$repo/config/phase-commit.conf")"
  run_phase "$repo" verify-history "$baseline..HEAD"
}

test_dirty_nested_and_wrong_phase_rejections() {
  local repo state

  make_enforced_repo 'dirty-tracked'
  repo="$TEST_REPO"
  printf 'tracked residue\n' >> "$repo/seed.txt"
  expect_failure 'begin rejects tracked residue' run_phase "$repo" begin dirty-tracked
  assert_absent "$(state_path "$repo")" 'tracked residue leaves no state'

  make_enforced_repo 'dirty-untracked'
  repo="$TEST_REPO"
  printf 'untracked residue\n' > "$repo/untracked.txt"
  expect_failure 'begin rejects nonignored untracked residue' run_phase "$repo" begin dirty-untracked
  assert_absent "$(state_path "$repo")" 'untracked residue leaves no state'

  make_enforced_repo 'nested-wrong'
  repo="$TEST_REPO"
  run_phase "$repo" begin alpha
  state="$(state_path "$repo")"
  expect_failure 'nested begin is rejected' run_phase "$repo" begin beta
  printf 'staged change\n' > "$repo/change.txt"
  git -C "$repo" add change.txt
  expect_failure 'wrong phase end is rejected' run_phase "$repo" end beta 'feat: close beta'
  assert_exists "$state" 'wrong end retains state'
  run_phase "$repo" end alpha 'feat: close alpha'
  run_phase "$repo" verify-history
}

test_adjacent_history_and_head_requirements() {
  local repo state start direct_head bootstrap_start

  make_enforced_repo 'runtime-intermediate'
  repo="$TEST_REPO"
  run_phase "$repo" begin direct
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" commit --allow-empty -qm 'fix: forbidden intermediate commit'
  direct_head="$(git -C "$repo" rev-parse HEAD)"
  expect_failure 'end rejects an advanced HEAD after begin' run_phase "$repo" end direct 'feat: close direct'
  assert_exists "$state" 'advanced HEAD retains state'
  assert_head "$repo" "$direct_head" 'failed end does not advance HEAD'
  if [[ "$start" != "$direct_head" ]]; then
    pass 'intermediate fixture advances HEAD'
  else
    fail 'intermediate fixture advances HEAD'
  fi

  make_enforced_repo 'history-intermediate'
  repo="$TEST_REPO"
  manual_begin "$repo" adjacent
  bootstrap_start="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" commit --allow-empty -qm 'fix: direct intermediate'
  printf 'end content\n' > "$repo/end.txt"
  git -C "$repo" add end.txt
  manual_end "$repo" adjacent "$bootstrap_start" 'feat: close adjacent'
  expect_failure 'history rejects a normal commit between begin and end' run_phase "$repo" verify-history
}

test_history_trailer_and_config_trust() {
  local repo start baseline direct_head

  make_enforced_repo 'history-direct'
  repo="$TEST_REPO"
  git -C "$repo" commit --allow-empty -qm 'fix: direct outside phase'
  expect_failure 'history rejects a direct commit outside a phase' run_phase "$repo" verify-history

  make_enforced_repo 'history-missing'
  repo="$TEST_REPO"
  manual_begin "$repo" missing
  expect_failure 'history rejects a missing end marker' run_phase "$repo" verify-history

  make_enforced_repo 'history-nested'
  repo="$TEST_REPO"
  manual_begin "$repo" outer
  manual_begin "$repo" inner
  expect_failure 'history rejects nested begin markers' run_phase "$repo" verify-history

  make_enforced_repo 'history-wrong-start'
  repo="$TEST_REPO"
  manual_begin "$repo" wrong-start
  start="$(git -C "$repo" rev-parse HEAD)"
  printf 'boundary content\n' > "$repo/boundary.txt"
  git -C "$repo" add boundary.txt
  manual_end "$repo" wrong-start "$start" 'feat: close with wrong start' '0000000000000000000000000000000000000000'
  expect_failure 'history rejects a wrong Phase-Start' run_phase "$repo" verify-history

  make_enforced_repo 'history-duplicate-trailer'
  repo="$TEST_REPO"
  manual_begin "$repo" duplicate 'Phase-Id' 'Phase-Boundary' 'phase-boundary: begin'
  expect_failure 'history rejects case-variant duplicate boundary trailers' run_phase "$repo" verify-history

  make_enforced_repo 'history-case-insensitive'
  repo="$TEST_REPO"
  manual_begin "$repo" lowercase 'phase-id' 'phase-boundary'
  start="$(git -C "$repo" rev-parse HEAD)"
  printf 'case content\n' > "$repo/case.txt"
  git -C "$repo" add case.txt
  manual_end "$repo" lowercase "$start" 'feat: close lowercase trailers' "$start" 'PHASE-ID' 'PHASE-BOUNDARY' 'PHASE-START'
  run_phase "$repo" verify-history

  make_enforced_repo 'config-trust'
  repo="$TEST_REPO"
  git -C "$repo" commit --allow-empty -qm 'fix: invalid committed history'
  direct_head="$(git -C "$repo" rev-parse HEAD)"
  printf '%s\n' "PHASE_HISTORY_BASELINE=$direct_head" > "$repo/config/phase-commit.conf"
  expect_failure 'dirty config baseline cannot bypass verify-history' run_phase "$repo" verify-history
  expect_failure 'begin reads committed config rather than dirty config' run_phase "$repo" begin bypass
}

test_staged_path_and_content_guards() {
  local repo state start

  make_enforced_repo 'forced-generated'
  repo="$TEST_REPO"
  run_phase "$repo" begin generated
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  mkdir "$repo/test-results"
  printf 'generated\n' > "$repo/test-results/report.txt"
  git -C "$repo" add -f test-results/report.txt
  expect_failure 'end rejects force-staged generated artifacts' run_phase "$repo" end generated 'feat: reject generated artifact'
  assert_exists "$state" 'generated-artifact rejection retains state'
  assert_head "$repo" "$start" 'generated-artifact rejection preserves HEAD'

  make_enforced_repo 'forced-env'
  repo="$TEST_REPO"
  run_phase "$repo" begin environment
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  printf 'VALUE=test\n' > "$repo/.env"
  git -C "$repo" add -f .env
  expect_failure 'end rejects force-staged .env files' run_phase "$repo" end environment 'feat: reject environment file'
  assert_exists "$state" '.env rejection retains state'
  assert_head "$repo" "$start" '.env rejection preserves HEAD'

  make_enforced_repo 'forced-private-key'
  repo="$TEST_REPO"
  run_phase "$repo" begin key-content
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  write_private_key_fixture "$repo/safe-name.txt"
  git -C "$repo" add safe-name.txt
  expect_secret_path_rejection 'end reports only the secret fixture path' safe-name.txt \
    run_phase "$repo" end key-content 'feat: reject key content'
  assert_exists "$state" 'private-key rejection retains state'
  assert_head "$repo" "$start" 'private-key rejection preserves HEAD'

  make_enforced_repo 'staged-symlink'
  repo="$TEST_REPO"
  run_phase "$repo" begin symlink
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  ln -s seed.txt "$repo/link.txt"
  git -C "$repo" add link.txt
  expect_failure 'end rejects staged symlinks' run_phase "$repo" end symlink 'feat: reject symlink'
  assert_exists "$state" 'symlink rejection retains state'
  assert_head "$repo" "$start" 'symlink rejection preserves HEAD'

}

test_ambient_git_environment_guards() {
  local repo state start variable value
  local -a local_environment_names=()
  local -a required_environment_names=(
    GIT_NAMESPACE
    GIT_SHALLOW_FILE
    GIT_NO_REPLACE_OBJECTS
    GIT_REPLACE_REF_BASE
    GIT_GLOB_PATHSPECS
    GIT_NOGLOB_PATHSPECS
    GIT_LITERAL_PATHSPECS
    GIT_ICASE_PATHSPECS
    GIT_INDEX_FILE
    GIT_INDEX_VERSION
    GIT_QUARANTINE_PATH
    GIT_CEILING_DIRECTORIES
    GIT_DISCOVERY_ACROSS_FILESYSTEM
    GIT_OPTIONAL_LOCKS
    GIT_TEMPLATE_DIR
    GIT_EXEC_PATH
    GIT_EXTERNAL_DIFF
    GIT_DIFF_OPTS
    GIT_PAGER
    GIT_EDITOR
    GIT_SEQUENCE_EDITOR
    GIT_SSH_COMMAND
    GIT_TERMINAL_PROMPT
    GIT_TRANSPORT_HELPER_DIR
    GIT_ASKPASS_REQUIRE
  )
  declare -A seen_environment_names=()

  make_enforced_repo 'ambient-git-environment'
  repo="$TEST_REPO"
  run_phase "$repo" begin ambient-git-environment
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  printf 'safe\n' > "$repo/safe.txt"
  git -C "$repo" add safe.txt
  mapfile -t local_environment_names < <(git -C "$repo" rev-parse --local-env-vars)

  for variable in "${local_environment_names[@]}" "${required_environment_names[@]}"; do
    [[ -n "$variable" && -z "${seen_environment_names[$variable]:-}" ]] || continue
    seen_environment_names["$variable"]=1
    value="$repo/blocked-${variable,,}"
    expect_failure "ambient $variable is rejected before Git mutation" \
      run_phase_with_git_environment "$repo" "$variable" "$value" end ambient-git-environment 'feat: reject ambient Git environment'
    assert_exists "$state" "$variable rejection retains state"
    assert_head "$repo" "$start" "$variable rejection preserves HEAD"
  done
}

test_askpass_sanitization() {
  local repo state askpass askpass_marker git_dir

  make_enforced_repo 'askpass-sanitization'
  repo="$TEST_REPO"
  askpass="$TMP_ROOT/caller-askpass"
  askpass_marker="$TMP_ROOT/askpass-executed"
  git_dir="$(worktree_git_dir "$repo")"
  printf '%s\n' '#!/usr/bin/env bash' "printf executed > '$askpass_marker'" > "$askpass"
  chmod 700 "$askpass"

  run_phase_with_git_environment "$repo" GIT_ASKPASS "$askpass" begin askpass-sanitization
  state="$(state_path "$repo")"
  write_hook "$repo" pre-commit \
    'if [[ -n "${GIT_ASKPASS+x}" ]]; then "$GIT_ASKPASS"; exit 1; fi' \
    "printf pre > '$git_dir/pre-askpass-unset'"
  write_hook "$repo" commit-msg \
    'if [[ -n "${GIT_ASKPASS+x}" ]]; then "$GIT_ASKPASS"; exit 1; fi' \
    "printf commit > '$git_dir/commit-askpass-unset'"
  printf 'askpass-safe\n' > "$repo/askpass-safe.txt"
  git -C "$repo" add askpass-safe.txt
  run_phase_with_git_environment "$repo" GIT_ASKPASS "$askpass" end askpass-sanitization 'feat: sanitize inherited askpass'
  assert_exists "$git_dir/pre-askpass-unset" 'pre-commit hook observes GIT_ASKPASS unset'
  assert_exists "$git_dir/commit-askpass-unset" 'commit-msg hook observes GIT_ASKPASS unset'
  assert_absent "$askpass_marker" 'caller-supplied askpass is never executed'
  assert_absent "$state" 'askpass-sanitized end clears state'
  run_phase "$repo" verify-history
}

test_literal_staged_path_guards() {
  local repo state start path phase_id label index
  local -a private_key_phase_ids=(literal-exclude literal-wildcard literal-newline)
  local -a private_key_paths=(':(exclude)opaque.txt' 'wild[card]*.txt' $'newline\nopaque.txt')
  local -a private_key_labels=(pathspec-exclude wildcard-brackets newline)

  make_enforced_repo 'literal-symlink'
  repo="$TEST_REPO"
  run_phase "$repo" begin literal-symlink
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  path=':(literal)symlink'
  ln -s seed.txt "$repo/$path"
  stage_literal_path "$repo" "$path"
  expect_failure 'literal pathspec-magic symlink is rejected' run_phase "$repo" end literal-symlink 'feat: reject literal symlink'
  assert_exists "$state" 'literal pathspec-magic symlink rejection retains state'
  assert_head "$repo" "$start" 'literal pathspec-magic symlink rejection preserves HEAD'

  for index in "${!private_key_phase_ids[@]}"; do
    phase_id="${private_key_phase_ids[$index]}"
    path="${private_key_paths[$index]}"
    label="${private_key_labels[$index]}"
    make_enforced_repo "$phase_id"
    repo="$TEST_REPO"
    run_phase "$repo" begin "$phase_id"
    state="$(state_path "$repo")"
    start="$(git -C "$repo" rev-parse HEAD)"
    write_private_key_fixture "$repo/$path"
    stage_literal_path "$repo" "$path"
    expect_failure "literal $label private key is rejected" run_phase "$repo" end "$phase_id" 'feat: reject literal private key'
    assert_exists "$state" "literal $label private-key rejection retains state"
    assert_head "$repo" "$start" "literal $label private-key rejection preserves HEAD"
  done

  make_enforced_repo 'literal-colon'
  repo="$TEST_REPO"
  run_phase "$repo" begin literal-colon
  path=':ordinary-colon.txt'
  printf 'safe colon path\n' > "$repo/$path"
  stage_literal_path "$repo" "$path"
  run_phase "$repo" end literal-colon 'feat: commit ordinary colon filename'
  assert_literal_path_in_head "$repo" "$path" 'ordinary colon filename commits through literal validation'
  run_phase "$repo" verify-history
}

test_hook_order_binding_and_failure() {
  local repo state start git_dir

  make_enforced_repo 'hook-order'
  repo="$TEST_REPO"
  run_phase "$repo" begin hooks
  state="$(state_path "$repo")"
  git_dir="$(worktree_git_dir "$repo")"
  write_hook "$repo" pre-commit "printf pre > '$git_dir/pre-ran'"
  write_hook "$repo" prepare-commit-msg "printf prepare > '$git_dir/prepare-ran'"
  write_hook "$repo" commit-msg "test -f \"\$1\"" "printf commit > '$git_dir/commit-ran'"
  write_hook "$repo" post-commit "printf post > '$git_dir/post-ran'"
  printf 'hook-safe\n' > "$repo/hook-safe.txt"
  git -C "$repo" add hook-safe.txt
  run_phase "$repo" end hooks 'feat: run standard commit hooks'
  assert_exists "$git_dir/pre-ran" 'pre-commit hook executes'
  assert_exists "$git_dir/prepare-ran" 'prepare-commit-msg hook executes'
  assert_exists "$git_dir/commit-ran" 'commit-msg hook executes'
  assert_exists "$git_dir/post-ran" 'post-commit hook executes'
  assert_absent "$state" 'successful hooks allow state cleanup'
  run_phase "$repo" verify-history

  make_enforced_repo 'failing-pre-hook'
  repo="$TEST_REPO"
  run_phase "$repo" begin pre-failure
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  write_hook "$repo" pre-commit 'exit 1'
  printf 'pre failure\n' > "$repo/pre.txt"
  git -C "$repo" add pre.txt
  expect_failure 'failing pre-commit hook retains state' run_phase "$repo" end pre-failure 'feat: fail pre hook'
  assert_exists "$state" 'pre-commit failure retains state file'
  assert_head "$repo" "$start" 'pre-commit failure preserves HEAD'

  make_enforced_repo 'failing-commit-msg-hook'
  repo="$TEST_REPO"
  run_phase "$repo" begin message-failure
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  write_hook "$repo" commit-msg 'exit 1'
  printf 'message failure\n' > "$repo/message.txt"
  git -C "$repo" add message.txt
  expect_failure 'failing commit-msg hook retains state' run_phase "$repo" end message-failure 'feat: fail message hook'
  assert_exists "$state" 'commit-msg failure retains state file'
  assert_head "$repo" "$start" 'commit-msg failure preserves HEAD'

  make_enforced_repo 'hook-index-secret'
  repo="$TEST_REPO"
  run_phase "$repo" begin hook-secret
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  write_hook "$repo" pre-commit "printf 'TOKEN=test' > .env" 'git add -f .env'
  printf 'normal staged content\n' > "$repo/normal.txt"
  git -C "$repo" add normal.txt
  expect_failure 'hook index mutation is rejected before HEAD advances' run_phase "$repo" end hook-secret 'feat: reject hook secret'
  assert_exists "$state" 'hook index mutation retains state'
  assert_head "$repo" "$start" 'hook index mutation preserves HEAD'
  assert_path_absent_from_head "$repo" .env 'hook-added ignored secret cannot enter history'
}

test_empty_cancel_worktree_and_lock() {
  local repo state start other main_state other_state lock status_output

  make_enforced_repo 'empty-cancel'
  repo="$TEST_REPO"
  run_phase "$repo" begin empty
  state="$(state_path "$repo")"
  expect_failure 'empty end requires --allow-empty' run_phase "$repo" end empty 'chore: close empty phase'
  assert_exists "$state" 'rejected empty end retains state'
  run_phase "$repo" end --allow-empty empty 'chore: close empty phase'
  assert_trailer "$repo" 'Phase-Empty' 'true' 'empty end records Phase-Empty'
  run_phase "$repo" verify-history

  make_enforced_repo 'cancel'
  repo="$TEST_REPO"
  run_phase "$repo" begin cancelled
  state="$(state_path "$repo")"
  start="$(git -C "$repo" rev-parse HEAD)"
  run_phase "$repo" cancel cancelled 'scope changed'
  assert_absent "$state" 'cancel clears state'
  assert_trailer "$repo" 'Phase-Start' "$start" 'cancel records begin SHA'
  run_phase "$repo" verify-history

  make_enforced_repo 'worktree'
  repo="$TEST_REPO"
  run_phase "$repo" begin alpha
  main_state="$(state_path "$repo")"
  other="$TMP_ROOT/linked-worktree"
  git -C "$repo" worktree add -q -b phase-commit-linked "$other" HEAD~1
  status_output="$(run_phase "$other" status)"
  if [[ "$status_output" == 'no active phase' ]]; then
    pass 'linked worktree cannot consume another state file'
  else
    fail 'linked worktree cannot consume another state file'
  fi
  run_phase "$other" begin beta
  other_state="$(state_path "$other")"
  assert_exists "$main_state" 'main worktree state remains present'
  assert_exists "$other_state" 'linked worktree stores separate state'
  run_phase "$other" cancel beta 'test cleanup'
  run_phase "$repo" cancel alpha 'test cleanup'
  git -C "$repo" worktree remove "$other"

  make_enforced_repo 'lock'
  repo="$TEST_REPO"
  lock="$(lock_path "$repo")"
  mkdir "$lock"
  printf '%s\n' "$$" > "$lock/pid"
  chmod 600 "$lock/pid"
  expect_failure 'per-worktree lock rejects concurrent mutation' run_phase "$repo" begin locked
  rm -- "$lock/pid"
  rmdir "$lock"
  run_phase "$repo" begin locked
  assert_absent "$lock" 'successful begin cleans lock'
  run_phase "$repo" cancel locked 'test cleanup'
}

test_exact_bootstrap_transition() {
  local repo status_output start

  repo="$TMP_ROOT/exact-bootstrap"
  git clone -q --no-hardlinks "$REPO_ROOT" "$repo"
  git -C "$repo" checkout -q -B phase-commit-bootstrap "$BOOTSTRAP_START_SHA"
  git -C "$repo" config user.name 'Phase Commit Test'
  git -C "$repo" config user.email 'phase-commit-test@example.invalid'
  git -C "$repo" config commit.gpgSign false
  git -C "$repo" config core.hooksPath "$repo/.git/hooks"
  mkdir -p "$repo/config"
  cp "$REPO_ROOT/config/phase-commit.conf" "$repo/config/phase-commit.conf"
  git -C "$repo" add config/phase-commit.conf
  status_output="$(run_phase "$repo" status)"
  if [[ "$status_output" == *'active phase: phase-commit-enforcement'* && "$status_output" == *'source: bootstrap'* ]]; then
    pass 'only the exact c828 bootstrap marker is accepted without committed policy'
  else
    fail 'only the exact c828 bootstrap marker is accepted without committed policy'
  fi
  start="$(git -C "$repo" rev-parse HEAD)"
  printf '%s\n' "PHASE_HISTORY_BASELINE=$BOOTSTRAP_START_SHA" > "$repo/config/phase-commit.conf"
  git -C "$repo" add config/phase-commit.conf
  expect_failure 'bootstrap end rejects an invalid staged policy' run_phase "$repo" end phase-commit-enforcement 'feat(repo): establish phase commit enforcement'
  assert_head "$repo" "$start" 'invalid bootstrap policy preserves HEAD'
  cp "$REPO_ROOT/config/phase-commit.conf" "$repo/config/phase-commit.conf"
  git -C "$repo" add config/phase-commit.conf
  run_phase "$repo" end phase-commit-enforcement 'feat(repo): establish phase commit enforcement'
  run_phase "$repo" verify-history
}

test_staged_index_preflight() {
  local repo start

  repo="$TMP_ROOT/staged-index-preflight"
  git clone -q --no-hardlinks "$REPO_ROOT" "$repo"
  git -C "$repo" checkout -q -B staged-index-preflight "$BOOTSTRAP_START_SHA"
  git -C "$repo" config user.name 'Phase Commit Test'
  git -C "$repo" config user.email 'phase-commit-test@example.invalid'
  git -C "$REPO_ROOT" diff --cached --binary | git -C "$repo" apply --index --whitespace=nowarn
  start="$(git -C "$repo" rev-parse HEAD)"
  write_hook "$repo" pre-commit 'exit 1'
  expect_precommit_preflight_failure 'staged-index preflight reaches pre-commit after secret scanning' \
    run_phase "$repo" end phase-commit-enforcement 'feat(repo): enforce phase commit boundaries'
  assert_head "$repo" "$start" 'staged-index preflight preserves HEAD'
}

main() {
  [[ -x "$PHASE_SCRIPT" ]] || {
    printf 'Missing executable phase script: %s\n' "$PHASE_SCRIPT" >&2
    exit 1
  }
  TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/phase-commit.XXXXXX")"

  test_clean_begin_end_status_and_range
  test_dirty_nested_and_wrong_phase_rejections
  test_adjacent_history_and_head_requirements
  test_history_trailer_and_config_trust
  test_staged_path_and_content_guards
  test_ambient_git_environment_guards
  test_askpass_sanitization
  test_literal_staged_path_guards
  test_hook_order_binding_and_failure
  test_empty_cancel_worktree_and_lock
  test_exact_bootstrap_transition
  test_staged_index_preflight

  printf 'Phase commit tests: %s assertion(s), %s failure(s)\n' "$TESTS" "$FAILURES"
  [[ "$FAILURES" -eq 0 ]]
}

trap cleanup EXIT
main "$@"
