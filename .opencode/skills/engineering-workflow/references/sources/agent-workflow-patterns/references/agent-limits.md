# Agent Concurrency Limits

## 🔴 Canonical Policy: 6 Active / 3 Writers

**Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt; it must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

| Limit | Value | Scope |
|-------|-------|-------|
| **Max active subagents per phase** | 6 | Total subagents spawned simultaneously in a single orchestration phase |
| **Max concurrent writers** | 3 | Subagents holding `edit: allow` or `write: allow` permission |
| **Remaining capacity** | 3 | Available to non-writer/research/QA/security agents |
| **Write territories** | Exclusive | No two writers may touch the same path concurrently |

## Task Contract Before Every Phase

Every task must declare **IN_SCOPE**, **OUT_OF_SCOPE**, acceptance criteria, **STOP_CONDITION**, verification plan, and escalation rule before execution. The plan identifies targeted checks, deployment/acceptance steps, a bounded diagnosis limit for an unreproduced failure, and the root-cause/proving-regression link for every remediation. A failed check or retry count alone is never **ESCALATE_USER**.

Every finding is **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. BLOCKING means an in-scope acceptance failure or immediately exploitable changed code. Only an in-scope BLOCKING finding can reopen work. Out-of-scope findings are FOLLOW_UP, reported separately, and never auto-dispatched. Every remediation names and addresses the current reproducible root cause, then runs the minimum targeted regression. STOP and CANCELLED are terminal only when explicitly requested: preserve resumable state and evidence, and run no new agents, QA, Docs, security review, visual gate, or sweep.

Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and declared deployment autonomously. Compile, test, package, scanner, configuration, and runtime defects with a concrete reproducible root cause are fixed and reverified automatically. Never ask permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work already within scope. Only Plan mode may use interactive decision questions; orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only for unavailable required external credential/access after the configured path was attempted, unauthorized destructive/irreversible work, a mutually exclusive product decision, a genuinely ambiguous user requirement, or no reproducible root cause after bounded diagnosis.

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
5. **Verification owner and plan** — targeted checks, owner, phase number, and declared execution sequence

Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven; never report completion from source tests alone. Runtime-impacting changes require a named, authorized writer deployment owner with Docker/Compose permission and a deployment wave to rebuild and restart the current merged source, then health-check actual routes. Visual/UI gates and full acceptance are mandatory before terminal success, and roadmap markers plus `TodoWrite` are reconciled before the final response.

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

- QA and security each report scope-classified BLOCKING/FOLLOW_UP findings once per implementation wave. They have no task-delegation authority, cannot spawn the other, and cannot reopen a closed task. After an in-scope reviewer blocker is fixed, run only its minimum targeted regression. Rerun the original reviewer check only when the fix changes that reviewer’s declared boundary; never create a recursive reviewer handoff.
- QA runs targeted checks once after an implementation wave and never schedules QA/Docs work.
- Docs runs only for directly affected canonical documentation or an explicit user request; Docs never schedules QA/Docs work.
- `@ingenium-qa` solely owns a declared full E2E/container suite.
- UI work gets one changed-route visual gate after its final UI change and one batch sweep per user-requested UI batch. A reproducible visual defect receives causal remediation and the smallest proving recheck; that recheck alone is not ESCALATE_USER.
- Docs and non-UI work never open visual gates.

## Territory Reservation Protocol

Before spawning a writer, list territories, check conflicts, serialize overlaps, and record the ownership in the phase declaration. A new wave does not erase failure evidence: every follow-on remediation must name the current causal defect and its proving regression.

## 🔴 HARD RULEs

- **Never exceed 6 active subagents in any single phase**
- **Never exceed 3 concurrent writers per wave**
- **Never overlap write territories** — serialize writers targeting the same file or directory
- **Always declare the causal task contract and phase before execution**
- **Never auto-dispatch FOLLOW_UP or INFORMATIONAL findings**
