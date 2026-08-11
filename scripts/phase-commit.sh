#!/usr/bin/env bash
set -euo pipefail

# Phase boundaries are local-only and must not invoke an inherited credential helper.
unset GIT_ASKPASS

umask 077

readonly CONFIG_RELATIVE_PATH="config/phase-commit.conf"
readonly STATE_FILE_NAME="phase-commit.state"
readonly LOCK_DIR_NAME="phase-commit.lock"
readonly STATE_VERSION="2"

# This migration predates the committed policy file. These are deliberately
# fixed so only the reviewed c828 bootstrap marker can use this path.
readonly BOOTSTRAP_BASELINE_SHA="3421f6b9fa9f87f2e400acb7a544723eb878fd60"
readonly BOOTSTRAP_START_SHA="c828ba4b80e03b83e6564263a8add2bec8f85f20"
readonly BOOTSTRAP_PHASE_ID="phase-commit-enforcement"
readonly BOOTSTRAP_SUBJECT="chore(phase): begin phase commit enforcement"

AMBIENT_GIT_VARIABLES=()
for ambient_git_variable in "${!GIT_@}"; do
  AMBIENT_GIT_VARIABLES+=("$ambient_git_variable")
done

REPO_ROOT=""
GIT_DIR=""
STATE_FILE=""
LOCK_DIR=""
LOCK_HELD=0

POLICY_BASELINE=""
POLICY_TARGET=""
CURRENT_REF=""
CURRENT_BRANCH=""

ACTIVE_SOURCE=""
ACTIVE_ID=""
ACTIVE_START=""
ACTIVE_BRANCH=""
ACTIVE_REF=""
ACTIVE_WORKTREE=""
HISTORY_OPEN_ID=""
HISTORY_OPEN_START=""
HISTORY_RANGE_START=""
RESOLVED_HISTORY_TARGET=""
MARKER_PHASE_ID=""
SINGLE_TRAILER_VALUE=""
INDEX_HAS_CHANGES=0
INDEX_TREE=""
INDEX_MANIFEST_SHA=""
NEW_COMMIT=""
MESSAGE_FILE=""
TRAILER_VALUES=()
PHASE_TRAILER_KEYS=()
TEMP_FILES=()

usage() {
  printf '%s\n' \
    'Usage:' \
    '  scripts/phase-commit.sh begin <phase-id>' \
    '  scripts/phase-commit.sh end [--allow-empty] <phase-id> <commit-message>' \
    '  scripts/phase-commit.sh cancel <phase-id> [reason]' \
    '  scripts/phase-commit.sh status' \
    '  scripts/phase-commit.sh verify-history [baseline..target]'
}

die() {
  printf 'phase-commit: %s\n' "$*" >&2
  exit 1
}

is_phase_id() {
  local value="$1"
  [[ ${#value} -ge 1 && ${#value} -le 64 && "$value" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

is_full_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

is_single_line_printable() {
  local value="$1"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* && ! "$value" =~ [[:cntrl:]] ]]
}

validate_end_subject() {
  local subject="$1"
  local conventional_subject='^[a-z][a-z0-9-]*(\([a-z0-9][a-z0-9._/-]*\))?!?: [^[:space:]][^[:cntrl:]]*$'
  local boundary_subject='^chore\(phase\):[[:space:]]*(begin|end|cancel)([[:space:]]|$)'

  is_single_line_printable "$subject" &&
    [[ "$subject" =~ $conventional_subject ]] &&
    [[ ! "$subject" =~ $boundary_subject ]]
}

reject_ambient_git_overrides() {
  local name

  # Reject by prefix so Git's version-specific local-env list and future
  # repository-control variables are blocked before repository discovery.
  for name in "${AMBIENT_GIT_VARIABLES[@]}"; do
    case "$name" in
      GIT_AUTHOR_NAME|GIT_AUTHOR_EMAIL|GIT_AUTHOR_DATE|GIT_COMMITTER_NAME|GIT_COMMITTER_EMAIL|GIT_COMMITTER_DATE) ;;
      *) die "ambient Git environment variable is not allowed: $name" ;;
    esac
  done
}

initialize_repository() {
  local inside_work_tree raw_git_dir

  if ! inside_work_tree="$(git rev-parse --is-inside-work-tree)"; then
    die 'must run inside a Git worktree'
  fi
  [[ "$inside_work_tree" == 'true' ]] || die 'must run inside a Git worktree'

  REPO_ROOT="$(git rev-parse --show-toplevel)"
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
  cd "$REPO_ROOT"
  raw_git_dir="$(git rev-parse --git-dir)"
  GIT_DIR="$(cd "$raw_git_dir" && pwd -P)"
  [[ -d "$GIT_DIR" ]] || die 'Git directory is unavailable'

  STATE_FILE="$GIT_DIR/$STATE_FILE_NAME"
  LOCK_DIR="$GIT_DIR/$LOCK_DIR_NAME"
}

resolve_commit() {
  local revision="$1"
  git rev-parse --verify "${revision}^{commit}"
}

