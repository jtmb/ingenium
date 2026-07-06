---
name: code-review-checklist
description: "Structured code review checklist — security, correctness, performance, readability, testing. Use when reviewing pull requests, evaluating AI-generated code, or auditing code quality."
---

# Code Review Checklist

## When to Use

- Reviewing a pull request before merging
- Auditing AI-generated code before accepting it
- Performing a post-mortem on a production incident tied to recent changes
- Evaluating code quality during design reviews
- Doing a pre-commit self-review of your own changes

## 🔴 HARD RULE — Review Each Lens Independently

Never mix concerns during a single read-through. Forcing the brain to switch between security, correctness, performance, readability, and testing in one pass guarantees gaps in all five. Do five separate passes, one per lens.

| Review pass | Focus on | Skip |
|-------------|----------|------|
| 1. Security | Injection, auth, secrets, permissions | Everything else |
| 2. Correctness | Logic, edge cases, invariants, error handling | Naming, style, perf |
| 3. Performance | Allocations, loops, I/O, caching | Nesting, spelling |
| 4. Readability | Naming, structure, comments, consistency | Runtime behavior |
| 5. Testing | Coverage, assertions, boundary cases | Documentation |

## Lens 1 — Security

- [ ] Are all inputs validated, sanitized, and range-checked? Never trust user input, file contents, API responses, or environment variables.
- [ ] Are SQL queries parameterized (not string-interpolated)? See the `sql-database` skill for specifics.
- [ ] Is sensitive data (passwords, tokens, keys, PII) never logged, leaked in error messages, or committed?
- [ ] Are authentication checks applied at the right layer, not just hidden in the UI?
- [ ] Is authorization checked for every operation, not just the first one in a request?
- [ ] Are file paths constructed safely (no path traversal via `../` or symlinks)?
- [ ] Are dependencies scanned for known vulnerabilities?
- [ ] Are secrets managed through a vault / environment, not hardcoded?

## Lens 2 — Correctness

- [ ] Does the code handle the happy path **and** every unhappy path (null, empty, malformed, missing)?
- [ ] Are error conditions checked immediately and explicitly, not silently swallowed?
- [ ] Are integer/arithmetic operations protected against overflow, division by zero, and precision loss?
- [ ] Are concurrency-safe patterns used where shared state exists (mutex, channels, atomics)?
- [ ] Are all branches in conditionals covered? Every `if` needs a corresponding `else` or explicit guard.
- [ ] Are magic numbers, dates, and thresholds named as constants so their meaning is explicit?
- [ ] Does the code handle resource cleanup in all exit paths (success, error, early return, panic)?
- [ ] Are edge cases tested explicitly (empty collection, single element, max size, boundary value)?

## Lens 3 — Performance

- [ ] Are allocations and copies minimized, especially in hot paths and tight loops?
- [ ] Are I/O operations (disk, network, database) batched or async rather than sequential and blocking?
- [ ] Are database queries using appropriate indexes? See `postgresql-optimization` for Pg-specific guidance.
- [ ] Is caching applied for repeated expensive operations (computation, API calls, DB queries)?
- [ ] Are data structures chosen appropriately for access patterns (hash map for lookup, array for iteration)?
- [ ] Is there an N+1 query problem in database access or API calls (loop-within-loop fetching)?
- [ ] Are large payloads paginated, truncated, or streamed rather than loaded entirely in memory?

## Lens 4 — Readability

- [ ] Do names communicate intent, not implementation detail (`calculate_total` not `doStuff`, `users` not `data`)?
- [ ] Is the code structured in small, single-responsibility functions/methods (under 30 lines where practical)?
- [ ] Are side effects obvious (functions that mutate arguments, global state, or I/O should be named accordingly)?
- [ ] Is dead code (unused variables, unreachable branches, commented-out blocks) removed?
- [ ] Are comments used for "why" not "what" — explain the non-obvious decision, not the language syntax?
- [ ] Does the code follow the project's language-specific conventions (see `go-conventions`, `python-conventions`, `rust-conventions`, `nextjs-conventions`)?

## Lens 5 — Testing

- [ ] Is there a test for each public function / API boundary?
- [ ] Do tests cover both positive cases (expected input) and negative cases (invalid input, edge values)?
- [ ] Are tests independent — no shared mutable state, no ordering dependencies?
- [ ] Do tests assert specific behavior, not just "no crash" or `expect(true).toBe(true)`?
- [ ] Is coverage meaningful — does each test verify at least one real behavior or invariant?
- [ ] Are flaky tests (timeouts, network-dependent, random-seed-dependent) explicitly flagged or avoided?
- [ ] Do tests fail meaningfully — clear assertion messages that identify the expected vs actual value?

## Model Notes

- **7B-9B models**: Review only ONE lens per turn. Asking a smaller model to evaluate all five at once guarantees shallow coverage. Use the checklist as a script — present the lens name and its numbered items, then wait for the model to work through them.
- **14B-27B models**: Can handle two lenses per pass (Security + Correctness first, then Performance + Readability, then Testing independently). The 🔴 HARD RULE is still important — skipping passes is fine, but merging them is not.
- **All local models**: The checklist format works better for smaller models than open-ended prompts. Frame the review as "Answer each of these 6-8 questions for the code below" rather than "Review this code for quality." The structure replaces reasoning depth with coverage breadth.
- **When reviewing AI-generated code**: Always start with Lens 1 (Security) and Lens 5 (Testing). These are where AI models most often produce plausible-but-wrong output. Lens 4 (Readability) is usually the strongest for AI-generated code.
