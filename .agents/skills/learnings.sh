#!/usr/bin/env bash
# learnings.sh — Safely append entries to .agents/skills/learnings.md
set -euo pipefail

LEARNINGS_FILE=".agents/skills/learnings.md"

usage() { echo "Usage: $0 <entry>"; exit 1; }

if [[ $# -eq 0 ]]; then usage; fi

# Trim leading/trailing whitespace from entry
entry=$(echo "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if ! echo "$entry" | grep -q "^## [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}"; then
    echo "Error: Entry must start with '## YYYY-MM-DD' date header." >&2
    exit 1
fi

# Determine repo root
if [[ -n "$(git rev-parse --show-toplevel 2>/dev/null)" ]]; then
    REPO_ROOT="$(git rev-parse --show-toplevel)"
elif [[ "$PWD" == */gh-llm-bootstrap* ]]; then
    REPO_ROOT="$PWD"
else
    echo "Error: Cannot determine repository root." >&2
    exit 1
fi

# Create learnings.md if needed
if [[ ! -f "$LEARNINGS_FILE" ]]; then
    mkdir -p "$(dirname "$LEARNINGS_FILE")" || {
        echo "Error: Cannot create directory for $LEARNINGS_FILE." >&2
        exit 1
    }
fi

# Add blank line before new entry if file is not empty
if [[ -s "$LEARNINGS_FILE" ]]; then
    printf '\n' >> "$LEARNINGS_FILE"
fi

cat >> "$LEARNINGS_FILE" << ENTRY
$entry

ENTRY

echo "✓ Entry appended to $LEARNINGS_FILE"
