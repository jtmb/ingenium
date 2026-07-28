---
name: agent-workflow-patterns
description: "Causal implementation workflow patterns: scoped remediation, bounded diagnosis, autonomous verification, and non-recursive quality gates."
---

# Agent Workflow Patterns

## 🔴 HARD RULEs — Task Contract, Causal Remediation, and Terminal Outcomes

**Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt; it must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

Before any task dispatch, declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification plan, and escalation rule. The plan names targeted checks, deployment/acceptance steps, a bounded diagnosis limit for an unreproduced failure, and the root-cause/proving-regression link for every remediation. A failed check or retry count alone never returns **ESCALATE_USER**.

Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and declared deployment autonomously. Compile, test, package, scanner, configuration, and runtime defects with a concrete reproducible root cause are fixed and reverified automatically. Never ask permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work already within scope. Only Plan mode may use interactive decision questions; orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only for unavailable required external credential/access after the configured path was attempted, unauthorized destructive/irreversible work, a mutually exclusive product decision, a genuinely ambiguous user requirement, or no reproducible root cause after bounded diagnosis.

Classify every finding as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. BLOCKING means an in-scope acceptance failure or immediately exploitable changed code. Only an in-scope BLOCKING finding may reopen implementation. Out-of-scope findings are FOLLOW_UP and are reported separately; they are never auto-dispatched. Each remediation must name and address the current reproducible root cause, then run the minimum targeted regression.

**STOP** and **CANCELLED** are terminal only when explicitly requested: do not spawn agents, QA, Docs, security reviews, visual gates, or a final sweep. Preserve resumable state, evidence, and skipped work; never reinterpret a remediation request as terminal.

Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven. Never report completion from source tests alone. Runtime-impacting changes require a deployment owner and deployment wave that rebuilds and restarts the current merged source, then health-checks actual routes. Visual/UI gates and full acceptance are mandatory before terminal success, and roadmap markers plus `TodoWrite` must be reconciled before the final response.

## 🔴 HARD RULEs — Concurrency & Phase Scheduling

- **Maximum 6 active subagents per phase** — total simultaneous subagents, including writers and read-only agents
- **Maximum 3 concurrent writers per wave** — subagents with `edit:` or `write:` allow in their permission block
- **Exclusive write territories** — no two writers may touch the same file/directory path concurrently; serialize overlaps
- **Mandatory phase declarations** — include active count, writer count, ownership paths, dependencies, verification owner, and targeted checks in the verification plan
- **Duplicate writer instances** are valid only for separate, non-overlapping territories

## 🔴 HARD RULEs — Bounded Quality Gates

- QA and security each report scope-classified BLOCKING/FOLLOW_UP findings once per implementation wave. They have no task-delegation authority, cannot spawn the other, and cannot reopen a closed task. After an in-scope reviewer blocker is fixed, run only its minimum targeted regression. Rerun the original reviewer check only when the fix changes that reviewer’s declared boundary; never create a recursive reviewer handoff.
- QA runs targeted checks once after an implementation wave. QA and Docs never trigger QA, Docs, remediation, or new tasks.
- Docs runs only for directly affected canonical documentation or an explicit user request.
- `@ingenium-qa` is the sole owner of a declared full E2E/container suite; the orchestrator schedules it but does not duplicate it.
- UI work gets one changed-route visual gate after the final UI change and one full sweep per user-requested UI batch. A reproducible visual defect receives causal remediation and the smallest proving recheck; that recheck alone is not ESCALATE_USER.
- Docs-only and non-UI work never opens or reopens visual gates.

## 🔴 HARD RULEs — Security Boundary

- Security defaults to current-diff and relevant dependency review.
- A history scan may run once only for a confirmed secret or a critical explicit trigger.
- Out-of-scope security findings are FOLLOW_UP unless changed code is immediately exploitable.

## Reference Files

| File | Content |
|------|--------|
| [`references/finite-task-contract.md`](references/finite-task-contract.md) | Canonical scope, finding-classification, bounded verification, cancellation, and escalation rules |
| [`references/agent-limits.md`](references/agent-limits.md) | Canonical concurrency policy and bounded phase declaration |
| [`references/visual-validation.md`](references/visual-validation.md) | Bounded changed-route and batch visual QA protocol |
