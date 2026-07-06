#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# wsl-cleanup.sh — Safe WSL2 Ubuntu Cleanup Utility
#
# Safely reclaims disk space on WSL2 Ubuntu by cleaning Docker, apt, pip, npm,
# yarn, systemd journals, temp files, trash, snap, and model caches.
#
# Every destructive step requires explicit user confirmation. The script NEVER
# touches $HOME/repos or any subdirectory (HARD RULE).
#
# Usage: ./wsl-cleanup.sh [--dry-run] [--allow-root]
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Metadata ──
readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"
readonly REPOS_DIR="${HOME}/repos"

# ── Global State ──
DRY_RUN=false
ALLOW_ROOT=false
TOTAL_FREED=0
declare -a ITEM_NAMES=()
declare -a ITEM_BYTES=()

# ── Terminal Colors (disabled for non-interactive) ──
if [[ -t 1 ]]; then
    readonly RST='\033[0m'
    readonly GRN='\033[0;32m'
    readonly YLW='\033[1;33m'
    readonly RED='\033[0;31m'
    readonly CYN='\033[0;36m'
    readonly BLD='\033[1m'
else
    readonly RST=''
    readonly GRN=''
    readonly YLW=''
    readonly RED=''
    readonly CYN=''
    readonly BLD=''
fi

# ══════════════════════════════════════════════════════════════════════════════
# CORE UTILITY FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

# ── usage — Print usage information and exit ──
usage() {
    cat <<EOF
${BLD}${SCRIPT_NAME}${RST} — Safe WSL2 Ubuntu Cleanup Utility v${SCRIPT_VERSION}

${BLD}Usage:${RST} ${SCRIPT_NAME} [OPTIONS]

${BLD}Options:${RST}
    --dry-run       Show what would be done without executing destructive commands
    --allow-root    Allow running as root (NOT RECOMMENDED)
    --help, -h      Show this help message and exit

${BLD}Safety guarantees:${RST}
    • Every destructive step requires explicit [y/N] confirmation
    • The script NEVER touches \${HOME}/repos or any subdirectory (HARD RULE)
    • Tool presence is checked before every operation — missing tools are skipped
    • Running as root is blocked unless --allow-root is passed
    • Dry-run mode previews operations without executing them
    • ${RED}--force / -f flags are NEVER used without explicit user consent${RST}

${BLD}Operations:${RST}
    Cleanup steps (each prompted separately):
      1. Docker system prune (containers, networks, images, volumes)
      2. Docker aggressive prune (remove all unused images, not just dangling)
      3. Docker build cache prune
      4. APT cache clean + autoclean
      5. APT autoremove (remove unused package dependencies)
      6. pip cache purge
      7. npm cache clean
      8. yarn cache clean
      9. Systemd journal vacuum (limit to 200M)
      10. Temp file cleanup (/tmp and /var/tmp, files untouched for 3+ days)
      11. Trash directory empty (~/.local/share/Trash)
      12. Snap disabled revision cleanup
      13. AI/ML model cache cleanup (LM Studio, Ollama, HuggingFace, PyTorch)
EOF
    exit 0
}

# ── log / warn / error — Colored output helpers ──
log()   { echo -e "${GRN}[INFO]${RST} $*"; }
warn()  { echo -e "${YLW}[WARN]${RST} $*"; }
error() { echo -e "${RED}[ERROR]${RST} $*" >&2; }

# ── header — Section header divider ──
header() {
    echo ""
    echo -e "${CYN}══════════════════════════════════════════════════════════════${RST}"
    echo -e "${CYN}  $*${RST}"
    echo -e "${CYN}══════════════════════════════════════════════════════════════${RST}"
    echo ""
}

