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

Each phase also declares its active count `A`, writer count `W`, exclusive
territories, dependencies, verification owner, and `UNUSED_CAPACITY`. With `W`
writers, at most `6 - W` read-only agents may run; this is a ceiling rather than
a quota. Underfilled active slots (`6 - A`) and writer slots (`3 - W`) require
concrete dependency, territory, or applicability reasons, and work must not be
manufactured to fill them.

Before each phase, enumerate the independent, dependency-ready `TodoWrite` items
and select up to three concurrently. Every selected Todo receives exactly one
pair of exactly two agents in one parallel call: one, two, or three selected
Todos use 2, 4, or 6 agents. If fewer than three are eligible, leave the
remaining capacity unused; never invent a Todo or add a third agent. Pair
members have distinct, non-overlapping responsibilities, and dependency order,
the three-writer maximum, exclusive territories, and QA/security/visual review
gates remain in force.

## Git and GitHub Workflow

Manual and user-created commits are valid and never block continued work. Before
committing, inspect `git status`, `git diff`, and recent `git log`; stage only
intended paths and never include unrelated changes. Use ordinary non-interactive
Git for local commits and `gh` for GitHub pushes, pull requests, and checks. Never
rewrite published history or force-push without explicit authorization.

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

## Autonomous TUI recovery

For terminal user interface (TUI) recovery, a read-only recovery preflight must
complete before any restart task is dispatched. Restart is forbidden until the
retained proof bundle establishes nonce/enrollment, durable typed handoff,
external supervisor ownership, replacement health, reconnect/resume,
rollback/adoption, and split-brain fencing. A legacy unenrolled parent is
automatically bootstrapped through an externally owned replacement and is never
signaled first. A task/tool transport abort is nonterminal: preserve the unknown
outcome and trigger immediate state recovery; never end the turn because a
restart task aborted. `PASS` requires actual live TUI/session and `TodoWrite`
replay evidence. Source tests and deployed canaries prove different boundaries
and cannot substitute for that evidence. See
[`tui-recovery.md`](tui-recovery.md).

## Autonomous Orchestration and Reviewer Handoffs

Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and declared deployment autonomously. Compile, test, package, scanner, configuration, and runtime defects with a concrete reproducible root cause are fixed and reverified automatically. Never ask permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work already within scope. Only Plan mode may use interactive decision questions; orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only for unavailable required external credential/access after the configured path was attempted, unauthorized destructive/irreversible work, a mutually exclusive product decision, a genuinely ambiguous user requirement, or no reproducible root cause after bounded diagnosis.

After implementation and its declared verification, independent applicable QA,
security, and visual QA reviews share one post-wave phase when safe. Each
implementation boundary receives exactly one QA report and, only when the task
contract predeclares a changed security surface, at most one eligible security
report; applicable visual QA follows the final UI boundary. Reviewers have no
task-delegation authority, cannot spawn one another, and cannot reopen a closed
task. If a reviewer is blocked or not applicable, declare its unused slot and
concrete reason. After an in-scope reviewer blocker is fixed, run only the named
minimum targeted regression, then proceed directly to the declared deploy and
acceptance steps; never rerun QA, security, visual QA, or any other reviewer,
even when the remediation changes the reviewer’s declared boundary, and never
create a recursive reviewer handoff.

User-facing communication starts with a plain-language introduction, presents
the structured contract, interprets each phase result in human terms, and ends
with a terminal summary containing status, changed files, verification count,
findings or remaining work, and links or paths to retained proof. Raw agent or
tool output is not a substitute for that summary.