current_branch_ref() {
  local ref

  if ! ref="$(git symbolic-ref --quiet HEAD)"; then
    die 'a named branch is required'
  fi
  [[ "$ref" == refs/heads/* ]] || die 'HEAD must reference a local branch'
  CURRENT_REF="$ref"
  CURRENT_BRANCH="${ref#refs/heads/}"
}

assert_ref_at() {
  local expected="$1"
  local current_ref current_head ref_head

  if ! current_ref="$(git symbolic-ref --quiet HEAD)"; then
    die 'HEAD became detached while creating a phase boundary'
  fi
  [[ "$current_ref" == "$CURRENT_REF" ]] || die 'current branch changed while creating a phase boundary'
  current_head="$(git rev-parse HEAD)"
  ref_head="$(git rev-parse "$CURRENT_REF")"
  [[ "$current_head" == "$expected" && "$ref_head" == "$expected" ]] || die 'HEAD changed while creating a phase boundary'
}

is_on_first_parent() {
  local candidate="$1"
  local target="$2"
  local revision

  while IFS= read -r revision; do
    [[ "$revision" == "$candidate" ]] && return 0
  done < <(git rev-list --first-parent "$target")
  return 1
}

commit_has_single_parent() {
  local commit="$1"
  local parents
  local -a parent_list=()

  parents="$(git show -s --format=%P "$commit")"
  read -r -a parent_list <<< "$parents"
  [[ ${#parent_list[@]} -eq 1 ]]
}

commit_is_empty() {
  local commit="$1"
  local changed_paths

  changed_paths="$(git diff-tree --no-commit-id --name-only -r "$commit")"
  [[ -z "$changed_paths" ]]
}

message_from_commit() {
  git show -s --format=%B "$1"
}

message_subject() {
  local message="$1"
  local subject="${message%%$'\n'*}"
  printf '%s\n' "${subject%$'\r'}"
}

phase_trailer_values() {
  local message="$1"
  local wanted="${2,,}"

  mapfile -t TRAILER_VALUES < <(
    printf '%s\n' "$message" |
      git interpret-trailers --parse |
      awk -v wanted="$wanted" '
        {
          separator = index($0, ":")
          if (separator == 0) next
          key = tolower(substr($0, 1, separator - 1))
          if (key != wanted) next
          value = substr($0, separator + 1)
          sub(/^[[:space:]]*/, "", value)
          print value
        }
      '
  )
}

phase_trailer_keys() {
  local message="$1"

  mapfile -t PHASE_TRAILER_KEYS < <(
    printf '%s\n' "$message" |
      git interpret-trailers --parse |
      awk '
        {
          separator = index($0, ":")
          if (separator == 0) next
          key = tolower(substr($0, 1, separator - 1))
          if (key ~ /^phase-[[:alnum:]-]*$/) {
            print key
          } else if (key ~ /^phase-/) {
            print "__MALFORMED__"
          }
        }
      '
  )
}

