---
name: engineering-workflow
description: "Agent execution quality, debugging methodology, OpenCode agent configuration, orchestrator pipeline, logging visibility, per-project scoping, supervision, and direct response patterns. Use when creating agents, debugging failures, configuring pipelines, scoping work, or reviewing agent behavior."
alwaysApply: true
tags: ["engineering", "workflow", "agents", "debugging", "orchestrator", "logging", "supervision"]
---

# Engineering Workflow

> Unified engineering workflow conventions across agent execution, debugging, agent configuration, orchestrator pipeline, logging, supervision, and project scoping. Absorbed 9 legacy skills.

## When to Use

- Creating or auditing OpenCode agent definitions (`permission` blocks, `@skill` references)
- Debugging test failures, crashes, or unexpected behavior
- Configuring orchestrator pipelines and agent delegation
- Setting up logging, tracing, or supervision for agent execution
- Scoping work to specific projects or worktrees
- Ensuring agents self-verify and avoid simulated testing
- Handling uncensored direct responses from models

## 🔴 HARD RULEs

### 🔴 Open-Roadmap Turn Rule

While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt. It must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

### 🔴 Self-Verify Everything Before Delivery

Every agent task must self-verify: run typechecks, tests, lints before returning results. Never ask the user to verify — do it yourself. No simulated testing.

### 🔴 Mandatory Phase Commit Boundaries

The configured `scripts/phase-commit.sh` contract is mandatory for every
declared implementation, docs, QA-remediation, deployment-remediation, and
acceptance-fix phase. Read-only diagnosis and review phases also require both
boundaries, even when they produce no repository changes:

```bash
scripts/phase-commit.sh begin <phase-id>
scripts/phase-commit.sh end [--allow-empty] <phase-id> '<semantic commit message>'
```

`begin` runs before work, records the begin SHA, and opens protected state only
from a fully clean worktree, including non-ignored untracked files. A dirty
pre-phase tree blocks dispatch; it is never permission to commit unrelated
changes. Writers return exact paths, and the orchestrator stages only those
intended paths before `end`. Unknown files, generated artifacts, secrets,
another worktree/session's changes, amend commits, and hook bypasses are never
accepted. A verified no-change phase uses `--allow-empty`.

Each phase has exactly one begin marker followed by one terminal end or cancel
commit. No ordinary commit may occur between those boundaries or outside an
active phase; the orchestrator creates commits only through the phase helper.
Its Bash permissions are ordered for last-match semantics: wildcard/broad Git
denials, helper and read-only inspection allows, then direct commit/ref/push/
reset, hook/config/index mutation, and amend denials. The helper uses standard
Git hooks, revalidates the bound ref and index after each pre-update hook, and
rejects hook changes to the verified index; a failed pre-update hook leaves the
phase active for correction.

No next phase dispatch is allowed while state is open. Explicit STOP/CANCELLED
uses only `scripts/phase-commit.sh cancel <phase-id> [reason]` from a clean tree;
it does not absorb dirty work. A failed end or cancel preserves resumable phase
state, and a failed begin writes no state. Deployment/source changes made within
a phase must be in its end commit before the next phase. Final reconciliation
must pass `scripts/phase-commit.sh verify-history [baseline..target]` with every
first-parent begin paired to its matching end or authorized cancel.
The history check may be deferred during pre-end validation while the active
boundary is open, but must pass after end or cancel and before the next phase.

### 🔴 Isolate Before You Fix

Never attempt a fix until you have isolated the minimal reproduction. Guessing at fixes without isolation leads to cascading changes that obscure the root cause.

### 🔴 Read the FIRST Error, Not the Last

Build tools report cascading errors. Always scroll to the top and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

### 🔴 Every Agent MUST Use `@skill-name` References

In Required Skills sections and inline prose, use the `@` prefix so OpenCode can resolve the skill: `@development-conventions`, `@devops-conventions`, `@mcp-tooling`.

### 🔴 Every Agent MUST Have Explicit `permission` Block in Frontmatter

Every agent definition must include a `permission` block explicitly allowing the tools and skills it needs. No implicit permissions.

### 🔴 Writer Accounting Is Permission-Derived

