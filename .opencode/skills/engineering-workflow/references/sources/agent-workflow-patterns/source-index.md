---
name: agent-workflow-patterns
description: "Implementation workflow patterns including verification gates, agent limits, and documentation requirements"
---

# Agent Workflow Patterns

## 🔴 HARD RULEs — Concurrency & Phase Scheduling

- **Maximum 12 active subagents per phase** — total simultaneous subagents, including both writers and read-only agents
- **Maximum 6 concurrent writers per wave** — subagents with `edit:` or `write:` allow in their permission block
- **Exclusive write territories** — no two writers may touch the same file/directory path concurrently; serialize overlapping writers across waves
- **Remaining active capacity** (beyond writer count, up to 12 total) reserved for read-only/research/QA/docs/security/browser agents
- **Mandatory phase declarations** — before executing any phase, declare: active count, writer count, ownership paths, dependencies, verification owners
- **Duplicate writer instances** (same agent type) are valid only for separate, non-overlapping territories

## 🔴 HARD RULEs — Verification & Quality Gates

- Always verify sub-agent outputs for concerns, recommendations, findings, and bugs before advancing phases
- All sub-agent outputs must be audited before proceeding to next phase
- Every sub-agent finding must be added as a todo task before next phase begins
- Gates must not advance until real tests pass AND screenshots verified via @vision-bridge
- Self-verification mandatory at end of every task before delivery
- Health checks at Gate 1 should be short verification (not 5-minute waits) when changes don't affect schedulers/timers

## 🔴 HARD RULEs — Visual & Tooling

- Apply @vision-bridge in Phase 2.5 for visual validation (not just subagent-reported checks)
- Use todo tool throughout all implementation phases
- Provide text summary of what was done at end of sessions
- Final summary required explaining what was performed and verified

## 🔴 HARD RULEs — Plan Architecture

- Plans must be architected into distinct phases for orchestrator execution
- Plan handoff messages must include specific agent count instructions (max 12 active, max 6 writers per phase)
- Every plan must end with copy-paste handoff instruction summarizing agent limits and verification steps
- Parallel subagent planning governed by 12-active/6-writer policy, prioritizing engineer/qa tasks for speedup
- Documentation and testing mapped at EVERY phase before proceeding

## 🔴 HARD RULEs — Execution

- Iterative testing required until functionality confirmed (no simulated testing)
- Visual validation from orchestrator required during implementation phases
- Tool selection: @ingenium-explore for exploration, @ingenium-software-engineer-premium for deep reasoning, @ingenium-software-engineer-terra for critical tasks (auth, migrations, runtime outages, multi-service contracts, cross-package refactors, persistent high-risk failures)
- @ingenium-software-engineer-fast for routine isolated fixes/tests

## Reference Files

| File | Content |
|------|--------|
| [`references/agent-limits.md`](references/agent-limits.md) | Canonical concurrency policy: 12 active subagents per phase, 6 concurrent writers, exclusive territories, mandatory phase declarations, collision resolution |
| [`references/verification-gates.md`](references/verification-gates.md) | Sub-agent output verification patterns and gate requirements |
| [`references/visual-validation.md`](references/visual-validation.md) | @vision-bridge visual check requirements and Phase 2.5 workflow |
| [`references/todo-workflow.md`](references/todo-workflow.md) | Todo tool usage patterns across implementation phases |
| [`references/session-summary.md`](references/session-summary.md) | End-of-session text summary requirements |
| [`references/orchestrator-phases.md`](references/orchestrator-phases.md) | Plans architected into distinct phases |
| [`references/plan-handoff-format.md`](references/plan-handoff-format.md) | Copy-paste handoff instruction format with agent limits and verification steps |
| [`references/phase-documentation-mapping.md`](references/phase-documentation-mapping.md) | Documentation and testing mapped at every phase before implementation begins |
| [`references/orchestrator-visual-validation.md`](references/orchestrator-visual-validation.md) | Visual validation requirements for orchestrator acceptance |
| [`references/handoff-message-template.md`](references/handoff-message-template.md) | Plan handoff messages with agent count and verification instructions |
| [`references/self-verification.md`](references/self-verification.md) | End-of-task self-verification requirements |
| [`references/task-summary.md`](references/task-summary.md) | Final summary format and content expectations |
