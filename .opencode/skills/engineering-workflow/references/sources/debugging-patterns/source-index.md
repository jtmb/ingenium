---
name: debugging-patterns
description: "Systematic debugging methodology — isolation, bisection, log-driven analysis, error interpretation, and AI self-correction patterns. Use when diagnosing bugs, interpreting errors, investigating test failures, or recovering from AI mistakes."
---

# Debugging Patterns

> Unified debugging skill covering three areas: debugging methods, error interpretation, and AI self-correction. Each area has its own section in `references/`.

## When to Use

- A test is failing and the root cause isn't obvious
- A bug report describes unexpected behavior in production
- A CI pipeline is failing intermittently
- An error message doesn't point to the actual source
- Investigating a regression introduced by recent changes
- The model produces incorrect output, gets stuck in a loop, or needs to self-correct
- The user says "that didn't work" or "you are stuck in a loop"

## 🔴 HARD RULEs

### Isolate Before You Fix

Never attempt a fix until you have isolated the minimal reproduction of the bug. Guessing at fixes without isolation leads to cascading changes that obscure the real root cause.

| When you see | Do this before fixing |
|---|---|
| Test failure with unclear cause | Reduce the test to the minimal input that triggers failure |
| Crash / panic with a stack trace | Find the exact line + call path |
| Intermittent / flaky failure | Identify the race condition or ordering dependency |
| Wrong output (no crash) | Pinpoint where the output diverges from expectation |
| Regression | `git bisect` to find the exact commit |

### Verify Before You Declare Done

Every output must be verified against available evidence before being submitted. Never assume a fix is correct without a passing test, successful build, or confirmed behavior change.

### Read the FIRST Error, Not the Last

Build tools report cascading errors. Always scroll to the top and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

## Reference Files

| File | Content |
|------|---------|
| [`references/isolation-and-methods.md`](references/isolation-and-methods.md) | Debugging methods: bisect, log-driven, rubber duck, delta debugging, replay — with 🔴 Isolate Before You Fix rule |
| [`references/error-interpretation.md`](references/error-interpretation.md) | Cross-language error maps (JS, Python, Rust, Go, Bash, Git), CI failure patterns, with 🔴 Read the FIRST Error rule |
| [`references/self-correction.md`](references/self-correction.md) | Recognition triggers, recovery strategies (backtrack, narrow scope, verify against source), AI anti-patterns, agent checklist, with 🔴 Verify Before You Declare Done rule |
| [`references/model-notes.md`](references/model-notes.md) | Model-specific guidance from all three skills — when bisect vs hypothesis-driven, size-specific recovery patterns |

## Cross-References

- **`local-models`** — Command safety rules; model profiles that inform debugging strategies
- **`development-conventions`** — Code conventions that may affect error interpretation
- **`devops-conventions`** — Docker/K8s CLI commands for debugging container/runtime issues
