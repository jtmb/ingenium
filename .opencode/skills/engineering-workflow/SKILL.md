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

### 🔴 Self-Verify Everything Before Delivery

Every agent task must self-verify: run typechecks, tests, lints before returning results. Never ask the user to verify — do it yourself. No simulated testing.

### 🔴 Isolate Before You Fix

Never attempt a fix until you have isolated the minimal reproduction. Guessing at fixes without isolation leads to cascading changes that obscure the root cause.

### 🔴 Read the FIRST Error, Not the Last

Build tools report cascading errors. Always scroll to the top and fix the first error first. In 80% of cases, fixing the first error eliminates the rest.

### 🔴 Every Agent MUST Use `@skill-name` References

In Required Skills sections and inline prose, use the `@` prefix so OpenCode can resolve the skill: `@development-conventions`, `@devops-conventions`, `@mcp-tooling`.

### 🔴 Every Agent MUST Have Explicit `permission` Block in Frontmatter

Every agent definition must include a `permission` block explicitly allowing the tools and skills it needs. No implicit permissions.

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
- **`@mcp-tooling`** — Browser automation, Thread persistence, email tools
- **`@local-models`** — Command safety rules, model profiles
- **`@self-learning`** — Observation pipeline, personality traits
