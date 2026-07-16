---
name: agent-workflow-patterns
description: "Implementation workflow patterns including verification gates, agent limits, and documentation requirements"
---

# Agent Workflow Patterns

## 🔴 HARD RULEs
- Always verify sub-agent outputs for concerns, recommendations, findings, and bugs before advancing phases
- Never exceed 6 concurrent agents per phase
- Apply @vision-bridge in Phase 2.5 for visual validation (not just subagent-reported checks)
- Use todo tool throughout all implementation phases
- Provide text summary of what was done at end of sessions

## Reference Files

| File | Content |
|------|--------|
| [`references/verification-gates.md`](references/verification-gates.md) | Sub-agent output verification patterns and gate requirements |
| [`references/agent-limits.md`](references/agent-limits.md) | Concurrent agent limits (max 6 per phase, max 4 parallel for specific phases) |
| [`references/visual-validation.md`](references/visual-validation.md) | @vision-bridge visual check requirements and Phase 2.5 workflow |
| [`references/todo-workflow.md`](references/todo-workflow.md) | Todo tool usage patterns across implementation phases |
| [`references/session-summary.md`](references/session-summary.md) | End-of-session text summary requirements

## 🔴 HARD RULEs
- Never exceed 6 concurrent agents at once (updated from previous limits)
- All sub-agent outputs must be audited for concerns, recommendations, findings, and bugs before proceeding to next phase
- Every sub-agent finding must be added as a todo task before next phase begins
- Use opencode's todo tool throughout all implementation phases for task management
- Health checks at Gate 1 should be short verification (not 5-minute waits) when changes don't affect schedulers/timers

## 🔴 HARD RULEs
- Plans must be architected into distinct phases for orchestrator execution
- Plan handoff messages must include specific agent count instructions (max 6 concurrent)
- Every plan must end with copy-paste handoff instruction summarizing agent limits and verification steps
- Parallel subagent planning limited to 6, prioritizing engineer/qa tasks for speedup

## Reference Files

| File | Content |
|------|--------|
| [`references/orchestrator-phases.md`](references/orchestrator-phases.md) | Plans architected into distinct phases |
| [`references/plan-handoff-format.md`](references/plan-handoff-format.md) | Copy-paste handoff instruction format with agent limits and verification steps |

## 🔴 HARD RULEs
- Plan handoff MUST include copy-paste line with exact agent count instruction for orchestrator
- Documentation and testing requirements mapped at EVERY phase before proceeding
- Iterative testing required until functionality confirmed (no simulated testing)
- Visual validation from orchestrator required during implementation phases
- Tool selection: @ingenium-explore for exploration, @ingenium-software-engineer-premium only for deep reasoning

## 🔴 HARD RULEs
- Documentation and testing must be mapped at every phase of agent orchestration (importance: 9)
- Visual validation required for orchestrator acceptance before declaring work complete (importance: 7)
- Handoff message template must include specific agent count instructions and verification responsibility (importance: 8)
- Parallel agent execution restricted to maximum of 6 concurrent agents at once (updated from 4)

## Reference Files

| File | Content |
|------|--------|
| [`references/phase-documentation-mapping.md`](references/phase-documentation-mapping.md) | Documentation and testing mapped at every phase before implementation begins |
| [`references/orchestrator-visual-validation.md`](references/orchestrator-visual-validation.md) | Visual validation requirements for orchestrator acceptance |
| [`references/handoff-message-template.md`](references/handoff-message-template.md) | Plan handoff messages with agent count and verification instructions

## 🔴 HARD RULEs
- Gates must not advance until real tests pass AND screenshots verified via @vision-bridge
- Self-verification mandatory at end of every task before delivery
- Final summary required explaining what was performed and verified

## Reference Files

| File | Content |
|------|--------|
| [`references/verification-gates.md`](references/verification-gates.md) | Gate advancement rules requiring test + visual validation |
| [`references/self-verification.md`](references/self-verification.md) | End-of-task self-verification requirements |
| [`references/task-summary.md`](references/task-summary.md) | Final summary format and content expectations |