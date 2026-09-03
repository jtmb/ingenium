# Agent Concurrency Limits

## 🔴 Canonical Policy: 6 Active / 3 Writers

**Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt; it must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

| Limit | Value | Scope |
|-------|-------|-------|
| **Max active subagents per phase** | 6 | Total subagents spawned simultaneously in a single orchestration phase |
| **Max concurrent writers** | 3 | Subagents holding `edit: allow` or `write: allow` permission |
| **Read-only ceiling with `W` writers** | `6 - W` | Maximum non-writer/research/QA/security agents in the phase; it is dynamic, not a quota |
| **Unused writer slots** | `3 - W` | Capacity that must be accounted for when fewer than three writers are safe and in scope |
| **Write territories** | Exclusive | No two writers may touch the same path concurrently |

For a phase with `A` active agents, `W` writers, and `R` read-only agents, `A ≤ 6`, `W ≤ 3`, and `R = A - W ≤ 6 - W`. When `A < 6` or `W < 3`, declare `UNUSED_CAPACITY` with the exact unused active slots (`6 - A`) and writer slots (`3 - W`) plus a concrete dependency, territory, or applicability reason. Capacity is a ceiling, not a target; do not manufacture work.

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
6. **`UNUSED_CAPACITY`** — unused active and writer slots with concrete reasons for every underfilled phase

### Exact-two Todo allocation

Before every phase, enumerate the independent, dependency-ready `TodoWrite`
items and select up to three concurrently. Each selected Todo receives exactly
one pair of exactly two agents in one parallel call: one, two, or three selected
Todos use 2, 4, or 6 agents. If fewer than three are eligible, leave the
remaining capacity unused; never invent a Todo or add a third agent. Pair
members have distinct, non-overlapping responsibilities. Preserve the maximum
of three permission-derived writers, exclusive writer territories, dependency
ordering, and review gates; QA, security, and visual review Todos wait for
their declared prerequisites.

### Git and GitHub workflow

Manual and user-created commits are valid and never block continued work. Before
a requested local commit, inspect status, diff, and recent log, then stage only
intended paths. Use ordinary non-interactive Git locally and `gh` for GitHub
pushes, pull requests, and checks. Never commit unrelated changes, rewrite
published history, or force-push without explicit authorization.

Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven; never report completion from source tests alone. Runtime-impacting changes require a named, authorized writer deployment owner with Docker/Compose permission and a deployment wave to rebuild and restart the current merged source, then health-check actual routes. Visual/UI gates and full acceptance are mandatory before terminal success, and roadmap markers plus `TodoWrite` are reconciled before the final response.

## Safe Parallelism Examples

### ✅ Safe — Two selected Todos with explicit capacity

```text
Phase: "Implement auth + email" — Wave 1 (4 active, 2 pairs, 2 writers; W=2, read-only ceiling=4)
  Pair "auth boundary":
    @ingenium-software-engineer-premium → packages/ingenium-core/auth/ (writer)
    @ingenium-explore                   → scoped auth-pattern search (non-writer)
  Pair "email boundary":
    @ingenium-software-engineer-fast → services/ingenium-api/email/ (writer)
    @ingenium-scout                  → scoped email-contract context (non-writer)

UNUSED_CAPACITY:
  active slots: 2 → no third dependency-ready Todo is in scope; QA, security, and applicable visual review wait for finalized implementation and verification
  writer slots: 1 → no third non-overlapping writer territory is declared
```

Active: 4, Writers: 2, Read-only: 2 of 4. Each selected Todo has exactly two agents and the remaining capacity is intentionally unused. ✅

### ✅ Safe — Three selected Todos use all six active slots

