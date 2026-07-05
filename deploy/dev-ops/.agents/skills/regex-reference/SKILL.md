---
name: regex-reference
description: "Regex pattern reference — common patterns, language-specific escaping differences, catastrophic backtracking prevention. Use when writing or reviewing regular expressions in any language."
---

# Regex Reference

## When to Use

- Matching or extracting email addresses, URLs, IPs, or dates from text
- Validating user input format (email, phone, slug, semver)
- Performing find-and-replace with capture groups
- Splitting or parsing structured strings
- Reviewing regex for correctness, safety, or performance

## 🔴 HARD RULE — Prevent Catastrophic Backtracking

Nested quantifiers with overlapping matches can cause regex engines to run exponentially — stalling or crashing the process. Apply these rules to every non-trivial regex:

| Dangerous pattern | Why | Fix |
|------------------|-----|-----|
| `(a+)+` | Nested quantifiers — `+` inside `+` | `a+` (remove outer quantifier) |
| `(a|)*` | Alternation inside `*` — alternates can match empty | Anchor with `^...$` and remove `*` |
| `(a|b)*` on long string with no match | Every position tries every alternation permutation | Make the alternation atomic: `(?>a|b)*` or rewrite without alternation |
| `a.*b` with regex on very long line | `.*` is greedy, backtracks character by character | Use `a[^a]*b` or a non-greedy `a.*?b` with anchoring |
| `(\d+,)+\d+` on malformed input like `12345` | `+` inside `+` with comma separator | `\d+(,\d+)*` (unroll the loop) |

**Always test complex regexes** with a tool before deploying. Platform-specific gotchas (backreferences in JavaScript, lookbehind in Python, Unicode in Go) can change behavior silently.

## Common Patterns

| Pattern | Regex | Notes |
|---------|-------|-------|
| Email (basic) | `^[\w.+-]+@[\w-]+\.[\w.-]+$` | Covers 95% of cases. Production validation should also check DNS MX records. |
| URL | `^https?://[\w.-]+(:\d+)?(/[\w./%-]*)?$` | HTTP/HTTPS only. Omit `^...$` for URL extraction from text. |
| Semver | `^\d+\.\d+\.\d+$` | Basic major.minor.patch. For pre-release/build metadata: `^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$` |
| IPv4 | `^(?:\d{1,3}\.){3}\d{1,3}$` | Validates format only. For range validity, add numeric check after match. |
| Date (ISO 8601) | `^\d{4}-\d{2}-\d{2}$` | YYYY-MM-DD. For full datetime: `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z\|[+-]\d{2}:\d{2})$` |
| Hex color | `^#([0-9a-fA-F]{3}\|[0-9a-fA-F]{6})$` | Supports both `#rgb` and `#rrggbb`. |
| Slug | `^[a-z0-9]+(-[a-z0-9]+)*$` | Lowercase alphanumeric with hyphens. No leading/trailing hyphens. |
| UUID v4 | `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | The `4` at position 13 and `[89ab]` at position 17 are version/variant markers. |

## Language-Specific Escaping

Every language has its own escaping rules for putting regexes in string literals. The same regex `^\w+@\w+\.\w+$` looks different in each context.

### JavaScript

```javascript
// Backslashes must be doubled in string literals
const re = new RegExp("^\\w+@\\w+\\.\\w+$");

// Regex literals avoid one layer of escaping
const re = /^\w+@\w+\.\w+$/;
```

**Gotcha**: JavaScript regex literal syntax (`/pattern/`) does not support variable interpolation. Use `new RegExp(...)` with dynamic patterns, but then you must double-escape `\d` → `\\d`.

### Python

```python
import re

# Raw strings avoid double escaping (USE THESE)
pattern = r"^\w+@\w+\.\w+$"

# Without raw string, backslashes must be doubled — easy to get wrong
# pattern = "^\\w+@\\w+\\.\\w+$"  # ❌ fragile

re.match(pattern, email)
```

**Gotcha**: Python's `re` module does NOT support variable-length lookbehind. Use `regex` (third-party) for `(?<=foo.*bar)`. Raw strings (`r"..."`) are mandatory for all patterns.

### Rust

```rust
// Use regex! macro for compile-time checked patterns
use regex::Regex;
let re = Regex::new(r"^\w+@\w+\.\w+$").unwrap();

// Captures
if let Some(caps) = re.captures(text) {
    println!("{}", &caps[1]);
}
```

**Gotcha**: Rust's `regex` crate does NOT support backreferences or lookahead/lookbehind. Patterns that rely on these must be rewritten. Compile regexes with `once_cell::sync::Lazy` or `Regex::new` at module level rather than in hot paths.

### Go

```go
import "regexp"

// Raw strings avoid escaping
re := regexp.MustCompile(`^\w+@\w+\.\w+$`)

// MustCompile panics — use Compile for dynamic patterns
re, err := regexp.Compile(`^\w+@\w+\.\w+$`)
```

**Gotcha**: Go's `regexp` uses RE2 syntax — no backreferences, no lookahead/lookbehind, no possessive quantifiers. Most patterns from other languages need simplification. This is by design: RE2 guarantees linear time (no catastrophic backtracking).

### Bash

```bash
# In grep, escaping rules are per-shell
grep -E '^\w+@\w+\.\w+$' emails.txt

# In sed, use -E for extended regex
sed -E 's/^([a-z]+):/\1:/' /etc/passwd

# In variable expansions with regex
if [[ "$email" =~ ^[a-z]+@[a-z]+\.[a-z]+$ ]]; then
    echo "valid"
fi
```

**Gotcha**: Bash `=~` uses POSIX ERE — no `\d` shorthand (use `[0-9]`), no `\w` (use `[a-zA-Z0-9_]`). Double-quote the regex variable ONLY in the `[[ ]]` test, not inside the regex itself: `[[ "$str" =~ $pattern ]]`.

## Model Notes

- **7B-9B models**: Most likely to forget escaping rules for string literals. A regex that works in isolation (e.g., `^\d+$`) will fail inside a Python string unless written as `r"^\d+$"` or `"^\\d+$"`. Always double-check the language's escaping section before producing code.
- **14B-27B models**: Better at pattern logic but still prone to catastrophic backtracking — especially with nested quantifiers. Always run the 🔴 HARD RULE checklist on any regex that has more than one quantifier or alternation.
- **All local models**: Use the Common Patterns table as a template library. Don't write regexes from scratch for common validations — adapt one from the table. The table patterns have been tested; custom patterns have not.
- **When a regex seems complex**: Recognize that the pattern may be doing too much. Many parsing tasks are better served by string methods (`str.split`, `.find`, indexing) or dedicated parsers (URLs → `urllib.parse`, JSON → `json.loads`, dates → `datetime.strptime`). Regex is often not the right tool for structured data.
