# Agent Concurrency Limits

## 🔴 Canonical Policy: 6 Active / 3 Writers

| Limit | Value | Scope |
|-------|-------|-------|
| **Max active subagents per phase** | 6 | Total subagents spawned simultaneously in a single orchestration phase |
| **Max concurrent writers** | 3 | Subagents holding `edit: allow` or `write: allow` permission |
| **Remaining capacity** | 3 | Available to non-writer/research/QA/security agents |
| **Write territories** | Exclusive | No two writers may touch the same path concurrently |

## Task Contract Before Every Phase

Every task must declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification budget, and escalation rule before execution. The verification budget is finite: maximum **3 verification phases per task**, each individual check may execute at most **2 times**, and maximum **1 writer remediation round**. The second failed execution of an in-scope BLOCKING check is **ESCALATE_USER** with evidence, not a new retry.

Every finding is **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. Only an in-scope BLOCKING finding can reopen work. Out-of-scope findings are FOLLOW_UP, reported separately, and never auto-dispatched. STOP and CANCELLED are terminal: preserve evidence and run no new agents, QA, Docs, security review, visual gate, or sweep.

## Writer Classification

A **writer** is any subagent with `edit: allow` or `write: allow` in its permission block:

- `@ingenium-software-engineer-fast` — writer
- `@ingenium-software-engineer-premium` — writer
- `@ingenium-docs` — writer
- `@browser-agent` — writer

**Non-writers** count toward the active limit but not the writer limit:

- `@ingenium-explore`, `@ingenium-scout`, `@ingenium-qa`, `@ingenium-qa-vision`, `@ingenium-security-auditor`

## Mandatory Phase Declarations

Every orchestration phase must declare:

1. **Active count** — total subagents to spawn in this phase (max 6)
2. **Writer count** — total writers among them (max 3)
3. **Ownership paths** — each writer's exclusive territory
4. **Dependencies** — writers that must complete before others start
5. **Verification owner and budget** — targeted checks, owner, phase number, and remaining executions

## Safe Parallelism Examples

### ✅ Safe — Full parallel (3 writers, non-overlapping territories)

```text
Phase: "Implement auth + email + dashboard widgets" — Wave 1 (5 active, 3 writers)
  @ingenium-software-engineer-premium → packages/ingenium-core/auth/     (writer)
  @ingenium-software-engineer-premium → services/ingenium-api/email/    (writer)
  @ingenium-software-engineer-fast    → services/ingenium-dashboard/components/ (writer)
  @ingenium-explore                   → scoped pattern search (non-writer)
  @ingenium-scout                     → scoped context retrieval (non-writer)
```

Active: 5, Writers: 3. Non-overlapping territories. ✅

### ✅ Safe — Docs and Browser are permission-derived writers

```text
Phase: "Implementation + direct documentation + browser automation" — Wave 1 (5 active, 3 writers)
  @ingenium-software-engineer-fast → dashboard/       (writer)
  @ingenium-docs                   → docs/            (writer)
  @browser-agent                   → browser-recipes/ (writer)
  @ingenium-explore                → scoped search    (non-writer)
  @ingenium-scout                  → scoped context   (non-writer)
```

Active: 5, Writers: 3. Docs and Browser count because their permission blocks allow `edit`/`write`; QA and visual gates run after final implementation. ✅

## Bounded Gates

- QA runs targeted checks once after an implementation wave and never schedules QA/Docs work.
- Docs runs only for directly affected canonical documentation or an explicit user request; Docs never schedules QA/Docs work.
- `@ingenium-qa` solely owns a declared full E2E/container suite.
- UI work gets one changed-route visual gate after its final UI change and one batch sweep per user-requested UI batch. Each route permits one writer fix/recheck; a failed/BLOCKED recheck is ESCALATE_USER.
- Docs and non-UI work never open visual gates.

## Territory Reservation Protocol

Before spawning a writer, list territories, check conflicts, serialize overlaps, and record the ownership in the phase declaration. A new wave does not reset the task's verification or remediation budget.

## 🔴 HARD RULEs

- **Never exceed 6 active subagents in any single phase**
- **Never exceed 3 concurrent writers per wave**
- **Never overlap write territories** — serialize writers targeting the same file or directory
- **Always declare the finite task contract and phase before execution**
- **Never auto-dispatch FOLLOW_UP or INFORMATIONAL findings**
