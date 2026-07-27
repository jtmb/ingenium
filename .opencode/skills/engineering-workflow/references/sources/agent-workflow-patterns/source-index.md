---
name: agent-workflow-patterns
description: "Bounded implementation workflow patterns: finite task contracts, scope control, verification budgets, and non-recursive quality gates."
---

# Agent Workflow Patterns

## 🔴 HARD RULEs — Task Contract and Terminal Outcomes

Before any task dispatch, declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification budget, and escalation rule. A task has a maximum of **3 verification phases**, each individual check may execute at most **2 times**, and it permits a maximum of **1 writer remediation round**. A second failed execution of an in-scope blocking check returns **ESCALATE_USER** with evidence; no retry or follow-on dispatch resets that budget.

Classify every finding as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. Only an in-scope BLOCKING finding may reopen implementation. Out-of-scope findings are FOLLOW_UP and are reported separately; they are never auto-dispatched.

**STOP** and **CANCELLED** are terminal: do not spawn agents, QA, Docs, security reviews, visual gates, or a final sweep. Preserve evidence and report skipped work.

## 🔴 HARD RULEs — Concurrency & Phase Scheduling

- **Maximum 6 active subagents per phase** — total simultaneous subagents, including writers and read-only agents
- **Maximum 3 concurrent writers per wave** — subagents with `edit:` or `write:` allow in their permission block
- **Exclusive write territories** — no two writers may touch the same file/directory path concurrently; serialize overlaps
- **Mandatory phase declarations** — include active count, writer count, ownership paths, dependencies, verification owner, and remaining verification budget
- **Duplicate writer instances** are valid only for separate, non-overlapping territories

## 🔴 HARD RULEs — Bounded Quality Gates

- QA runs targeted checks once after an implementation wave. QA and Docs never trigger QA, Docs, remediation, or new tasks.
- Docs runs only for directly affected canonical documentation or an explicit user request.
- `@ingenium-qa` is the sole owner of a declared full E2E/container suite; the orchestrator schedules it but does not duplicate it.
- UI work gets one changed-route visual gate after the final UI change and one full sweep per user-requested UI batch. One visual fix/recheck maximum applies per route; a failed/BLOCKED recheck is ESCALATE_USER.
- Docs-only and non-UI work never opens or reopens visual gates.

## 🔴 HARD RULEs — Security Boundary

- Security defaults to current-diff and relevant dependency review.
- A history scan may run once only for a confirmed secret or a critical explicit trigger.
- Out-of-scope security findings are FOLLOW_UP unless changed code is immediately exploitable.

## Reference Files

| File | Content |
|------|--------|
| [`references/finite-task-contract.md`](references/finite-task-contract.md) | Canonical scope, finding-classification, budget, cancellation, and escalation rules |
| [`references/agent-limits.md`](references/agent-limits.md) | Canonical concurrency policy and bounded phase declaration |
| [`references/visual-validation.md`](references/visual-validation.md) | Bounded changed-route and batch visual QA protocol |