```text
Phase: "Implementation + direct documentation + browser automation" — Wave 1 (6 active, 3 pairs, 3 writers; W=3, read-only ceiling=3)
  Pair "dashboard implementation":
    @ingenium-software-engineer-fast → dashboard/ (writer)
    @ingenium-explore                → scoped dashboard search (non-writer)
  Pair "direct documentation":
    @ingenium-docs  → docs/ (writer)
    @ingenium-scout → scoped documentation context (non-writer)
  Pair "browser automation":
    @browser-agent    → browser-recipes/ (writer)
    @ingenium-explore → separate scoped browser search (non-writer; separate invocation)

UNUSED_CAPACITY: none
```

Active: 6, Writers: 3, Read-only: 3 of 3. Docs and Browser count because their permission blocks allow `edit`/`write`; each selected Todo still has exactly two agents. ✅

### ✅ Safe — Shared post-wave review in two pairs

```text
Phase: "Finalized UI and auth review" — Wave 2 (4 active, 2 pairs, 0 writers; W=0, read-only ceiling=6)
  Pair "finalized behavior/security review":
    @ingenium-qa               → finalized behavior checks (non-writer)
    @ingenium-security-auditor → finalized auth diff/dependency review (non-writer)
  Pair "finalized UI/evidence review":
    @ingenium-qa-vision → finalized UI route review (non-writer)
    @ingenium-explore   → finalized route-boundary cross-check (non-writer)

UNUSED_CAPACITY:
  active slots: 2 → these are the only two applicable review Todos for the finalized change; no speculative reviewer or research work is added
  writer slots: 3 → implementation territories are complete, and no directly affected Docs or Browser territory is declared for this phase
```

The shared review phase is valid only after the implementation boundary and final UI change are complete. If a visual review is not applicable, or a reviewer remains blocked, omit it and state that applicability or dependency in `UNUSED_CAPACITY` instead of splitting safe reviewers or manufacturing work.

## Bounded Gates

- QA, security, and applicable visual QA share one post-wave phase when their finalized, independent checks are safe to run together. Each implementation boundary receives exactly one QA report and, only when the task contract predeclares a changed security surface, at most one eligible security report; applicable visual QA follows the final UI boundary. Reviewers have no task-delegation authority, cannot spawn one another, and cannot reopen a closed task. After an in-scope reviewer-reported blocker is remediated, run only the named minimum targeted regression, then proceed directly to deployment and acceptance; never rerun QA, security, visual QA, or any other reviewer, and never create a recursive reviewer handoff.
- QA produces exactly one report after each declared implementation boundary, using the contract-defined targeted checks, and never schedules QA/Docs work.
- Docs runs only for directly affected canonical documentation or an explicit user request; Docs never schedules QA/Docs work.
- `@ingenium-qa` solely owns a declared full E2E/container suite.
- UI work gets one changed-route visual gate after its final UI change and one batch sweep per user-requested UI batch. A reproducible visual defect receives causal remediation and the smallest proving recheck; that recheck alone is not ESCALATE_USER.
- Docs and non-UI work never open visual gates.

## Territory Reservation Protocol

Before spawning a writer, list territories, check conflicts, serialize overlaps, and record the ownership in the phase declaration. A new wave does not erase failure evidence: every follow-on remediation must name the current causal defect and its proving regression.

## 🔴 HARD RULEs

- **Never exceed 6 active subagents in any single phase**
- **Never exceed 3 concurrent writers per wave**
- **Read-only capacity is `6 - W` when `W` writers are active; it is not a quota**
- **Never overlap write territories** — serialize writers targeting the same file or directory
- **Always declare the causal task contract and phase before execution**
- **Declare `UNUSED_CAPACITY` for every underfilled phase with concrete dependency, territory, or applicability reasons**
- **Never auto-dispatch FOLLOW_UP or INFORMATIONAL findings**

## User-Facing Communication

Start with a plain-language introduction, then show the structured contract. After each phase, give an interpreted result covering the changed files, checks and outcomes, finding classification, and next dependency; continue to the next eligible phase without asking for a reprompt. End with a human-readable status summary, verification execution count, findings or remaining work, and Markdown links or repository paths to retained proof, distinguishing source-test, deployed-runtime, and model/session evidence.
