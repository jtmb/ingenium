---
name: agent-execution-quality
description: "Agent execution standards requiring actual testing, one-shot solutions, and no dead code"
---

# Agent Execution Quality

## 🔴 HARD RULEs
- Agents MUST actually test functionality until it works, not pretend to test
- Deliver one-shot complete solutions without incremental approaches
- No dead code or silent failures in any output
- Premium agents required for task execution

## Reference Files

| File | Content |
|------|--------|
| [`references/testing-requirements.md`](references/testing-requirements.md) | Actual testing standards and verification protocols |
| [`references/one-shot-solutions.md`](references/one-shot-solutions.md) | Complete solution delivery patterns |
| [`references/file-management-rules.md`](references/file-management-rules.md) | Agent file overwrite prevention rules |

## 🔴 HARD RULEs
- One-shot delivery must result in fully functional output with rigorous testing until it works (importance: 9)
- Never use simulated testing - actual verification required at every phase
- Test selectors must be specific and stable (data-testid over generic selectors) (importance: 85)
- QA must reproduce exact reported user actions, not adjacent endpoints (importance: 90)

## Reference Files

| File | Content |
|------|--------|
| [`references/one-shot-delivery.md`](references/one-shot-delivery.md) | One-shot complete solutions without dead code or silent failures |
| [`references/rigorous-testing-standards.md`](references/rigorous-testing-standards.md) | Testing standards that catch real issues, not just passing tests |
| [`references/qa-reproduction-guidelines.md`](references/qa-reproduction-guidelines.md) | QA must reproduce exact user actions for bug verification

## 🔴 HARD RULEs
- Actual testing required until functionality works (no simulated testing)
- One-shot complete solutions without dead code or silent failures
- Self-verification mandatory at end of every task before delivery

## Reference Files

| File | Content |
|------|--------|
| [`references/testing-requirements.md`](references/testing-requirements.md) | Actual testing vs simulated testing rules |
| [`references/one-shot-delivery.md`](references/one-shot-delivery.md) | One-shot approach without excuses |
| [`references/quality-gates.md`](references/quality-gates.md) | Quality gate requirements including visual validation |