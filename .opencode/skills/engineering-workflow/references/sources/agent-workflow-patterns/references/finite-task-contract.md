# Finite Task Contract

**Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt; it must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

Every task begins with a contract before any agent is dispatched:

```text
IN_SCOPE: permitted files, behavior, and remediation
OUT_OF_SCOPE: excluded work and follow-up boundaries
Acceptance criteria: observable completion conditions
STOP_CONDITION: PASS, ESCALATE_USER, STOP, or CANCELLED
Verification plan: targeted checks, deployment/acceptance steps, bounded diagnosis limit for an unreproduced failure, and root-cause/proving-regression links
Escalation rule: evidence for one of the five permitted ESCALATE_USER conditions only
```

## Findings

| Classification | Definition | Routing |
|---|---|---|
| **BLOCKING** | In scope and fails acceptance criteria, or immediately exploitable changed code | Remediate its reproducible root cause and run the minimum targeted regression |
| **FOLLOW_UP** | Valid but out of scope, deferred, or non-blocking | Report separately; never auto-dispatch |
| **INFORMATIONAL** | Context or suggestion | Report only |

Only an in-scope BLOCKING finding reopens work. Every remediation must name and address the currently failing reproducible root cause; a failing check or remediation count alone never returns **ESCALATE_USER**.

## Verification and Cancellation

Each verification phase is an explicitly named set of targeted checks. A follow-on check must prove a named causal remediation or execute a declared deployment/acceptance step; do not use generic retries to hide a defect. Continue declared **source fix → targeted test → deploy → acceptance** work automatically.

**STOP** and **CANCELLED** are terminal only on an explicit user request. Do not dispatch agents, QA, Docs, security review, visual QA, or a sweep. Preserve resumable state, existing evidence, and completed/skipped work; a remediation request is never terminal by reinterpretation.

Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven. Never report completion from source tests alone. Runtime-impacting changes require a named, authorized writer deployment owner with Docker/Compose permission and a deployment wave to rebuild and restart the current merged source, then health-check actual routes. Visual/UI gates and full acceptance are mandatory before `PASS`; reconcile roadmap markers and `TodoWrite` before the final response.

## Autonomous Orchestration and Reviewer Handoffs

Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and declared deployment autonomously. Compile, test, package, scanner, configuration, and runtime defects with a concrete reproducible root cause are fixed and reverified automatically. Never ask permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work already within scope. Only Plan mode may use interactive decision questions; orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only for unavailable required external credential/access after the configured path was attempted, unauthorized destructive/irreversible work, a mutually exclusive product decision, a genuinely ambiguous user requirement, or no reproducible root cause after bounded diagnosis.

QA and security each report scope-classified BLOCKING/FOLLOW_UP findings once per implementation wave. They have no task-delegation authority, cannot spawn the other, and cannot reopen a closed task. After an in-scope reviewer blocker is fixed, run only its minimum targeted regression. Rerun the original reviewer check only when the fix changes that reviewer’s declared boundary; never create a recursive reviewer handoff.
