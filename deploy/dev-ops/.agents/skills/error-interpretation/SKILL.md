---
name: error-interpretation
description: "Map common error signatures to their actual root causes — null reference, type mismatch, import failure, permission denied, network timeout. Use when diagnosing build failures, runtime errors, or CI failures."
---

# Error Interpretation

## When to Use

- A build or test pipeline fails and the error message is cryptic
- A runtime error repeats with different inputs
- CI fails on one platform but not another
- The error message points to a line that "looks fine"
- Multiple errors appear in a stack and you need to find the primary one

## 🔴 HARD RULE — Read the FIRST Error, Not the Last

Build tools and runtimes often report cascading errors — the first failure triggers a chain of subsequent failures that look unrelated. Always scroll to the top of the error output and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

| Output pattern | First error is | Ignore until first is fixed |
|----------------|----------------|---------------------------|
| Compiler output | First `error:` line (not `warning:` or `note:`) | All later `error:` lines |
| Stack trace | The line with the `File "/...", line N` that is YOUR code (not library code) | All frames below it |
| Test output | The first `FAIL` or `FAILED` line | All subsequent test failures |
| CI log | The first `Error:` or `[ERROR]` after the last `[PASS]` or `[OK]` | Everything in the same or later steps |
| ESLint / Ruff | The first rule violation in the first file listed | All violations in later files |

## Cross-Language Error Patterns

These patterns look different in each language but have the same root cause.

| Pattern | Looks like (various languages) | Root cause | Quick fix |
|---------|-------------------------------|------------|-----------|
| **Null / undefined reference** | JS: `Cannot read property 'x' of undefined` / Python: `'NoneType' object has no attribute 'x'` / Go: `nil pointer dereference` / Rust: `called Option::unwrap()` on a `None` value | A variable or return value is unexpectedly `null`, `None`, `nil`, or `undefined` | Check if the previous operation succeeded. Add a guard or handle the null case. |
| **Type mismatch** | JS: `x is not a function` / Python: `TypeError: can only concatenate str (not "int") to str` / Go: `cannot use x (type A) as type B` / Rust: `expected i32, found &str` | A value has a different type than expected | Check the function signature and the actual value being passed. Cast or convert explicitly. |
| **Import / module not found** | JS: `Cannot find module 'x'` / Python: `ModuleNotFoundError: No module named 'x'` / Go: `package x is not in GOROOT` / Rust: `can't find crate for x` | The dependency is not installed, not in the path, or misspelled | Run the package manager: `npm install`, `pip install`, `go get`, `cargo add`. Check the import path spelling. |
| **Permission denied** | Bash: `Permission denied` / Node: `EACCES: permission denied` / Docker: `permission denied while trying to connect` / SSH: `Permission denied (publickey)` | The user doesn't have permission to read/write/execute the file or resource | Check file permissions (`ls -la`), add `chmod +x` for scripts, check SSH keys for remote access. |
| **Network timeout** | curl: `Connection timed out` / Node: `ETIMEDOUT` / Python: `requests.exceptions.ConnectionError` / Go: `dial tcp: i/o timeout` | A remote server is unreachable or not responding | Check the URL/port, check firewall, check DNS resolution, retry with longer timeout. |
| **Out of memory** | Node: `FATAL ERROR: Reached heap limit Allocation failed` / Python: `MemoryError` / Go: `fatal error: runtime: out of memory` / Rust: `memory allocation of X bytes failed` / Bash: `fork: Cannot allocate memory` | The process exceeded available memory | Reduce batch size, add pagination, increase memory limit, fix a memory leak. |
| **File not found** | Python: `FileNotFoundError: [Errno 2] No such file or directory` / Node: `ENOENT: no such file or directory` / Bash: `No such file or directory` | The path doesn't exist, is relative from the wrong directory, or is misspelled | Use an absolute path or check the current working directory with `pwd`. |
| **Port in use** | Node: `EADDRINUSE` / Python: `[Errno 98] Address already in use` / Go: `bind: address already in use` | Another process is holding the port | Kill the old process or change the port. `lsof -i :PORT` to find the process. |

## Language-Specific Error Maps

### JavaScript / TypeScript

| Error signature | Most likely root cause |
|----------------|----------------------|
| `Cannot read property 'x' of undefined` | Accessing a property on an object that is `undefined`. Add an optional chain (`?.`) or default. |
| `x is not a function` | Expected a function but got a different type. Check the import (is it a default vs named export?). |
| `Cannot find module 'x'` | Missing dependency, wrong path, or case mismatch in import. |
| `Unexpected token '<'` | The server returned HTML (a 404 page) instead of JSON or JS. Check the URL. |
| `Maximum call stack size exceeded` | Infinite recursion. Check for missing base case in recursive function. |

### Python