require_single_trailer_value() {
  local message="$1"
  local key="$2"

  phase_trailer_values "$message" "$key"
  [[ ${#TRAILER_VALUES[@]} -eq 1 ]] || die "message must contain exactly one ${key} trailer"
  SINGLE_TRAILER_VALUE="${TRAILER_VALUES[0]}"
}

require_exact_trailer() {
  local message="$1"
  local key="$2"
  local expected="$3"

  require_single_trailer_value "$message" "$key"
  [[ "$SINGLE_TRAILER_VALUE" == "$expected" ]] || die "message must contain ${key}: ${expected}"
}

require_absent_trailer() {
  local message="$1"
  local key="$2"

  phase_trailer_values "$message" "$key"
  [[ ${#TRAILER_VALUES[@]} -eq 0 ]] || die "message must not contain a ${key} trailer"
}

assert_only_phase_trailers() {
  local message="$1"
  shift
  local key expected allowed

  phase_trailer_keys "$message"
  for key in "${PHASE_TRAILER_KEYS[@]}"; do
    [[ "$key" != '__MALFORMED__' ]] || die 'message has a malformed Phase-* trailer'
    allowed=0
    for expected in "$@"; do
      if [[ "$key" == "$expected" ]]; then
        allowed=1
        break
      fi
    done
    [[ "$allowed" -eq 1 ]] || die 'message has an unexpected Phase-* trailer'
  done
}

has_any_phase_trailer() {
  phase_trailer_keys "$1"
  [[ ${#PHASE_TRAILER_KEYS[@]} -gt 0 ]]
}

validate_boundary_value() {
  local message="$1"
  local expected="$2"

  require_single_trailer_value "$message" 'phase-boundary'
  [[ "${SINGLE_TRAILER_VALUE,,}" == "$expected" ]] || die "message must contain Phase-Boundary: $expected"
}

validate_bootstrap_marker() {
  local commit="$1"
  local subject message parent

  [[ "$commit" == "$BOOTSTRAP_START_SHA" ]] || die 'unexpected bootstrap marker'
  commit_has_single_parent "$commit" || die 'bootstrap marker must have one parent'
  parent="$(git rev-parse --verify "${commit}^")"
  [[ "$parent" == "$BOOTSTRAP_BASELINE_SHA" ]] || die 'bootstrap marker parent is invalid'
  commit_is_empty "$commit" || die 'bootstrap marker must be empty'
  subject="$(git show -s --format=%s "$commit")"
  [[ "$subject" == "$BOOTSTRAP_SUBJECT" ]] || die 'bootstrap marker subject is invalid'
  message="$(message_from_commit "$commit")"
  assert_only_phase_trailers "$message"
}

validate_begin_message() {
  local message="$1"
  local expected_id="${2:-}"
  local phase_id subject

  assert_only_phase_trailers "$message" 'phase-id' 'phase-boundary'
  require_single_trailer_value "$message" 'phase-id'
  phase_id="$SINGLE_TRAILER_VALUE"
  is_phase_id "$phase_id" || die 'begin marker has an invalid Phase-Id'
  [[ -z "$expected_id" || "$phase_id" == "$expected_id" ]] || die 'begin marker Phase-Id changed unexpectedly'
  validate_boundary_value "$message" 'begin'
  subject="$(message_subject "$message")"
  [[ "$subject" == "chore(phase): begin $phase_id" ]] || die 'begin marker subject is invalid'
  MARKER_PHASE_ID="$phase_id"
}

validate_end_message() {
  local message="$1"
  local expected_id="$2"
  local expected_start="$3"
  local expected_empty="$4"
  local subject

  assert_only_phase_trailers "$message" 'phase-id' 'phase-boundary' 'phase-start' 'phase-empty'
  require_exact_trailer "$message" 'phase-id' "$expected_id"
  validate_boundary_value "$message" 'end'
  require_exact_trailer "$message" 'phase-start' "$expected_start"
  subject="$(message_subject "$message")"
  validate_end_subject "$subject" || die 'end marker subject is not a conventional non-boundary subject'
  if [[ "$expected_empty" -eq 1 ]]; then
    require_exact_trailer "$message" 'phase-empty' 'true'
  else
    require_absent_trailer "$message" 'phase-empty'
  fi
}

validate_cancel_message() {
  local message="$1"
  local expected_id="$2"
  local expected_start="$3"
  local subject

  assert_only_phase_trailers "$message" 'phase-id' 'phase-boundary' 'phase-start' 'phase-cancel-reason'
  require_exact_trailer "$message" 'phase-id' "$expected_id"
  validate_boundary_value "$message" 'cancel'
  require_exact_trailer "$message" 'phase-start' "$expected_start"
  subject="$(message_subject "$message")"
  [[ "$subject" == "chore(phase): cancel $expected_id" ]] || die 'cancel marker subject is invalid'
  phase_trailer_values "$message" 'phase-cancel-reason'
  if [[ ${#TRAILER_VALUES[@]} -eq 1 ]]; then
    is_single_line_printable "${TRAILER_VALUES[0]}" || die 'cancel reason is invalid'
  elif [[ ${#TRAILER_VALUES[@]} -ne 0 ]]; then
    die 'message has multiple Phase-Cancel-Reason trailers'
  fi
}

validate_begin_marker() {
  local commit="$1"
  local message

  commit_has_single_parent "$commit" || die 'begin marker must have one parent'
  commit_is_empty "$commit" || die 'begin marker must be empty'
  message="$(message_from_commit "$commit")"
  validate_begin_message "$message"
}

validate_end_marker() {
  local commit="$1"
  local expected_id="$2"
  local expected_start="$3"
  local message expected_empty=0

  commit_has_single_parent "$commit" || die 'end marker must have one parent'
  if commit_is_empty "$commit"; then
    expected_empty=1
  fi
  message="$(message_from_commit "$commit")"
  validate_end_message "$message" "$expected_id" "$expected_start" "$expected_empty"
}

validate_cancel_marker() {
  local commit="$1"
  local expected_id="$2"
  local expected_start="$3"
  local message

  commit_has_single_parent "$commit" || die 'cancel marker must have one parent'
  commit_is_empty "$commit" || die 'cancel marker must be empty'
  message="$(message_from_commit "$commit")"
  validate_cancel_message "$message" "$expected_id" "$expected_start"
}

parse_policy_text() {
  local policy_text="$1"
  local line key value
  local baseline_seen=0
  local resolved_baseline

  POLICY_BASELINE=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || die 'committed phase policy is malformed'
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      PHASE_HISTORY_BASELINE)
        baseline_seen=$((baseline_seen + 1))
        POLICY_BASELINE="$value"
        ;;
      *) die 'committed phase policy has an unknown key' ;;
    esac
  done <<< "$policy_text"

  [[ "$baseline_seen" -eq 1 ]] || die 'committed phase policy must define one PHASE_HISTORY_BASELINE'
  is_full_sha "$POLICY_BASELINE" || die 'committed phase policy baseline must be a lowercase 40-character SHA'
  if ! resolved_baseline="$(resolve_commit "$POLICY_BASELINE")"; then
    die 'committed phase policy baseline does not resolve'
  fi
  [[ "$resolved_baseline" == "$POLICY_BASELINE" ]] || die 'committed phase policy baseline must be canonical'
}

load_policy_from_commit() {
  local target="$1"
  local policy_text

  if ! policy_text="$(git show "${target}:${CONFIG_RELATIVE_PATH}")"; then
    die "committed phase policy is missing from $target"
  fi
  parse_policy_text "$policy_text"
  POLICY_TARGET="$target"
}

validate_history() {
  local target="$1"
  local final_mode="$2"
  local target_sha baseline_sha commit boundary message
  local open_id=""
  local open_start=""
  local -a commits=()

  if ! target_sha="$(resolve_commit "$target")"; then
    die "history target does not resolve to a commit: $target"
  fi
  load_policy_from_commit "$target_sha"
  baseline_sha="$POLICY_BASELINE"
  if ! git merge-base --is-ancestor "$baseline_sha" "$target_sha"; then
    die 'history target does not descend from the committed policy baseline'
  fi
  if ! is_on_first_parent "$baseline_sha" "$target_sha"; then
    die 'committed policy baseline is not on the target first-parent history'
  fi

  mapfile -t commits < <(git rev-list --first-parent --reverse "${baseline_sha}..${target_sha}")
  for commit in "${commits[@]}"; do
    if [[ "$commit" == "$BOOTSTRAP_START_SHA" ]]; then
      [[ "$baseline_sha" == "$BOOTSTRAP_BASELINE_SHA" && -z "$open_id" ]] || die 'bootstrap marker is not the exact one-time transition'
      validate_bootstrap_marker "$commit"
      open_id="$BOOTSTRAP_PHASE_ID"
      open_start="$commit"
      continue
    fi

    message="$(message_from_commit "$commit")"
    phase_trailer_values "$message" 'phase-boundary'
    [[ ${#TRAILER_VALUES[@]} -eq 1 ]] || die 'history contains a non-boundary or duplicate-boundary commit'
    boundary="${TRAILER_VALUES[0],,}"
    case "$boundary" in
      begin)
        [[ -z "$open_id" ]] || die 'history contains nested phase boundaries'
        validate_begin_marker "$commit"
        open_id="$MARKER_PHASE_ID"
        open_start="$commit"
        ;;
      end)
        [[ -n "$open_id" ]] || die 'history ends a phase when no phase is open'
        validate_end_marker "$commit" "$open_id" "$open_start"
        open_id=""
        open_start=""
        ;;
      cancel)
        [[ -n "$open_id" ]] || die 'history cancels a phase when no phase is open'
        validate_cancel_marker "$commit" "$open_id" "$open_start"
        open_id=""
        open_start=""
        ;;
      *) die 'history has an invalid Phase-Boundary value' ;;
    esac
  done

  HISTORY_OPEN_ID="$open_id"
  HISTORY_OPEN_START="$open_start"
  case "$final_mode" in
    closed)
      [[ -z "$open_id" ]] || die 'history has an unpaired phase boundary'
      ;;
    any) ;;
    expected)
      [[ -n "$open_id" && "$open_id" == "$ACTIVE_ID" && "$open_start" == "$ACTIVE_START" ]] || die 'active state does not match adjacent phase history'
      ;;
    *) die 'invalid history validation mode' ;;
  esac
}

read_state() {
  local line key value mode
  local version=""
  local phase_id=""
  local start_sha=""
  local branch=""
  local branch_ref=""
  local worktree=""
  local version_seen=0
  local phase_seen=0
  local start_seen=0
  local branch_seen=0
  local branch_ref_seen=0
  local worktree_seen=0

  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && -O "$STATE_FILE" && -r "$STATE_FILE" ]] || die 'phase state is malformed or unreadable'
  if ! mode="$(stat -c '%a' "$STATE_FILE")"; then
    die 'cannot inspect phase state permissions'
  fi
  [[ "$mode" == '600' ]] || die 'phase state must have mode 600'

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || die 'phase state is malformed'
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      version) version_seen=$((version_seen + 1)); version="$value" ;;
      phase_id) phase_seen=$((phase_seen + 1)); phase_id="$value" ;;
      start_sha) start_seen=$((start_seen + 1)); start_sha="$value" ;;
      branch) branch_seen=$((branch_seen + 1)); branch="$value" ;;
      branch_ref) branch_ref_seen=$((branch_ref_seen + 1)); branch_ref="$value" ;;
      worktree) worktree_seen=$((worktree_seen + 1)); worktree="$value" ;;
      *) die 'phase state contains an unknown field' ;;
    esac
  done < "$STATE_FILE"

  [[ "$version_seen" -eq 1 && "$phase_seen" -eq 1 && "$start_seen" -eq 1 && "$branch_seen" -eq 1 && "$branch_ref_seen" -eq 1 && "$worktree_seen" -eq 1 ]] || die 'phase state is incomplete'
  [[ "$version" == "$STATE_VERSION" ]] || die 'phase state version is unsupported'
  is_phase_id "$phase_id" || die 'phase state has an invalid phase ID'
  is_full_sha "$start_sha" || die 'phase state has an invalid start SHA'
  is_single_line_printable "$branch" || die 'phase state has an invalid branch'
  [[ "$branch_ref" == "refs/heads/$branch" ]] || die 'phase state has an invalid branch reference'
  is_single_line_printable "$worktree" || die 'phase state has an invalid worktree'
  [[ "$(resolve_commit "$start_sha")" == "$start_sha" ]] || die 'phase state start SHA no longer resolves'

  ACTIVE_SOURCE='state'
  ACTIVE_ID="$phase_id"
  ACTIVE_START="$start_sha"
  ACTIVE_BRANCH="$branch"
  ACTIVE_REF="$branch_ref"
  ACTIVE_WORKTREE="$worktree"
}

