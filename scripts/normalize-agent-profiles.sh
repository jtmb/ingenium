#!/bin/sh
# Normalize public OpenCode agent profiles before an appuser-owned repository
# initialization. The descriptor-safe helper keeps path checks and writes on
# opened file descriptors, so a persistent configuration volume cannot swap a
# checked profile path for a symlink before it is modified.
set -eu

script_dir="$(dirname "$0")"
exec node "$script_dir/project-agent-profiles.mjs" "$@"