# ── confirm — Yes/no prompt, returns 0 for yes, 1 for no ──
confirm() {
    local prompt="$1"
    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would ask: ${prompt} [y/N]"
        return 0
    fi
    local response
    read -r -p "${prompt} [y/N] " response
    [[ "$response" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# ── sanitize_digits — Strip all non-digit characters from a string ──
# Also removes whitespace/newlines. Returns "0" if empty after stripping.
sanitize_digits() {
    local val
    val="${1//[!0-9]/}"
    val="${val:-0}"
    echo "$val"
}

# ── human_readable — Convert bytes to human-friendly format ──
# Usage: human_readable 2147483648  →  "2.0 GB"
human_readable() {
    local bytes
    bytes="$(sanitize_digits "${1:-0}")"
    if (( bytes < 1024 )); then
        echo "${bytes} B"
    elif (( bytes < 1048576 )); then
        echo "$(awk "BEGIN { printf \"%.1f\", $bytes / 1024 }") KB"
    elif (( bytes < 1073741824 )); then
        echo "$(awk "BEGIN { printf \"%.1f\", $bytes / 1048576 }") MB"
    else
        echo "$(awk "BEGIN { printf \"%.1f\", $bytes / 1073741824 }") GB"
    fi
}

# ── check_repos_exclusion — Verify a path is NOT inside $REPOS_DIR ──
# Returns 0 if safe, 1 if blocked. MUST be called before every filesystem op.
check_repos_exclusion() {
    local target
    target="$(realpath "$1" 2>/dev/null || echo "$1")"
    local repos_real
    repos_real="$(realpath "$REPOS_DIR" 2>/dev/null || echo "$REPOS_DIR")"
    if [[ "$target" == "$repos_real"* ]]; then
        error "BLOCKED: $1 is inside ${REPOS_DIR} — this is a HARD RULE violation. Skipping."
        return 1
    fi
    return 0
}

# ── calculate_freed — Return freed space in bytes (no negative values) ──
calculate_freed() {
    local before after
    before="$(sanitize_digits "${1:-0}")"
    after="$(sanitize_digits "${2:-0}")"
    if (( before > after )); then
        echo $(( before - after ))
    else
        echo 0
    fi
}

# ── record_result — Append an item to the summary table ──
record_result() {
    local name="$1"
    local bytes=$2
    ITEM_NAMES+=("$name")
    ITEM_BYTES+=("$bytes")
    TOTAL_FREED=$(( TOTAL_FREED + bytes ))
}

# ══════════════════════════════════════════════════════════════════════════════
# ASSESSMENT / INFO FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

# ── check_disk — Show df -h for a mount point ──
check_disk() {
    local mount_point="${1:-/}"
    log "Disk usage for ${mount_point}:"
    df -h "$mount_point" | tail -n1
}

# ── docker_assess — Display current Docker disk usage ──
docker_assess() {
    if ! command -v docker &>/dev/null; then
        warn "Docker not installed. Skipping assessment."
        return 0
    fi
    header "Docker Disk Assessment"
    log "Current Docker disk usage:"
    docker system df 2>&1 || true
}

# ══════════════════════════════════════════════════════════════════════════════
# CLEANUP FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

# Helper: measure directory size in bytes (safe, with error handling)
dir_bytes() {
    local dir="$1"
    if [[ -z "$dir" || ! -d "$dir" ]]; then
        echo "0"
        return
    fi
    du -sb "$dir" 2>/dev/null | cut -f1 || echo "0"
}

# Helper: parse docker reclaimed space output into bytes
parse_reclaimed() {
    local output="$1"
    local line
    line=$(echo "$output" | grep -i 'reclaimed' | head -1 || true)
    if [[ -z "$line" ]]; then
        echo 0
        return
    fi
    # Match patterns like "2.1GB", "340 MB", "Total reclaimed space: 2.1GB"
    if [[ "$line" =~ ([0-9]+(\.[0-9]+)?)[[:space:]]*([KMGT]?B) ]]; then
        local num="${BASH_REMATCH[1]}"
        local unit="${BASH_REMATCH[3]}"
        case "$unit" in
            kB|KB) awk "BEGIN { printf \"%.0f\", $num * 1024 }" ;;
            MB)    awk "BEGIN { printf \"%.0f\", $num * 1048576 }" ;;
            GB)    awk "BEGIN { printf \"%.0f\", $num * 1073741824 }" ;;
            TB)    awk "BEGIN { printf \"%.0f\", $num * 1099511627776 }" ;;
            *)     echo 0 ;;
        esac
    else
        echo 0
    fi
}

