#!/bin/sh
# Normalize public OpenCode agent profiles before an appuser-owned repository
# initialization. Profiles contain metadata rather than credentials, so they
# must be readable by the runtime user; tokens and configuration are excluded.
set -eu

agents_dir="${1:?agent profile directory is required}"
opencode_dir="$(dirname "$agents_dir")"
worktree_dir="$(dirname "$opencode_dir")"

if [ ! -e "$agents_dir" ]; then
  exit 0
fi
if [ -L "$worktree_dir" ] || [ ! -d "$worktree_dir" ] || \
   [ -L "$opencode_dir" ] || [ ! -d "$opencode_dir" ] || \
   [ -L "$agents_dir" ] || [ ! -d "$agents_dir" ]; then
  echo "ERROR: OpenCode agent paths must be real directories" >&2
  exit 1
fi

# find -P never traverses symlinked directories. Restrict chmod to regular
# Markdown profiles only, preserving every file's owner and content.
find -P "$agents_dir" -type f -name "*.md" -exec chmod 0644 {} +