An agent is a writer when its permission block grants `edit: allow` or `write: allow`, regardless of whether the task is code, documentation, or browser automation. In the current topology, `@ingenium-software-engineer-fast`, `@ingenium-software-engineer-premium`, `@ingenium-docs`, and `@browser-agent` are writers. Docs and Browser therefore count toward the maximum of three concurrent writers, and Browser is dispatchable. Every phase must stay at **≤6 active subagents and ≤3 permission-derived writers**; reserve exclusive territories and serialize overlaps.

Valid example: one phase with Fast, Docs, and Browser writers plus QA, Explore, and QA Vision read-only agents is **6 active / 3 writers**. A phase declaration must state those counts before dispatch.

### Phase Declaration Protocol

Every phase declaration must record:

1. **Phase ID** — lowercase slug passed to `phase-commit.sh`
2. **Begin SHA** — recorded after the successful begin marker
3. **Expected end commit owner** — one named boundary owner
4. **Active count** — total subagents (max 6)
5. **Writer count** — total writers (max 3)
6. **Exclusive territories** — file/directory ownership per writer; zero overlap
7. **Dependencies** — serialization order for writers sharing territories across waves
8. **Verification owner and checks** — targeted owner and checks for source fix → targeted test → deploy → acceptance

### 🔴 Agent Output Must Be Direct and Uncensored

No sugarcoating, no evasion, no refusal-to-answer patterns. Deliver direct, technically precise responses.

### 🔴 Per-Project Scoping — INGENIUM_PROJECT

Always respect the current project scope. Don't cross-contaminate projects. Use `INGENIUM_PROJECT` env var for extension plugins.

## Reference Files

### Agent Configuration
| File | Content |
|------|---------|
| [`references/sources/configuring-opencode/source-index.md`](references/sources/configuring-opencode/source-index.md) | Agent conventions: permissions, @skill references, plugin rules |
| [`references/sources/configuring-opencode/references/`](references/sources/configuring-opencode/references/) | Agent template |

### Debugging
| File | Content |
|------|---------|
| [`references/sources/debugging-patterns/source-index.md`](references/sources/debugging-patterns/source-index.md) | Debugging methodology: isolation, bisection, error interpretation |
| [`references/sources/debugging-patterns/references/`](references/sources/debugging-patterns/references/) | Isolation methods, error maps, self-correction, model notes |

### Agent Quality
| File | Content |
|------|---------|
| [`references/sources/agent-execution-quality/source-index.md`](references/sources/agent-execution-quality/source-index.md) | Testing requirements, one-shot solutions, file management |
| [`references/sources/agent-execution-quality/references/`](references/sources/agent-execution-quality/references/) | Testing standards, quality gates |

### Workflow & Orchestration
| File | Content |
|------|---------|
| [`references/sources/agent-workflow-patterns/source-index.md`](references/sources/agent-workflow-patterns/source-index.md) | Agent workflow patterns |
| [`references/sources/orchestrator-primer/source-index.md`](references/sources/orchestrator-primer/source-index.md) | Orchestrator pipeline primer |
| [`references/sources/orchestrator-primer/references/`](references/sources/orchestrator-primer/references/) | Orchestrator flow |

### Logging & Supervision
| File | Content |
|------|---------|
| [`references/sources/logging-visibility/source-index.md`](references/sources/logging-visibility/source-index.md) | Dashboard logging, execution tracing |
| [`references/sources/logging-visibility/references/`](references/sources/logging-visibility/references/) | Logging patterns |
| [`references/sources/supervision-logging/source-index.md`](references/sources/supervision-logging/source-index.md) | Detection prompts, phase gating |
| [`references/sources/supervision-logging/references/`](references/sources/supervision-logging/references/) | Supervision overlays |

### Scoping & Response
| File | Content |
|------|---------|
| [`references/sources/per-project-scoping/source-index.md`](references/sources/per-project-scoping/source-index.md) | Per-project scoping conventions |
| [`references/sources/uncensored-direct-response/source-index.md`](references/sources/uncensored-direct-response/source-index.md) | Uncensored direct response patterns |

## Cross-References

- **`@development-conventions`** — Code conventions, API design, Next.js, Python
- **`@devops-conventions`** — Docker, K8s, CLI toolkit, shell scripts
- **`@mcp-tooling`** — Browser automation, Docs RAG persistence, email tools
- **`@local-models`** — Command safety rules, model profiles
- **`@self-learning`** — Observation pipeline, personality traits
