---
title: "Error Interpretation — Cross-Language Error Maps and CI Failure Patterns"
impact: HIGH
impactDescription: "Enables root-cause identification from error signatures across all languages"
tags: [error-interpretation, errors, CI, cross-language]
---

## Error Interpretation

## 🔴 HARD RULE — Read the FIRST Error, Not the Last

Build tools and runtimes often report cascading errors. Always scroll to the top and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

| Output pattern | First error is | Ignore until first is fixed |
|----------------|----------------|---------------------------|
| Compiler output | First `error:` line | All later `error:` lines |
| Stack trace | The line with YOUR code (not library code) | All frames below it |
| Test output | The first `FAIL` or `FAILED` line | All subsequent test failures |
| CI log | The first `Error:` after the last `[PASS]` | Everything in same or later steps |

## Cross-Language Error Patterns

These patterns look different in each language but have the same root cause.

| Pattern | Looks like (various languages) | Root cause | Quick fix |
|---------|-------------------------------|------------|-----------|
| **Null / undefined reference** | JS: `Cannot read property 'x' of undefined` / Python: `'NoneType' object has no attribute 'x'` / Go: `nil pointer dereference` / Rust: `called Option::unwrap() on a None value` | Variable or return value is unexpectedly null | Check if previous operation succeeded. Add a guard. |
| **Type mismatch** | JS: `x is not a function` / Python: `TypeError: can only concatenate str (not "int") to str` / Go: `cannot use x (type A) as type B` / Rust: `expected i32, found &str` | Value has different type than expected | Check function signature and actual value. Cast explicitly. |
| **Import / module not found** | JS: `Cannot find module 'x'` / Python: `ModuleNotFoundError: No module named 'x'` / Go: `package x is not in GOROOT` / Rust: `can't find crate for x` | Dependency not installed, not in path, or misspelled | Run package manager. Check import path spelling. |
| **Permission denied** | Bash: `Permission denied` / Node: `EACCES` / Docker: `permission denied` / SSH: `Permission denied (publickey)` | User lacks permission for file or resource | Check file permissions, `chmod +x`, check SSH keys. |
| **Network timeout** | curl: `Connection timed out` / Node: `ETIMEDOUT` / Python: `ConnectionError` / Go: `dial tcp: i/o timeout` | Remote server unreachable | Check URL/port, firewall, DNS. Retry with longer timeout. |
| **Out of memory** | Node: `FATAL ERROR: Reached heap limit` / Python: `MemoryError` / Go: `runtime: out of memory` / Rust: `memory allocation failed` / Bash: `fork: Cannot allocate memory` | Process exceeded available memory | Reduce batch size, add pagination, increase memory limit. |
| **File not found** | Python: `FileNotFoundError` / Node: `ENOENT` / Bash: `No such file or directory` | Path doesn't exist, wrong CWD, or misspelled | Use absolute path or check CWD with `pwd`. |
| **Port in use** | Node: `EADDRINUSE` / Python: `Address already in use` / Go: `bind: address already in use` | Another process holds the port | Kill old process or change port. `lsof -i :PORT`. |

## Language-Specific Error Maps

### JavaScript / TypeScript
| Error | Root cause |
|-------|-----------|
| `Cannot read property 'x' of undefined` | Object is undefined. Add optional chain `?.` or default. |
| `x is not a function` | Expected a function but got different type. Check import. |
| `Cannot find module 'x'` | Missing dependency, wrong path, case mismatch. |
| `Unexpected token '<'` | Server returned HTML (404 page) instead of JSON. Check URL. |
| `Maximum call stack size exceeded` | Infinite recursion. Check base case. |

### Python
| Error | Root cause |
|-------|-----------|
| `KeyError: 'x'` | Dict key doesn't exist. Use `.get()` or `defaultdict`. |
| `ValueError: invalid literal for int()` | Parsing non-numeric string as int. Validate input. |
| `ImportError: cannot import name 'x'` | Circular import, misspelled name, renamed symbol. |
| `IndexError: list index out of range` | Exceeding list length. Check bounds before indexing. |

### Rust
| Error | Root cause |
|-------|-----------|
| `cannot borrow as mutable` | Multiple mutable references. Restructure ownership. |
| `expected &str, found String` | Type mismatch. Use `&s` or `.as_str()`. |
| `use of moved value` | Value moved out of scope. Clone or restructure. |
| `the trait bound X: Y is not satisfied` | Generic missing trait bound. Add it. |

### Go
| Error | Root cause |
|-------|-----------|
| `nil pointer dereference` | Nil pointer. Add nil check before use. |
| `expected declaration, found '}'` | Unclosed struct, function, or brace. |
| `undefined: x` | Variable not in scope or not imported. |

### Shell / Bash
| Error | Root cause |
|-------|-----------|
| `command not found: x` | Tool not installed or not in PATH. |
| `Permission denied` (script) | Execute permission missing. `chmod +x`. |
| `Unexpected EOF while looking for matching` | Unclosed quote or heredoc. |

### Git
| Error | Root cause |
|-------|-----------|
| `fatal: not a git repository` | Outside Git working tree. |
| `fatal: refusing to merge unrelated histories` | Branches with no common ancestor. |
| `error: failed to push some refs` | Remote has commits you don't have. Pull first. |

## CI-Specific Failure Patterns

| CI error | Root cause |
|----------|------------|
| Exit code 137 (SIGKILL) | Runner out of memory. Reduce parallelism. |
| Cache miss or restore failed | Cache key mismatch. Check `hashFiles()`. |
| Auth failed to registry | Token expired. Rotate secrets. |
| Step runs but no output before timeout | Step is hanging. Add timeout or verbose logging. |
| "Process completed with exit code 1" with no message | Command output on stderr not captured. Add `set -x`. |
