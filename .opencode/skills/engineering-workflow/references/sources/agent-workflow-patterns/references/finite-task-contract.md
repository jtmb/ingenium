# Finite Task Contract

Every task begins with a contract before any agent is dispatched:

```text
IN_SCOPE: permitted files, behavior, and remediation
OUT_OF_SCOPE: excluded work and follow-up boundaries
Acceptance criteria: observable completion conditions
STOP_CONDITION: PASS, ESCALATE_USER, STOP, or CANCELLED
Verification budget: maximum 3 verification phases; each individual check at most 2 executions; maximum 1 writer remediation round
Escalation rule: evidence required after the second failed in-scope blocking check
```

## Findings

| Classification | Definition | Routing |
|---|---|---|
| **BLOCKING** | In scope and prevents acceptance or a required safety result | May consume the one writer remediation round |
| **FOLLOW_UP** | Valid but out of scope, deferred, or non-blocking | Report separately; never auto-dispatch |
| **INFORMATIONAL** | Context or suggestion | Report only |

Only an in-scope BLOCKING finding reopens work. On the second failed execution of that check, return **ESCALATE_USER** with both results and do not retry.

## Verification and Cancellation

Each verification phase is an explicitly named set of targeted checks. No later phase, nested task, or QA/Docs task resets the maximum three phases, two executions per check, or single remediation round.

**STOP** and **CANCELLED** are terminal. Do not dispatch agents, QA, Docs, security review, visual QA, or a sweep. Preserve existing evidence and report completed and skipped work.