validate_state_context() {
  local head

  current_branch_ref
  [[ "$ACTIVE_BRANCH" == "$CURRENT_BRANCH" && "$ACTIVE_REF" == "$CURRENT_REF" ]] || die 'phase branch identity mismatch'
  [[ "$ACTIVE_WORKTREE" == "$REPO_ROOT" ]] || die 'phase worktree identity mismatch'
  head="$(git rev-parse HEAD)"
  [[ "$head" == "$ACTIVE_START" ]] || die 'HEAD advanced after phase begin'
  validate_history "$head" expected
}

bootstrap_is_active() {
  local head="$1"

  [[ "$head" == "$BOOTSTRAP_START_SHA" ]] || return 1
  validate_bootstrap_marker "$head"
  return 0
}

resolve_active_phase() {
  local head

  ACTIVE_SOURCE=""
  ACTIVE_ID=""
  ACTIVE_START=""
  ACTIVE_BRANCH=""
  ACTIVE_REF=""
  ACTIVE_WORKTREE=""

  if [[ -e "$STATE_FILE" || -L "$STATE_FILE" ]]; then
    read_state
    validate_state_context
    return 0
  fi

  head="$(git rev-parse HEAD)"
  current_branch_ref
  if bootstrap_is_active "$head"; then
    ACTIVE_SOURCE='bootstrap'
    ACTIVE_ID="$BOOTSTRAP_PHASE_ID"
    ACTIVE_START="$BOOTSTRAP_START_SHA"
    ACTIVE_BRANCH="$CURRENT_BRANCH"
    ACTIVE_REF="$CURRENT_REF"
    ACTIVE_WORKTREE="$REPO_ROOT"
    return 0
  fi

  validate_history "$head" any
  if [[ -z "$HISTORY_OPEN_ID" ]]; then
    return 1
  fi
  die 'history has an open phase without state for this worktree'
}