# ── clean_docker — docker system prune --volumes (with confirmation) ──
# Removes: stopped containers, unused networks, dangling images, unused volumes
clean_docker() {
    local name="Docker system prune"
    if ! command -v docker &>/dev/null; then
        warn "Docker not installed. Skipping ${name}."
        return 0
    fi
    header "${name}"

    log "Current Docker disk usage:"
    docker system df 2>&1 || true

    if ! confirm "Remove stopped containers, unused networks, dangling images, and unused volumes?"; then
        log "Skipped."
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would execute: docker system prune --volumes"
        record_result "$name" 0
        return 0
    fi

    local output
    output=$(docker system prune --volumes 2>&1) || true
    echo "$output"

    local freed
    freed=$(parse_reclaimed "$output")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_docker_aggressive — docker system prune -a --volumes (⚠️ extra caution) ──
# ALSO removes all unused images (not just dangling), all stopped containers
clean_docker_aggressive() {
    local name="Docker aggressive prune"
    if ! command -v docker &>/dev/null; then
        warn "Docker not installed. Skipping ${name}."
        return 0
    fi
    header "${name} [⚠️  AGGRESSIVE]"

    warn "This removes ALL unused images, not just dangling ones."
    warn "You will need to re-pull any images you use."
    echo ""

    if ! confirm "Remove ALL unused images, containers, networks, and volumes?"; then
        log "Skipped."
        return 0
    fi

    # Extra confirmation for this aggressive step
    if ! confirm "⚠️  Really proceed? This is destructive and requires re-downloading images."; then
        log "Skipped."
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would execute: docker system prune --all --volumes"
        record_result "$name" 0
        return 0
    fi

    local output
    output=$(docker system prune --all --volumes 2>&1) || true
    echo "$output"

    local freed
    freed=$(parse_reclaimed "$output")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_docker_builder — docker builder prune ──
clean_docker_builder() {
    local name="Docker build cache prune"
    if ! command -v docker &>/dev/null; then
        warn "Docker not installed. Skipping ${name}."
        return 0
    fi
    header "${name}"

    if ! confirm "Remove Docker BuildKit build cache?"; then
        log "Skipped."
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would execute: docker builder prune"
        record_result "$name" 0
        return 0
    fi

    local output
    output=$(docker builder prune 2>&1) || true
    echo "$output"

    local freed
    freed=$(parse_reclaimed "$output")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_apt — apt-get clean + autoclean ──
clean_apt() {
    local name="APT cache clean"
    if ! command -v apt-get &>/dev/null; then
        warn "apt-get not installed. Skipping ${name}."
        return 0
    fi
    header "APT Cache Cleanup"

    local cache_dir="/var/cache/apt/archives"
    if [[ ! -d "$cache_dir" ]]; then
        log "APT cache directory ${cache_dir} not found. Nothing to clean."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes "$cache_dir")
    log "Current APT cache size: $(human_readable "$before")"

    if ! confirm "Run apt-get clean (removes all .deb package files from cache)?"; then
        log "Skipped apt-get clean."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        log "Running: sudo apt-get clean"
        sudo apt-get clean 2>&1 || warn "apt-get clean failed."
        log "Running: sudo apt-get autoclean"
        sudo apt-get autoclean 2>&1 || warn "apt-get autoclean failed."
    else
        log "[DRY-RUN] Would run: sudo apt-get clean && sudo apt-get autoclean"
    fi

    after=$(dir_bytes "$cache_dir")
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_apt_autoremove — apt-get autoremove --purge (with review prompt) ──
clean_apt_autoremove() {
    local name="APT autoremove"
    if ! command -v apt-get &>/dev/null; then
        warn "apt-get not installed. Skipping ${name}."
        return 0
    fi
    header "APT Autoremove"

    log "Checking for packages that can be autoremoved..."
    local dry_run_output
    dry_run_output=$(apt-get --dry-run autoremove 2>/dev/null || true)

    # Count packages to be removed
    local pkg_count
    pkg_count=$(echo "$dry_run_output" | grep -c '^Remv ' || true)
    if [[ "$pkg_count" -eq 0 ]]; then
        log "No packages to autoremove."
        record_result "$name" 0
        return 0
    fi
    log "${pkg_count} package(s) can be autoremoved."

    if confirm "Show packages to be removed?"; then
        echo "$dry_run_output" | grep '^Remv ' || true
        echo ""
    fi

    if ! confirm "Run apt-get autoremove --purge?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        log "Running: sudo apt-get autoremove --purge"
        sudo apt-get autoremove --purge 2>&1 || warn "apt-get autoremove failed or was cancelled."
    else
        log "[DRY-RUN] Would run: sudo apt-get autoremove --purge"
    fi

    # Measure space change in apt archives as a rough proxy
    local before after freed
    before=$(dir_bytes /var/cache/apt/archives)
    after=$(dir_bytes /var/cache/apt/archives)
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "APT cache size change: $(human_readable "$freed")"
    log "(Note: autoremove also frees disk outside apt cache. Run 'df -h /' to see total effect.)"
}

# ── clean_pip_cache — pip cache purge ──
clean_pip_cache() {
    local name="pip cache"
    local pip_cmd=""

    if command -v pip3 &>/dev/null; then
        pip_cmd="pip3"
    elif command -v pip &>/dev/null; then
        pip_cmd="pip"
    else
        warn "pip not installed. Skipping ${name}."
        return 0
    fi
    header "pip Cache Cleanup"

    # Find pip cache directory
    local pip_cache_dir
    pip_cache_dir=$("${pip_cmd}" cache dir 2>/dev/null || true)
    if [[ -z "$pip_cache_dir" || ! -d "$pip_cache_dir" ]]; then
        pip_cache_dir="${HOME}/.cache/pip"
    fi

    if [[ ! -d "$pip_cache_dir" ]]; then
        log "pip cache directory not found at ${pip_cache_dir}."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes "$pip_cache_dir")
    log "pip cache directory: ${pip_cache_dir}"
    log "Current size: $(human_readable "$before")"

    if ! confirm "Run ${pip_cmd} cache purge?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        "${pip_cmd}" cache purge 2>&1 || true
    else
        log "[DRY-RUN] Would run: ${pip_cmd} cache purge"
    fi

    after=$(dir_bytes "$pip_cache_dir")
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_npm_cache — npm cache clean (requires --force confirmation) ──
clean_npm_cache() {
    local name="npm cache"
    if ! command -v npm &>/dev/null; then
        warn "npm not installed. Skipping ${name}."
        return 0
    fi
    header "npm Cache Cleanup"

    local npm_cache_dir
    npm_cache_dir=$(npm config get cache 2>/dev/null || true)
    if [[ -z "$npm_cache_dir" ]]; then
        npm_cache_dir="${HOME}/.npm"
    fi

    if [[ ! -d "$npm_cache_dir" ]]; then
        log "npm cache directory not found at ${npm_cache_dir}."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes "$npm_cache_dir")
    log "npm cache directory: ${npm_cache_dir}"
    log "Current size: $(human_readable "$before")"

    warn "npm cache clean requires the --force flag (npm design requirement)."
    if ! confirm "Allow --force and proceed with npm cache clean?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        npm cache clean --force 2>&1 || true
    else
        log "[DRY-RUN] Would run: npm cache clean --force"
    fi

    after=$(dir_bytes "$npm_cache_dir")
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_yarn_cache — yarn cache clean (if yarn exists) ──
clean_yarn_cache() {
    local name="yarn cache"
    if ! command -v yarn &>/dev/null; then
        warn "yarn not installed. Skipping ${name}."
        return 0
    fi
    header "yarn Cache Cleanup"

    local yarn_cache_dir
    yarn_cache_dir=$(yarn cache dir 2>/dev/null || true)
    if [[ -z "$yarn_cache_dir" ]]; then
        warn "Could not determine yarn cache directory."
        record_result "$name" 0
        return 0
    fi

    if [[ ! -d "$yarn_cache_dir" ]]; then
        log "yarn cache directory not found at ${yarn_cache_dir}."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes "$yarn_cache_dir")
    log "yarn cache directory: ${yarn_cache_dir}"
    log "Current size: $(human_readable "$before")"

    if ! confirm "Run yarn cache clean?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        yarn cache clean 2>&1 || true
    else
        log "[DRY-RUN] Would run: yarn cache clean"
    fi

    after=$(dir_bytes "$yarn_cache_dir")
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_journal — journalctl --vacuum-size=200M ──
clean_journal() {
    local name="Systemd journal vacuum"
    if ! command -v journalctl &>/dev/null; then
        warn "journalctl not installed. Skipping ${name}."
        return 0
    fi
    header "Systemd Journal Cleanup"

    local before after
    before=$(journalctl --disk-usage 2>/dev/null || true)
    log "Current journal disk usage:"
    echo "${before}"

    if ! confirm "Vacuum systemd journals to 200M limit?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        log "Running: sudo journalctl --vacuum-size=200M"
        sudo journalctl --vacuum-size=200M 2>&1 || warn "journalctl vacuum failed."
    else
        log "[DRY-RUN] Would run: sudo journalctl --vacuum-size=200M"
    fi

    after=$(journalctl --disk-usage 2>/dev/null || true)
    log "Journal disk usage after:"
    echo "${after}"

    # Parse before/after sizes to calculate freed space
    local before_bytes=0 after_bytes=0
    if [[ "${before}" =~ ([0-9]+(\.[0-9]+)?)[[:space:]]*([KMGT]) ]]; then
        local bnum="${BASH_REMATCH[1]}"
        local bunit="${BASH_REMATCH[3]}"
        case "${bunit}" in
            K) before_bytes=$(awk "BEGIN { printf \"%.0f\", $bnum * 1024 }") ;;
            M) before_bytes=$(awk "BEGIN { printf \"%.0f\", $bnum * 1048576 }") ;;
            G) before_bytes=$(awk "BEGIN { printf \"%.0f\", $bnum * 1073741824 }") ;;
        esac
    fi
    if [[ "${after}" =~ ([0-9]+(\.[0-9]+)?)[[:space:]]*([KMGT]) ]]; then
        local anum="${BASH_REMATCH[1]}"
        local aunit="${BASH_REMATCH[3]}"
        case "${aunit}" in
            K) after_bytes=$(awk "BEGIN { printf \"%.0f\", $anum * 1024 }") ;;
            M) after_bytes=$(awk "BEGIN { printf \"%.0f\", $anum * 1048576 }") ;;
            G) after_bytes=$(awk "BEGIN { printf \"%.0f\", $anum * 1073741824 }") ;;
        esac
    fi

    local freed
    freed=$(calculate_freed "$before_bytes" "$after_bytes")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_temp — Safe /tmp and /var/tmp cleanup (atime+3 regular files only) ──
