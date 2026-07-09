---
title: "CLI Toolkit — jq, curl, sed, awk, find, grep Reference"
impact: HIGH
impactDescription: "Prevents flag hallucination and unsafe piping patterns in shell pipelines"
tags: [cli, jq, curl, sed, awk, find, grep, shell]
---

## CLI Toolkit

## 🔴 HARD RULE — Never Pipe Curl to Shell

Never pipe `curl ... | sh` or `curl ... | bash`. Always download, inspect, then run.

```bash
# ❌ BAD — blind execution
curl -sSL https://example.com/install.sh | bash

# ✅ GOOD — inspect first
curl -sSL https://example.com/install.sh > install.sh
less install.sh     # or open in editor
bash install.sh

# ✅ GOOD — or use a package manager
brew install <package>   # macOS
apt install <package>    # Debian
```

## jq — JSON Processor

### Common flags

| Flag | Meaning |
|------|---------|
| `-r` | Raw output (no quotes around strings) |
| `-c` | Compact output (one object per line) |
| `-f <file>` | Read filter from file |
| `--arg k v` | Pass shell variable as `$k` |

### Essential recipes

```bash
# Extract a field
curl ... | jq -r '.name'

# Array of objects — select specific fields
curl ... | jq -r '.[] | {name, email}'

# Filter array elements
curl ... | jq -r '.[] | select(.status == "active") | .name'

# Nested access with default
jq -r '.user?.profile?.name // "anonymous"'

# Transform keys
jq -r '{full_name: .firstName + " " + .lastName}'
```

### Gotcha
`jq` indexing is 0-based. `.` is the identity filter. `.[]` iterates over array elements.

## curl — HTTP Client

### Common flags

| Flag | Meaning |
|------|---------|
| `-s` | Silent (no progress meter) |
| `-S` | Show errors (use with `-s`) |
| `-L` | Follow redirects |
| `-H` | Custom header |
| `-d` | POST data (form-encoded) |
| `-X` | HTTP method |
| `-o <file>` | Write output to file |
| `-w "%{http_code}"` | Print HTTP status code |
| `-f` | Fail on HTTP error (exit non-zero) |

### Essential recipes

```bash
# Test endpoint, show only status code
curl -s -o /dev/null -w "%{http_code}" https://api.example.com/health

# POST JSON
curl -s -H "Content-Type: application/json" \
     -d '{"name":"test"}' \
     https://api.example.com/items

# Download file preserving name
curl -sSLO https://example.com/file.tar.gz

# With auth header
curl -s -H "Authorization: Bearer $TOKEN" https://api.example.com/data
```

### Gotcha
`-d` automatically sends a POST request and adds `Content-Type: application/x-www-form-urlencoded`. For JSON, always override with `-H`.

## sed — Stream Editor

### Common flags

| Flag | Meaning |
|------|---------|
| `-i` | Edit in-place (no backup) |
| `-i.bak` | Edit in-place with `.bak` backup |
| `-n` | Suppress automatic printing (use with `p`) |
| `-E` | Extended regex (ERE, not BRE) |

### Essential recipes

```bash
# Find and replace in-place
sed -i 's/old-text/new-text/g' file.txt

# Find and replace in multiple files
sed -i 's/old-text/new-text/g' src/**/*.py

# Print lines matching a pattern
sed -n '/error/p' log.txt

# Delete lines matching a pattern
sed -i '/^#/d' config.ini

# Replace only on specific line range
sed -i '10,20s/foo/bar/g' file.txt
```

### Gotcha
`sed -i` behavior differs between GNU (Linux) and BSD (macOS). Linux: `sed -i 's/.../' file`. macOS: `sed -i '' 's/.../' file`.

## awk — Column & Text Processor

### Common patterns

| Pattern | Meaning |
|---------|---------|
| `{print $1, $3}` | Print columns 1 and 3 |
| `{print $NF}` | Print last column |
| `NR > 1 {print}` | Skip header row |
| `$3 > 100 {print}` | Conditional filter |
| `BEGIN {FS=","}` | Set field separator to comma |

### Essential recipes

```bash
# Print column 2 from space-separated output
command | awk '{print $2}'

# CSV: print column 1 and 4
command | awk 'BEGIN {FS=","} {print $1, $4}'

# Sum a column
command | awk '{sum += $3} END {print sum}'

# Filter by value
command | awk '$4 > 1000 {print $1, $4}'

# Format output
command | awk '{printf "%-20s %s\n", $1, $3}'
```

### Gotcha
`awk` uses 1-based column indexing. `$0` is the whole line. Field separator defaults to whitespace.

## find + xargs — File Search and Batch Operations

### Common find flags

| Flag | Meaning |
|------|---------|
| `-name` | Pattern match filename |
| `-type f` | Files only |
| `-type d` | Directories only |
| `-mtime -7` | Modified in last 7 days |
| `-size +1M` | Larger than 1 MB |
| `-maxdepth 2` | Descend at most 2 levels |

### Essential recipes

```bash
# Find and delete
find . -name "*.tmp" -type f -delete

# Find and run command (xargs variant)
find . -name "*.log" -type f | xargs rm

# Find files larger than 100MB
find / -type f -size +100M

# Find and grep (safe with spaces)
find . -name "*.py" -type f -print0 | xargs -0 grep "TODO"

# Find recently modified
find . -name "*.go" -type f -mtime -1
```

### Gotcha
Always use `-print0` with `xargs -0` when filenames may contain spaces, quotes, or special characters.

## grep — Pattern Search

### Common flags

| Flag | Meaning |
|------|---------|
| `-r` | Recursive |
| `-i` | Case-insensitive |
| `-n` | Show line numbers |
| `-C 3` | Show 3 lines of context |
| `-l` | List filenames only |
| `-v` | Invert match |
| `-E` | Extended regex (ERE) |
| `--include="*.py"` | Only search certain file types |
| `--exclude-dir=node_modules` | Skip directories |

### Essential recipes

```bash
# Recursive search with context
grep -rnC 3 "functionName" src/

# List files containing a pattern
grep -rl "TODO" src/ --include="*.py"

# Exclude directories
grep -rn "import" . --exclude-dir={node_modules,.git,vendor}

# Count matches per file
grep -rc "error" log/

# Negated pattern (find lines NOT matching)
grep -v "^#" config.ini
```

### Gotcha
`grep -r` follows symlinks. On large codebases, always exclude `node_modules/`, `.git/`, and `vendor/`.

## Model Notes

- **7B-9B models**: Frequently hallucinate CLI flags. Always consult this reference before suggesting a flag.
- **14B-27B models**: Better at flag recall but still confuse GNU vs BSD. Check the user's platform.
- **All local models**: Prefer producing a complete one-liner from the recipes rather than inventing custom pipelines.