write_state() {
  local phase_id="$1"
  local start_sha="$2"
  local branch="$3"
  local branch_ref="$4"
  local worktree="$5"
  local temporary_state

  [[ ! -e "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die 'cannot overwrite an existing phase state'
  if ! temporary_state="$(mktemp "$GIT_DIR/.phase-commit.state.XXXXXX")"; then
    die 'cannot create phase state'
  fi
  TEMP_FILES+=("$temporary_state")
  if ! printf 'version=%s\nphase_id=%s\nstart_sha=%s\nbranch=%s\nbranch_ref=%s\nworktree=%s\n' \
    "$STATE_VERSION" "$phase_id" "$start_sha" "$branch" "$branch_ref" "$worktree" > "$temporary_state"; then
    die 'cannot write phase state'
  fi
  chmod 600 "$temporary_state" || die 'cannot secure phase state'
  mv "$temporary_state" "$STATE_FILE" || die 'cannot install phase state'
}

clear_state() {
  [[ "$ACTIVE_SOURCE" == 'state' ]] || return 0
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die 'phase state disappeared before it could be cleared'
  rm -f -- "$STATE_FILE" || die 'cannot clear phase state after boundary commit'
}

release_lock() {
  if [[ "$LOCK_HELD" -eq 1 ]]; then
    rm -f -- "$LOCK_DIR/pid" || true
    rmdir -- "$LOCK_DIR" || true
    LOCK_HELD=0
  fi
  return 0
}

cleanup() {
  local status=$?
  local temporary

  for temporary in "${TEMP_FILES[@]}"; do
    rm -f -- "$temporary" || true
  done
  release_lock
  exit "$status"
}

acquire_lock() {
  if ! mkdir -- "$LOCK_DIR"; then
    die "phase lock is already held for this worktree: $LOCK_DIR"
  fi
  LOCK_HELD=1
  if ! printf '%s\n' "$$" > "$LOCK_DIR/pid"; then
    rmdir -- "$LOCK_DIR" || true
    LOCK_HELD=0
    die 'cannot record phase lock owner'
  fi
  chmod 600 "$LOCK_DIR/pid" || die 'cannot secure phase lock owner'
}

ensure_no_in_progress_operation() {
  local path

  for path in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-apply rebase-merge; do
    [[ ! -e "$GIT_DIR/$path" && ! -L "$GIT_DIR/$path" ]] || die 'cannot create a phase boundary during an in-progress Git operation'
  done
}

ensure_clean_worktree() {
  local status

  status="$(git status --porcelain=v1 --untracked-files=all)"
  [[ -z "$status" ]] || die 'worktree must be fully clean, including nonignored untracked files'
}

blob_has_high_confidence_secret() {
  local object_id="$1"
  local pattern='-----BEGIN ([A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}'

  LC_ALL=C grep -aEq -- "$pattern" < <(git cat-file blob "$object_id")
}

reject_staged_path() {
  local path="$1"
  local lower_path="${path,,}"
  local basename="${lower_path##*/}"

  case "/$lower_path/" in
    */test-results/*|*/artifacts/*|*/node_modules/*|*/dist/*|*/.next/*|*/coverage/*)
      die 'staged generated or secret path is forbidden'
      ;;
  esac
  case "$basename" in
    .env|.env.*)
      [[ "$basename" == '.env.example' ]] || die 'staged generated or secret path is forbidden'
      ;;
    auth.json|auth.yaml|auth.yml|credentials|credentials.*|credential|credential.*|*.pem|*.key|*.p12|*.pfx|id_rsa|id_ed25519|private-key*|*private-key*|private_key*|*private_key*|.ingenium-api-token)
      die 'staged generated or secret path is forbidden'
      ;;
  esac
  case "/$lower_path/" in
    */.auth/*|*/credentials/*|*/secrets/*)
      die 'staged generated or secret path is forbidden'
      ;;
  esac
}

validate_staged_path() {
  local path="$1"
  local literal_path=":(literal)$path"
  local entry metadata mode remainder object_id stage rendered_path

  while IFS= read -r -d '' entry; do
    metadata="${entry%%$'\t'*}"
    mode="${metadata%% *}"
    remainder="${metadata#* }"
    object_id="${remainder%% *}"
    stage="${remainder##* }"
    [[ "$stage" == '0' ]] || die 'staged index contains unmerged entries'
    [[ "$mode" != '120000' ]] || die 'staged symlinks are forbidden'
    reject_staged_path "$path"
    case "$mode" in
      100644|100755)
        if blob_has_high_confidence_secret "$object_id"; then
          printf -v rendered_path '%q' "$path"
          die "staged secret content is forbidden: $rendered_path"
        fi
        ;;
    esac
  done < <(git ls-files --stage -z -- "$literal_path")
}

validate_staged_entries() {
  local expected_head="$1"
  local path

  while IFS= read -r -d '' path; do
    validate_staged_path "$path"
  done < <(git diff --cached --name-only -z "$expected_head")
}

index_manifest_hash() {
  git ls-files --stage -z | git hash-object --stdin
}

capture_index_binding() {
  local expected_head="$1"

  assert_ref_at "$expected_head"
  validate_staged_entries "$expected_head"
  INDEX_TREE="$(git write-tree)" || die 'cannot write the staged index tree'
  INDEX_MANIFEST_SHA="$(index_manifest_hash)" || die 'cannot hash the staged index manifest'
}

assert_index_manifest() {
  local actual_tree actual_manifest

  actual_tree="$(git write-tree)" || die 'cannot inspect the staged index tree'
  actual_manifest="$(index_manifest_hash)" || die 'cannot inspect the staged index manifest'
  [[ "$actual_tree" == "$INDEX_TREE" && "$actual_manifest" == "$INDEX_MANIFEST_SHA" ]] || die 'a commit hook changed the verified index'
}

assert_pre_commit_binding() {
  local expected_head="$1"

  assert_ref_at "$expected_head"
  assert_index_manifest
}

ensure_end_index() {
  local expected_head="$1"
  local diff_status untracked unmerged

  if ! git diff --quiet; then
    die 'end requires no unstaged tracked changes'
  fi
  untracked="$(git ls-files --others --exclude-standard)"
  [[ -z "$untracked" ]] || die 'end requires no nonignored untracked files'
  unmerged="$(git ls-files -u)"
  [[ -z "$unmerged" ]] || die 'end cannot commit unmerged paths'

  if git diff --cached --quiet; then
    INDEX_HAS_CHANGES=0
  else
    diff_status=$?
    [[ "$diff_status" -eq 1 ]] || die 'cannot inspect staged changes'
    INDEX_HAS_CHANGES=1
  fi
  validate_staged_entries "$expected_head"
  if [[ "$INDEX_HAS_CHANGES" -eq 1 ]]; then
    git diff --cached --check || die 'staged changes fail git diff --cached --check'
  fi
}

validate_bootstrap_staged_policy() {
  local policy_text

  if ! policy_text="$(git show ":$CONFIG_RELATIVE_PATH")"; then
    die "bootstrap end must stage $CONFIG_RELATIVE_PATH so the policy becomes committed"
  fi
  parse_policy_text "$policy_text"
  [[ "$POLICY_BASELINE" == "$BOOTSTRAP_BASELINE_SHA" ]] || die 'bootstrap staged policy baseline is invalid'
}

create_message_file() {
  local temporary

  if ! temporary="$(mktemp "$GIT_DIR/.phase-commit-message.XXXXXX")"; then
    die 'cannot create temporary commit message'
  fi
  chmod 600 "$temporary" || die 'cannot secure temporary commit message'
  TEMP_FILES+=("$temporary")
  MESSAGE_FILE="$temporary"
}

write_boundary_message() {
  local subject="$1"
  local phase_id="$2"
  local boundary="$3"
  local start_sha="${4:-}"
  local empty_marker="${5:-0}"
  local cancel_reason="${6:-}"

  create_message_file
  {
    printf '%s\n\n' "$subject"
    printf 'Phase-Id: %s\n' "$phase_id"
    printf 'Phase-Boundary: %s\n' "$boundary"
    if [[ -n "$start_sha" ]]; then
      printf 'Phase-Start: %s\n' "$start_sha"
    fi
    if [[ "$empty_marker" -eq 1 ]]; then
      printf 'Phase-Empty: true\n'
    fi
    if [[ -n "$cancel_reason" ]]; then
      printf 'Phase-Cancel-Reason: %s\n' "$cancel_reason"
    fi
  } > "$MESSAGE_FILE"
}

hook_path() {
  local hook_name="$1"
  local path

  path="$(git rev-parse --git-path "hooks/$hook_name")"
  if [[ "$path" != /* ]]; then
    path="$REPO_ROOT/$path"
  fi
  printf '%s\n' "$path"
}

run_standard_hook() {
  local hook_name="$1"
  shift
  local path

  path="$(hook_path "$hook_name")"
  [[ -x "$path" && ! -d "$path" ]] || return 0
  (
    cd "$REPO_ROOT"
    "$path" "$@"
  )
}

validate_message_file() {
  local boundary="$1"
  local phase_id="$2"
  local start_sha="${3:-}"
  local empty_marker="${4:-0}"
  local message

  message="$(< "$MESSAGE_FILE")"
  case "$boundary" in
    begin) validate_begin_message "$message" "$phase_id" ;;
    end) validate_end_message "$message" "$phase_id" "$start_sha" "$empty_marker" ;;
    cancel) validate_cancel_message "$message" "$phase_id" "$start_sha" ;;
    *) die 'invalid phase boundary message type' ;;
  esac
}

run_pre_update_hooks() {
  local expected_head="$1"
  local boundary="$2"
  local phase_id="$3"
  local start_sha="${4:-}"
  local empty_marker="${5:-0}"

  if ! run_standard_hook pre-commit; then
    die 'pre-commit hook failed; phase state remains active'
  fi
  assert_pre_commit_binding "$expected_head"

  if ! run_standard_hook prepare-commit-msg "$MESSAGE_FILE" message; then
    die 'prepare-commit-msg hook failed; phase state remains active'
  fi
  assert_pre_commit_binding "$expected_head"
  validate_message_file "$boundary" "$phase_id" "$start_sha" "$empty_marker"

  if ! run_standard_hook commit-msg "$MESSAGE_FILE"; then
    die 'commit-msg hook failed; phase state remains active'
  fi
  assert_pre_commit_binding "$expected_head"
  validate_message_file "$boundary" "$phase_id" "$start_sha" "$empty_marker"
}

create_verified_commit() {
  local expected_head="$1"
  local boundary="$2"
  local phase_id="$3"
  local start_sha="${4:-}"
  local empty_marker="${5:-0}"
  local post_hook_failed=0
  local new_tree

  capture_index_binding "$expected_head"
  run_pre_update_hooks "$expected_head" "$boundary" "$phase_id" "$start_sha" "$empty_marker"
  assert_pre_commit_binding "$expected_head"

  if ! NEW_COMMIT="$(git commit-tree "$INDEX_TREE" -p "$expected_head" < "$MESSAGE_FILE")"; then
    die 'cannot create phase boundary commit'
  fi
  assert_pre_commit_binding "$expected_head"
  if ! git update-ref "$CURRENT_REF" "$NEW_COMMIT" "$expected_head"; then
    die 'branch advanced before the phase boundary could be recorded'
  fi
  assert_ref_at "$NEW_COMMIT"
  new_tree="$(git rev-parse "${NEW_COMMIT}^{tree}")"
  [[ "$new_tree" == "$INDEX_TREE" ]] || die 'created commit tree does not match the verified index'

  if ! run_standard_hook post-commit; then
    post_hook_failed=1
  fi
  assert_ref_at "$NEW_COMMIT"
  assert_index_manifest
  if [[ "$post_hook_failed" -eq 1 ]]; then
    printf 'phase-commit: post-commit hook failed after the branch update\n' >&2
  fi
}

resolve_history_target() {
  local requested="${1:-HEAD}"
  local range_start range_end

  HISTORY_RANGE_START=""
  [[ "$requested" != *$'\n'* && "$requested" != *$'\r'* && "$requested" != -* ]] || die 'history range is invalid'
  [[ "$requested" != *...* ]] || die 'history range must use exactly two dots'
  if [[ "$requested" == *..* ]]; then
    range_start="${requested%%..*}"
    range_end="${requested#*..}"
    [[ -n "$range_start" && -n "$range_end" && "$range_end" != *..* ]] || die 'history range is invalid'
    HISTORY_RANGE_START="$(resolve_commit "$range_start")" || die 'history range start does not resolve'
    RESOLVED_HISTORY_TARGET="$(resolve_commit "$range_end")" || die 'history range target does not resolve'
  else
    RESOLVED_HISTORY_TARGET="$(resolve_commit "$requested")" || die 'history target does not resolve'
  fi
}

command_begin() {
  local phase_id="$1"
  local head expected_tree

  is_phase_id "$phase_id" || die 'phase ID must be a lowercase slug of at most 64 characters'
  acquire_lock
  if resolve_active_phase; then
    die "phase $ACTIVE_ID is already active in this worktree"
  fi
  current_branch_ref
  head="$(git rev-parse HEAD)"
  validate_history "$head" closed
  ensure_no_in_progress_operation
  ensure_clean_worktree
  expected_tree="$(git rev-parse "${head}^{tree}")"
  write_boundary_message "chore(phase): begin $phase_id" "$phase_id" begin
  create_verified_commit "$head" begin "$phase_id"
  [[ "$INDEX_TREE" == "$expected_tree" ]] || die 'begin marker must use an unchanged index tree'
  validate_begin_marker "$NEW_COMMIT"
  [[ "$MARKER_PHASE_ID" == "$phase_id" ]] || die 'begin marker Phase-Id changed unexpectedly'
  write_state "$phase_id" "$NEW_COMMIT" "$CURRENT_BRANCH" "$CURRENT_REF" "$REPO_ROOT"
  ACTIVE_SOURCE='state'
  ACTIVE_ID="$phase_id"
  ACTIVE_START="$NEW_COMMIT"
  ACTIVE_BRANCH="$CURRENT_BRANCH"
  ACTIVE_REF="$CURRENT_REF"
  ACTIVE_WORKTREE="$REPO_ROOT"
  validate_history "$NEW_COMMIT" expected
  printf 'began phase %s at %s\n' "$phase_id" "$NEW_COMMIT"
}

command_end() {
  local allow_empty=0
  local phase_id message expected_empty=0

  if [[ "${1:-}" == '--allow-empty' ]]; then
    allow_empty=1
    shift
  fi
  [[ $# -eq 2 ]] || die 'end requires <phase-id> <commit-message>'
  phase_id="$1"
  message="$2"
  is_phase_id "$phase_id" || die 'phase ID must be a lowercase slug of at most 64 characters'
  validate_end_subject "$message" || die 'end commit message must be a conventional non-boundary subject'

  acquire_lock
  if ! resolve_active_phase; then
    die 'no active phase exists in this worktree'
  fi
  [[ "$ACTIVE_ID" == "$phase_id" ]] || die "cannot end $phase_id while $ACTIVE_ID is active"
  current_branch_ref
  [[ "$CURRENT_REF" == "$ACTIVE_REF" ]] || die 'phase branch identity changed before end'
  [[ "$(git rev-parse HEAD)" == "$ACTIVE_START" ]] || die 'HEAD advanced after phase begin'
  ensure_no_in_progress_operation
  ensure_end_index "$ACTIVE_START"
  if [[ "$INDEX_HAS_CHANGES" -eq 0 ]]; then
    [[ "$allow_empty" -eq 1 ]] || die 'end requires explicitly staged changes; use --allow-empty to create an empty end marker'
    expected_empty=1
  fi
  if [[ "$ACTIVE_SOURCE" == 'bootstrap' ]]; then
    validate_bootstrap_staged_policy
  fi

  write_boundary_message "$message" "$phase_id" end "$ACTIVE_START" "$expected_empty"
  create_verified_commit "$ACTIVE_START" end "$phase_id" "$ACTIVE_START" "$expected_empty"
  validate_end_marker "$NEW_COMMIT" "$phase_id" "$ACTIVE_START"
  validate_history "$NEW_COMMIT" closed
  clear_state
  printf 'ended phase %s at %s\n' "$phase_id" "$NEW_COMMIT"
}

command_cancel() {
  local phase_id="$1"
  local reason="${2:-}"

  is_phase_id "$phase_id" || die 'phase ID must be a lowercase slug of at most 64 characters'
  [[ -z "$reason" ]] || is_single_line_printable "$reason" || die 'cancel reason must be a printable single line'

  acquire_lock
  if ! resolve_active_phase; then
    die 'no active phase exists in this worktree'
  fi
  [[ "$ACTIVE_SOURCE" != 'bootstrap' ]] || die 'the exact bootstrap phase must end, not cancel'
  [[ "$ACTIVE_ID" == "$phase_id" ]] || die "cannot cancel $phase_id while $ACTIVE_ID is active"
  current_branch_ref
  [[ "$CURRENT_REF" == "$ACTIVE_REF" ]] || die 'phase branch identity changed before cancel'
  [[ "$(git rev-parse HEAD)" == "$ACTIVE_START" ]] || die 'HEAD advanced after phase begin'
  ensure_no_in_progress_operation
  ensure_clean_worktree

  write_boundary_message "chore(phase): cancel $phase_id" "$phase_id" cancel "$ACTIVE_START" 0 "$reason"
  create_verified_commit "$ACTIVE_START" cancel "$phase_id" "$ACTIVE_START"
  validate_cancel_marker "$NEW_COMMIT" "$phase_id" "$ACTIVE_START"
  validate_history "$NEW_COMMIT" closed
  clear_state
  printf 'cancelled phase %s at %s\n' "$phase_id" "$NEW_COMMIT"
}

command_status() {
  if resolve_active_phase; then
    printf 'active phase: %s\nstart: %s\nbranch: %s\nworktree: %s\nsource: %s\n' \
      "$ACTIVE_ID" "$ACTIVE_START" "$ACTIVE_BRANCH" "$ACTIVE_WORKTREE" "$ACTIVE_SOURCE"
  else
    printf 'no active phase\n'
  fi
}

command_verify_history() {
  local target

  resolve_history_target "${1:-HEAD}"
  target="$RESOLVED_HISTORY_TARGET"
  if [[ -n "${HISTORY_RANGE_START:-}" ]]; then
    load_policy_from_commit "$target"
    [[ "$HISTORY_RANGE_START" == "$POLICY_BASELINE" ]] || die 'history range must start at the committed policy baseline'
  fi
  validate_history "$target" closed
  printf 'phase history is valid through %s\n' "$target"
}

main() {
  local command

  [[ $# -ge 1 ]] || {
    usage >&2
    exit 2
  }
  command="$1"
  shift

  reject_ambient_git_overrides
  initialize_repository
  trap cleanup EXIT

  case "$command" in
    begin)
      [[ $# -eq 1 ]] || die 'begin requires <phase-id>'
      command_begin "$1"
      ;;
    end)
      command_end "$@"
      ;;
    cancel)
      [[ $# -ge 1 && $# -le 2 ]] || die 'cancel requires <phase-id> [reason]'
      command_cancel "$@"
      ;;
    status)
      [[ $# -eq 0 ]] || die 'status does not accept arguments'
      command_status
      ;;
    verify-history)
      [[ $# -le 1 ]] || die 'verify-history accepts at most one range'
      command_verify_history "$@"
      ;;
    -h|--help|help)
      [[ $# -eq 0 ]] || die 'help does not accept arguments'
      usage
      ;;
    *)
      usage >&2
      die "unknown command: $command"
      ;;
  esac
}

main "$@"
