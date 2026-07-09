---
title: "Shell Script Conventions — Safety, Quoting, Error Handling, Portability"
impact: HIGH
impactDescription: "Prevents shell script bugs from unsafe quoting, missing error handling, and portability issues"
tags: [shell, bash, scripting, safety, quoting, portability]
---

## Shell Script Conventions

### Safety Flags — Mandatory

Every shell script MUST start with safety flags. No exceptions.

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- **`set -e`**: Exit immediately on any command failure.
- **`set -u`**: Treat unset variables as errors. Catches typos.
- **`set -o pipefail`**: A pipeline fails if ANY command in it fails.

If you must tolerate a failing command, be explicit:
```bash
if ! pgrep -f "my-daemon" > /dev/null; then
    echo "Daemon not running — starting it"
fi
```

### Quoting — Mandatory

Always quote variable expansions unless you have a specific reason not to.

```bash
# Bad — breaks on filenames with spaces, globs, or empty values
rm -rf $TEMP_DIR

# Good
rm -rf "$TEMP_DIR"
```

- **Double-quote `"$var"`**: Prevents word splitting and glob expansion
- **Brace-delimit**: `"${var}_suffix"` when concatenating with text
- **Use `$(())` for arithmetic**: `$(( count + 1 ))` not `$count + 1`
- **Use `[[ ]]` for tests**: Safer than `[ ]` — handles empty strings, supports regex

### Error Handling

```bash
# Trap errors with context
trap 'echo "Error on line $LINENO"' ERR

# Cleanup on exit (success or failure)
cleanup() {
    rm -rf "$TEMP_DIR"
    docker stop "$CONTAINER_ID" 2>/dev/null || true
}
trap cleanup EXIT
```

- Use `trap cleanup EXIT` for temporary files, background processes
- `|| true` for commands you expect might fail in cleanup
- Never `rm -rf "$VAR"` without validating `$VAR` is set and non-empty

### Temporary Files

Use `mktemp`, never hardcode paths in `/tmp/`.

```bash
# Bad — predictable, race-condition prone
TMPFILE=/tmp/my-script-output.txt

# Good — unique, secure
TMPFILE=$(mktemp) || exit 1
trap 'rm -f "$TMPFILE"' EXIT
```

- `mktemp -d` for temporary directories
- Always `trap` cleanup of temp files
- Never use `$$` for temp file names

### Portability

Write POSIX-compliant shell unless you know bash is guaranteed.

```bash
# Bash-only — fails on dash/sh
if [[ "$a" == "$b" ]]; then ... fi

# POSIX — works everywhere
if [ "$a" = "$b" ]; then ... fi
```

- **Use `#!/usr/bin/env bash`** if you need bash features (arrays, `[[ ]]`, `${var/pattern/replace}`)
- **Use `#!/bin/sh`** and stick to POSIX for maximum portability
- **No `echo -n`**: use `printf` for portable output formatting
- **Use `$()` over backticks**: `$(command)` nests, backticks don't
- **No `function` keyword**: `funcname() { ... }` is POSIX

### Patterns

```bash
# Reading lines safely
while IFS= read -r line; do
    echo "Got: $line"
done < "$input_file"

# Default values
OUTPUT_DIR="${1:-./output}"
TIMEOUT="${TIMEOUT:-30}"
```

### No Secrets

```bash
# Bad — password visible in ps
curl -u "admin:$PASSWORD" https://api.example.com

# Good — read from file or environment
curl --netrc-file /secrets/netrc https://api.example.com
```

- Never pass secrets as command-line arguments
- Use environment variables, files with restricted permissions, or secret managers
- `chmod 600` on any file containing secrets

### Script Organization

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── Defaults ──
VAR="${ENV_VAR:-default}"

# ── Usage ──
usage() { cat <<EOF
Usage: $(basename "$0") [OPTIONS] ARG
EOF
}

# ── Parse args ──
while [[ $# -gt 0 ]]; do
    case "$1" in
        --flag) FLAG=true; shift ;;
        --help) usage; exit 0 ;;
        *) break ;;
    esac
done

# ── Validation ──
if [[ $# -lt 1 ]]; then
    echo "Error: required argument missing" >&2
    usage; exit 1
fi

# ── Main ──
main() { :; }
main "$@"
```

- `usage()` function for every script with arguments
- Errors to stderr: `echo "..." >&2`
- `main "$@"` pattern keeps global scope clean
