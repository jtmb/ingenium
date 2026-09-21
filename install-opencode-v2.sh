#!/usr/bin/env bash
#
# install-opencode-v2.sh
#
# Installs the OpenCode v2 line on this host and retires the v1 CLI binary.
#
# Context (verified 2026-09-20):
#   * OpenCode has no published 2.x release. GitHub releases stop at v1.18.31 and
#     npm `opencode-ai` has no 2.x version; the v2 line ships only as npm
#     pre-release dist-tags. Default target is therefore `dev`
#     (currently 0.0.0-dev-202609201743).
#   * `opencode uninstall` is deliberately NOT used: it removes "all related
#     files", which can include the session store. Retiring v1 must never delete
#     sessions.
#   * Order matters: v2 is installed and verified BEFORE v1 is removed, so a
#     failed install leaves you with a working CLI.
#
# Scope: host CLI only. The repository/container pins (Dockerfile, package.json)
# are a separate migration and are not touched here.
#
# Usage:
#   bash install-opencode-v2.sh --dry-run    # show every action, change nothing
#   bash install-opencode-v2.sh              # do it
#
# Overrides:
#   OPENCODE_V2_TARGET   npm dist-tag or version to install  (default: dev)
#   OPENCODE_V1_BIN      v1 binary to retire                 (default: ~/.opencode/bin/opencode)
#   OPENCODE_BACKUP_DIR  where the v1 backup is written      (default: ~/.local/state/opencode-v1-backup)
#   OPENCODE_DATA_DIR    session store, reported only        (default: ~/.local/share/opencode)

set -euo pipefail

V2_TARGET="${OPENCODE_V2_TARGET:-dev}"
V1_BIN="${OPENCODE_V1_BIN:-$HOME/.opencode/bin/opencode}"
BACKUP_DIR="${OPENCODE_BACKUP_DIR:-$HOME/.local/state/opencode-v1-backup}"
DATA_DIR="${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}"
CONFIG_DIR="${HOME}/.config/opencode"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") ;;
  *) printf 'unknown argument: %s\nusage: bash %s [--dry-run]\n' "$1" "$0" >&2; exit 2 ;;
esac

run() {
  if [[ "$DRY_RUN" == "1" ]]; then printf '  would: %s\n' "$*"; else "$@"; fi
}
step() { printf '\n==> %s\n' "$1"; }

command -v npm >/dev/null 2>&1 || { printf 'error: npm not found in PATH\n' >&2; exit 1; }

# --- 1. Inspect current state ----------------------------------------------
step "Current state"
CURRENT_BIN="$(command -v opencode || true)"
V1_VERSION=""
if [[ -x "$V1_BIN" ]]; then
  V1_VERSION="$("$V1_BIN" --version 2>/dev/null || echo unknown)"
fi

printf '  opencode in PATH : %s\n' "${CURRENT_BIN:-<none>}"
printf '  v1 binary        : %s%s\n' "$V1_BIN" "${V1_VERSION:+ (version $V1_VERSION)}"
printf '  v2 npm target    : opencode-ai@%s\n' "$V2_TARGET"
printf '  backup dir       : %s\n' "$BACKUP_DIR"
printf '  sessions         : %s  (preserved)\n' "$DATA_DIR"
printf '  config           : %s  (preserved)\n' "$CONFIG_DIR"

if [[ ! -x "$V1_BIN" ]]; then
  printf '\n  note: no v1 binary at that path; only the v2 install will run.\n'
fi

# --- 2. Install v2 ----------------------------------------------------------
step "Install OpenCode v2 (opencode-ai@$V2_TARGET)"
run npm install -g "opencode-ai@$V2_TARGET"

# --- 3. Verify the install before removing anything -------------------------
step "Verify the installed version"
NPM_BIN="$(npm prefix -g)/bin"
if [[ "$DRY_RUN" == "1" ]]; then
  printf '  would: %s/opencode --version\n' "$NPM_BIN"
else
  if [[ -x "$NPM_BIN/opencode" ]]; then
    printf '  %s -> %s\n' "$NPM_BIN/opencode" "$("$NPM_BIN/opencode" --version 2>/dev/null || echo unknown)"
  else
    printf 'error: no opencode binary at %s after install; leaving v1 in place\n' "$NPM_BIN" >&2
    exit 1
  fi
fi

# --- 4. Retire the v1 binary (backed up; sessions untouched) ----------------
step "Retire the v1 binary"
if [[ -x "$V1_BIN" ]]; then
  V1_LABEL="${V1_VERSION:-unknown}"
  run mkdir -p "$BACKUP_DIR"
  run cp -a "$V1_BIN" "$BACKUP_DIR/opencode-$V1_LABEL"
  run chmod 600 "$BACKUP_DIR/opencode-$V1_LABEL"
  run rm -f "$V1_BIN"
  if [[ "$DRY_RUN" != "1" ]]; then
    printf '  backup written : %s/opencode-%s\n' "$BACKUP_DIR" "$V1_LABEL"
  fi
  # Remove the launcher directory only if retiring the binary emptied it.
  run rmdir "$(dirname "$V1_BIN")" 2>/dev/null || true
else
  printf '  skipped: %s is not an executable file\n' "$V1_BIN"
fi

# --- 5. What is on PATH now -------------------------------------------------
step "Result"
if [[ "$DRY_RUN" == "1" ]]; then
  printf '  would re-check `command -v opencode`\n'
else
  RESOLVED="$(command -v opencode || true)"
  printf '  opencode now     : %s\n' "${RESOLVED:-<none>}"
  if [[ -z "$RESOLVED" ]]; then
    printf 'warning: opencode is not on PATH. Add the npm global bin dir: %s\n' "$NPM_BIN" >&2
  elif [[ "$RESOLVED" != "$NPM_BIN/opencode" ]]; then
    printf 'warning: %s resolves before the npm install (%s)\n' "$RESOLVED" "$NPM_BIN/opencode" >&2
  fi
fi

step "Preserved (never touched by this script)"
printf '  %s\n' "$DATA_DIR"
printf '  %s\n' "$CONFIG_DIR"

step "Next"
printf '  resume this session on v2 :  opencode -s ses_f4aa759a5ffeCDZRSr4Aix2mtH\n'
printf '  revert to v1              :  cp %s/opencode-%s "%s" && chmod +x "%s"\n' \
  "$BACKUP_DIR" "${V1_VERSION:-unknown}" "$V1_BIN" "$V1_BIN"
printf '  remove v2 and go back     :  npm install -g opencode-ai@latest\n'
printf '\n  Note: a running OpenCode process keeps using the old binary until you restart it.\n'

if [[ "$DRY_RUN" == "1" ]]; then
  printf '\nDry run: nothing was installed, removed, or modified.\n'
fi
