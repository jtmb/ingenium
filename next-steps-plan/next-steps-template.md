# Next-Steps Orchestration Plan

Use this template to turn a request into a bounded handoff for the
Orchestrator. Keep the plan reusable: name only the files, agents, checks, and
decisions required by the request.

## Plan-mode boundary

- Plan is read-only. Do not edit, write, run Bash, mutate Docs Workspace, or
  claim implementation evidence from Plan.
- In Plan, delegate research only to `@ingenium-explore`, and only for
  read-only repository exploration. No other research or implementation
  delegation is permitted from Plan.
- Record the user's explicit maximum concurrency as
  `{{USER_REQUESTED_MAX_CONCURRENCY}}`. Do not invent a default or imply a
  universal agent ceiling.
- The Orchestrator dispatches one distinct subagent per dependency-ready Todo,
  never more than the recorded user maximum. Give each writer an exclusive,
  non-overlapping territory. Subagents do not delegate, spawn, reassign, or
  request follow-up work.

## Request and contract

**Request:** `{{REQUEST}}`

**IN_SCOPE**

- `{{FILES, ROUTES, OR BEHAVIORS}}`

**OUT_OF_SCOPE**

- `{{EXCLUDED_FILES, SYSTEMS, AND FOLLOW-UP WORK}}`

**Acceptance criteria**

- `{{TESTABLE OUTCOME 1}}`
- `{{TESTABLE OUTCOME 2}}`

**STOP_CONDITION**

- `{{PASS CONDITION, EXPLICIT STOP/CANCEL CONDITION, OR PERMITTED ESCALATION}}`

**Deployment owner:** `{{OWNER OR N/A}}`

**Verification plan**

- `{{TARGETED CHECK, EXECUTION COUNT, AND DEPLOYED CHECK IF APPLICABLE}}`

**Escalation rule**

- Escalate only for the contract's permitted credential/access,
  authorization, product-decision, ambiguity, or unreproduced-cause condition:
  `{{PERMITTED CONDITIONS}}`
- A failed check is evidence to classify and repair, not automatic escalation.

**Changed files:** `{{EXACT PATHS}}`

**Directly affected canonical documentation:** `{{EXACT DOC PATHS OR NONE}}`

## Design admission

Complete one row before each dependent mutation. If a required field is
missing or unverified, reject and replan instead of guessing.

| Executor | Exact action | Safe probe | Prerequisites | Verifier | Rollback/adoption owner | Expected evidence |
|---|---|---|---|---|---|---|
| `{{AGENT}}` | `{{MUTATION}}` | `{{READ-ONLY PROBE}}` | `{{PREREQUISITES}}` | `{{CHECK}}` | `{{OWNER}}` | `{{EVIDENCE}}` |

## Phased execution plan

### Phase `{{ID}}` — `{{NAME}}`

- **Goal:** `{{DELIVERABLE}}`
- **Dependencies:** `{{TODO IDS OR NONE}}`
- **Assigned subagent:** `{{ONE DISTINCT AGENT}}`
- **Exclusive writer territory:** `{{NON-OVERLAPPING PATHS OR READ-ONLY}}`
- **Docs:** `{{DIRECTLY AFFECTED DOCS OR N/A}}`
- **Tests/checks:** `{{TARGETED CHECKS}}`
- **Deployment/restart:** `{{OWNER, FULL PARENT RESTART BOUNDARY, OR N/A}}`
- **Exit evidence:** `{{REQUIRED EVIDENCE AND ACCEPTANCE MAPPING}}`

Map documentation and tests for every phase. When a profile, plugin, command,
instruction, or OpenCode configuration changes, restart the full parent
OpenCode process/session; restarting only a child MCP process is insufficient.
For runtime-impacting work, the authorized deployment owner rebuilds the
current merged source, restarts it, and checks actual routes.

## Evidence and failure discipline

Keep these evidence classes separate and label each as pass, fail, unknown, or
not applicable:

| Evidence class | What it proves | What it does not prove |
|---|---|---|
| Source | Focused tests, lint, typecheck, or build on the current checkout | A deployed service, visual route, or real model/session |
| Deployed | Rebuilt current source, restart, and actual-route health check | Source correctness, visual behavior, or model/session proof |
| Visual | Declared changed-route gate and required passive sweep for UI work | Source tests, deployment health, or model/session proof |
| Model/session | Actual provider, model, and session/TUI evidence | Source, deployment, or visual acceptance |

On failure, retain the first failure and its stable signature (code, tool
family, session, failing path, attempted paths, new evidence, owner, and
`nextWork`). Repair the named root cause, then rerun only the affected check.
Never retry an unchanged action with no new evidence.

Preserve stable roadmap and Todo IDs and their history. Append linked work
instead of rewriting historical entries. Update TodoWrite after each
implementation or evidence transition, then reconcile every Todo and roadmap
marker against retained evidence before the terminal response. Preserve
unknown and failed outcomes; do not convert them to success by omission.

## Copy-paste Orchestrator handoff

```text
Orchestrator, execute the approved plan below.

Maximum concurrency: {{USER_REQUESTED_MAX_CONCURRENCY}} (the user's explicit maximum; do not invent another limit).
Start only dependency-ready Todos, dispatching one distinct subagent per Todo with exclusive writer territory.
Subagents must not delegate, spawn, reassign, or request follow-up work.

Honor IN_SCOPE, OUT_OF_SCOPE, acceptance criteria, STOP_CONDITION, deployment owner,
verification plan, and escalation rule exactly. Complete the design-admission probe
before every dependent mutation. On failure, repair the named root cause and do not
repeat an unchanged action. Keep source, deployed, visual, and model/session evidence
separate. Map docs and tests per phase. Apply the full parent OpenCode restart boundary
when profile, plugin, command, instruction, or configuration changes require it.

Update TodoWrite and preserve stable roadmap IDs after every evidence transition.
Before reporting completion, reconcile all Todo and roadmap markers against retained
evidence and report changed files, checks with execution counts, unresolved findings,
and any permitted escalation.
```
