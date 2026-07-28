#!/bin/sh
# Normalize public OpenCode agent profiles before an appuser-owned repository
# initialization. Profiles contain metadata rather than credentials, so they
# must be readable by the runtime user; tokens and configuration are excluded.
set -eu

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

normalize_agent_profiles() {
  agents_dir="${1:?agent profile directory is required}"
  opencode_dir="$(dirname "$agents_dir")"
  worktree_dir="$(dirname "$opencode_dir")"

  if [ ! -e "$agents_dir" ]; then
    exit 0
  fi
  if [ -L "$worktree_dir" ] || [ ! -d "$worktree_dir" ] || \
     [ -L "$opencode_dir" ] || [ ! -d "$opencode_dir" ] || \
     [ -L "$agents_dir" ] || [ ! -d "$agents_dir" ]; then
    fail "OpenCode agent paths must be real directories"
  fi

  # find -P never traverses symlinked directories. Restrict chmod to regular
  # Markdown profiles only, preserving every file's owner and content.
  find -P "$agents_dir" -type f -name "*.md" -exec chmod 0644 {} +
}

project_server_owned_agent_profiles() {
  source_agents_dir="${1:?source agent directory is required}"
  target_agents_dir="${2:?target agent directory is required}"

  if [ -L "$source_agents_dir" ] || [ ! -d "$source_agents_dir" ]; then
    fail "Server-owned agent source directory must be a real directory"
  fi
  if [ -L "$target_agents_dir" ] || { [ -e "$target_agents_dir" ] && [ ! -d "$target_agents_dir" ]; }; then
    fail "OpenCode global agents directory must be a real directory"
  fi
  mkdir -p "$target_agents_dir"
  if [ -L "$target_agents_dir" ] || [ ! -d "$target_agents_dir" ]; then
    fail "OpenCode global agents directory must be a real directory"
  fi

  # These are server-owned profiles that must be globally discoverable by the
  # OpenCode process. Keep the list explicit so operator-managed global
  # profiles remain untouched.
  for relative_profile in \
    "chat/ingenium-chat.md" \
    "execution/ingenium-llm-broker.md"; do
    source_profile="${source_agents_dir}/${relative_profile}"
    target_profile="${target_agents_dir}/$(basename "$relative_profile")"

    if [ -L "$source_profile" ] || [ ! -f "$source_profile" ]; then
      fail "Server-owned agent profile must be a regular non-symlink file"
    fi
    if [ -L "$target_profile" ] || { [ -e "$target_profile" ] && [ ! -f "$target_profile" ]; }; then
      fail "OpenCode global agent profile must be a regular non-symlink file"
    fi
    if [ ! -f "$target_profile" ] || ! cmp -s "$source_profile" "$target_profile"; then
      # Preserve the appuser ownership carried by packaged profiles when the
      # root entrypoint writes into the persistent opencode-config volume.
      cp -p "$source_profile" "$target_profile"
    fi
    chmod 0644 "$target_profile"
  done
}

if [ "${1:-}" = "--project-server-owned" ]; then
  [ "$#" -eq 3 ] || fail "usage: $0 --project-server-owned SOURCE_AGENTS_DIR TARGET_AGENTS_DIR"
  project_server_owned_agent_profiles "$2" "$3"
elif [ "$#" -eq 1 ]; then
  normalize_agent_profiles "$1"
else
  fail "usage: $0 AGENTS_DIR"
fi
