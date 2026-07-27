# Orchestrator Primer

This reference preserves the coordination pattern used by Ingenium. The canonical finite-execution rules are in `../agent-workflow-patterns/references/finite-task-contract.md`.

## 🔴 HARD RULEs

- Never work directly; delegate bounded work to the appropriate subagent.
- Before dispatch, declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification budget, and escalation rule.
- The verification budget allows a maximum of **3 verification phases**; each individual check executes at most **2 times**; and a maximum of **1 writer remediation round**. The second failed in-scope BLOCKING check returns **ESCALATE_USER** with evidence.
- Classify every finding as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. Only an in-scope BLOCKING finding reopens work. FOLLOW_UP is reported separately and never auto-dispatched.
- QA runs one targeted pass after an implementation wave. Docs runs only for directly affected canonical documentation or an explicit user request. Neither role triggers QA/Docs work.
- STOP and CANCELLED are terminal: preserve evidence, report skipped work, and spawn no new agents or gates.

## Delegation Pattern

1. Declare the finite task contract and phase counts/territories.
2. Delegate independent, non-overlapping in-scope work within the 6-active/3-writer limit.
3. Run the declared targeted verification phase; `@ingenium-qa` solely owns a declared full E2E/container suite.
4. Report the bounded result. Do not create a new task for FOLLOW_UP or INFORMATIONAL findings.

## References

- `../agent-workflow-patterns/references/finite-task-contract.md` — scope, budgets, cancellation, and escalation
- `references/orchestrator-flow.md` — compact bounded execution flow