# Uses find with -type -f and -atime +3, targeting only regular files,
# never glob patterns. Each operation requires confirmation.
clean_temp() {
    local name="Temporary files (atime > 3 days)"
    header "Temp File Cleanup"

    local temp_dirs=("/tmp" "/var/tmp")
    local total_freed=0

    for temp_dir in "${temp_dirs[@]}"; do
        if [[ ! -d "$temp_dir" ]]; then
            log "Directory ${temp_dir} does not exist. Skipping."
            continue
        fi

        log "Scanning ${temp_dir} for regular files with atime > 3 days..."

        # Count old files — capture wc output safely (|| true prevents pipefail issues)
        local file_count=0
        file_count=$(sudo find "${temp_dir}" -type f -atime +3 2>/dev/null | wc -l) || true
        file_count="$(sanitize_digits "$file_count")"

        if [[ "$file_count" -eq 0 ]]; then
            log "  No qualifying files found in ${temp_dir}."
            continue
        fi

        # Measure total size of old files (in bytes)
        local total_bytes=0
        total_bytes=$(sudo find "${temp_dir}" -type f -atime +3 -printf '%s\n' 2>/dev/null | awk '{sum+=$1} END {print sum}') || true
        total_bytes="$(sanitize_digits "$total_bytes")"

        log "  Found ${file_count} file(s), total size: $(human_readable "$total_bytes")"

        # Preview first 20 files
        log "  Preview (first 20 files):"
        sudo find "${temp_dir}" -type f -atime +3 -ls 2>/dev/null | head -20 || true

        echo ""
        if ! confirm "Delete ${file_count} old file(s) from ${temp_dir}?"; then
            log "  Skipped ${temp_dir}."
            continue
        fi

        if [[ "$DRY_RUN" == "false" ]]; then
            log "  Deleting files in ${temp_dir}..."
            sudo find "${temp_dir}" -type f -atime +3 -delete 2>/dev/null || true
        else
            log "  [DRY-RUN] Would delete ${file_count} file(s) from ${temp_dir}"
        fi

        local after_bytes=0
        after_bytes=$(sudo find "${temp_dir}" -type f -atime +3 -printf '%s\n' 2>/dev/null | awk '{sum+=$1} END {print sum}') || true
        after_bytes="$(sanitize_digits "$after_bytes")"

        local dir_freed
        dir_freed=$(calculate_freed "$total_bytes" "$after_bytes")
        total_freed=$(( total_freed + dir_freed ))
        log "  Freed $(human_readable "$dir_freed") from ${temp_dir}"
    done

    record_result "$name" "$total_freed"
    log "Total temp space freed: $(human_readable "$total_freed")"
}

