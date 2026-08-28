# Visual QA Validation Protocol

## Bounded UI Gates

Visual work requires a parent task contract with `IN_SCOPE`, `OUT_OF_SCOPE`, acceptance criteria, `STOP_CONDITION`, verification plan, and escalation rule.

1. Run one changed-route visual gate only **after the final UI change** for that route.
2. Run one safe, passive full-site desktop/mobile sweep **per user-requested UI batch**.
3. Both gates must be explicit in the verification plan.
4. A reproducible in-scope visual defect receives causal source remediation and the smallest route recheck that proves it. A failed/BLOCKED recheck alone is not **ESCALATE_USER**; escalate only for the task’s permitted credential/access, authorization, product-decision, ambiguity, or unreproduced-cause condition.
5. After the final UI change and its implementation verification, the visual reviewer shares one post-wave phase with independent applicable QA and security review when safe. If visual review is not applicable or is blocked, the phase declaration records its unused active slot and concrete applicability/dependency reason instead of manufacturing visual work.
6. Docs-only and non-UI work never opens or reopens a visual gate.

Inspect assigned non-sensitive routes at 1440x900 and 390x844. Capture descriptive screenshots and accessibility evidence, record console errors and non-2xx responses, avoid data-changing interactions, and close the browser before returning.

Classify visual findings as **BLOCKING** only when in scope and acceptance-relevant; use **FOLLOW_UP** for valid out-of-scope/non-blocking issues and **INFORMATIONAL** for context. Never auto-dispatch a visual finding.

STOP and CANCELLED are terminal only on an explicit user request: do not open
the browser or run a sweep; preserve evidence and report the skipped gate.