| Error signature | Most likely root cause |
|----------------|----------------------|
| `KeyError: 'x'` | Accessing a dict key that doesn't exist. Use `.get()` or `collections.defaultdict`. |
| `ValueError: invalid literal for int()` | Trying to parse a non-numeric string as an integer. Validate input first. |
| `ImportError: cannot import name 'x'` | Circular import, misspelled name, or the symbol was renamed. |
| `IndexError: list index out of range` | Accessing an empty list or exceeding its length. Check bounds before indexing. |
| `RecursionError: maximum recursion depth exceeded` | Deep or infinite recursion. Increase limit or fix the recursion. |

### Rust

| Error signature | Most likely root cause |
|----------------|----------------------|
| `cannot borrow as mutable` | Borrow checker violation — multiple mutable references exist. Restructure ownership. |
| `expected `&str`, found `String`` | Type mismatch between `String` and `&str`. Use `&s` or `.as_str()`. |
| `use of moved value` | Value moved out of scope. Clone or restructure ownership. |
| `the trait bound X: Y is not satisfied` | A generic type parameter doesn't implement the required trait. Add the trait bound. |
| `no method named 'x' found` | The method doesn't exist on the type or the type is unexpected. Check the type. |

### Go

| Error signature | Most likely root cause |
|----------------|----------------------|
| `nil pointer dereference` | Accessing a field or method on a nil pointer. Add a nil check before use. |
| `expected declaration, found '}'` | Syntax error — likely an unclosed struct, function, or brace. |
| `undefined: x` | Variable or function not in scope or not imported. Check spelling and imports. |
| `cannot use _ (*X) as *Y` | Type mismatch in a pointer assignment. Check the concrete types. |
| `error: "..."` without line number | A custom error returned from a function. Check the function's documentation or implementation. |

### Shell / Bash

| Error signature | Most likely root cause |
|----------------|----------------------|
| `command not found: x` | The tool is not installed or not in `$PATH`. Check with `which x` or `command -v x`. |
| `Permission denied` (on a script) | The script doesn't have execute permission. Run `chmod +x script.sh`. |
| `Permission denied` (SSH) | SSH key not loaded or not accepted. Check `ssh-add -l` and the remote authorized_keys. |
| `No such file or directory` | Path doesn't exist. Use `pwd` to check current directory, or use absolute path. |
| `Unexpected EOF while looking for matching` | Unclosed quote or heredoc. Check for unmatched `"`, `'`, or `<<`. |

### Git

| Error signature | Most likely root cause |
|----------------|----------------------|
| `fatal: not a git repository` | Not inside a Git working tree. Check with `git rev-parse --show-toplevel`. |
| `fatal: refusing to merge unrelated histories` | Two branches with no common ancestor. Use `--allow-unrelated-histories` if intentional. |
| `error: failed to push some refs` | Remote has commits you don't have locally. Pull or rebase first. |
| `fatal: 'origin' does not appear to be a git repository` | Remote named `origin` doesn't exist. Check `git remote -v`. |
| `hint: divergent branches` / `failed to push` | Force-push required, but use `--force-with-lease`, not `--force`. |

## CI-Specific Failure Patterns

| CI error | Root cause |
|----------|------------|
| Job fails with exit code 137 (SIGKILL) | Runner ran out of memory. Reduce parallelism, add swap, or use a larger runner. |
| Cache miss or cache restore failed | Cache key mismatch. Check `hashFiles()` and cache key format in workflow file. |
| Authentication failed to registry | Token expired or incorrect. Rotate secrets in the CI settings. |
| Step runs but produces no output before timeout | The step is hanging, not processing. Add a timeout or debug with verbose logging. |
| Linter fails on code you didn't change | The linter config or version changed. Check the CI linter version vs local. |
| "Process completed with exit code 1" with no error message | The command produced output on stderr that was not captured. Add `set -x` or `--verbose` to the step. |

## Model Notes

- **7B-9B models**: Most often fix the symptom instead of the root cause. When you see an error like `KeyError: 'name'`, the model will add `if 'name' in data:` as a bandaid instead of asking *why* `name` is missing. Always trace to the root cause using the cross-language table — look at the "Root cause" column, not just the "Looks like" column.
- **14B-27B models**: Better at tracing error chains but still benefit from the "Read the FIRST Error" rule. These models sometimes skip ahead to the last visible error (most recent stack frame) because that's where they expect the answer to be. The table format under language-specific maps helps them think structurally.
- **All local models**: CI errors (especially exit code 137 and cache issues) are where smaller models add the most value — these are mechanical lookup problems with known solutions. Conversely, Rust borrow checker errors are where small models struggle most; the ownership model is non-intuitive and the error messages reference concepts the model may not reliably reproduce. For borrow errors, suggest the fix but verify against `cargo check`.
- **When error messages are long**: Ask yourself "Does this error match a known pattern in the tables above?" rather than reading every character. Pattern matching is a local model strength; byte-by-byte analysis is not.