# ── clean_trash — Empty ~/.local/share/Trash/ ──
clean_trash() {
    local name="Trash directory"
    header "Trash Directory Cleanup"

    local trash_dir="${HOME}/.local/share/Trash"

    if [[ ! -d "$trash_dir" ]]; then
        log "Trash directory not found at ${trash_dir}. Nothing to clean."
        record_result "$name" 0
        return 0
    fi

    # Validate path safety
    if ! check_repos_exclusion "$trash_dir"; then
        error "Trash directory failed repos exclusion check. Skipping."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes "$trash_dir")
    log "Trash directory: ${trash_dir}"
    log "Current size: $(human_readable "$before")"

    if [[ "$before" -eq 0 ]]; then
        log "Trash is already empty."
        record_result "$name" 0
        return 0
    fi

    if ! confirm "Empty trash at ${trash_dir}?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would remove contents of: ${trash_dir}"
        record_result "$name" 0
        return 0
    fi

    # Remove trash contents safely — never remove the directory itself
    if [[ -d "${trash_dir}/files" ]]; then
        find "${trash_dir}/files" -type f -delete 2>/dev/null || true
        find "${trash_dir}/files" -type d -empty -delete 2>/dev/null || true
    fi
    if [[ -d "${trash_dir}/info" ]]; then
        find "${trash_dir}/info" -type f -delete 2>/dev/null || true
        find "${trash_dir}/info" -type d -empty -delete 2>/dev/null || true
    fi

    after=$(dir_bytes "$trash_dir")
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_snap — Remove disabled snap revisions ──
clean_snap() {
    local name="Snap disabled revisions"
    if ! command -v snap &>/dev/null; then
        warn "snap not installed. Skipping ${name}."
        return 0
    fi
    header "Snap Cleanup"

    # Show disabled snap revisions
    local disabled
    disabled=$(snap list --all 2>/dev/null | awk '/disabled/' || true)
    if [[ -z "$disabled" ]]; then
        log "No disabled snap revisions found."
        record_result "$name" 0
        return 0
    fi

    log "Disabled snap revisions:"
    echo "$disabled"
    echo ""

    # Also check snap cache size
    local snap_cache="/var/lib/snapd/cache"
    if [[ -d "$snap_cache" ]]; then
        local cache_size
        cache_size=$(du -sh "$snap_cache" 2>/dev/null | cut -f1) || true
        if [[ -z "$cache_size" ]]; then cache_size="unknown"; fi
        log "Snap cache directory size: ${cache_size}"
    fi

    if ! confirm "Remove all disabled snap revisions?"; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    local before after freed
    before=$(dir_bytes /var/lib/snapd)

    if [[ "$DRY_RUN" == "true" ]]; then
        log "[DRY-RUN] Would remove disabled snap revisions"
        record_result "$name" 0
        return 0
    fi

    # Process each disabled revision
    local removed_count=0
    while IFS= read -r line; do
        local sname srev
        sname=$(echo "$line" | awk '{print $1}')
        srev=$(echo "$line" | awk '{print $3}')
        if [[ -z "$sname" || -z "$srev" ]]; then
            continue
        fi
        log "Removing ${sname} revision ${srev}..."
        sudo snap remove "$sname" --revision "$srev" 2>&1 || warn "Failed to remove ${sname} rev ${srev}"
        removed_count=$(( removed_count + 1 ))
    done < <(snap list --all 2>/dev/null | awk '/disabled/')

    log "Removed ${removed_count} disabled snap revision(s)."

    # Also clean snap cache
    if [[ -d "$snap_cache" ]]; then
        log "Cleaning snap cache..."
        sudo find "$snap_cache" -type f -delete 2>/dev/null || true
    fi

    after=$(dir_bytes /var/lib/snapd)
    freed=$(calculate_freed "$before" "$after")
    record_result "$name" "$freed"
    log "Space freed: $(human_readable "$freed")"
}

