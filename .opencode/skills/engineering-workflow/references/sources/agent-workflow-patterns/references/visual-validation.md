# Visual QA Validation Protocol

## Bounded UI Gates

Visual work requires a parent task contract with `IN_SCOPE`, `OUT_OF_SCOPE`, acceptance criteria, `STOP_CONDITION`, verification budget, and escalation rule.

1. Run one changed-route visual gate only **after the final UI change** for that route.
2. Run one safe, passive full-site desktop/mobile sweep **per user-requested UI batch**.
3. Both gates must fit within the task maximum of three verification phases; each route allows one visual writer-fix/recheck maximum.
4. If the recheck FAILs or is BLOCKED, return **ESCALATE_USER** with screenshots, snapshots, console/network evidence, and cleanup confirmation. Do not request another fix or recheck.
5. Docs-only and non-UI work never opens or reopens a visual gate.

Inspect assigned non-sensitive routes at 1440x900 and 390x844. Capture descriptive screenshots and accessibility evidence, record console errors and non-2xx responses, avoid data-changing interactions, and close the browser before returning.

Classify visual findings as **BLOCKING** only when in scope and acceptance-relevant; use **FOLLOW_UP** for valid out-of-scope/non-blocking issues and **INFORMATIONAL** for context. Never auto-dispatch a visual finding.

STOP and CANCELLED are terminal: do not open the browser or run a sweep; preserve evidence and report the skipped gate.
