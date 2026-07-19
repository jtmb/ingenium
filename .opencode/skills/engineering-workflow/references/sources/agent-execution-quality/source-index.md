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

## 🔴 HARD RULEs
- One-shot delivery must result in fully functional output with rigorous testing until it works (importance: 9)
- Never use simulated testing - actual verification required at every phase
- Test selectors must be specific and stable (data-testid over generic selectors) (importance: 85)
- QA must reproduce exact reported user actions, not adjacent endpoints (importance: 90)

## 🔴 HARD RULEs
- Actual testing required until functionality works (no simulated testing)
- One-shot complete solutions without dead code or silent failures
- Self-verification mandatory at end of every task before delivery

## Reference Files

| File | Content |
|------|--------|
| [`references/testing-requirements.md`](references/testing-requirements.md) | Actual testing vs simulated testing rules |
| [`references/one-shot-solutions.md`](references/one-shot-solutions.md) | One-shot approach without excuses |
| [`references/file-management-rules.md`](references/file-management-rules.md) | Agent file overwrite prevention rules |