# ── clean_model_caches — Report and clean AI/ML model caches ──
clean_model_caches() {
    local name="AI/ML model caches"
    header "Model Cache Cleanup"

    # Collect all model cache directories with their labels
    local -a cache_labels=()
    local -a cache_paths=()

    # LM Studio
    local lmstudio_paths=(
        "${HOME}/.cache/lm-studio"
        "${HOME}/.lmstudio/cache"
    )
    for p in "${lmstudio_paths[@]}"; do
        if [[ -d "$p" ]]; then
            cache_labels+=("LM Studio")
            cache_paths+=("$p")
        fi
    done

    # Ollama
    local ollama_paths=(
        "${HOME}/.ollama/models"
        "/usr/share/ollama/models"
    )
    for p in "${ollama_paths[@]}"; do
        if [[ -d "$p" ]]; then
            cache_labels+=("Ollama")
            cache_paths+=("$p")
        fi
    done

    # HuggingFace
    local hf_path="${HOME}/.cache/huggingface"
    if [[ -d "$hf_path" ]]; then
        cache_labels+=("HuggingFace")
        cache_paths+=("$hf_path")
    fi

    # PyTorch
    local torch_path="${HOME}/.cache/torch"
    if [[ -d "$torch_path" ]]; then
        cache_labels+=("PyTorch")
        cache_paths+=("$torch_path")
    fi

    if [[ ${#cache_labels[@]} -eq 0 ]]; then
        log "No model caches found."
        record_result "$name" 0
        return 0
    fi

    log "Found ${#cache_labels[@]} model cache location(s):"
    for i in "${!cache_labels[@]}"; do
        local size
        size=$(du -sh "${cache_paths[$i]}" 2>/dev/null | cut -f1) || true
        if [[ -z "$size" ]]; then size="unknown"; fi
        echo "  • ${cache_labels[$i]}: ${cache_paths[$i]} (${size})"
    done
    echo ""

    if ! confirm "Clean model caches? This will require re-downloading models."; then
        log "Skipped."
        record_result "$name" 0
        return 0
    fi

    for i in "${!cache_labels[@]}"; do
        local label="${cache_labels[$i]}"
        local path="${cache_paths[$i]}"

        # Safety: validate path
        if [[ -z "$path" || ! -d "$path" ]]; then
            continue
        fi
        if ! check_repos_exclusion "$path"; then
            error "  ${label} cache at ${path} blocked by repos exclusion. Skipping."
            continue
        fi
        # Also verify path is not the root or home directory
        if [[ "$path" == "/" || "$path" == "$HOME" ]]; then
            error "  ${label} cache path is root or home directory. BLOCKED."
            continue
        fi

        local size
        size=$(du -sh "$path" 2>/dev/null | cut -f1) || true
        if [[ -z "$size" ]]; then size="?"; fi
        echo ""
        if ! confirm "  Clean ${label} cache (${size}) at ${path}?"; then
            log "  Skipped ${label}."
            continue
        fi

        local before after freed
        before=$(dir_bytes "$path")

        if [[ "$DRY_RUN" == "true" ]]; then
            log "  [DRY-RUN] Would remove: ${path}"
            freed=0
        else
            log "  Removing ${path}..."
            rm -rf "$path" 2>/dev/null || warn "Failed to remove ${path}"
            after=$(dir_bytes "$path")
            # If directory no longer exists, after will be 0
            freed=$(calculate_freed "$before" "$after")
        fi

        record_result "${label} cache" "$freed"
        log "  Freed $(human_readable "$freed") from ${label}"
    done
}

# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY TABLE
# ══════════════════════════════════════════════════════════════════════════════

# ── hr_repeat — Repeat a character N times (safe for multi-byte UTF-8) ──
hr_repeat() {
    local char="$1" count="$2"
    if [[ "$count" -le 0 ]]; then
        return
    fi
    # Use printf with seq to repeat the character (each seq arg triggers one format iteration)
    printf "${char}%.0s" $(seq 1 "$count")
}

# ── summarize — Print a formatted "Space Freed" table with box-drawing chars ──
summarize() {
    header "Cleanup Summary"

    if [[ ${#ITEM_NAMES[@]} -eq 0 ]]; then
        log "No cleanup operations were performed."
        return 0
    fi

    # Column dimensions
    local col1=38   # Name column content width (total including padding = col1 + 2)
    local col2=14   # Value column content width

    # Top border:  ╔═(col1+2)╦═(col2+2)╗
    echo -n "╔"
    hr_repeat "═" "$(( col1 + 2 ))"
    echo -n "╦"
    hr_repeat "═" "$(( col2 + 2 ))"
    echo "╗"

    # Header row
    printf "║ %-*s ║ %*s ║\n" "$col1" "Cleanup Item" "$col2" "Space Freed"

    # Separator
    echo -n "╠"
    hr_repeat "═" "$(( col1 + 2 ))"
    echo -n "╬"
    hr_repeat "═" "$(( col2 + 2 ))"
    echo "╣"

    # Data rows
    local grand_total=0
    for i in "${!ITEM_NAMES[@]}"; do
        local name="${ITEM_NAMES[$i]}"
        local bytes="${ITEM_BYTES[$i]}"
        local formatted
        formatted=$(human_readable "$bytes")
        grand_total=$(( grand_total + bytes ))
        printf "║ %-*s ║ %*s ║\n" "$col1" "$name" "$col2" "$formatted"
    done

    # Bottom separator before total
    echo -n "╠"
    hr_repeat "═" "$(( col1 + 2 ))"
    echo -n "╬"
    hr_repeat "═" "$(( col2 + 2 ))"
    echo "╣"

    # Total row
    local total_formatted
    total_formatted=$(human_readable "$grand_total")
    printf "║ ${BLD}%-*s${RST} ║ ${BLD}%*s${RST} ║\n" "$col1" "TOTAL" "$col2" "$total_formatted"

    # Bottom border
    echo -n "╚"
    hr_repeat "═" "$(( col1 + 2 ))"
    echo -n "╩"
    hr_repeat "═" "$(( col2 + 2 ))"
    echo "╝"

    echo ""
    log "Total space freed: ${BLD}${total_formatted}${RST}"
}

# ══════════════════════════════════════════════════════════════════════════════
# TRAP HANDLER
# ══════════════════════════════════════════════════════════════════════════════

cleanup() {
    log "Cleanup complete."
}
trap cleanup EXIT

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

main() {
    # ── Parse flags ──
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --allow-root)
                ALLOW_ROOT=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # ── Root check ──
    if [[ $EUID -eq 0 && "$ALLOW_ROOT" != "true" ]]; then
        error "Running as root is dangerous."
        error "Use --allow-root if you understand the risks."
        exit 1
    fi

    # ── Pre-flight banner ──
    echo ""
    echo -e "${BLD}${SCRIPT_NAME}${RST} — Safe WSL2 Ubuntu Cleanup v${SCRIPT_VERSION}"
    echo ""

    if [[ "$DRY_RUN" == "true" ]]; then
        warn "╔══════════════════════════════════════════════════════════════╗"
        warn "║            DRY-RUN MODE ACTIVE                              ║"
        warn "║  No destructive commands will be executed.                  ║"
        warn "║  All operations are previewed only.                         ║"
        warn "╚══════════════════════════════════════════════════════════════╝"
        echo ""
    fi

    log "System information:"
    log "  User: ${USER} (EUID: ${EUID})"
    log "  Home: ${HOME}"
    log "  Repos: ${REPOS_DIR} ${BLD}(PROTECTED — will not be touched by any operation)${RST}"
    echo ""

    log "Initial disk usage:"
    check_disk /
    echo ""

    # ── Run all cleanup steps ──
    # Each step checks its own tool availability and prompts the user.
    docker_assess
    clean_docker
    clean_docker_aggressive
    clean_docker_builder
    clean_apt
    clean_apt_autoremove
    clean_pip_cache
    clean_npm_cache
    clean_yarn_cache
    clean_journal
    clean_temp
    clean_trash
    clean_snap
    clean_model_caches

    # ── Final disk usage ──
    echo ""
    log "Final disk usage:"
    check_disk /

    # ── Summary table ──
    summarize
    echo ""

    if [[ "$DRY_RUN" == "true" ]]; then
        warn "Dry-run completed. No files were modified."
        warn "Re-run without --dry-run to actually perform cleanup."
    fi

    log "All done!"
}

# ── Entry point ──
main "$@"
