# Orchestrator Primer

This reference preserves the coordination pattern used by Ingenium. The canonical finite-execution rules are in `../agent-workflow-patterns/references/finite-task-contract.md`.

## 🔴 HARD RULEs

- **Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt; it must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

- Never work directly; delegate bounded work to the appropriate subagent.
- Before dispatch, declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification plan, and escalation rule.
- The verification plan names targeted checks, deployment/acceptance steps, a bounded diagnosis limit for an unreproduced failure, and the root-cause/proving-regression link for every remediation. A failed check or retry count alone never returns **ESCALATE_USER**.
- Classify every finding as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. BLOCKING means an in-scope acceptance failure or immediately exploitable changed code. FOLLOW_UP is reported separately and never auto-dispatched.
- Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and declared deployment autonomously. Compile, test, package, scanner, configuration, and runtime defects with a concrete reproducible root cause are fixed and reverified automatically. Never ask permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work already within scope. Only Plan mode may use interactive decision questions; orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only for unavailable required external credential/access after the configured path was attempted, unauthorized destructive/irreversible work, a mutually exclusive product decision, a genuinely ambiguous user requirement, or no reproducible root cause after bounded diagnosis.
- QA and security each report scope-classified BLOCKING/FOLLOW_UP findings once per implementation wave. They have no task-delegation authority, cannot spawn the other, and cannot reopen a closed task. After an in-scope reviewer blocker is fixed, run only its minimum targeted regression. Rerun the original reviewer check only when the fix changes that reviewer’s declared boundary; never create a recursive reviewer handoff.
- QA runs one targeted pass after an implementation wave. Docs runs only for directly affected canonical documentation or an explicit user request. Neither role triggers QA/Docs work.
- STOP and CANCELLED are terminal only when explicitly requested: preserve resumable state, evidence, and skipped work, and spawn no new agents or gates. Never reinterpret a remediation request as terminal.
- Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven. Never report completion from source tests alone.
- Runtime-impacting changes require a named, authorized writer deployment owner with Docker/Compose permission and a deployment wave. The owner rebuilds and restarts the current merged source, then health-checks actual routes. Visual/UI gates and full acceptance are mandatory before terminal success; reconcile roadmap markers and `TodoWrite` before the final response.
- Manual and user-created commits are valid and never block continued work. Before a local commit, inspect status, diff, and recent log, then stage only intended paths. Use ordinary non-interactive Git for local commits and `gh` for GitHub pushes, pull requests, and checks. Never commit unrelated changes, rewrite published history, or force-push without explicit authorization.

## Delegation Pattern

1. Declare the causal task contract and phase counts/territories.
2. Delegate independent, non-overlapping in-scope work within the 6-active/3-writer limit.
3. Run the declared targeted verification phase; `@ingenium-qa` solely owns a declared full E2E/container suite.
4. Continue declared source fix → targeted test → deploy → acceptance work, then report the result. Do not create a new task for FOLLOW_UP or INFORMATIONAL findings.

## References

- `../agent-workflow-patterns/references/finite-task-contract.md` — scope, bounded verification, cancellation, and escalation
- `references/orchestrator-flow.md` — compact bounded execution flow
