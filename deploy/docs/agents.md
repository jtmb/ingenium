# Agent Architecture

## Overview

Eight agents total: 2 primary, 6 subagents. The **planner** analyzes and produces plans (read-only). The **orchestrator** executes plans with full tool access. Subagents handle specialized tasks.

## Agent Table

| Agent | Type | Model | Provider | Access | Purpose |
|-------|------|-------|----------|--------|---------|
| **ingenium-planner** | Primary | `deepseek/deepseek-v4-pro` | DeepSeek API | Read-only | Mastermind — analyzes, delegates research, produces execution plan |
| **ingenium-orchestrator** | Primary | `deepseek/deepseek-v4-flash` | DeepSeek API | Full R/W | Executor — launches subs, writes code, runs commands |
| **ingenium-explore** | Subagent | `deepseek/deepseek-v4-flash` | DeepSeek API | Read-only | Codebase search (paid Flash, max reasoning) |
| **ingenium-scout** | Subagent | `lmstudio/qwopus3.5-9b-coder` | LM Studio | Read-only | Thread/RAG persistent memory |
| **ingenium-qa** | Subagent | `opencode/deepseek-v4-flash-free` | OpenCode Zen | Write tests | Code review + test authoring |
| **ingenium-docs** | Subagent | `opencode/deepseek-v4-flash-free` | OpenCode Zen | Write docs | Documentation + skill updates |
| **security-auditor** | Subagent | `deepseek/deepseek-v4-flash` | DeepSeek API | Bash + read-only | Security audit + git-history leak scanning |
| **ingenium-software-engineer** | Subagent | `opencode/deepseek-v4-flash-free` | OpenCode Zen | Read-only | Design review, implementation analysis, technical recommendations |

## Workflow

```
User Request
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  @ingenium-planner  (DeepSeek V4 Pro)                 │
│  • Reads codebase via @ingenium-explore                 │
│  • Checks Thread via @ingenium-scout                     │
│  • Produces detailed plan                              │
└──────────────────────┬───────────────────────────────┘
    │
    │  User switches to orchestrator
    ▼
┌──────────────────────────────────────────────────────┐
│  @ingenium-orchestrator  (DeepSeek V4 Flash, max reas)│
│  • Executes plan step by step                         │
│  • Delegates specialized work to subagents            │
│  • Writes code, runs commands, commits                │
│  • Verifies tests pass                                │
│  • Saves decisions to Thread                          │
└──────────────────────────────────────────────────────┘
```

## Compute Split

| Resource | Agents | Count |
|----------|--------|-------|
| DeepSeek V4 Pro (API) | `ingenium-planner` | 1 |
| DeepSeek V4 Flash (API) | `ingenium-orchestrator`, `ingenium-explore`, `security-auditor` | 3 |
| DeepSeek V4 Flash (OpenCode Zen free) | `ingenium-qa`, `ingenium-docs`, `ingenium-software-engineer` | 3 |
| qwopus 3.5 9B Coder (LM Studio) | `ingenium-scout` | 1 |

## Subagent Invocation

Primary agents invoke subagents via the Task tool automatically. Note: `ingenium-qa` and `ingenium-docs` are write-capable — the planner cannot spawn them, only the orchestrator can.

| Subagent | `@` mention | Access | Read-only |
|----------|-------------|--------|-----------|
| ingenium-explore | `@ingenium-explore` | Read-only | ✅ planner + orchestrator |
| ingenium-scout | `@ingenium-scout` | Read-only | ✅ planner + orchestrator |
| security-auditor | `@security-auditor` | Bash + read-only | ✅ planner + orchestrator |
| ingenium-qa | `@ingenium-qa` | Write tests | ❌ orchestrator only |
| ingenium-docs | `@ingenium-docs` | Write docs | ❌ orchestrator only |
| ingenium-software-engineer | `@ingenium-software-engineer` | Read-only | ❌ orchestrator only |

## How to Use the Pipeline

### Switching Primary Agents

You have **two primary agents** — switch between them with the **Tab** key:

| Primary | Tab to | Use when you want to... |
|---------|--------|------------------------|
| **ingenium-planner** | Tab | Analyze, research, produce a plan. Read-only — no accidental edits. |
| **ingenium-orchestrator** | Tab | Execute the plan. Full write access, runs commands, drives changes home. |

### Typical Workflow

```
1. Tab → ingenium-planner
   You: "Plan the addition of OAuth to the API"
   Planner: auto-invokes @ingenium-explore, @ingenium-scout for research
            returns a step-by-step plan

2. Tab → ingenium-orchestrator  
   You: "Execute that plan"
   Orchestrator: auto-invokes subagents as needed:
     • @ingenium-explore      — finds relevant files
      • @ingenium-qa       — writes tests
      • @ingenium-docs         — updates documentation
      • @ingenium-software-engineer — design review, implementation analysis
      • @ingenium-scout        — saves decisions to Thread
   Writes code, runs commands, commits, verifies
```

### Manual Subagent Invocation

At any time, you can `@`-mention a subagent directly:

```
@ingenium-explore find all API route definitions
@ingenium-scout search Thread for past decisions about rate limiting
@security-auditor audit the auth flow for vulnerabilities
```

This opens a child session. Navigate with:
- **Right** → cycle to next child session
- **Left** → cycle to previous child session
- **Up** → return to parent session

### Automatic Delegation

Both primary agents will automatically decide when to invoke subagents. You don't need to prompt for it — just describe the task. The Task tool delegates to the right subagent based on the agent's description.

**Examples:**

| You say... | Planner auto-delegates | Orchestrator auto-delegates |
|------------|----------------------|---------------------------|
| "Add rate limiting to auth routes" | explore (find routes), scout (past context) | explore, review (tests), docs, scout (save) |
| "Refactor the payment module" | explore (find files), scout (past decisions) | explore, review (tests), docs, scout (save) |
| "Audit the repo for security issues" | security-auditor, explore | security-auditor, explore, scout (save) |
