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

### 🔴 Git and GitHub Workflow

Manual and user-created commits are valid and never block continued work. Before
committing, inspect `git status`, `git diff`, and recent `git log`; stage only
intended paths and never include unrelated changes. Use ordinary non-interactive
Git for local commits and `gh` for GitHub pushes, pull requests, and checks. Never
rewrite published history or force-push without explicit authorization.

### 🔴 Isolate Before You Fix

Never attempt a fix until you have isolated the minimal reproduction. Guessing at fixes without isolation leads to cascading changes that obscure the root cause.

### 🔴 Read the FIRST Error, Not the Last

Build tools report cascading errors. Always scroll to the top and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

### 🔴 Every Agent MUST Use `@skill-name` References

In Required Skills sections and inline prose, use the `@` prefix so OpenCode can resolve the skill: `@development-conventions`, `@devops-conventions`, `@mcp-tooling`.

### 🔴 Every Agent MUST Have Explicit `permission` Block in Frontmatter

Every agent definition must include a `permission` block explicitly allowing the tools and skills it needs. No implicit permissions.

### 🔴 Writer Accounting Is Permission-Derived

An agent is a writer when its permission block grants `edit: allow` or `write: allow`, regardless of whether the task is code, documentation, or browser automation. In the current topology, `@ingenium-software-engineer-fast`, `@ingenium-software-engineer-premium`, `@ingenium-docs`, and `@browser-agent` are writers. Docs and Browser therefore count toward the maximum of three concurrent writers, and Browser is dispatchable.

For a phase with `A` active agents, `W` permission-derived writers, and `R` read-only agents, the limits are `A ≤ 6`, `W ≤ 3`, and `R = A - W ≤ 6 - W`. Thus `6 - W` is the dynamic read-only ceiling: three writers leave three read-only slots, one writer leaves five, and zero writers leave six. It is a ceiling, not a quota; do not manufacture research, review, or implementation work to fill it.

Every phase declaration must state `A`, `W`, and the read-only ceiling. If the phase is underfilled, its `UNUSED_CAPACITY` entry must state the unused active slots (`6 - A`) and writer slots (`3 - W`) with a concrete dependency, territory, or applicability reason. Every phase must stay at **≤6 active subagents and ≤3 permission-derived writers**; reserve exclusive territories and serialize overlaps.

Valid full example: one phase with Fast, Docs, and Browser writers plus QA, Explore, and QA Vision read-only agents is **6 active / 3 writers** (`W = 3`, read-only ceiling `6 - W = 3`). A phase declaration must state those counts before dispatch.

### 🔴 Shared Post-Wave Reviewer Phase

After an implementation wave is finalized and its declared source verification is complete, schedule one post-wave phase for all independent, applicable read-only reviews that are safe to run together. `@ingenium-qa`, `@ingenium-security-auditor`, and `@ingenium-qa-vision` for an applicable UI change share that phase rather than being split for convenience. QA and security still wait for the relevant implementation boundary; visual QA waits for the final UI change. If a reviewer is blocked or not applicable, leave it out, record its unused active slot and the concrete dependency or applicability reason in `UNUSED_CAPACITY`, and do not manufacture substitute work. Each reviewer reports once per implementation wave and cannot recursively schedule another reviewer.

### Phase Declaration Protocol

Every task and phase declaration must record:

1. **Active count** — total subagents (max 6)
2. **Writer count** — total writers (max 3)
3. **Exclusive territories** — file/directory ownership per writer; zero overlap
4. **Dependencies** — serialization order for writers sharing territories across waves
5. **Verification owner and checks** — targeted owner and checks for source fix → targeted test → deploy → acceptance
6. **`IN_SCOPE` and `OUT_OF_SCOPE` boundaries** — permitted work and excluded follow-up
7. **Acceptance criteria and `STOP_CONDITION`** — observable completion and terminal outcomes
8. **Verification and escalation rules** — targeted checks, bounded diagnosis, and the five permitted escalation conditions
9. **Independent work streams** — every currently safe in-scope stream and its dependencies
10. **`UNUSED_CAPACITY`** — unused active and writer slots, with concrete reasons whenever the phase is underfilled

### User-Facing Communication

Orchestration communication is human-readable and follows four steps:

1. **Plain-language introduction** — before dispatch, explain what will happen, why it matters, and the immediate approach in one to three sentences.
2. **Structured contract** — show the task scope, acceptance criteria, stop condition, verification and escalation rules, phase counts, territories, dependencies, and unused-capacity accounting using the exact labels above.
3. **Interpreted phase result** — after each phase, explain what completed, what changed, which checks ran and passed or failed, the finding classification, and the next dependency. While work remains open, this is an immediate handoff followed by the next eligible phase in the same turn; it is not a turn-ending progress update or a request for a reprompt. Do not return raw agent JSON or tool dumps.
4. **Human-readable terminal summary** — finish with the status, what changed, verification count, findings or remaining work, and Markdown links or repository paths to the retained proof. Identify whether each proof is source-test, deployed-runtime, or model/session evidence; never imply that one evidence class proves another.

Use this terminal shape:

```text
STATUS: PASS | ESCALATE_USER | STOP | CANCELLED
What I did: <plain-language summary>
What changed: <files and behavior>
How I verified it: <targeted checks and execution count>
Where the proof is: <Markdown links or retained artifact paths>
Findings / What remains: <BLOCKING | FOLLOW_UP | INFORMATIONAL>
```

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
